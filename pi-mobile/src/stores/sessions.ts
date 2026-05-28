/**
 * Session list + active session log.
 *
 * The list lives in a signal, refreshed from the bridge via
 * `loadSessions()`. The active log lives in a store; events arrive over the
 * wire and flow through `applyWireEvent()` — the single reducer used by both
 * the bridge transport and (during dev) the local mock.
 */
import { createSignal, createMemo, type Accessor } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type {
  AssistantMessage,
  LogEntry,
  SessionMeta,
  WireEvent,
} from "@pi-mobile/protocol";
import * as api from "~/lib/api";

/* ── session list ────────────────────────────────────────────────────── */

export const [sessions, setSessions] = createSignal<SessionMeta[]>([]);

export async function loadSessions(baseUrl: string): Promise<void> {
  const list = await api.listSessions(baseUrl);
  setSessions(list);
}

/** Memoised lookup by id-accessor — re-tracks when either id or list changes. */
export function useSession(id: Accessor<string>) {
  return createMemo(() => sessions().find((s) => s.id === id()));
}

/* ── active session status ───────────────────────────────────────────── */

export const [activeStatus, setActiveStatus] =
  createSignal<SessionMeta["status"]>("idle");

/**
 * Transient retry state. Pi emits `auto_retry_start` when it's about to
 * retry a provider failure (rate limit, transient network error) and
 * `auto_retry_end` when the retry resolves. Between those two events
 * the mobile shows a "retrying N of M" pill so the user sees the pause
 * is intentional rather than a hang.
 *
 * The eventual outcome — success or final failure — surfaces durably
 * via the subsequent `assistant_end` (with `stopReason` "error" on
 * final failure); `activeRetry` itself is intentionally ephemeral and
 * not persisted to the log.
 */
interface RetryState {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}
const [activeRetry, setActiveRetry] = createSignal<RetryState | null>(null);
export { activeRetry };

/* ── active session log ──────────────────────────────────────────────── */

const [log, setLog] = createStore<{
  entries: LogEntry[];
  /** Highest seq we've applied; what we send as `cursor` on reconnect. */
  cursor: number;
}>({ entries: [], cursor: 0 });

export const entries = () => log.entries;
export const cursor = () => log.cursor;

export function resetActiveLog() {
  setLog({ entries: [], cursor: 0 });
  setActiveStatus("idle");
  setActiveRetry(null);
}

const mutate = (fn: (arr: LogEntry[]) => void): void =>
  setLog("entries", produce(fn));

type AssistantEndEvent = Extract<WireEvent, { t: "assistant_end" }>;

function applyAssistantEnd(
  message: AssistantMessage,
  event: AssistantEndEvent,
): void {
  message.streaming = false;
  if (event.stopReason) message.stopReason = event.stopReason;
  if (event.errorMessage) message.errorMessage = event.errorMessage;
  if (event.usage) message.usage = event.usage;
}

function assistantFromEnd(event: AssistantEndEvent): AssistantMessage {
  const message: AssistantMessage = {
    kind: "assistant",
    id: event.id,
    at: Date.now(),
    text: "",
    streaming: false,
  };
  applyAssistantEnd(message, event);
  return message;
}

/**
 * Single ingestion point for the wire protocol. Used by the real WS client
 * and any test/mock streams. Pure with respect to the network.
 */
export function applyWireEvent(e: WireEvent): void {
  // Ignore replayed events we've already applied. This makes reconnects safe
  // even when the socket asks the bridge to replay from an older cursor.
  // Hello carries seq=0 and is metadata, so it is always allowed through.
  if (e.t !== "hello" && e.seq > 0 && e.seq <= log.cursor) return;

  // Track the high-water cursor for every event with a positive seq.
  // Hello carries seq=0 and we never want to set cursor to that.
  if (e.seq > log.cursor) setLog("cursor", e.seq);

  switch (e.t) {
    case "hello":
      // Caller may use e.session to update meta if needed; the route owns
      // that decision (it has the route context).
      return;

    case "user_message":
      return mutate((arr) => void arr.push(e.entry));

    case "assistant_delta":
      return mutate((arr) => {
        const existing = arr.find((x) => x.id === e.id);
        if (existing?.kind === "assistant") {
          existing.text += e.text;
          existing.streaming = true;
        } else {
          arr.push({
            kind: "assistant",
            id: e.id,
            at: Date.now(),
            text: e.text,
            streaming: true,
          });
        }
      });

    case "assistant_end":
      return mutate((arr) => {
        let m = arr.find((x) => x.id === e.id);
        if (!m) {
          // Zero-delta failure path: pi emitted an empty assistant
          // message with stopReason "error" before any text streamed,
          // so we never saw an assistant_delta to mint the entry from.
          // Push one now so the user sees the failure surfaced rather
          // than a silent thinking→idle transition.
          arr.push(assistantFromEnd(e));
          return;
        }
        if (m.kind === "assistant") applyAssistantEnd(m, e);
      });

    case "tool_call":
      return mutate((arr) => void arr.push(e.entry));

    case "tool_result":
      return mutate((arr) => {
        const m = arr.find((x) => x.id === e.id);
        if (m?.kind === "tool_call") {
          m.status = e.status;
          m.result = e.result;
          m.durationMs = e.durationMs;
        }
      });

    case "permission":
      return mutate((arr) => void arr.push(e.entry));

    case "status":
      setActiveStatus(e.status);
      return;

    case "cost":
      // Per-session cost updates need the active session id, which the
      // reducer doesn't carry. Session.tsx handles cost events directly in
      // its onEvent handler where params.id is in scope.
      return;

    case "auto_retry_start":
      setActiveRetry({
        attempt: e.attempt,
        maxAttempts: e.maxAttempts,
        delayMs: e.delayMs,
        errorMessage: e.errorMessage,
      });
      return;

    case "auto_retry_end":
      // Whether success or final failure, clear the transient banner —
      // a subsequent assistant_end (with stopReason "error" if the
      // final attempt failed) is the durable surfaced state.
      setActiveRetry(null);
      return;
  }
}

export function resolvePermissionLocal(
  id: string,
  choice: "allow" | "deny" | "allow_session",
): void {
  // Optimistic local update so the UI collapses the gate immediately;
  // the eventual server-side state will catch up via subsequent events.
  mutate((arr) => {
    const m = arr.find((x) => x.id === id);
    if (m?.kind === "permission") m.resolved = choice;
  });
}
