import { WebSocket as ReconnectingWS } from "partysocket";
import { decodeWireEvent } from "@pi-mobile/protocol";
import type {
  ClientEvent,
  SessionMeta,
  SessionModelState,
  SystemInfo,
  WireEvent,
} from "@pi-mobile/protocol";

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({ error: res.statusText }));
  return `${res.status}: ${body.error ?? "unknown"}`;
}

async function requestJson<T>(label: string, input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(`${label} ${await errorMessage(res)}`);
  return (await res.json()) as T;
}

async function requestVoid(label: string, input: RequestInfo | URL, init?: RequestInit): Promise<void> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(`${label} ${await errorMessage(res)}`);
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const sessionUrl = (baseUrl: string, id: string, suffix = "") =>
  `${baseUrl}/sessions/${encodeURIComponent(id)}${suffix}`;

export const listSessions = (baseUrl: string): Promise<SessionMeta[]> =>
  requestJson("listSessions", `${baseUrl}/sessions`);

export const createSession = (
  baseUrl: string,
  opts: { cwd: string; title?: string; branch?: string },
): Promise<SessionMeta> =>
  requestJson("createSession", `${baseUrl}/sessions`, jsonInit("POST", opts));

export const patchSession = (
  baseUrl: string,
  id: string,
  patch: { title?: string; archived?: boolean },
): Promise<SessionMeta> =>
  requestJson("patchSession", sessionUrl(baseUrl, id), jsonInit("PATCH", patch));

export const deleteSession = (baseUrl: string, id: string): Promise<void> =>
  requestVoid("deleteSession", sessionUrl(baseUrl, id), { method: "DELETE" });

export async function healthcheck(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/healthz`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const getSystemInfo = (baseUrl: string): Promise<SystemInfo> =>
  requestJson("getSystemInfo", `${baseUrl}/system/info`);

export const listSessionModels = (
  baseUrl: string,
  id: string,
): Promise<SessionModelState> =>
  requestJson("listSessionModels", sessionUrl(baseUrl, id, "/models"));

export const setSessionModel = (
  baseUrl: string,
  id: string,
  opts: { provider: string; modelId: string },
): Promise<void> =>
  requestVoid("setSessionModel", sessionUrl(baseUrl, id, "/model"), jsonInit("POST", opts));

export const compactSession = (
  baseUrl: string,
  id: string,
  instructions?: string,
): Promise<void> =>
  requestVoid(
    "compactSession",
    sessionUrl(baseUrl, id, "/compact"),
    jsonInit("POST", { instructions: instructions?.trim() || undefined }),
  );

export interface FsListing {
  path: string;
  parent: string | null;
  home: string;
  entries: Array<{ name: string; hidden: boolean }>;
}

export function lsFs(baseUrl: string, path?: string): Promise<FsListing> {
  const url = new URL(`${baseUrl}/fs/ls`);
  if (path !== undefined) url.searchParams.set("path", path);
  return requestJson("lsFs", url);
}

export interface CommandEntry {
  kind: "builtin" | "prompt" | "skill";
  name: string;
  description: string;
  takesArgs?: boolean;
}

export interface Commands {
  builtins: CommandEntry[];
  prompts: CommandEntry[];
  skills: CommandEntry[];
}

export const listCommands = (baseUrl: string): Promise<Commands> =>
  requestJson("listCommands", `${baseUrl}/commands`);

const TERMINAL_CLOSE_CODES = new Set<number>([4004]);

export interface StreamHandlers {
  onOpen?: () => void;
  onClose?: (code: number, reason: string, terminal: boolean) => void;
  onError?: () => void;
  onEvent: (event: WireEvent) => void;
}

export interface StreamHandle {
  send: (e: ClientEvent) => void;
  reconnect: () => void;
  close: () => void;
}

export function connectStream(
  baseUrl: string,
  sessionId: string,
  cursor: number | (() => number),
  handlers: StreamHandlers,
): StreamHandle {
  const wsBase = baseUrl.replace(/^http/, "ws");
  const currentCursor = () => (typeof cursor === "function" ? cursor() : cursor);
  const url = () =>
    `${wsBase}/ws?session=${encodeURIComponent(sessionId)}&cursor=${currentCursor()}`;

  const ws = new ReconnectingWS(url, [], {
    minReconnectionDelay: 500,
    maxReconnectionDelay: 10_000,
    reconnectionDelayGrowFactor: 1.5,
    connectionTimeout: 5_000,
    maxRetries: Infinity,
  });

  ws.addEventListener("open", () => handlers.onOpen?.());
  ws.addEventListener("close", (e) => {
    const close = e as CloseEvent;
    const terminal = TERMINAL_CLOSE_CODES.has(close.code);
    if (terminal) ws.close();
    handlers.onClose?.(close.code, close.reason, terminal);
  });
  ws.addEventListener("error", () => handlers.onError?.());
  ws.addEventListener("message", (e) => {
    try {
      const result = decodeWireEvent(JSON.parse((e as MessageEvent).data as string));
      if (result.success) handlers.onEvent(result.output);
      else console.error("invalid wire event:", result.issues);
    } catch (err) {
      console.error("invalid wire event:", err);
    }
  });

  return {
    send: (e: ClientEvent) => ws.send(JSON.stringify(e)),
    reconnect: () => ws.reconnect(),
    close: () => ws.close(),
  };
}
