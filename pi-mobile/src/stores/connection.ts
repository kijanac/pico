/**
 * Live connection state — what the header status pill renders.
 */
import { createSignal } from "solid-js";
import type { ClientEvent } from "@pi-mobile/protocol";

/**
 * Live connection state — what the header status pill renders.
 *
 *   connected     — WS up, events flowing
 *   connecting    — initial connect or after manual reconnect
 *   reconnecting  — transient drop; partysocket is retrying
 *   offline       — initial, before any connect attempt
 *   gone          — terminal: server says this session no longer exists.
 *                   No reconnect will happen; UI should bail to the list.
 *   error         — generic transport failure (still retrying)
 */
export type ConnState =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "offline"
  | "gone"
  | "error";

export const [connState, setConnState] = createSignal<ConnState>("offline");
export const [latencyMs, setLatencyMs] = createSignal<number | null>(null);

/**
 * The currently-active WS send function. Set by the Session route on mount,
 * cleared on cleanup. InputBar / PermissionGate read this to send events
 * without each having to know about the stream lifecycle.
 */
export const [activeSend, setActiveSend] =
  createSignal<((e: ClientEvent) => void) | null>(null);
