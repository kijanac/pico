import type { ExtensionUiResponseValue, ImageContent, SendMode } from "@pico/protocol";
import { sessionExportHtmlUrl } from "@/shared/lib/host-http";
import { rpc } from "@/shared/lib/rpc-client";

export const compactSession = (sessionId: string, instructions?: string) =>
  rpc((c) => c.sessions.compact({ id: sessionId, instructions: instructions?.trim() || undefined }));

export const sendMessage = (
  sessionId: string,
  message: { cid: string; text: string; mode: SendMode; images?: readonly ImageContent[]; base: string | null; retry: boolean },
) => rpc((c) => c.sessions.send({ id: sessionId, ...message }));

export const interruptSession = (sessionId: string) => rpc((c) => c.sessions.interrupt({ id: sessionId }));

export const answerExtensionUi = (sessionId: string, requestId: string, value: ExtensionUiResponseValue) =>
  rpc((c) => c.sessions.uiResponse({ id: sessionId, requestId, value }));

export const clearSessionQueue = (sessionId: string) => rpc((c) => c.sessions.clearQueue({ id: sessionId }));

export const listSessionCommands = (sessionId: string) => rpc((c) => c.sessions.commands({ id: sessionId }));

export const getSessionSettings = (sessionId: string) => rpc((c) => c.sessions.controls({ id: sessionId }));

export const patchSessionSetting = (sessionId: string, key: string, value: string | boolean) =>
  rpc((c) => c.sessions.patchControl({ id: sessionId, key, value }));

export const getSessionStats = (sessionId: string) => rpc((c) => c.sessions.stats({ id: sessionId }));

export const getSessionHistory = (sessionId: string, before: string, limit?: number) =>
  rpc((c) => c.sessions.history({ id: sessionId, before, limit }));

const safeFilenamePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";

export async function exportSessionHtml(sessionId: string): Promise<boolean> {
  const response = await fetch(sessionExportHtmlUrl(sessionId));
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
