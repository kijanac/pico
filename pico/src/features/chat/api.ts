import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";
import { sessionExportHtmlUrl } from "@/shared/lib/host-http";
import { rpc } from "@/shared/lib/rpc-client";

export const compactSession = (sessionId: string, instructions?: string) =>
  rpc((c) => c.sessions.compact({ id: sessionId, instructions: instructions?.trim() || undefined }));

export const getSessionQueue = (sessionId: string) => rpc((c) => c.sessions.queue({ id: sessionId }));

export const clearSessionQueue = (sessionId: string) => rpc((c) => c.sessions.clearQueue({ id: sessionId }));

export const removeQueuedMessage = (sessionId: string, messageId: string) =>
  rpc((c) => c.sessions.removeQueued({ id: sessionId, messageId }));

export const listSessionCommands = (sessionId: string) => rpc((c) => c.sessions.commands({ id: sessionId }));

export const getSessionSettings = (sessionId: string) => rpc((c) => c.sessions.controls({ id: sessionId }));

export const patchSessionSetting = (sessionId: string, key: string, value: string | boolean) =>
  rpc((c) => c.sessions.patchControl({ id: sessionId, key, value }));

export const getSessionStats = (sessionId: string) => rpc((c) => c.sessions.stats({ id: sessionId }));

export const getSessionLogBefore = (sessionId: string, beforeId: string, limit?: number) =>
  rpc((c) => c.sessions.logBefore({ id: sessionId, beforeId, limit }));

const safeFilenamePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";

export async function exportSessionHtml(hostId: string, sessionId: string): Promise<boolean> {
  const host = hostRegistryState.getHost(hostId);
  if (!host) throw new Error(`Pico host not found: ${hostId}`);
  const url = sessionExportHtmlUrl(host.url, sessionId);
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`export failed (${response.status}): ${body.error ?? "unknown"}`);
  }

  const filename = `pi-session-${safeFilenamePart(sessionId)}.html`;
  const file = new File([await response.blob()], filename, { type: "text/html" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      // NotAllowedError: the tap's activation lapsed during the fetch; download instead.
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return true;
}

export const getSessionTree = (sessionId: string) => rpc((c) => c.sessions.tree({ id: sessionId }));

export const navigateSessionTree = (sessionId: string, opts: { entryId: string; summarize?: boolean }) =>
  rpc((c) => c.sessions.navigateTree({ id: sessionId, ...opts }));
