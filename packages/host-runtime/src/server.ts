import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Runtime } from "effect";
import { WebSocketServer } from "ws";
import { makeConnectionHandler, type WsBindings } from "./ws.ts";
import { authorizeHeaders, isAllowedBrowserOrigin } from "./auth.ts";
import type { SessionManager } from "./session.ts";

interface UpgradeServer {
  on(event: "upgrade", listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocketUpgrade(
  server: UpgradeServer,
  runtime: Runtime.Runtime<SessionManager>,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const onConnection = makeConnectionHandler(runtime);

  server.on("upgrade", (request, socket, head) => {
    if (!request.url || !request.headers.host) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get("session");
    const rawCursor = url.searchParams.get("cursor");
    if (!sessionId || rawCursor === null) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    const cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    if (!isAllowedBrowserOrigin(request.headers.origin)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const auth = authorizeHeaders(request.headers);
    if (!auth.ok) {
      rejectUpgrade(socket, auth.status, auth.status === 401 ? "Unauthorized" : "Forbidden");
      return;
    }

    const bindings: WsBindings = { sessionId, cursor };
    wss.handleUpgrade(request, socket, head, (ws) => {
      onConnection(ws, bindings);
    });
  });

  return wss;
}
