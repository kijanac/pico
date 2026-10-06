import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { connect, type Socket } from "node:net";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, ThinkingLevel } from "@earendil-works/pi-ai";
import type {
  LogEntry,
  MessageUsage,
  PicoAttachEmission,
  PicoAttachHello,
  PicoAttachHostMessage,
  PicoAttachRequest,
  SendMode,
  SessionControls,
  SessionStats,
  StopReason,
  ToolCallMessage,
} from "@pico/protocol";

// Kept local so the installed extension has no runtime workspace dependency.
// The host accepts protocol 1 for transient attach; handoff requires version 2.
const PICO_ATTACH_PROTOCOL_VERSION = 3 as const;

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 64 * 1024;
const MAX_TOOL_ARG_CHARS = 16 * 1024;
const HANDSHAKE_TIMEOUT_MS = 30_000;
const DELTA_FLUSH_MS = 75;
const HANDOFF_RESPONSE_TIMEOUT_MS = 10_000;

const defaultSocketPath = (): string => {
  const configured = process.env.PICO_ATTACH_SOCKET?.trim();
  if (configured) return configured;
  const configuredDataDir = process.env.PICO_HOST_DATA_DIR?.trim();
  if (configuredDataDir) return join(configuredDataDir, "pi-attach.sock");
  if (process.platform === "darwin") {
    return join(homedir(), "Library/Application Support/Pico/Host/pi-attach.sock");
  }
  return join(process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local/share"), "pico/host/pi-attach.sock");
};

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;

const truncate = (value: string, limit = MAX_TEXT_CHARS): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}\n…[truncated by Pico attach]`;

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return truncate(content);
  if (!Array.isArray(content)) return "";
  return truncate(content
    .map((part) => {
      const item = record(part);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join(""));
};

const safeArgs = (value: unknown): JsonRecord => {
  const args = record(value);
  if (!args) return {};
  try {
    const encoded = JSON.stringify(args);
    if (encoded.length > MAX_TOOL_ARG_CHARS) return { preview: truncate(encoded, MAX_TOOL_ARG_CHARS) };
  } catch {
    return { preview: "[unserializable tool arguments]" };
  }
  const clean = Object.create(null) as JsonRecord;
  for (const [key, item] of Object.entries(args)) {
    if (key !== "__proto__" && key !== "constructor" && key !== "prototype") clean[key] = item;
  }
  return clean;
};

const toolCall = (id: string, name: string, args: unknown, at = Date.now()): ToolCallMessage => {
  const input = safeArgs(args);
  const base = { kind: "tool_call" as const, id, at, status: "running" as const };
  if (name === "read" && typeof input.path === "string") {
    return { ...base, toolKind: "builtin", tool: "read", args: { path: truncate(input.path, 4096) } };
  }
  if (name === "write" && typeof input.path === "string" && typeof input.content === "string") {
    return {
      ...base,
      toolKind: "builtin",
      tool: "write",
      args: { path: truncate(input.path, 4096), content: truncate(input.content, MAX_TOOL_ARG_CHARS) },
    };
  }
  if (name === "bash" && typeof input.command === "string") {
    return { ...base, toolKind: "builtin", tool: "bash", args: { command: truncate(input.command) } };
  }
  if (name === "edit" && typeof input.path === "string" && Array.isArray(input.edits)) {
    const edits = input.edits.slice(0, 50).flatMap((raw) => {
      const edit = record(raw);
      return typeof edit?.oldText === "string" && typeof edit.newText === "string"
        ? [{ oldText: truncate(edit.oldText, MAX_TOOL_ARG_CHARS), newText: truncate(edit.newText, MAX_TOOL_ARG_CHARS) }]
        : [];
    });
    return { ...base, toolKind: "builtin", tool: "edit", args: { path: truncate(input.path, 4096), edits } };
  }
  return { ...base, toolKind: "custom", tool: truncate(name, 256), args: input };
};

const completedStopReason = (
  value: AssistantMessage["stopReason"],
): StopReason | undefined =>
  value === "pending" || value === "deferred" ? undefined : value;

const snapshotFromBranch = (branch: readonly SessionEntry[]): LogEntry[] => {
  const entries: LogEntry[] = [];
  const tools = new Map<string, number>();

  // A remote view is a bounded tail, not a second full session export.
  for (const entry of branch.slice(-240)) {
    const at = new Date(entry.timestamp).getTime();
    if (entry.type === "compaction") {
      entries.push({
        kind: "compaction",
        id: entry.id,
        at,
        status: "success",
        summary: truncate(entry.summary),
        tokensBefore: entry.tokensBefore,
      });
      continue;
    }
    if (entry.type !== "message") continue;

    const message = entry.message;
    if (message.role === "user") {
      entries.push({ kind: "user", id: entry.id, at, text: textFromContent(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      entries.push({
        kind: "assistant",
        id: entry.id,
        at,
        text: textFromContent(message.content),
        ...(completedStopReason(message.stopReason)
          ? { stopReason: completedStopReason(message.stopReason) }
          : {}),
        ...(message.errorMessage ? { errorMessage: truncate(message.errorMessage) } : {}),
        ...(message.usage ? { usage: message.usage as MessageUsage } : {}),
      });
      for (const raw of message.content) {
        const part = record(raw);
        if (part?.type !== "toolCall" || typeof part.id !== "string" || typeof part.name !== "string") continue;
        tools.set(part.id, entries.length);
        entries.push(toolCall(part.id, part.name, part.arguments, at));
      }
      continue;
    }
    if (message.role === "toolResult") {
      const index = tools.get(message.toolCallId);
      if (index === undefined) continue;
      const previous = entries[index];
      if (previous?.kind !== "tool_call") continue;
      entries[index] = {
        ...previous,
        result: textFromContent(message.content),
        status: message.isError ? "error" : "ok",
        durationMs: 0,
      };
    }
  }

  const bounded: LogEntry[] = [];
  let bytes = 2;
  for (const entry of entries.slice(-120).reverse()) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (bytes + entryBytes > MAX_SNAPSHOT_BYTES) break;
    bounded.push(entry);
    bytes += entryBytes;
  }
  return bounded.reverse();
};

const controlsFor = (pi: ExtensionAPI, ctx: ExtensionContext): SessionControls => ({
  controls: [
    {
      key: "model",
      kind: "select",
      label: "model",
      value: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
      options: ctx.modelRegistry.getAvailable().map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: model.name,
        description: `${model.provider} · ${model.id} · ${Math.round(model.contextWindow / 1000)}k context`,
      })),
    },
    {
      key: "thinkingLevel",
      kind: "select",
      label: "thinking level",
      value: pi.getThinkingLevel(),
      options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        .map((level) => ({ value: level, label: level })),
    },
  ],
});

const statsFor = (ctx: ExtensionContext): SessionStats => {
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let toolResults = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let cost = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "user") userMessages += 1;
    if (entry.message.role === "assistant") {
      assistantMessages += 1;
      toolCalls += entry.message.content.filter((part) => part.type === "toolCall").length;
      if (entry.message.usage) {
        tokens.input += entry.message.usage.input;
        tokens.output += entry.message.usage.output;
        tokens.cacheRead += entry.message.usage.cacheRead;
        tokens.cacheWrite += entry.message.usage.cacheWrite;
        tokens.total += entry.message.usage.totalTokens;
        cost += entry.message.usage.cost.total;
      }
    }
    if (entry.message.role === "toolResult") toolResults += 1;
  }

  const contextUsage = ctx.getContextUsage();
  return {
    ...(ctx.sessionManager.getSessionFile() ? { sessionFile: ctx.sessionManager.getSessionFile() } : {}),
    sessionId: ctx.sessionManager.getSessionId(),
    cwd: ctx.cwd,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: userMessages + assistantMessages + toolResults,
    tokens,
    cost,
    ...(contextUsage ? { contextUsage } : {}),
  };
};

const parseHostMessage = (value: unknown): PicoAttachHostMessage => {
  const message = record(value);
  if (!message || typeof message.t !== "string") throw new Error("invalid Pico attach message");
  if (message.t === "ready" && typeof message.sessionId === "string") return value as PicoAttachHostMessage;
  if (message.t === "error" && typeof message.error === "string") return value as PicoAttachHostMessage;
  if (message.t === "request" && typeof message.id === "string" && typeof message.method === "string") {
    return value as PicoAttachHostMessage;
  }
  if (
    message.t === "handoff_response" &&
    typeof message.id === "string" &&
    ((message.ok === true && typeof message.leaseId === "string") ||
      (message.ok === false && typeof message.error === "string"))
  ) {
    return value as PicoAttachHostMessage;
  }
  throw new Error("invalid Pico attach message");
};

class PicoConnection {
  private socket: Socket | undefined;
  private buffer = "";
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private closed = false;
  private requestChain: Promise<void> = Promise.resolve();
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private backgroundIncompatibility: string | undefined;
  private pendingHandoff: {
    readonly id: string;
    readonly resolve: (leaseId: string) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | undefined;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly context: () => ExtensionContext,
    private readonly hello: PicoAttachHello,
    private readonly submitInput: (text: string, mode: SendMode, clientId: string) => void,
    private readonly onBackgroundRequested: () => void,
    private readonly onClose: (error?: Error) => void,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.handshakeTimer = setTimeout(() => this.finish(new Error("Pico attach handshake timed out")), HANDSHAKE_TIMEOUT_MS);
      this.handshakeTimer.unref();
      const socket = connect(defaultSocketPath());
      this.socket = socket;
      socket.setEncoding("utf8");
      socket.setNoDelay(true);
      socket.once("connect", () => this.write(this.hello));
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.once("error", (error) => this.finish(error));
      socket.once("close", () => this.finish(new Error("Pico host disconnected")));
    });
  }

  get connected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed && !this.closed);
  }

  get backgroundIssue(): string | undefined {
    return this.backgroundIncompatibility;
  }

  sendEvent(event: PicoAttachEmission): void {
    if (this.connected) this.write({ t: "event", event });
  }

  requestBackground(runtimeSessionId: string, runtimeSessionFile: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error("Pico remote control is not connected"));
    if (this.backgroundIncompatibility) return Promise.reject(new Error(this.backgroundIncompatibility));
    if (this.pendingHandoff) return Promise.reject(new Error("A Pico background handoff is already pending"));

    const id = randomUUID();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingHandoff?.id !== id) return;
        this.pendingHandoff = undefined;
        reject(new Error("Pico background handoff timed out"));
      }, HANDOFF_RESPONSE_TIMEOUT_MS);
      timer.unref();
      this.pendingHandoff = { id, resolve, reject, timer };
      this.write({
        t: "handoff",
        id,
        runtimeSessionId,
        runtimeSessionFile,
        ownerPid: process.pid,
      });
    });
  }

  // session_shutdown runs before Pi tears down its AgentSession. Keep the
  // socket open but unref it; the host treats OS-level close after process exit
  // as the proof that the terminal can no longer write the JSONL.
  releaseForProcessExit(): void {
    this.socket?.unref();
  }

  close(): void {
    this.finish();
  }

  private finish(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.pendingHandoff) {
      clearTimeout(this.pendingHandoff.timer);
      this.pendingHandoff.reject(error ?? new Error("Pico attach connection closed"));
      this.pendingHandoff = undefined;
    }
    this.readyReject?.(error ?? new Error("Pico attach connection closed"));
    this.readyResolve = undefined;
    this.readyReject = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
    this.onClose(error);
  }

  private write(message: unknown): void {
    const encoded = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(encoded) > MAX_LINE_BYTES || (this.socket?.writableLength ?? 0) > MAX_LINE_BYTES) {
      this.finish(new Error("Pico attach output limit exceeded"));
      return;
    }
    this.socket?.write(encoded);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) {
      this.finish(new Error("Pico attach input limit exceeded"));
      return;
    }
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: PicoAttachHostMessage;
      try {
        message = parseHostMessage(JSON.parse(line));
      } catch (error) {
        this.finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (message.t === "ready") {
        if (message.sessionId !== this.hello.session.id) {
          this.finish(new Error("Pico host acknowledged the wrong session"));
          return;
        }
        this.backgroundIncompatibility = message.backgroundCompatible === false
          ? message.backgroundIncompatibility ?? "This Pi version cannot move into the current Pico host"
          : undefined;
        if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
        this.readyResolve?.();
        this.readyResolve = undefined;
        this.readyReject = undefined;
      } else if (message.t === "error") {
        this.finish(new Error(message.error));
      } else if (message.t === "handoff_response") {
        const pending = this.pendingHandoff;
        if (!pending || pending.id !== message.id) continue;
        clearTimeout(pending.timer);
        this.pendingHandoff = undefined;
        if (message.ok) pending.resolve(message.leaseId);
        else pending.reject(new Error(message.error));
      } else {
        this.requestChain = this.requestChain.then(() => this.handleRequest(message)).catch((error) => {
          this.finish(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }

  private async handleRequest(request: PicoAttachRequest): Promise<void> {
    try {
      const value = await this.dispatch(request);
      this.write({ t: "response", id: request.id, ok: true, ...(value === undefined ? {} : { value }) });
    } catch (error) {
      this.write({
        t: "response",
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async dispatch(request: PicoAttachRequest): Promise<unknown> {
    const ctx = this.context();
    switch (request.method) {
      case "send":
        if (request.params.images && request.params.images.length > 0) {
          throw new Error("image sends are not supported by attached sessions");
        }
        this.submitInput(request.params.text, request.params.mode, request.params.clientId);
        return;
      case "interrupt":
        await ctx.abort();
        return;
      case "patchSession":
        this.pi.setSessionName(request.params.title);
        return;
      case "getSettings":
        return controlsFor(this.pi, ctx);
      case "patchSetting": {
        const { key, value } = request.params;
        if (key === "thinkingLevel" && typeof value === "string") {
          this.pi.setThinkingLevel(value as ThinkingLevel);
        } else if (key === "model" && typeof value === "string") {
          const separator = value.indexOf("/");
          if (separator <= 0 || separator === value.length - 1) throw new Error(`invalid model: ${value}`);
          const model = ctx.modelRegistry.find(value.slice(0, separator), value.slice(separator + 1));
          if (!model || !(await this.pi.setModel(model))) throw new Error(`model unavailable: ${value}`);
        } else {
          throw new Error(`unsupported attached setting: ${key}`);
        }
        return controlsFor(this.pi, ctx);
      }
      case "getStats":
        return statsFor(ctx);
      case "background":
        this.onBackgroundRequested();
        return;
    }
  }
}

export default function picoExtension(pi: ExtensionAPI): void {
  let reclaimedLogicalSessionId = process.env.PICO_RECLAIM_SESSION_ID?.trim() || undefined;
  let reclaimLeaseId = process.env.PICO_RECLAIM_LEASE_ID?.trim() || undefined;
  if (!reclaimedLogicalSessionId) reclaimLeaseId = undefined;

  let activeContext: ExtensionContext | undefined;
  let connection: PicoConnection | undefined;
  let backgroundLeaseId: string | undefined;
  let backgroundRequested = false;
  let assistantId: string | undefined;
  let pendingDelta = "";
  let deltaTimer: ReturnType<typeof setTimeout> | undefined;
  let totals = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const toolStartedAt = new Map<string, number>();
  const remoteInputs: Array<{ clientId: string }> = [];

  const emit = (event: PicoAttachEmission) => connection?.sendEvent(event);
  const flushDelta = () => {
    if (deltaTimer) clearTimeout(deltaTimer);
    deltaTimer = undefined;
    if (!assistantId || !pendingDelta) return;
    const text = pendingDelta;
    pendingDelta = "";
    emit({ t: "assistant_delta", id: assistantId, text });
  };
  const sendEvent = (event: PicoAttachEmission) => {
    if (event.t !== "assistant_delta") flushDelta();
    emit(event);
  };

  const attach = async (ctx: ExtensionCommandContext) => {
    // pico-host also discovers installed Pi extensions for its SDK sessions.
    // Attach is a terminal integration only; without this guard a host-owned
    // session could be lent back into the same host as a duplicate presence.
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Pico attach is available only in interactive terminal Pi", "warning");
      return;
    }

    if (connection?.connected) {
      flushDelta();
      connection.close();
      connection = undefined;
      backgroundLeaseId = undefined;
      reclaimedLogicalSessionId = undefined;
      ctx.ui.setStatus("pico", undefined);
      ctx.ui.notify("Pico remote control stopped", "info");
      return;
    }

    activeContext = ctx;
    const stats = statsFor(ctx);
    totals = { tokensIn: stats.tokens.input, tokensOut: stats.tokens.output, costUsd: stats.cost };
    const hello: PicoAttachHello = {
      t: "hello",
      version: PICO_ATTACH_PROTOCOL_VERSION,
      piVersion: PI_VERSION,
      ...(reclaimLeaseId ? { reclaimLeaseId } : {}),
      session: {
        id: reclaimedLogicalSessionId ?? `attached:${ctx.sessionManager.getSessionId()}`,
        title: pi.getSessionName() || basename(ctx.cwd) || "Pi session",
        cwd: ctx.cwd,
        status: ctx.isIdle() ? "idle" : "thinking",
        updatedAt: new Date().toISOString(),
        tokens: { in: stats.tokens.input, out: stats.tokens.output },
        costUsd: stats.cost,
        archived: false,
        execution: "terminal",
        canBackground: true,
        capabilities: ["rename", "interrupt", "settings", "stats"],
      },
      snapshot: snapshotFromBranch(ctx.sessionManager.getBranch()),
    };

    const next = new PicoConnection(
      pi,
      () => {
        if (!activeContext) throw new Error("Pi session is no longer active");
        return activeContext;
      },
      hello,
      (text, mode, clientId) => {
        remoteInputs.push({ clientId });
        try {
          pi.sendUserMessage(text, ctx.isIdle()
            ? undefined
            : { deliverAs: mode === "follow_up" ? "followUp" : "steer" });
        } catch (error) {
          const index = remoteInputs.findIndex((input) => input.clientId === clientId);
          if (index >= 0) remoteInputs.splice(index, 1);
          throw error;
        }
      },
      () => {
        if (backgroundRequested) return;
        backgroundRequested = true;
        // Let handleRequest write its response first. Starting the handoff in
        // the same microtask could make the host wait on an operation gate
        // whose release is queued behind that response on this socket.
        setTimeout(() => {
          void background(ctx).catch((error) => {
            backgroundRequested = false;
            ctx.ui.setStatus("pico", connection?.connected ? "remote" : undefined);
            ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
          });
        }, 0);
      },
      (error) => {
        if (connection !== next) return;
        flushDelta();
        connection = undefined;
        remoteInputs.length = 0;
        ctx.ui.setStatus("pico", undefined);
        if (error) ctx.ui.notify(error.message, "warning");
      },
    );
    connection = next;

    try {
      await next.connect();
      reclaimLeaseId = undefined;
      delete process.env.PICO_RECLAIM_LEASE_ID;
      delete process.env.PICO_RECLAIM_SESSION_ID;
      ctx.ui.setStatus("pico", "remote");
      ctx.ui.notify(
        next.backgroundIssue
          ? `Pico remote control is live. ${next.backgroundIssue}`
          : "Pico remote control is live",
        next.backgroundIssue ? "warning" : "info",
      );
    } catch (error) {
      if (connection === next) connection = undefined;
      next.close();
      // A reclaim grant is one-shot. If the host restarted or consumed it
      // before registration completed, keep terminal Pi usable and let the
      // next /pico attach under its ordinary attached:<runtime-id> identity.
      if (reclaimLeaseId) {
        reclaimLeaseId = undefined;
        reclaimedLogicalSessionId = undefined;
        delete process.env.PICO_RECLAIM_LEASE_ID;
        delete process.env.PICO_RECLAIM_SESSION_ID;
      }
      throw error;
    }
  };

  const background = async (ctx: ExtensionCommandContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Pico background is available only in interactive terminal Pi", "warning");
      return;
    }
    const runtimeSessionFile = ctx.sessionManager.getSessionFile();
    if (!runtimeSessionFile) {
      throw new Error("An ephemeral Pi session cannot move to the background");
    }

    if (!connection?.connected) await attach(ctx);
    const current = connection;
    if (!current?.connected) throw new Error("Could not attach this session to Pico");

    ctx.ui.setStatus("pico", "waiting for idle");
    await ctx.waitForIdle();
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      throw new Error("Pi still has pending work; try /pico background again when it is idle");
    }

    flushDelta();
    // Ordered immediately before the request so the host can establish the
    // lease at an idle journal boundary.
    current.sendEvent({ t: "status", status: "idle" });
    const leaseId = await current.requestBackground(
      ctx.sessionManager.getSessionId(),
      resolve(runtimeSessionFile),
    );
    if (connection !== current) throw new Error("Pico disconnected during background handoff");

    backgroundLeaseId = leaseId;
    backgroundRequested = true;
    ctx.ui.setStatus("pico", "moving to background");
    ctx.ui.notify("Session is moving to Pico background; this Pi process will exit", "info");
    ctx.shutdown();
  };

  const command = {
    description: "Attach/detach this session, or move it to Pico background",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const action = args.trim().toLowerCase();
      try {
        if (action === "background" || action === "bg") {
          if (backgroundRequested) {
            ctx.ui.notify("Pico background handoff is already in progress", "info");
          } else {
            backgroundRequested = true;
            try {
              await background(ctx);
            } catch (error) {
              backgroundRequested = false;
              throw error;
            }
          }
        }
        else if (action) ctx.ui.notify("Usage: /pico [background]", "warning");
        else await attach(ctx);
      } catch (error) {
        ctx.ui.setStatus("pico", connection?.connected ? "remote" : undefined);
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  };
  pi.registerCommand("pico", command);
  pi.registerCommand("rc", command);

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
  });
  pi.on("session_shutdown", () => {
    activeContext = undefined;
    flushDelta();
    const current = connection;
    connection = undefined;
    if (backgroundLeaseId && current) current.releaseForProcessExit();
    else current?.close();
    backgroundLeaseId = undefined;
    backgroundRequested = false;
    remoteInputs.length = 0;
  });

  pi.on("input", (event) => {
    // Pi emits the input hook from sendUserMessage in submission order. Source
    // tells us whether this came from the terminal/RPC or the extension; FIFO
    // correlation avoids guessing ownership from message text.
    const remote = event.source === "extension" ? remoteInputs.shift() : undefined;
    const entry = event.streamingBehavior
      ? {
          kind: "user" as const,
          id: randomUUID(),
          at: Date.now(),
          text: truncate(event.text),
          ...(remote ? { clientId: remote.clientId } : {}),
          queued: true as const,
          mode: event.streamingBehavior === "followUp" ? "follow_up" as const : "steer" as const,
        }
      : {
          kind: "user" as const,
          id: randomUUID(),
          at: Date.now(),
          text: truncate(event.text),
          ...(remote ? { clientId: remote.clientId } : {}),
        };
    sendEvent({ t: "user_message", entry });
    return { action: "continue" };
  });

  pi.on("message_update", (event) => {
    if (event.assistantMessageEvent.type !== "text_delta") return;
    assistantId ??= randomUUID();
    pendingDelta = truncate(pendingDelta + event.assistantMessageEvent.delta);
    if (!deltaTimer) deltaTimer = setTimeout(flushDelta, DELTA_FLUSH_MS);
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const id = assistantId ?? randomUUID();
    sendEvent({
      t: "assistant_end",
      id,
      at: Date.now(),
      text: textFromContent(event.message.content),
      ...(completedStopReason(event.message.stopReason)
        ? { stopReason: completedStopReason(event.message.stopReason) }
        : {}),
      ...(event.message.errorMessage ? { errorMessage: truncate(event.message.errorMessage) } : {}),
      ...(event.message.usage ? { usage: event.message.usage as MessageUsage } : {}),
    });
    assistantId = undefined;
    if (event.message.usage) {
      totals.tokensIn += event.message.usage.input;
      totals.tokensOut += event.message.usage.output;
      totals.costUsd += event.message.usage.cost.total;
      sendEvent({ t: "cost", ...totals });
    }
  });

  pi.on("tool_execution_start", (event) => {
    toolStartedAt.set(event.toolCallId, Date.now());
    sendEvent({ t: "tool_call", entry: toolCall(event.toolCallId, event.toolName, event.args) });
  });
  pi.on("tool_execution_update", (event) => {
    sendEvent({ t: "tool_update", id: event.toolCallId, result: textFromContent(event.partialResult.content) });
  });
  pi.on("tool_execution_end", (event) => {
    sendEvent({
      t: "tool_result",
      id: event.toolCallId,
      result: textFromContent(event.result.content),
      status: event.isError ? "error" : "ok",
      durationMs: Date.now() - (toolStartedAt.get(event.toolCallId) ?? Date.now()),
    });
    toolStartedAt.delete(event.toolCallId);
  });

  pi.on("agent_start", () => sendEvent({ t: "status", status: "thinking" }));
  pi.on("agent_end", () => sendEvent({ t: "status", status: "idle" }));
  pi.on("session_compact", (event) => {
    sendEvent({
      t: "compaction",
      entry: {
        kind: "compaction",
        id: event.compactionEntry.id,
        at: Date.now(),
        status: "success",
        reason: event.reason,
        summary: truncate(event.compactionEntry.summary),
        tokensBefore: event.compactionEntry.tokensBefore,
        ...(event.willRetry ? { willRetry: true } : {}),
      },
    });
  });
}
