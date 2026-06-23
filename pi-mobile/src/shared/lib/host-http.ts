// Non-RPC host HTTP: the unauthenticated health probe and the HTML export URL
// (opened directly by the browser). RPC goes through rpc-client.ts; the live
// session stream through the WS-RPC client (PicoSessionClient).
export const healthcheckHostUrl = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(`${url.trim()}/healthz`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
};

export const sessionExportHtmlUrl = (baseUrl: string, sessionId: string): string =>
  `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/export.html`;
