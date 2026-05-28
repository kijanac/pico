/**
 * Bridge HTTP + WebSocket client.
 *
 * REST is plain fetch. The live stream uses partysocket's ReconnectingWebSocket
 * — a drop-in for the browser's WebSocket with built-in exponential-backoff
 * reconnect, which is critical on mobile where the OS drops sockets when the
 * app backgrounds.
 */
import { WebSocket as ReconnectingWS } from "partysocket";
import { decodeWireEvent } from "@pi-mobile/protocol";
import type {
  ClientEvent,
  SessionMeta,
  SessionModelState,
  WireEvent,
} from "@pi-mobile/protocol";

/* ── REST ───────────────────────────────────────────────────────────── */

export async function listSessions(baseUrl: string): Promise<SessionMeta[]> {
  const res = await fetch(`${baseUrl}/sessions`);
  if (!res.ok) throw new Error(`listSessions: ${res.status} ${res.statusText}`);
  return (await res.json()) as SessionMeta[];
}

export async function createSession(
  baseUrl: string,
  opts: { cwd: string; title?: string; branch?: string },
): Promise<SessionMeta> {
  const res = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`createSession: ${res.status} ${res.statusText}`);
  return (await res.json()) as SessionMeta;
}

/**
 * Partial update — supply only the fields you want to change. The
 * bridge rejects empty bodies with 400, so call sites should pass at
 * least one of `title` / `archived`. Returns the updated meta.
 */
export async function patchSession(
  baseUrl: string,
  id: string,
  patch: { title?: string; archived?: boolean },
): Promise<SessionMeta> {
  const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`patchSession ${res.status}: ${body.error ?? "unknown"}`);
  }
  return (await res.json()) as SessionMeta;
}

/**
 * Hard delete. The bridge purges all persisted events for the session
 * and tears down any live PiSession; concurrent WS subscribers see the
 * socket close. Returns nothing on success (HTTP 204).
 */
export async function deleteSession(
  baseUrl: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`deleteSession ${res.status}: ${body.error ?? "unknown"}`);
  }
}

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

/* ── agent actions ──────────────────────────────────────────────────── */

export async function listSessionModels(
  baseUrl: string,
  id: string,
): Promise<SessionModelState> {
  const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(id)}/models`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`listSessionModels ${res.status}: ${body.error ?? "unknown"}`);
  }
  return (await res.json()) as SessionModelState;
}

export async function setSessionModel(
  baseUrl: string,
  id: string,
  opts: { provider: string; modelId: string },
): Promise<void> {
  const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(id)}/model`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`setSessionModel ${res.status}: ${body.error ?? "unknown"}`);
  }
}

export async function compactSession(
  baseUrl: string,
  id: string,
  instructions?: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/sessions/${encodeURIComponent(id)}/compact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instructions: instructions?.trim() || undefined }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`compactSession ${res.status}: ${body.error ?? "unknown"}`);
  }
}

/* ── filesystem ─────────────────────────────────────────────────────── */

export interface FsListing {
  /** Absolute path the listing is for (after resolution). */
  path: string;
  /** Parent path, or null at the root. */
  parent: string | null;
  /** User's home directory. */
  home: string;
  entries: Array<{ name: string; hidden: boolean }>;
}

export async function lsFs(
  baseUrl: string,
  path?: string,
): Promise<FsListing> {
  const url = new URL(`${baseUrl}/fs/ls`);
  if (path !== undefined) url.searchParams.set("path", path);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`lsFs ${res.status}: ${body.error ?? "unknown"}`);
  }
  return (await res.json()) as FsListing;
}

/* ── slash commands ─────────────────────────────────────────────────── */

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

export async function listCommands(baseUrl: string): Promise<Commands> {
  const res = await fetch(`${baseUrl}/commands`);
  if (!res.ok)
    throw new Error(`listCommands: ${res.status} ${res.statusText}`);
  return (await res.json()) as Commands;
}

/* ── WS stream ──────────────────────────────────────────────────────── */

/**
 * Close codes whose presence means "don't bother reconnecting — this
 * session is irrecoverable." Currently just 4004 (session not found),
 * but extending the set in the future is a matter of adding entries
 * here on the mobile side once the bridge starts emitting them.
 *
 * Anything outside this set (transport errors, server restarts,
 * network drops, etc.) is treated as transient: partysocket reconnects
 * with backoff and the cursor-based replay layer handles the gap.
 */
const TERMINAL_CLOSE_CODES = new Set<number>([4004]);

export interface StreamHandlers {
  onOpen?: () => void;
  /**
   * Called on every close. `terminal` is true when the close code is
   * one the server uses to say "this session is dead, stop trying"
   * (e.g., 4004 for a missing session). Callers should surface this
   * to the user — usually by navigating away — since reconnects have
   * also been stopped by then.
   */
  onClose?: (code: number, reason: string, terminal: boolean) => void;
  onError?: () => void;
  onEvent: (event: WireEvent) => void;
}

export interface StreamHandle {
  send: (e: ClientEvent) => void;
  /** Force a fresh socket — used on app foreground after the OS may
   *  have silently killed the connection while backgrounded. */
  reconnect: () => void;
  close: () => void;
}

export function connectStream(
  baseUrl: string,
  sessionId: string,
  cursor: number,
  handlers: StreamHandlers,
): StreamHandle {
  // http → ws, https → wss
  const wsBase = baseUrl.replace(/^http/, "ws");
  const url = `${wsBase}/ws?session=${encodeURIComponent(sessionId)}&cursor=${cursor}`;

  // ReconnectingWebSocket is API-compatible with the browser WebSocket.
  // We tweak the backoff for mobile: faster initial reconnect, capped at 10s.
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
    if (terminal) {
      // partysocket reconnects on every close by default. A client-
      // side .close() flips its internal `shouldReconnect` flag off,
      // so the reconnect loop stops. The socket is already closed
      // network-side; this is a state-only call.
      ws.close();
    }
    handlers.onClose?.(close.code, close.reason, terminal);
  });
  ws.addEventListener("error", () => handlers.onError?.());
  ws.addEventListener("message", (e) => {
    try {
      const parsed = JSON.parse((e as MessageEvent).data as string);
      const result = decodeWireEvent(parsed);
      if (!result.success) {
        console.error("invalid wire event:", result.issues);
        return;
      }
      handlers.onEvent(result.output);
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
