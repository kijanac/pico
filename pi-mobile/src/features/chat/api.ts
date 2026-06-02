import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { ApiClient } from "@/shared/lib/api-client";
import type { QueueState, SessionControls, SessionStats, SessionTree } from "@pi-mobile/protocol";
import { getBridgeClient } from "@/shared/lib/bridge-client";

function client(): ApiClient {
  return getBridgeClient();
}

export function compactSession(sessionId: string, instructions?: string): Promise<void> {
  return client().compactSession(sessionId, instructions);
}

export function getSessionQueue(sessionId: string): Promise<QueueState> {
  return client().getSessionQueue(sessionId);
}

export function clearSessionQueue(sessionId: string): Promise<QueueState> {
  return client().clearSessionQueue(sessionId);
}

export function getSessionSettings(sessionId: string): Promise<SessionControls> {
  return client().getSessionSettings(sessionId);
}

export function patchSessionSetting(sessionId: string, key: string, value: string | boolean): Promise<SessionControls> {
  return client().patchSessionSetting(sessionId, key, value);
}

export function getSessionStats(sessionId: string): Promise<SessionStats> {
  return client().getSessionStats(sessionId);
}

const safeFilenamePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";

export async function exportSessionHtml(sessionId: string): Promise<boolean> {
  const url = client().sessionExportHtmlUrl(sessionId);
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
      url: uri,
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

export function getSessionTree(sessionId: string): Promise<SessionTree> {
  return client().getSessionTree(sessionId);
}

export function navigateSessionTree(sessionId: string, opts: { entryId: string; summarize?: boolean }): Promise<void> {
  return client().navigateSessionTree(sessionId, opts);
}
