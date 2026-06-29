import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { settingsState } from "@/features/settings/settings.state.svelte";
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

const safeFilenamePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";

export async function exportSessionHtml(sessionId: string): Promise<boolean> {
  const url = sessionExportHtmlUrl(settingsState.hostUrl, sessionId);
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`export failed (${response.status}): ${body.error ?? "unknown"}`);
  }

  const filename = `pi-session-${safeFilenamePart(sessionId)}.html`;
  const path = `exports/${filename}`;
  await Filesystem.writeFile({
    path,
    directory: Directory.Cache,
    data: await response.text(),
    encoding: Encoding.UTF8,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });

  try {
    await Share.share({
      title: filename,
      files: [uri],
      dialogTitle: "Export to HTML",
    });
    return true;
  } catch (error) {
    if (isShareCanceled(error)) return false;
    throw error;
  }
}

function isShareCanceled(error: unknown): boolean {
  return error instanceof Error && error.message === "Share canceled";
}

export const getSessionTree = (sessionId: string) => rpc((c) => c.sessions.tree({ id: sessionId }));

export const navigateSessionTree = (sessionId: string, opts: { entryId: string; summarize?: boolean }) =>
  rpc((c) => c.sessions.navigateTree({ id: sessionId, ...opts }));
