import { WebSocket as ReconnectingWS } from "partysocket";
import { decodeWireEvent } from "@pico/protocol";
import type { ClientEvent, WireEvent } from "@pico/protocol";

export interface StreamHandlers {
  onOpen?: () => void;
  onClose?: (code: number, reason: string, terminal: boolean) => void;
  onError?: () => void;
  onEvent: (event: WireEvent) => void;
}

export interface StreamHandle {
  send: (event: ClientEvent) => void;
  reconnect: () => void;
  close: () => void;
}

const TERMINAL_CLOSE_CODES = new Set<number>([4004]);

function sessionUrl(baseUrl: string, id: string, suffix = ""): string {
  return `${baseUrl}/sessions/${encodeURIComponent(id)}${suffix}`;
}

function wsBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws");
}

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

  connectSessionStream(
    sessionId: string,
    cursor: number | (() => number),
    handlers: StreamHandlers,
  ): StreamHandle {
    const currentCursor = () => (typeof cursor === "function" ? cursor() : cursor);
    const url = () => `${wsBaseUrl(this.baseUrl)}/ws?session=${encodeURIComponent(sessionId)}&cursor=${currentCursor()}`;

    const ws = new ReconnectingWS(url, [], {
      minReconnectionDelay: 500,
      maxReconnectionDelay: 10_000,
      reconnectionDelayGrowFactor: 1.5,
      connectionTimeout: 5_000,
      maxRetries: Infinity,
    });

    ws.addEventListener("open", () => handlers.onOpen?.());
    ws.addEventListener("close", (event: CloseEvent) => {
      const terminal = TERMINAL_CLOSE_CODES.has(event.code);
      if (terminal) ws.close();
      handlers.onClose?.(event.code, event.reason, terminal);
    });
    ws.addEventListener("error", () => handlers.onError?.());
    ws.addEventListener("message", (event: MessageEvent<string>) => {
      try {
        const result = decodeWireEvent(JSON.parse(event.data));
        if (result.success) handlers.onEvent(result.output);
        else console.error("invalid wire event:", result.issues);
      } catch (error) {
        console.error("invalid wire event:", error);
      }
    });

    return {
      send: (event: ClientEvent) => ws.send(JSON.stringify(event)),
      reconnect: () => ws.reconnect(),
      close: () => ws.close(),
    };
  }
}
