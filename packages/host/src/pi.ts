import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  ModelRuntime,
  SessionManager as PiSessionManager,
  type AgentSession,
  type CreateAgentSessionFromServicesOptions,
  type AgentSessionEvent,
  type InlineExtension,
  type SessionEntry,
  type SessionStats as PiSdkSessionStats,
} from "@earendil-works/pi-coding-agent";
import type {
  Api,
  AssistantMessage as PiAssistantMessage,
  ImageContent as PiImageContent,
  Model,
  TextContent,
} from "@earendil-works/pi-ai";
import { randomUUIDv7 } from "node:crypto";
import { join } from "node:path";
import * as FileSystem from "@effect/platform/FileSystem";
import type {
  Commands,
  Entry,
  ExtensionUiRequest,
  ExtensionUiResponseValue,
  HistoryPage,
  ImageContent,
  LiveEvent,
  QueueItem,
  SendMode,
  SendState,
  SendStatus,
  ServerMessage,
  SessionControls,
  SessionMeta,
  SessionStats,
  SessionTree,
  StopReason,
  TreeEntry,
} from "@pico/protocol";
import { applyLiveEvent, emptyLive, endLiveItem, textChange } from "@pico/protocol/log";
import { SessionNotFound } from "./errors.ts";
import { HOST_DATA_DIR, PI_EPHEMERAL } from "./config.ts";
import { createMobileExtensionUiChannel } from "./mobile-extension-ui-channel.ts";
import type { SessionRecord } from "./session-record.ts";
import { textFromContent, toolResultFields } from "./tool-result-projection.ts";

export class PiError extends Data.TaggedError("PiError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ExportedHtml {
  readonly stream: Stream.Stream<Uint8Array>;
  readonly size?: number;
  readonly filename?: string;
}

export interface PiSession {
  // Entries, the live mirror, sends and subscribers (live.ts).
  readonly live: LiveSession;
  readonly interrupt: () => Effect.Effect<void, PiError>;
  readonly extensionUiResponse: (id: string, value: ExtensionUiResponseValue) => Effect.Effect<void>;
  readonly compact: (instructions?: string) => Effect.Effect<void, PiError>;
  readonly exportHtml: () => Effect.Effect<ExportedHtml, PiError>;
  readonly listCommands: () => Effect.Effect<Commands, PiError>;
  readonly getSettings: () => Effect.Effect<SessionControls, PiError>;
  readonly patchSession: (patch: { title?: string }) => Effect.Effect<void, PiError>;
  readonly patchSetting: (key: string, value: string | boolean) => Effect.Effect<SessionControls, PiError>;
  readonly getStats: () => Effect.Effect<SessionStats, PiError>;
  readonly getTree: () => Effect.Effect<SessionTree, PiError>;
  readonly navigateTree: (entryId: string, summarize?: boolean) => Effect.Effect<void, PiError>;
  readonly close: () => Effect.Effect<void>;
}

export class PiClient extends Context.Tag("PiClient")<
  PiClient,
  {
    readonly create: (opts: { cwd: string; title: string }, hooks: LiveHooks) => Effect.Effect<PiSession, PiError>;
    readonly resume: (record: SessionRecord, hooks: LiveHooks) => Effect.Effect<PiSession, PiError | SessionNotFound>;
  }
>() {}

const EXPORT_DIR = join(HOST_DATA_DIR, "exports");
const EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let modelRuntimePromise: Promise<ModelRuntime> | undefined;

// A failed create isn't cached, so the next caller retries.
export const getAgentModelRuntime = (): Promise<ModelRuntime> =>
  modelRuntimePromise ??= ModelRuntime.create().catch((error: unknown) => {
    modelRuntimePromise = undefined;
    throw error;
  });

// Where sessions come from: pi's own setup, or the mock's scripted model.
export interface PiSetup {
  readonly modelRuntime: () => Promise<ModelRuntime>;
  // pi's settings and resources; pi's own (~/.pi/agent) when unset.
  readonly agentDir?: string;
  readonly newSessionManager: (cwd: string) => PiSessionManager;
  // A saved session's file, to resume it.
  readonly findSession: (cwd: string, id: string) => string | undefined;
  // Options every session gets.
  readonly sessionOptions?: (runtime: ModelRuntime) => Pick<CreateAgentSessionFromServicesOptions, "model" | "tools">;
}

// The extensions pi's CLI loads into every session (MCP servers, codemode,
// tool search); the SDK leaves them to the host. Same defaults as the CLI's.
// Its llama.cpp extension isn't exported.
const builtInExtensions: InlineExtension[] = [
  { name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
  { name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
  { name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true },
];

// Same order as pi's CLI: the cwd's services (settings, resources, extensions
// and any providers they register), then the session from them.
const openAgentSession = async (
  setup: PiSetup,
  cwd: string,
  sessionManager: PiSessionManager,
  reason: "startup" | "resume",
): Promise<AgentSession> => {
  const modelRuntime = await setup.modelRuntime();
  const services = await createAgentSessionServices({
    cwd,
    agentDir: setup.agentDir,
    modelRuntime,
    resourceLoaderOptions: { extensionFactories: builtInExtensions },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent: { type: "session_start", reason },
    ...setup.sessionOptions?.(modelRuntime),
  });
  return session;
};

const safeFilenamePart = (value: string) =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";

const cleanupOldExports = (fs: FileSystem.FileSystem, now = Date.now()) =>
  Effect.gen(function* () {
    const names = yield* fs.readDirectory(EXPORT_DIR).pipe(Effect.orElseSucceed(() => [] as string[]));
    yield* Effect.forEach(
      names.filter((name) => name.endsWith(".html") || name.endsWith(".tmp")),
      (name) =>
        Effect.gen(function* () {
          const path = join(EXPORT_DIR, name);
          const mtime = yield* fs.stat(path).pipe(
            Effect.map((info) => info.mtime),
            Effect.orElseSucceed(() => Option.none<Date>()),
          );
          if (Option.isSome(mtime) && now - mtime.value.getTime() > EXPORT_MAX_AGE_MS) {
            yield* fs.remove(path, { force: true }).pipe(Effect.ignore);
          }
        }),
      { concurrency: "unbounded", discard: true },
    );
  });

const queueModeOptions = [
  { value: "one-at-a-time", label: "one-at-a-time" },
  { value: "all", label: "all" },
];

const modelControlValue = (model: Model<Api>): string => `${model.provider}/${model.id}`;

const modelControlDescription = (piSession: AgentSession, model: Model<Api>): string => {
  const provider = piSession.modelRuntime.getProvider(model.provider)?.name ?? model.provider;
  const tags = [provider, model.id];
  if (model.reasoning) tags.push("reasoning");
  if (model.input.includes("image")) tags.push("image");
  tags.push(`${Math.round(model.contextWindow / 1000)}k context`);
  return tags.join(" · ");
};

const sessionSettings = (piSession: AgentSession): SessionControls => ({
  controls: [
    {
      key: "model",
      kind: "select",
      label: "model",
      value: piSession.model ? modelControlValue(piSession.model) : "",
      options: piSession.modelRuntime.getAvailableSnapshot().map((model) => ({
        value: modelControlValue(model),
        label: model.name,
        description: modelControlDescription(piSession, model),
      })),
    },
    {
      key: "thinkingLevel",
      kind: "select",
      label: "thinking level",
      value: piSession.thinkingLevel,
      options: piSession.getAvailableThinkingLevels().map((level) => ({ value: level, label: level })),
    },
    {
      key: "steeringMode",
      kind: "select",
      label: "steering while running",
      value: piSession.steeringMode,
      options: queueModeOptions,
    },
    {
      key: "followUpMode",
      kind: "select",
      label: "follow-up delivery",
      value: piSession.followUpMode,
      options: queueModeOptions,
    },
    {
      key: "autoCompaction",
      kind: "boolean",
      label: "auto compact",
      value: piSession.autoCompactionEnabled,
    },
    {
      key: "autoRetry",
      kind: "boolean",
      label: "auto retry",
      value: piSession.autoRetryEnabled,
    },
  ],
});

const requireString = (key: string, value: string | boolean): string => {
  if (typeof value !== "string") throw new PiError({ message: `${key} requires a string value` });
  return value;
};

const requireBoolean = (key: string, value: string | boolean): boolean => {
  if (typeof value !== "boolean") throw new PiError({ message: `${key} requires a boolean value` });
  return value;
};

const requireOption = <T extends string>(key: string, value: string, options: readonly T[]): T => {
  if (!options.includes(value as T)) throw new PiError({ message: `${key} does not support value: ${value}` });
  return value as T;
};

const setSessionSetting = async (piSession: AgentSession, key: string, value: string | boolean): Promise<SessionControls> => {
  switch (key) {
    case "model": {
      const selected = requireString(key, value);
      const model = piSession.modelRuntime.getAvailableSnapshot().find((candidate) => modelControlValue(candidate) === selected);
      if (!model) throw new PiError({ message: `model not found: ${selected}` });
      await piSession.setModel(model);
      break;
    }
    case "thinkingLevel":
      piSession.setThinkingLevel(requireOption(key, requireString(key, value), piSession.getAvailableThinkingLevels()));
      break;
    case "steeringMode":
      piSession.setSteeringMode(requireOption(key, requireString(key, value), ["all", "one-at-a-time"]));
      break;
    case "followUpMode":
      piSession.setFollowUpMode(requireOption(key, requireString(key, value), ["all", "one-at-a-time"]));
      break;
    case "autoCompaction":
      piSession.setAutoCompactionEnabled(requireBoolean(key, value));
      break;
    case "autoRetry":
      piSession.setAutoRetryEnabled(requireBoolean(key, value));
      break;
    default:
      throw new PiError({ message: `unknown setting: ${key}` });
  }
  return sessionSettings(piSession);
};

const flattenSessionTree = (piSession: AgentSession): SessionTree => {
  const roots = piSession.sessionManager.getTree();
  const currentId = piSession.sessionManager.getLeafId();
  const byId = new Map<string, { parentId: string | null }>();
  const currentPath = new Set<string>();
  const scan = (nodes: typeof roots) => {
    for (const node of nodes) {
      byId.set(node.entry.id, { parentId: node.entry.parentId });
      scan(node.children);
    }
  };
  scan(roots);
  for (let id = currentId; id;) {
    currentPath.add(id);
    id = byId.get(id)?.parentId ?? null;
  }

  const entries: TreeEntry[] = [];
  const visit = (nodes: typeof roots, depth: number) => {
    for (const node of nodes) {
      const entry: SessionEntry = node.entry;
      const role = entry.type === "message" ? entry.message.role : undefined;
      let text = "";
      if (entry.type === "message") text = "content" in entry.message ? textFromContent(entry.message.content) : "";
      else if (entry.type === "branch_summary" || entry.type === "compaction") text = entry.summary;
      else if (entry.type === "thinking_level_change") text = `thinking ${entry.thinkingLevel}`;
      else if (entry.type === "model_change") text = `${entry.provider}/${entry.modelId}`;
      entries.push({
        id: entry.id,
        parentId: entry.parentId,
        type: entry.type,
        ...(role ? { role } : {}),
        text: text.trim().slice(0, 500),
        timestamp: entry.timestamp,
        depth,
        current: entry.id === currentId,
        onCurrentPath: currentPath.has(entry.id),
        ...(node.label ? { label: node.label } : {}),
        childCount: node.children.length,
      });

      visit(node.children, node.children.length > 1 ? depth + 1 : depth);
    }
  };
  visit(roots, 0);
  return { currentId, entries };
};

type PiUserContent = string | readonly (TextContent | PiImageContent)[];

const userText = (content: PiUserContent): string =>
  typeof content === "string"
    ? content
    : content.filter((part) => part.type === "text").map((part) => part.text).join("");

const userImages = (content: PiUserContent): ImageContent[] | undefined => {
  if (typeof content === "string") return undefined;
  const images = content
    .filter((part): part is PiImageContent => part.type === "image")
    .map((part) => ({ type: "image" as const, data: part.data, mimeType: part.mimeType }));
  return images.length > 0 ? images : undefined;
};

const assistantText = (content: PiAssistantMessage["content"]): string =>
  content.filter((part) => part.type === "text").map((part) => part.text).join("");

// pi also reports in-flight "pending"/"deferred" stops; only final ones are shown.
const finalStopReason = (stopReason: PiAssistantMessage["stopReason"]): { stopReason?: StopReason } =>
  stopReason === "pending" || stopReason === "deferred" ? {} : { stopReason };

// One of pi's entries as the phone shows it, or undefined for entries it
// doesn't show (model and thinking-level changes, labels, usage, …).
const toEntry = (entry: SessionEntry): Entry | undefined => {
  const at = Date.parse(entry.timestamp);
  switch (entry.type) {
    case "compaction":
      return { type: "compaction", id: entry.id, at, summary: entry.summary, tokensBefore: entry.tokensBefore };
    case "branch_summary":
      return { type: "note", id: entry.id, at, label: "branch summary", text: entry.summary };
    case "custom_message":
      return entry.display
        ? { type: "note", id: entry.id, at, label: entry.customType, text: textFromContent(entry.content) }
        : undefined;
    case "message":
      break;
    default:
      return undefined;
  }

  const message = entry.message;
  switch (message.role) {
    case "user": {
      const images = userImages(message.content);
      return { type: "user", id: entry.id, at, text: userText(message.content), ...(images ? { images } : {}) };
    }
    case "assistant":
      return {
        type: "assistant",
        id: entry.id,
        at,
        text: assistantText(message.content),
        tools: message.content.flatMap((part) =>
          part.type === "toolCall" ? [{ id: part.id, name: part.name, args: part.arguments }] : [],
        ),
        ...finalStopReason(message.stopReason),
        ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
        ...(message.usage ? { usage: message.usage } : {}),
      };
    case "toolResult":
      return {
        type: "tool_result",
        id: entry.id,
        at,
        toolCallId: message.toolCallId,
        isError: message.isError,
        ...toolResultFields(message.content, message.details),
      };
    default:
      return undefined;
  }
};

const sessionStatsWithCwd = (stats: PiSdkSessionStats, cwd: string): SessionStats => ({
  ...(stats.sessionFile ? { sessionFile: stats.sessionFile } : {}),
  sessionId: stats.sessionId,
  cwd,
  userMessages: stats.userMessages,
  assistantMessages: stats.assistantMessages,
  toolCalls: stats.toolCalls,
  toolResults: stats.toolResults,
  totalMessages: stats.totalMessages,
  tokens: { ...stats.tokens },
  cost: stats.cost,
  ...(stats.contextUsage ? { contextUsage: stats.contextUsage } : {}),
});


// What the live session needs from pi's AgentSession; the mock implements the same.
export type PiCore = Pick<AgentSession, "subscribe" | "prompt" | "abort" | "clearQueue" | "isStreaming" | "getSessionStats"> & {
  readonly sessionManager: Pick<PiSessionManager, "getLeafId" | "getEntry">;
};

export interface Subscriber {
  // False when it is too far behind; it is then ended and the phone reconnects.
  push(message: ServerMessage): boolean;
  end(): void;
}

export interface LiveHooks {
  // Status or usage changed; the session list keeps a copy.
  persist(meta: SessionMeta): void;
  log(event: string, fields: Record<string, unknown>): void;
}

export type LiveSession = ReturnType<typeof makeLive>;

const TEXT_COALESCE_MS = 50;
const OUTPUT_COALESCE_MS = 250;
// A phone further behind than this gets the newest page instead of a catch-up.
const MAX_CATCHUP_ENTRIES = 400;
const PAGE_ENTRIES = 100;
const MAX_REMEMBERED_SENDS = 100;
// pi defers a prompt sent while it notifies agent_settled and reports it later;
// this bounds the wait in case it never does.
const DEFERRED_PROMPT_TIMEOUT_MS = 30_000;

interface SendRecord {
  readonly cid: string;
  readonly text: string;
  readonly mode: SendMode;
  readonly images?: readonly ImageContent[];
  // Unset until pi reports where the send went; `result` settles then.
  status?: SendStatus;
  result?: Promise<SendStatus>;
  // The text pi will save: what it queued (templates expanded), or what was sent.
  matchText?: string;
}

const isIn = (record: SendRecord, ...states: SendState[]) => record.status !== undefined && states.includes(record.status.state);

// One open pi session as phones see it: pi's saved entries, published as they
// appear, plus a mirror of what pi doesn't save, built from the events the host
// forwarded. It all runs synchronously with pi's notifications, so a
// subscriber's sync and the changes after it can't interleave.
export const makeLive = (core: PiCore, initialMeta: SessionMeta, hooks: LiveHooks) => {
  const sm = core.sessionManager;
  const mirror = emptyLive();
  const subscribers = new Set<Subscriber>();
  const sends = new Map<string, SendRecord>();
  const cidByEntry = new Map<string, string>();
  const held: SendRecord[] = [];
  const runningTools = new Set<string>();
  let meta = initialMeta;
  let piQueue: { steering: readonly string[]; followUp: readonly string[] } = { steering: [], followUp: [] };
  let publishedLeaf = sm.getLeafId();
  let sendChain: Promise<unknown> = Promise.resolve();
  let queueing: SendRecord | null = null;
  let stopping = false;
  let closed = false;

  const broadcast = (message: ServerMessage) => {
    for (const subscriber of subscribers) {
      if (subscriber.push(message)) continue;
      subscribers.delete(subscriber);
      subscriber.end();
      hooks.log("subscriber_dropped", { session_id: meta.id, reason: "behind" });
    }
  };

  const emit = (event: LiveEvent) => {
    applyLiveEvent(mirror, event);
    broadcast(event);
  };

  const setMeta = (patch: Partial<SessionMeta>) => {
    meta = { ...meta, ...patch, updatedAt: new Date().toISOString() };
    hooks.persist(meta);
    broadcast({ t: "meta", session: meta });
  };

  const updateStatus = () => {
    const status = mirror.running || mirror.compacting ? (runningTools.size > 0 ? "tool" : "thinking") : "idle";
    if (status !== meta.status) setMeta({ status });
  };

  // Reply text goes out every 50 ms; a running tool's output, and the
  // arguments of tool calls the model is writing, every 250 ms.
  let pendingText = "";
  const pendingOutput = new Map<string, { text: string; details?: unknown }>();
  // The streaming message, and which of its tool calls grew (by content index).
  let pendingCalls: { message: PiAssistantMessage; indexes: Set<number> } | undefined;
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  let outputTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(textTimer);
    clearTimeout(outputTimer);
    textTimer = outputTimer = undefined;
    if (pendingText) emit({ t: "d", s: pendingText });
    pendingText = "";
    // pi parses the arguments as they stream; their JSON goes out as changes.
    for (const index of pendingCalls?.indexes ?? []) {
      const part = pendingCalls?.message.content[index];
      if (part?.type !== "toolCall") continue;
      const before = mirror.msg?.calls.find((call) => call.id === part.id)?.args ?? "";
      emit({ t: "call", id: part.id, name: part.name, ...textChange(before, JSON.stringify(part.arguments ?? {})) });
    }
    pendingCalls = undefined;
    for (const [id, { text, details }] of pendingOutput) {
      const before = mirror.tools.find((tool) => tool.id === id)?.text ?? "";
      emit({ t: "out", id, ...textChange(before, text), ...(details !== undefined ? { details } : {}) });
    }
    pendingOutput.clear();
  };

  // pi's entries from `id` back to the root, newest first.
  function* branchFrom(id: string | null) {
    for (let entry = id ? sm.getEntry(id) : undefined; entry; entry = entry.parentId ? sm.getEntry(entry.parentId) : undefined) yield entry;
  }

  const project = (entries: readonly SessionEntry[]): Entry[] =>
    entries.flatMap((saved) => {
      const entry = toEntry(saved);
      const cid = entry?.type === "user" ? cidByEntry.get(entry.id) : undefined;
      return entry ? [cid ? { ...entry, cid } : entry] : [];
    });

  // A user entry belongs to the oldest pending send pi would save with that
  // text (pi matches its queue the same way), else to the send that started
  // the run (templates may have expanded its text).
  const link = (entryId: string, text: string) => {
    const pending = [...sends.values()].filter((record) => record === queueing || isIn(record, "started", "queued"));
    const record = pending.find((r) => r.matchText === text) ?? pending.find((r) => isIn(r, "started"));
    if (!record) return;
    record.status = { cid: record.cid, state: "delivered" };
    cidByEntry.set(entryId, record.cid);
  };

  // Entries ending at `fromId`, `limit` shown ones or so, starting at a user
  // message or compaction so a tool call isn't split from its result.
  const pageEndingAt = (fromId: string | null, limit: number): HistoryPage => {
    const walked: SessionEntry[] = [];
    let shown = 0;
    for (const entry of branchFrom(fromId)) {
      walked.push(entry);
      const projected = toEntry(entry);
      if (projected) shown += 1;
      if ((shown >= limit && (projected?.type === "user" || projected?.type === "compaction")) || shown >= limit * 3) break;
    }
    const oldest = walked.at(-1);
    return { entries: project(walked.reverse()), ...(oldest?.parentId ? { more: oldest.id } : {}) };
  };

  // The entries after `head` on the published branch; undefined when it isn't
  // there or is too far back.
  const entriesAfter = (head: string): SessionEntry[] | undefined => {
    const walked: SessionEntry[] = [];
    for (const entry of branchFrom(publishedLeaf)) {
      if (entry.id === head) return walked.reverse();
      if (walked.push(entry) > MAX_CATCHUP_ENTRIES) return undefined;
    }
    return undefined;
  };

  const syncMessage = (head: string | null, cids: readonly string[]): ServerMessage => {
    const after = head === null ? undefined : entriesAfter(head);
    return {
      t: "sync",
      reset: after === undefined,
      leaf: publishedLeaf,
      ...(after ? { entries: project(after) } : pageEndingAt(publishedLeaf, PAGE_ENTRIES)),
      // Encoded after later events change the mirror, so it is copied.
      live: structuredClone(mirror),
      session: meta,
      sends: cids.flatMap((cid) => sends.get(cid)?.status ?? []),
    };
  };

  // pi notifies message_end before it saves the message, and most saves have
  // no event of their own, so after every pi event and host command the leaf
  // (which every save moves) is compared with what was last published.
  const pump = () => {
    const leaf = sm.getLeafId();
    if (leaf === publishedLeaf) return;
    const fresh: SessionEntry[] = [];
    let continues = publishedLeaf === null;
    for (const entry of branchFrom(leaf)) {
      if (entry.id === publishedLeaf) {
        continues = true;
        break;
      }
      fresh.push(entry);
    }
    publishedLeaf = leaf;
    flush();
    if (!continues) {
      // The leaf moved to another branch (tree navigation): every phone starts over.
      hooks.log("branch_switched", { session_id: meta.id, leaf });
      broadcast(syncMessage(null, [...sends.keys()]));
      return;
    }
    for (const saved of fresh) {
      if (saved.type === "message" && saved.message.role === "user") link(saved.id, userText(saved.message.content));
    }
    const entries = project(fresh.reverse());
    for (const entry of entries) endLiveItem(mirror, entry);
    broadcast({ t: "entries", leaf, entries });
    if (entries.some((entry) => entry.type === "assistant")) {
      const stats = core.getSessionStats();
      setMeta({ tokens: { in: stats.tokens.input, out: stats.tokens.output }, costUsd: stats.cost });
    }
  };

  let pumpQueued = false;
  const pumpSoon = () => {
    if (pumpQueued) return;
    pumpQueued = true;
    queueMicrotask(() => {
      pumpQueued = false;
      pump();
    });
  };

  // Sends held for a compaction, then pi's own queue.
  const emitQueue = () => {
    const claimed = new Set<SendRecord>();
    const item = (text: string, mode: SendMode): QueueItem => {
      // The send being queued right now has no status yet.
      const record = [...sends.values()].find(
        (r) => (r === queueing || isIn(r, "queued")) && r.mode === mode && r.matchText === text && !claimed.has(r),
      );
      if (!record) return { text, mode };
      claimed.add(record);
      return { text, mode, cid: record.cid };
    };
    emit({
      t: "queue",
      queue: [
        ...held.map(({ text, mode, cid }) => ({ text, mode, cid })),
        ...piQueue.steering.map((text) => item(text, "steer")),
        ...piQueue.followUp.map((text) => item(text, "follow_up")),
      ],
    });
  };

  const setRun = (patch: { running?: boolean; compacting?: boolean; retry?: typeof mirror.retry | null }) => {
    const retry = patch.retry === null ? undefined : (patch.retry ?? mirror.retry);
    flush();
    emit({ t: "run", running: patch.running ?? mirror.running, compacting: patch.compacting ?? mirror.compacting, ...(retry ? { retry } : {}) });
    updateStatus();
  };

  const remember = (record: SendRecord) => {
    sends.set(record.cid, record);
    for (const [cid, old] of sends) {
      if (sends.size <= MAX_REMEMBERED_SENDS) break;
      if (isIn(old, "delivered", "handled", "cleared")) sends.delete(cid);
    }
  };

  // Hands a send to pi and settles with how pi took it. Never rejects: a
  // refused send is forgotten, so the phone can try it again.
  const dispatch = (record: SendRecord): Promise<SendStatus> => {
    if (mirror.compacting) {
      // pi refuses prompts during a manual compaction, and its TUI holds input
      // during any compaction; hold them until it ends.
      record.status = { cid: record.cid, state: "held" };
      held.push(record);
      emitQueue();
      return Promise.resolve(record.status);
    }
    return new Promise((resolve) => {
      let reported = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (state: SendState, error?: string) => {
        clearTimeout(timer);
        if (queueing === record) queueing = null;
        // pi can deliver a queued send before it reports it: keep "delivered".
        const status = record.status?.state === "delivered" ? record.status : { cid: record.cid, state, ...(error ? { error } : {}) };
        record.status = status;
        if (state === "started") record.matchText = record.text;
        // A report that comes after the timeout below corrects it.
        if (reported) broadcast({ t: "send", ...status });
        else resolve(status);
        reported = true;
      };
      queueing = record;
      core
        .prompt(record.text, {
          images: record.images?.map((image) => ({ ...image })),
          streamingBehavior: record.mode === "follow_up" ? "followUp" : "steer",
          preflightResult: settle,
        })
        .then(() => {
          // Deferred; the cid stays known in case pi still runs it.
          if (!reported) timer = setTimeout(() => settle("failed", "pi didn't take the message"), DEFERRED_PROMPT_TIMEOUT_MS).unref();
        })
        .catch((error: unknown) => {
          if (reported) return hooks.log("prompt_failed", { session_id: meta.id, cid: record.cid, error: String(error) });
          sends.delete(record.cid);
          hooks.log("send_failed", { session_id: meta.id, cid: record.cid, error: String(error) });
          settle("failed", error instanceof Error ? error.message : String(error));
        });
      pumpSoon();
    });
  };

  // Sends wait for each other only until pi reports where each went.
  const enqueue = (record: SendRecord, then: (status: SendStatus) => void) => {
    delete record.status;
    const result = sendChain.then(() => dispatch(record)).then((status) => {
      then(status);
      return status;
    });
    sendChain = record.result = result;
    return result;
  };

  // After a host restart a retried send's cid is unknown, so pi's file decides
  // whether it already arrived.
  const sentAfter = (base: string | null, text: string): string | undefined => {
    let steps = 0;
    for (const entry of branchFrom(publishedLeaf)) {
      if (entry.id === base || ++steps > MAX_CATCHUP_ENTRIES) return undefined;
      if (entry.type === "message" && entry.message.role === "user") {
        // pi appends notes on attached images after the text.
        const saved = userText(entry.message.content);
        if (saved === text || saved.startsWith(`${text}\n\n`)) return entry.id;
      }
    }
    return undefined;
  };

  const send = async (input: {
    cid: string;
    text: string;
    mode: SendMode;
    images?: readonly ImageContent[];
    base: string | null;
    retry: boolean;
  }): Promise<SendStatus> => {
    if (stopping) throw new Error("The host is restarting; try again in a moment.");
    const known = sends.get(input.cid);
    if (known) {
      // A held send's status is cleared while it is handed to pi again.
      while (!known.status) await known.result;
      return known.status;
    }
    pump();
    const delivered = input.retry ? sentAfter(input.base, input.text) : undefined;
    const record: SendRecord = { cid: input.cid, text: input.text, mode: input.mode, images: input.images };
    // Recorded before anything awaits, so a racing retry finds it.
    remember(record);
    if (delivered) {
      record.status = { cid: input.cid, state: "delivered" };
      cidByEntry.set(delivered, input.cid);
      hooks.log("send_already_delivered", { session_id: meta.id, cid: input.cid, entry_id: delivered });
      return record.status;
    }
    return enqueue(record, (status) =>
      hooks.log("send_received", { session_id: meta.id, cid: record.cid, mode: record.mode, state: status.state }),
    );
  };

  const onEvent = (event: AgentSessionEvent) => {
    // Entries pi saved since its last notification come before this one.
    pump();
    // Calls a tool makes itself (codemode) show inside that tool's row, as in pi's TUI.
    if ("parentToolCallId" in event && event.parentToolCallId) return;
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          flush();
          emit({ t: "msg", at: Date.now() });
        }
        break;
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          pendingText += update.delta;
          textTimer ??= setTimeout(flush, TEXT_COALESCE_MS).unref();
        } else if ((update.type === "toolcall_start" || update.type === "toolcall_delta") && event.message.role === "assistant") {
          pendingCalls ??= { message: event.message, indexes: new Set() };
          pendingCalls.message = event.message;
          pendingCalls.indexes.add(update.contentIndex);
          outputTimer ??= setTimeout(flush, OUTPUT_COALESCE_MS).unref();
        }
        break;
      }
      case "tool_execution_start":
        runningTools.add(event.toolCallId);
        updateStatus();
        break;
      case "tool_execution_update": {
        const { content, details } = event.partialResult;
        pendingOutput.set(event.toolCallId, { text: textFromContent(content), ...(details !== undefined ? { details } : {}) });
        outputTimer ??= setTimeout(flush, OUTPUT_COALESCE_MS).unref();
        break;
      }
      case "tool_execution_end":
        runningTools.delete(event.toolCallId);
        pendingOutput.delete(event.toolCallId);
        updateStatus();
        break;
      case "queue_update": {
        // A send being queued right now: note the text pi queued for it.
        const lane = queueing?.mode === "follow_up" ? "followUp" : "steering";
        if (queueing && event[lane].length > piQueue[lane].length) queueing.matchText = event[lane].at(-1);
        piQueue = { steering: event.steering, followUp: event.followUp };
        emitQueue();
        break;
      }
      case "agent_start":
        if (!mirror.running) setRun({ running: true });
        break;
      case "agent_settled":
        runningTools.clear();
        setRun({ running: false, retry: null });
        break;
      case "compaction_start":
        setRun({ compacting: true });
        break;
      case "compaction_end":
        setRun({ compacting: false });
        // pi saves only a successful compaction; a failure shows like an extension notice.
        if (event.errorMessage) emit({ t: "ui", request: { kind: "notify", id: randomUUIDv7(), message: event.errorMessage, level: "error" } });
        // Not while shutting down: stop() aborting a compaction ends up here too.
        if (stopping) break;
        for (const record of held.splice(0)) enqueue(record, (status) => broadcast({ t: "send", ...status }));
        emitQueue();
        break;
      case "auto_retry_start":
        setRun({ retry: { attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, errorMessage: event.errorMessage } });
        break;
      case "auto_retry_end":
        setRun({ retry: null });
        break;
    }
    pumpSoon();
  };

  const unsubscribe = core.subscribe(onEvent);

  return {
    get meta() {
      return meta;
    },
    patchMeta: (patch: Partial<Pick<SessionMeta, "title" | "archived">>) => setMeta(patch),
    // Nothing running, held or queued, and no one watching: safe to close.
    get idle() {
      return subscribers.size === 0 && !mirror.running && !mirror.compacting && mirror.queue.length === 0;
    },
    // The sync, then every later change, in one synchronous step.
    attach(head: string | null, cids: readonly string[], subscriber: Subscriber): () => void {
      // Closed between the viewer's lookup and now (evicted or deleted).
      if (closed) {
        subscriber.end();
        return () => {};
      }
      flush();
      pump();
      subscriber.push(syncMessage(head, cids));
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    send,
    history(before: string, limit = PAGE_ENTRIES): HistoryPage {
      const parentId = sm.getEntry(before)?.parentId;
      return parentId ? pageEndingAt(parentId, Math.min(Math.max(1, limit), PAGE_ENTRIES * 2)) : { entries: [] };
    },
    // Empties the queue and returns it for the composer, like pi's dequeue.
    clearQueue(): { steering: string[]; followUp: string[] } {
      const fromHeld = held.splice(0);
      const fromPi = core.clearQueue();
      for (const record of sends.values()) {
        if (!isIn(record, "queued", "held")) continue;
        record.status = { cid: record.cid, state: "cleared" };
        broadcast({ t: "send", ...record.status });
      }
      emitQueue();
      const heldText = (mode: SendMode) => fromHeld.filter((r) => r.mode === mode).map((r) => r.text);
      return { steering: [...heldText("steer"), ...fromPi.steering], followUp: [...heldText("follow_up"), ...fromPi.followUp] };
    },
    ui: (request: ExtensionUiRequest) => emit({ t: "ui", request }),
    uiDone: (id: string) => emit({ t: "ui_done", id }),
    // After a host command that may have saved entries or moved the leaf.
    pump,
    // Graceful shutdown: refuse new sends and stop the turn, so pi saves the
    // partial reply and tool results.
    async stop(): Promise<void> {
      stopping = true;
      if (core.isStreaming || mirror.compacting) {
        hooks.log("turn_aborted_for_shutdown", { session_id: meta.id });
        await core.abort();
      }
    },
    close() {
      closed = true;
      flush();
      unsubscribe();
      for (const subscriber of subscribers) subscriber.end();
      subscribers.clear();
    },
  };
};

const wirePiSession = (
  piSession: AgentSession,
  meta: SessionMeta,
  hooks: LiveHooks,
  fs: FileSystem.FileSystem,
): Effect.Effect<PiSession> =>
  Effect.gen(function* () {
    const live = makeLive(piSession, meta, hooks);
    const extensionUi = createMobileExtensionUiChannel(live.ui, live.uiDone);

    yield* Effect.tryPromise({
      try: () => piSession.bindExtensions({
        uiContext: extensionUi.uiContext,
        onError: (error) =>
          live.ui({ kind: "notify", id: randomUUIDv7(), message: error instanceof Error ? error.message : String(error), level: "error" }),
      }),
      catch: (e) => new PiError({ message: `bindExtensions failed: ${String(e)}`, cause: e }),
    }).pipe(
      Effect.catchAll((e) =>
        Effect.logError("extension_bind_failed").pipe(Effect.annotateLogs({ session_id: meta.id, error: e.message })),
      ),
    );

    return {
      live,
      interrupt: () =>
        Effect.tryPromise({
          try: () => piSession.abort(),
          catch: (e) => new PiError({ message: `abort failed: ${String(e)}`, cause: e }),
        }),
      extensionUiResponse: (id, value) => Effect.sync(() => extensionUi.respond(id, value)),
      compact: (instructions) =>
        Effect.tryPromise({
          try: async () => {
            // A second compact would abort the first one (compact() aborts first).
            if (piSession.isCompacting) return;
            await piSession.compact(instructions?.trim() || undefined);
          },
          catch: (e) => new PiError({ message: `compact failed: ${String(e)}`, cause: e }),
        }),
      exportHtml: () =>
        Effect.gen(function* () {
          const fail = (cause: unknown) => new PiError({ message: `exportHtml failed: ${String(cause)}`, cause });

          yield* fs.makeDirectory(EXPORT_DIR, { recursive: true }).pipe(Effect.mapError(fail));
          yield* cleanupOldExports(fs);

          const base = `pi-session-${safeFilenamePart(piSession.sessionId)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
          const tmpPath = join(EXPORT_DIR, `${base}-${randomUUIDv7()}.html.tmp`);
          const finalName = `${base}.html`;
          const finalPath = join(EXPORT_DIR, finalName);

          yield* Effect.tryPromise({ try: () => piSession.exportToHtml(tmpPath), catch: fail }).pipe(
            Effect.flatMap((exportedPath) => fs.rename(exportedPath, finalPath).pipe(Effect.mapError(fail))),
            Effect.tapError(() =>
              fs
                .remove(tmpPath, { force: true })
                .pipe(Effect.zipRight(fs.remove(finalPath, { force: true })), Effect.ignore),
            ),
          );

          const info = yield* fs.stat(finalPath).pipe(Effect.option);
          return {
            stream: Stream.orDie(fs.stream(finalPath)),
            filename: finalName,
            ...(Option.isSome(info) ? { size: Number(info.value.size) } : {}),
          } satisfies ExportedHtml;
        }),
      listCommands: () =>
        Effect.sync(() => ({
          builtins: [],
          prompts: piSession.resourceLoader.getPrompts().prompts.map((p) => ({
            kind: "prompt" as const,
            name: p.name,
            description: p.description,
            takesArgs: true,
            source: p.filePath,
          })),
          skills: piSession.resourceLoader.getSkills().skills.map((s) => ({
            kind: "skill" as const,
            name: `skill:${s.name}`,
            description: s.description,
            takesArgs: true,
            source: s.filePath,
          })),
          // The runner's live registry — same list pi's TUI shows, including
          // commands registered dynamically (not just at load).
          extensions: piSession.extensionRunner.getRegisteredCommands().map((cmd) => ({
            kind: "extension" as const,
            name: cmd.invocationName,
            description: cmd.description ?? "",
            takesArgs: true,
          })),
        })),
      getSettings: () => Effect.sync(() => sessionSettings(piSession)),
      patchSession: (patch) =>
        Effect.sync(() => {
          if (patch.title !== undefined) piSession.setSessionName(patch.title);
        }),
      patchSetting: (key, value) =>
        Effect.tryPromise({
          try: () => setSessionSetting(piSession, key, value),
          catch: (e) => e instanceof PiError ? e : new PiError({ message: `patchSetting failed: ${String(e)}`, cause: e }),
        }),
      getStats: () => Effect.sync(() => sessionStatsWithCwd(piSession.getSessionStats(), meta.cwd)),
      getTree: () => Effect.sync(() => flattenSessionTree(piSession)),
      navigateTree: (entryId, summarize) =>
        Effect.tryPromise({
          try: async () => {
            await piSession.navigateTree(entryId, { summarize });
            live.pump();
          },
          catch: (e) => new PiError({ message: `navigateTree failed: ${String(e)}`, cause: e }),
        }),
      // As pi's runtime does: extensions hear the session end (MCP closes its
      // servers), then it is disposed.
      close: () =>
        Effect.promise(async () => {
          live.close();
          extensionUi.close();
          if (piSession.extensionRunner.hasHandlers("session_shutdown")) {
            await piSession.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }).catch(() => {});
          }
          piSession.dispose();
        }),
    };
  });

const makeLiveSession = (
  setup: PiSetup,
  opts: {
    cwd: string;
    title: string;
  },
  hooks: LiveHooks,
  fs: FileSystem.FileSystem,
): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<AgentSession, PiError>({
      try: () => openAgentSession(setup, opts.cwd, setup.newSessionManager(opts.cwd), "startup"),
      catch: (e) => new PiError({ message: `create session failed: ${String(e)}`, cause: e }),
    });

    const meta: SessionMeta = {
      id: piSession.sessionId,
      title: opts.title,
      cwd: opts.cwd,
      status: "idle",
      updatedAt: new Date().toISOString(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      archived: false,
    };

    return yield* wirePiSession(piSession, meta, hooks, fs);
  });

const makeResumedSession = (
  setup: PiSetup,
  storedRecord: SessionRecord,
  hooks: LiveHooks,
  fs: FileSystem.FileSystem,
): Effect.Effect<PiSession, PiError | SessionNotFound> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<
      AgentSession,
      PiError | SessionNotFound
    >({
      try: async () => {
        const path = setup.findSession(storedRecord.cwd, storedRecord.id);
        if (!path) throw new SessionNotFound({ id: storedRecord.id });
        return openAgentSession(setup, storedRecord.cwd, PiSessionManager.open(path), "resume");
      },
      catch: (e) => {
        if (e instanceof SessionNotFound) return e;
        return new PiError({ message: `resume failed: ${String(e)}`, cause: e });
      },
    });

    const meta: SessionMeta = {
      id: storedRecord.id,
      title: storedRecord.title,
      cwd: storedRecord.cwd,
      status: "idle",
      updatedAt: new Date().toISOString(),
      tokens: storedRecord.tokens,
      costUsd: storedRecord.costUsd,
      archived: storedRecord.archived,
    };

    return yield* wirePiSession(piSession, meta, hooks, fs);
  });


export const makePiClient = (setup: PiSetup) =>
  Layer.effect(
    PiClient,
    Effect.map(FileSystem.FileSystem, (fs) =>
      PiClient.of({
        create: (opts, hooks) => makeLiveSession(setup, opts, hooks, fs),
        resume: (storedRecord, hooks) => makeResumedSession(setup, storedRecord, hooks, fs),
      }),
    ),
  );

export const PiClientLive = makePiClient({
  modelRuntime: getAgentModelRuntime,
  newSessionManager: (cwd) => (PI_EPHEMERAL ? PiSessionManager.inMemory(cwd) : PiSessionManager.create(cwd)),
  // findById only reads headers; list() parses every transcript in the cwd.
  findSession: (cwd, id) => PiSessionManager.findById(cwd, id),
});

