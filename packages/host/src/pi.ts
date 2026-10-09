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
  getAgentDir,
  ModelRuntime,
  parseSessionEntries,
  SessionManager as PiSessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type InlineExtension,
  type SessionHeader,
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
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
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
import { HOST_DATA_DIR } from "./config.ts";
import { createMobileExtensionUiChannel } from "./mobile-extension-ui-channel.ts";
import type { FileSession, SessionFile, SessionRecord } from "./session-record.ts";
import { elsewhere, follow, followFile, type Cursor } from "./transcript.ts";
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
  readonly navigateTree: (entryId: string, summarize?: boolean) => Effect.Effect<void, PiError>;
  readonly close: () => Effect.Effect<void>;
}

export class PiClient extends Context.Tag("PiClient")<
  PiClient,
  {
    readonly create: (opts: { cwd: string; title?: string }, hooks: LiveHooks) => Effect.Effect<PiSession, PiError>;
    readonly resume: (record: SessionRecord, hooks: LiveHooks) => Effect.Effect<PiSession, PiError | SessionNotFound>;
    // pi's session files, for the session list.
    readonly sessionFiles: () => Effect.Effect<SessionFile[]>;
    readonly readSessionFile: (path: string) => Effect.Effect<Option.Option<FileSession>, PiError>;
    // For sessions Pico doesn't have open.
    readonly nameSessionFile: (path: string, name: string) => Effect.Effect<void, PiError>;
    readonly deleteSessionFile: (path: string) => Effect.Effect<void, PiError>;
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
  cwd: string,
  sessionManager: PiSessionManager,
  reason: "startup" | "resume",
): Promise<AgentSession> => {
  const services = await createAgentSessionServices({
    cwd,
    modelRuntime: await getAgentModelRuntime(),
    resourceLoaderOptions: { extensionFactories: builtInExtensions },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent: { type: "session_start", reason },
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

// The session's tree as pi's /tree shows it, flattened depth first.
const flattenSessionTree = (view: PiSessionManager, currentId: string | null): SessionTree => {
  const currentPath = new Set(currentId === null ? [] : view.getBranch(currentId).map((entry) => entry.id));
  const entries: TreeEntry[] = [];
  // Siblings sit one level in from their parent; an only child stays level with it.
  const stack = view.getTree().map((node) => ({ node, depth: 0 })).reverse();
  for (let next = stack.pop(); next; next = stack.pop()) {
    const { node: { entry, children, label }, depth } = next;
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
      ...(label ? { label } : {}),
      childCount: children.length,
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i]!, depth: children.length > 1 ? depth + 1 : depth });
  }
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


// What the live session needs from pi's AgentSession.
export type PiCore = Pick<AgentSession, "subscribe" | "prompt" | "abort" | "clearQueue" | "isStreaming" | "getSessionStats"> & {
  readonly sessionManager: Pick<PiSessionManager, "getLeafId" | "getEntry" | "getEntries" | "getSessionFile">;
};

export interface Subscriber {
  // False when it is too far behind; it is then ended and the phone reconnects.
  push(message: ServerMessage): boolean;
  end(): void;
}

export interface LiveHooks {
  // Status or usage changed; the session list keeps a copy.
  persist(meta: SessionMeta): void;
  // The phone's place moved; pi opens there next time.
  moved(sessionId: string, cursor: Cursor): void;
  log(event: string, fields: Record<string, unknown>): void;
}

// How pi was opened: standing at the phone's place, with its file `from` bytes
// long or longer, of whose entries the phone had seen `seen`.
export interface Opened {
  readonly from: number;
  readonly seen: number;
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

// One open pi session as phones see it: the entries in pi's file along the
// phone's line, published as they are saved, plus a mirror of what pi doesn't
// save, built from the events the host forwarded. Other pi processes (a
// terminal) may save to the same file; their entries follow the phone's line
// or count as activity elsewhere. It all runs synchronously with pi's
// notifications, so a subscriber's sync and the changes after it can't
// interleave.
export const makeLive = (core: PiCore, initialMeta: SessionMeta, hooks: LiveHooks, opened: Opened) => {
  const sm = core.sessionManager;
  const mirror = emptyLive();
  const subscribers = new Set<Subscriber>();
  const sends = new Map<string, SendRecord>();
  const cidByEntry = new Map<string, string>();
  const held: SendRecord[] = [];
  const runningTools = new Set<string>();
  let meta = initialMeta;
  let piQueue: { steering: readonly string[]; followUp: readonly string[] } = { steering: [], followUp: [] };
  const seed = sm.getEntries();
  // pi is opened standing where the phone does, having read its file.
  let cursor: Cursor = { id: sm.getLeafId(), since: seed.length, seen: opened.seen };
  let piLeaf = cursor.id;
  // Set when the file changed; pi's own saves also move its leaf.
  let changed = true;
  let sendChain: Promise<unknown> = Promise.resolve();
  let queueing: SendRecord | null = null;
  let stopping = false;
  let closed = false;

  const path = sm.getSessionFile();
  if (!path) throw new Error("pi's session has no file");
  const transcript = followFile(path, seed, opened.from, {
    known: (id) => sm.getEntry(id),
    changed: () => {
      changed = true;
      pumpSoon();
    },
  });

  // pi is at work, or about to be: a run, a compaction, a queue, or a send it
  // hasn't placed yet.
  const busy = () =>
    core.isStreaming || mirror.running || mirror.compacting || mirror.queue.length > 0 || [...sends.values()].some((record) => !record.status);

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

  // Saved entries from `id` back to the root, newest first.
  function* branchFrom(id: string | null) {
    for (let entry = id ? transcript.get(id) : undefined; entry; entry = entry.parentId ? transcript.get(entry.parentId) : undefined) yield entry;
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

  // The entries after `head` on the phone's line; undefined when it isn't
  // there or is too far back.
  const entriesAfter = (head: string): SessionEntry[] | undefined => {
    const walked: SessionEntry[] = [];
    for (const entry of branchFrom(cursor.id)) {
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
      leaf: cursor.id,
      ...(after ? { entries: project(after) } : pageEndingAt(cursor.id, PAGE_ENTRIES)),
      // Encoded after later events change the mirror, so it is copied.
      live: structuredClone(mirror),
      session: meta,
      sends: cids.flatMap((cid) => sends.get(cid)?.status ?? []),
    };
  };

  const moveTo = (next: Cursor) => {
    if (next.id === cursor.id && next.since === cursor.since && next.seen === cursor.seen) return;
    cursor = next;
    hooks.moved(meta.id, cursor);
  };

  const noteElsewhere = () => {
    const now = elsewhere(cursor, transcript);
    if (now?.messages === mirror.elsewhere?.messages && now?.at === mirror.elsewhere?.at) return;
    emit({ t: "elsewhere", ...(now ? { elsewhere: now } : {}) });
  };

  // pi notifies message_end before it saves the message, and most saves have
  // no event of their own, so after every pi event and host command pi's leaf
  // (which every save moves) is checked, and the file read when it moved or
  // changed.
  const pump = () => {
    const leaf = sm.getLeafId();
    if (!changed && leaf === piLeaf) return;
    changed = false;
    const saved = transcript.read();
    const piMoved = leaf !== piLeaf;
    piLeaf = leaf;
    if (saved.length === 0 && !piMoved) return;
    flush();
    // pi's own saves deliver what it was sent and end what it streamed,
    // wherever they landed.
    const own = saved.filter((entry) => sm.getEntry(entry.id) !== undefined);
    for (const entry of own) {
      if (entry.type === "message" && entry.message.role === "user") link(entry.id, userText(entry.message.content));
    }
    const ownEntries = project(own);
    for (const entry of ownEntries) endLiveItem(mirror, entry);
    if (ownEntries.some((entry) => entry.type === "assistant")) {
      const stats = core.getSessionStats();
      setMeta({ tokens: { in: stats.tokens.input, out: stats.tokens.output }, costUsd: stats.cost });
    }
    // While pi is at work the line is its own: another pi saving there forks it.
    const followed = follow(cursor.id, busy() ? own : saved);
    const since = transcript.entries.length;
    if (piMoved && leaf !== followed.id) {
      // pi went elsewhere: it navigated the tree, or went on from a place
      // another pi had moved on from. Phones go with it.
      moveTo({ ...cursor, id: leaf, since });
      // A new session keeps its settings to itself until its first message.
      if (leaf !== null && !transcript.get(leaf)) return;
      hooks.log("branch_switched", { session_id: meta.id, leaf });
      noteElsewhere();
      broadcast(syncMessage(null, [...sends.keys()]));
      return;
    }
    moveTo({ ...cursor, id: followed.id, since });
    noteElsewhere();
    if (followed.line.length > 0) broadcast({ t: "entries", leaf: cursor.id, entries: project(followed.line) });
  };

  // Before acting on what is saved: pi's file can change without notice
  // reaching the host yet.
  const pull = () => {
    changed = true;
    pump();
  };

  // The phone looked at every branch: only what's saved from now on is news.
  const seeAll = () => {
    pull();
    moveTo({ ...cursor, seen: transcript.entries.length });
    noteElsewhere();
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
    for (const entry of branchFrom(cursor.id)) {
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
    // pi was reopened, or the session deleted, since this send looked it up.
    if (closed) throw new Error("The session was reopened; try again.");
    const known = sends.get(input.cid);
    if (known) {
      // A held send's status is cleared while it is handed to pi again.
      while (!known.status) await known.result;
      return known.status;
    }
    pull();
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

  // Saved now too, so a session opened only to read opens here next time.
  hooks.moved(meta.id, cursor);
  noteElsewhere();
  const unsubscribe = core.subscribe(onEvent);

  return {
    get meta() {
      return meta;
    },
    patchMeta: (patch: Partial<Pick<SessionMeta, "title" | "archived">>) => setMeta(patch),
    // Nothing under way and no one watching: safe to close.
    get idle() {
      return subscribers.size === 0 && !busy();
    },
    // The sync, then every later change, in one synchronous step.
    attach(head: string | null, cids: readonly string[], subscriber: Subscriber): () => void {
      // Closed between the viewer's lookup and now (evicted or deleted).
      if (closed) {
        subscriber.end();
        return () => {};
      }
      flush();
      pull();
      subscriber.push(syncMessage(head, cids));
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    send,
    // pi reads its file only when it opens it, so it can't go on from where
    // another pi moved the phone's line on to, or navigate to an entry another
    // pi saved, until it is opened again. Never while Pico has work under way.
    behind(target?: string): boolean {
      pull();
      return !busy() && (sm.getLeafId() !== cursor.id || (target !== undefined && !sm.getEntry(target)));
    },
    // pi's tree of every entry in the file, which this pi may not have read.
    tree(): SessionTree {
      seeAll();
      return flattenSessionTree(PiSessionManager.inMemory(meta.cwd, undefined, [...transcript.entries]), cursor.id);
    },
    seeAll,
    history(before: string, limit = PAGE_ENTRIES): HistoryPage {
      const parentId = transcript.get(before)?.parentId;
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
      transcript.close();
      for (const subscriber of subscribers) subscriber.end();
      subscribers.clear();
    },
  };
};

const wirePiSession = (
  piSession: AgentSession,
  meta: SessionMeta,
  hooks: LiveHooks,
  opened: Opened,
  fs: FileSystem.FileSystem,
): Effect.Effect<PiSession> =>
  Effect.gen(function* () {
    const live = makeLive(piSession, meta, hooks, opened);
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
      navigateTree: (entryId, summarize) =>
        Effect.tryPromise({
          try: async () => {
            // Where the phone goes from isn't news.
            live.seeAll();
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
  opts: {
    cwd: string;
    title?: string;
  },
  hooks: LiveHooks,
  fs: FileSystem.FileSystem,
): Effect.Effect<PiSession, PiError> =>
  Effect.gen(function* () {
    const piSession = yield* Effect.tryPromise<AgentSession, PiError>({
      try: async () => {
        const session = await openAgentSession(opts.cwd, PiSessionManager.create(opts.cwd), "startup");
        if (opts.title) session.setSessionName(opts.title);
        return session;
      },
      catch: (e) => new PiError({ message: `create session failed: ${String(e)}`, cause: e }),
    });

    const meta: SessionMeta = {
      id: piSession.sessionId,
      title: opts.title ?? UNTITLED,
      cwd: opts.cwd,
      status: "idle",
      updatedAt: new Date().toISOString(),
      tokens: { in: 0, out: 0 },
      costUsd: 0,
      archived: false,
    };

    return yield* wirePiSession(piSession, meta, hooks, { from: 0, seen: 0 }, fs);
  });

// Where the phone was, gone on along its line through what was saved since;
// the first time, pi's newest entry, where pi itself resumes, with what's
// elsewhere already seen.
const resumeAt = (sessionManager: PiSessionManager, stored: Cursor | null) => {
  const entries = sessionManager.getEntries();
  if (stored && (stored.id === null || sessionManager.getEntry(stored.id))) {
    return { id: follow(stored.id, entries.slice(stored.since)).id, seen: stored.seen };
  }
  return { id: sessionManager.getLeafId(), seen: entries.length };
};

const makeResumedSession = (
  storedRecord: SessionRecord,
  hooks: LiveHooks,
  fs: FileSystem.FileSystem,
): Effect.Effect<PiSession, PiError | SessionNotFound> =>
  Effect.gen(function* () {
    const { piSession, opened } = yield* Effect.tryPromise<
      { piSession: AgentSession; opened: Opened },
      PiError | SessionNotFound
    >({
      try: async () => {
        // findById, for a session not indexed yet, only reads headers.
        const path = storedRecord.path ?? PiSessionManager.findById(storedRecord.cwd, storedRecord.id);
        // Taken first: whatever is saved after this, pi may or may not read.
        const info = path ? statSync(path, { throwIfNoEntry: false }) : undefined;
        if (!path || !info) throw new SessionNotFound({ id: storedRecord.id });
        const sessionManager = PiSessionManager.open(path);
        const at = resumeAt(sessionManager, storedRecord.cursor);
        // pi builds its context from where its session manager stands.
        if (at.id === null) sessionManager.resetLeaf();
        else sessionManager.branch(at.id);
        return { piSession: await openAgentSession(storedRecord.cwd, sessionManager, "resume"), opened: { from: info.size, seen: at.seen } };
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

    return yield* wirePiSession(piSession, meta, hooks, opened, fs);
  });

// A session with no name and no message yet.
const UNTITLED = "new session";

// Every file in pi's sessions folder (a folder per cwd), as pi's /resume lists them.
const sessionFiles = (fs: FileSystem.FileSystem) =>
  Effect.gen(function* () {
    const root = join(getAgentDir(), "sessions");
    const names = yield* fs.readDirectory(root, { recursive: true }).pipe(Effect.orElseSucceed((): string[] => []));
    const files = yield* Effect.forEach(
      names.filter((name) => name.endsWith(".jsonl")),
      (name) =>
        fs.stat(join(root, name)).pipe(
          Effect.map((info) => ({ path: join(root, name), stamp: `${info.size}:${Option.getOrUndefined(info.mtime)?.getTime()}` })),
          Effect.option,
        ),
      { concurrency: 32 },
    );
    return files.flatMap(Option.toArray);
  });

// A session as pi's /resume shows it (its name, else its first message), and
// its cost, summed as pi's session stats do. Read line by line, as pi does:
// files with images run to tens of megabytes.
const readSessionFile = (path: string) =>
  Effect.tryPromise({
    try: async (): Promise<Option.Option<FileSession>> => {
      let header: SessionHeader | undefined;
      let name: string | undefined;
      let firstMessage = "";
      let updatedAtMs = 0;
      const tokens = { in: 0, out: 0 };
      let costUsd = 0;
      for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
        const [entry] = parseSessionEntries(line);
        if (!entry) continue;
        if (!header) {
          if (entry.type !== "session") return Option.none();
          header = entry;
          continue;
        }
        if (entry.type === "session_info") name = entry.name?.trim() || undefined;
        const usage = entry.type === "message" ? ("usage" in entry.message ? entry.message.usage : undefined) : "usage" in entry ? entry.usage : undefined;
        if (usage) {
          tokens.in += usage.input;
          tokens.out += usage.output;
          costUsd += usage.cost.total;
        }
        if (entry.type !== "message") continue;
        const { message } = entry;
        // Activity is what pi sorts /resume by: the last user or assistant message.
        if (message.role !== "user" && message.role !== "assistant") continue;
        updatedAtMs = Math.max(updatedAtMs, typeof message.timestamp === "number" ? message.timestamp : Date.parse(entry.timestamp));
        if (!firstMessage && message.role === "user") {
          firstMessage = userText(message.content).replace(/\s+/g, " ").trim().slice(0, 200);
        }
      }
      if (!header) return Option.none();
      return Option.some({
        id: header.id,
        cwd: header.cwd,
        title: name ?? (firstMessage || UNTITLED),
        updatedAtMs: updatedAtMs || Date.parse(header.timestamp),
        tokens,
        costUsd,
      });
    },
    catch: (e) => new PiError({ message: `read failed: ${String(e)}`, cause: e }),
  });

const nameSessionFile = (path: string, name: string) =>
  Effect.try({
    try: () => void PiSessionManager.open(path).appendSessionInfo(name),
    catch: (e) => new PiError({ message: `rename failed: ${String(e)}`, cause: e }),
  });

const deleteSessionFile = (fs: FileSystem.FileSystem, path: string) =>
  fs.remove(path, { force: true }).pipe(
    Effect.mapError((e) => new PiError({ message: `delete failed: ${e.message}`, cause: e })),
  );

export const PiClientLive = Layer.effect(
  PiClient,
  Effect.map(FileSystem.FileSystem, (fs) =>
    PiClient.of({
      create: (opts, hooks) => makeLiveSession(opts, hooks, fs),
      resume: (storedRecord, hooks) => makeResumedSession(storedRecord, hooks, fs),
      sessionFiles: () => sessionFiles(fs),
      readSessionFile,
      nameSessionFile,
      deleteSessionFile: (path) => deleteSessionFile(fs, path),
    }),
  ),
);
