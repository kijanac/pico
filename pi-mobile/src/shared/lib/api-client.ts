function sessionUrl(baseUrl: string, id: string, suffix = ""): string {
  return `${baseUrl}/sessions/${encodeURIComponent(id)}${suffix}`;
}

// Non-RPC HTTP endpoints: the unauthenticated health probe and the HTML export
// URL (opened directly by the browser). RPC goes through rpc-client.ts; the live
// session stream goes through the WS-RPC client (PicoSessionClient).
export class ApiClient {
  constructor(readonly baseUrl: string) {}

  async healthcheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  sessionExportHtmlUrl(id: string): string {
    return sessionUrl(this.baseUrl, id, "/export.html");
  }
}
