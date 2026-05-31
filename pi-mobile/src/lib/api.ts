import { WebSocket as ReconnectingWS } from "partysocket";
import {
  decodeWireEvent,
  parseCommands,
  parseGitBranchesResponse,
  parseQueueState,
  parseSessionStats,
} from "@pi-mobile/protocol";
import type {
  AuthLoginJob,
  AuthProviders,
  BridgeUpdateStatus,
  ClientEvent,
  Commands,
  GitBranch,
  GitBranchesResponse,
  QueueState,
  SessionMeta,
  SessionControls,
  SessionStats,
  SessionTree,
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

export const listSessions = (
  baseUrl: string,
  opts?: { archived?: boolean },
): Promise<SessionMeta[]> => {
  const url = new URL(`${baseUrl}/sessions`);
  if (opts?.archived) url.searchParams.set("archived", "1");
  return requestJson("listSessions", url);
};

export const createSession = (
  baseUrl: string,
  opts: { cwd: string; title: string; branch?: string },
): Promise<SessionMeta> =>
  requestJson("createSession", `${baseUrl}/sessions`, jsonInit("POST", opts));

export type GitBranchInfo = GitBranch;
export type GitBranchesResult = GitBranchesResponse;

export async function listGitBranches(baseUrl: string, cwd: string): Promise<GitBranchesResult> {
  const url = new URL(`${baseUrl}/git/branches`);
  url.searchParams.set("cwd", cwd);
  return parseGitBranchesResponse(await requestJson("listGitBranches", url));
}

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

export interface BridgeIdentity {
  readonly user?: string;
  readonly claimed: boolean;
}

export const getBridgeIdentity = (baseUrl: string): Promise<BridgeIdentity> =>
  requestJson("getBridgeIdentity", `${baseUrl}/system/identity`);

export const getBridgeUpdateStatus = (baseUrl: string): Promise<BridgeUpdateStatus> =>
  requestJson("getBridgeUpdateStatus", `${baseUrl}/system/update`);

export const triggerBridgeUpdate = (baseUrl: string): Promise<BridgeUpdateStatus> =>
  requestJson("triggerBridgeUpdate", `${baseUrl}/system/update`, { method: "POST" });

export const claimBridge = (baseUrl: string): Promise<{ claimed: true; owner: string }> =>
  requestJson("claimBridge", `${baseUrl}/setup/claim`, { method: "POST" });

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

export const sessionExportHtmlUrl = (baseUrl: string, id: string): string =>
  sessionUrl(baseUrl, id, "/export.html");

export const getSessionQueue = async (baseUrl: string, id: string): Promise<QueueState> =>
  parseQueueState(await requestJson("getSessionQueue", sessionUrl(baseUrl, id, "/queue")));

export const clearSessionQueue = async (baseUrl: string, id: string): Promise<QueueState> =>
  parseQueueState(
    await requestJson("clearSessionQueue", sessionUrl(baseUrl, id, "/queue"), { method: "DELETE" }),
  );

export const listAuthProviders = (baseUrl: string): Promise<AuthProviders> =>
  requestJson("listAuthProviders", `${baseUrl}/providers`);

export const startAuthLogin = (baseUrl: string, providerId: string): Promise<AuthLoginJob> =>
  requestJson("startAuthLogin", `${baseUrl}/providers/${encodeURIComponent(providerId)}/login`, jsonInit("POST"));

export const getAuthLoginJob = (baseUrl: string, jobId: string): Promise<AuthLoginJob> =>
  requestJson("getAuthLoginJob", `${baseUrl}/provider-logins/${encodeURIComponent(jobId)}`);

export const submitAuthLoginInput = (
  baseUrl: string,
  jobId: string,
  value: string,
): Promise<AuthLoginJob> =>
  requestJson(
    "submitAuthLoginInput",
    `${baseUrl}/provider-logins/${encodeURIComponent(jobId)}/input`,
    jsonInit("POST", { value }),
  );

export const cancelAuthLogin = (baseUrl: string, jobId: string): Promise<void> =>
  requestVoid("cancelAuthLogin", `${baseUrl}/provider-logins/${encodeURIComponent(jobId)}/cancel`, jsonInit("POST"));

export const getSessionSettings = (
  baseUrl: string,
  id: string,
): Promise<SessionControls> =>
  requestJson("getSessionSettings", sessionUrl(baseUrl, id, "/settings"));

export const patchSessionSetting = (
  baseUrl: string,
  id: string,
  key: string,
  value: string | boolean,
): Promise<SessionControls> =>
  requestJson("patchSessionSetting", sessionUrl(baseUrl, id, `/settings/${encodeURIComponent(key)}`), jsonInit("PATCH", { value }));

export const getSessionStats = async (
  baseUrl: string,
  id: string,
): Promise<SessionStats> =>
  parseSessionStats(await requestJson("getSessionStats", sessionUrl(baseUrl, id, "/stats")));

export const getSessionTree = (
  baseUrl: string,
  id: string,
): Promise<SessionTree> =>
  requestJson("getSessionTree", sessionUrl(baseUrl, id, "/tree"));

export const navigateSessionTree = (
  baseUrl: string,
  id: string,
  opts: { entryId: string; summarize?: boolean },
): Promise<void> =>
  requestVoid("navigateSessionTree", sessionUrl(baseUrl, id, "/tree/jump"), jsonInit("POST", opts));

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

export type { CommandEntry, Commands } from "@pi-mobile/protocol";

export const listCommands = async (baseUrl: string, sessionId?: string): Promise<Commands> =>
  parseCommands(
    await requestJson(
      "listCommands",
      sessionId === undefined
        ? `${baseUrl}/commands`
        : sessionUrl(baseUrl, sessionId, "/commands"),
    ),
  );

const TERMINAL_CLOSE_CODES = new Set<number>([4004]);

interface StreamHandlers {
  onOpen?: () => void;
  onClose?: (code: number, reason: string, terminal: boolean) => void;
  onError?: () => void;
  onEvent: (event: WireEvent) => void;
}

interface StreamHandle {
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
  ws.addEventListener("close", (e: CloseEvent) => {
    const terminal = TERMINAL_CLOSE_CODES.has(e.code);
    if (terminal) ws.close();
    handlers.onClose?.(e.code, e.reason, terminal);
  });
  ws.addEventListener("error", () => handlers.onError?.());
  ws.addEventListener("message", (e: MessageEvent<string>) => {
    try {
      const result = decodeWireEvent(JSON.parse(e.data));
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
