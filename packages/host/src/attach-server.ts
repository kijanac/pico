import { chmod, lstat, unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { isAbsolute, join } from "node:path";
import { PicoAttachClientMessage } from "@pico/protocol";
import { Context, Effect, Schema } from "effect";
import { HOST_DATA_DIR } from "./config.ts";
import { makeAttachedPiPeer, type AttachedPiPeer } from "./attached-pi-session.ts";
import type { PresenceHandoffLease, SessionManager } from "./session.ts";
import {
  backgroundCompatibility,
  EMBEDDED_PI_VERSION,
  parsePiSessionBinding,
} from "./pi-compatibility.ts";

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const HANDSHAKE_TIMEOUT_MS = 30_000;
const HANDOFF_LEASE_TIMEOUT_MS = 30_000;

export const PICO_ATTACH_SOCKET_PATH = process.env.PICO_ATTACH_SOCKET?.trim() || join(HOST_DATA_DIR, "pi-attach.sock");

export interface AttachServerHandle {
  readonly socketPath: string;
  close(): Promise<void>;
}

type Manager = Context.Tag.Service<SessionManager>;

const socketIsLive = (): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = connect(PICO_ATTACH_SOCKET_PATH);
    probe.once("connect", () => {
      probe.end();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });

const removeSocketFile = async () => {
  try {
    const info = await lstat(PICO_ATTACH_SOCKET_PATH);
    if (!info.isSocket()) throw new Error(`refusing to replace non-socket path: ${PICO_ATTACH_SOCKET_PATH}`);
    if (await socketIsLive()) throw new Error(`Pico attach socket is already in use: ${PICO_ATTACH_SOCKET_PATH}`);
    await unlink(PICO_ATTACH_SOCKET_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const listen = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(PICO_ATTACH_SOCKET_PATH, () => {
      server.off("error", onError);
      resolve();
    });
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

function handleSocket(socket: Socket, manager: Manager, sockets: Set<Socket>): void {
  const logAttachError = (event: string, error: unknown) => {
    Effect.runFork(
      Effect.logError(event).pipe(
        Effect.annotateLogs({ reason: error instanceof Error ? error.message : String(error) }),
      ),
    );
  };

  sockets.add(socket);
  socket.setEncoding("utf8");
  socket.setNoDelay(true);

  let buffer = "";
  let protocolVersion: 1 | 2 | 3 | undefined;
  let terminalPiVersion: string | undefined;
  let reclaimedRuntimeSessionId: string | undefined;
  let peer: AttachedPiPeer | undefined;
  let pendingHandoff: PresenceHandoffLease | undefined;
  let handoffTimer: ReturnType<typeof setTimeout> | undefined;
  let processing: Promise<void> = Promise.resolve();
  let failed = false;
  let cleanupStarted = false;
  const handshakeTimer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
  handshakeTimer.unref();

  const fail = (error: unknown) => {
    if (failed || socket.destroyed) return;
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    socket.end(`${JSON.stringify({ t: "error", error: message })}\n`);
  };

  const processMessage = async (raw: string) => {
    let decoded: typeof PicoAttachClientMessage.Type;
    try {
      decoded = Schema.decodeUnknownSync(PicoAttachClientMessage)(JSON.parse(raw));
    } catch {
      // Effect's complete union parse tree can be several MiB for a malformed
      // transcript. Keep the wire error bounded and actionable.
      throw new Error("invalid Pico attach message");
    }
    if (!peer) {
      if (decoded.t !== "hello") throw new Error("the first Pico attach message must be hello");
      const hello = decoded;
      if (hello.reclaimLeaseId) {
        reclaimedRuntimeSessionId = await Effect.runPromise(
          manager.consumeTerminalRelease(hello.reclaimLeaseId, hello.session.id),
        );
      } else if (!hello.session.id.startsWith("attached:")) {
        throw new Error("attached session id must use the attached: namespace");
      }
      protocolVersion = hello.version;
      terminalPiVersion = hello.piVersion;
      const compatibility = backgroundCompatibility(terminalPiVersion);
      const effectiveHello = compatibility.compatible
        ? hello
        : {
            ...hello,
            session: {
              ...hello.session,
              canBackground: false,
            },
          };
      peer = await Effect.runPromise(makeAttachedPiPeer(socket, effectiveHello));
      await Effect.runPromise(manager.attachPresence(peer.session));
      socket.write(`${JSON.stringify({
        t: "ready",
        sessionId: hello.session.id,
        hostPiVersion: EMBEDDED_PI_VERSION,
        backgroundCompatible: compatibility.compatible,
        ...(!compatibility.compatible ? { backgroundIncompatibility: compatibility.reason } : {}),
      })}\n`);
      clearTimeout(handshakeTimer);
      return;
    }
    if (decoded.t === "hello") throw new Error("duplicate Pico attach hello");
    if (decoded.t === "handoff") {
      if (pendingHandoff) {
        socket.write(`${JSON.stringify({
          t: "handoff_response",
          id: decoded.id,
          ok: false,
          error: "a background handoff is already pending",
        })}\n`);
        return;
      }
      try {
        if (protocolVersion !== 3) {
          throw new Error("background handoff requires Pico attach protocol 3; update the Pico Pi extension");
        }
        const compatibility = backgroundCompatibility(terminalPiVersion);
        if (!compatibility.compatible) throw new Error(compatibility.reason);
        if (reclaimedRuntimeSessionId) {
          if (decoded.runtimeSessionId !== reclaimedRuntimeSessionId) {
            throw new Error("reclaimed session identity does not match its Pi runtime");
          }
        } else if (peer.session.meta.id !== `attached:${decoded.runtimeSessionId}`) {
          throw new Error("attached session identity does not match its Pi runtime");
        }
        if (!isAbsolute(decoded.runtimeSessionFile)) {
          throw new Error("handoff session file must be an absolute path");
        }
        if (!(await lstat(decoded.runtimeSessionFile)).isFile()) {
          throw new Error("handoff session file is not a regular file");
        }
        const binding = await parsePiSessionBinding(
          decoded.runtimeSessionFile,
          decoded.runtimeSessionId,
        );
        const lease = await Effect.runPromise(manager.preparePresenceHandoff(
          peer.session.meta.id,
          peer.session,
          {
            runtimeSessionId: binding.runtimeSessionId,
            runtimeSessionFile: binding.runtimeSessionFile,
            ownerPid: decoded.ownerPid,
          },
        ));
        pendingHandoff = lease;
        handoffTimer = setTimeout(() => {
          if (pendingHandoff !== lease) return;
          pendingHandoff = undefined;
          void Effect.runPromise(
            manager.cancelPresenceHandoff(peer!.session.meta.id, peer!.session, lease),
          ).catch((error) => logAttachError("attach_handoff_cancel_failed", error));
        }, HANDOFF_LEASE_TIMEOUT_MS);
        handoffTimer.unref();
        socket.write(`${JSON.stringify({
          t: "handoff_response",
          id: decoded.id,
          ok: true,
          leaseId: lease.leaseId,
        })}\n`);
      } catch (error) {
        socket.write(`${JSON.stringify({
          t: "handoff_response",
          id: decoded.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}\n`);
      }
      return;
    }
    await peer.receive(decoded);
  };

  socket.on("data", (chunk: string) => {
    if (failed) return;
    socket.pause();
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
      fail(new Error("Pico attach message exceeds 8 MiB"));
      return;
    }

    const lines: string[] = [];
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) lines.push(line);
    }

    processing = processing
      .then(async () => {
        for (const line of lines) {
          if (failed) return;
          await processMessage(line);
        }
      })
      .catch(fail)
      .finally(() => {
        if (!failed && !socket.destroyed) socket.resume();
      });
  });

  socket.on("error", () => {
    // A socket error is followed by close; keeping this listener prevents an
    // unhandled EventEmitter error from taking down pico-host.
    failed = true;
  });

  socket.on("close", () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    clearTimeout(handshakeTimer);
    if (handoffTimer) clearTimeout(handoffTimer);
    sockets.delete(socket);
    void processing.finally(async () => {
      const disconnected = peer;
      if (!disconnected) return;
      disconnected.disconnect();
      const lease = pendingHandoff;
      if (lease) {
        await Effect.runPromise(manager.completePresenceHandoff(
          disconnected.session.meta.id,
          disconnected.session,
          lease,
        ));
      } else {
        await Effect.runPromise(manager.detachPresence(disconnected.session.meta.id, disconnected.session));
      }
    }).catch((error) => logAttachError("attach_socket_cleanup_failed", error));
  });
}

export async function startAttachServer(manager: Manager): Promise<AttachServerHandle> {
  await removeSocketFile();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => handleSocket(socket, manager, sockets));
  await listen(server);
  try {
    await chmod(PICO_ATTACH_SOCKET_PATH, 0o600);
  } catch (error) {
    await closeServer(server);
    await unlink(PICO_ATTACH_SOCKET_PATH).catch(() => undefined);
    throw error;
  }

  let closed = false;
  return {
    socketPath: PICO_ATTACH_SOCKET_PATH,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
      await unlink(PICO_ATTACH_SOCKET_PATH).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}
