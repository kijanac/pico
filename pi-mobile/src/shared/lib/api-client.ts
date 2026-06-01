import { TRPCClientError } from "@trpc/client";
import { WebSocket as ReconnectingWS } from "partysocket";
import { decodeWireEvent } from "@pi-mobile/protocol";
import type {
  AuthLoginJob,
  AuthProviders,
  BridgeUpdateStatus,
  ClientEvent,
  Commands,
  GitBranch,
  GitBranchesResponse,
  QueueState,
  SessionControls,
  SessionMeta,
  SessionStats,
  SessionTree,
  SystemInfo,
  WireEvent,
} from "@pi-mobile/protocol";
import type { BridgeClaimResult, BridgeIdentity, FsListing } from "@pi-mobile/protocol/trpc";
import type { AppRouter } from "@pi-mobile/protocol/trpc";
import { createBridgeTrpcClient } from "@/shared/lib/trpc-client";

export type { CommandEntry, Commands } from "@pi-mobile/protocol";
export type { BridgeIdentity, FsListing } from "@pi-mobile/protocol/trpc";

export type GitBranchInfo = GitBranch;
export type GitBranchesResult = GitBranchesResponse;

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

export class BridgeRpcError extends Error {
  constructor(
    readonly label: string,
    readonly code: string,
    readonly responseMessage: string,
  ) {
    super(`${label} ${code}: ${responseMessage}`);
    this.name = "BridgeRpcError";
  }
}

const TERMINAL_CLOSE_CODES = new Set<number>([4004]);

type TrpcClient = ReturnType<typeof createBridgeTrpcClient>;
type TrpcPromise<T> = Promise<T>;

async function rpc<T>(label: string, promise: TrpcPromise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      const trpcError = error as TRPCClientError<AppRouter>;
      throw new BridgeRpcError(label, trpcError.data?.code ?? "TRPC_ERROR", trpcError.message);
    }
    throw error;
  }
}

function sessionUrl(baseUrl: string, id: string, suffix = ""): string {
  return `${baseUrl}/sessions/${encodeURIComponent(id)}${suffix}`;
}

function wsBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws");
}

export class ApiClient {
  readonly trpc: TrpcClient;

  constructor(readonly baseUrl: string) {
    this.trpc = createBridgeTrpcClient(baseUrl);
  }

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

  listSessions(opts?: { archived?: boolean }): Promise<SessionMeta[]> {
    return rpc("listSessions", this.trpc.sessions.list.query(opts ?? {}));
  }

  createSession(opts: { cwd: string; title: string; branch?: string }): Promise<SessionMeta> {
    return rpc("createSession", this.trpc.sessions.create.mutate(opts));
  }

  patchSession(id: string, patch: { title?: string; archived?: boolean }): Promise<SessionMeta> {
    return rpc("patchSession", this.trpc.sessions.patch.mutate({ id, ...patch }));
  }

  deleteSession(id: string): Promise<void> {
    return rpc("deleteSession", this.trpc.sessions.remove.mutate({ id }));
  }

  listGitBranches(cwd: string): Promise<GitBranchesResult> {
    return rpc("listGitBranches", this.trpc.git.branches.query({ cwd }));
  }

  getSystemInfo(): Promise<SystemInfo> {
    return rpc("getSystemInfo", this.trpc.system.info.query({}));
  }

  getBridgeIdentity(): Promise<BridgeIdentity> {
    return rpc("getBridgeIdentity", this.trpc.system.identity.query({}));
  }

  getBridgeUpdateStatus(): Promise<BridgeUpdateStatus> {
    return rpc("getBridgeUpdateStatus", this.trpc.system.updateStatus.query({}));
  }

  triggerBridgeUpdate(): Promise<BridgeUpdateStatus> {
    return rpc("triggerBridgeUpdate", this.trpc.system.triggerUpdate.mutate({}));
  }

  claimBridge(): Promise<BridgeClaimResult> {
    return rpc("claimBridge", this.trpc.system.claim.mutate({}));
  }

  compactSession(id: string, instructions?: string): Promise<void> {
    return rpc("compactSession", this.trpc.sessions.compact.mutate({ id, instructions: instructions?.trim() || undefined }));
  }

  sessionExportHtmlUrl(id: string): string {
    return sessionUrl(this.baseUrl, id, "/export.html");
  }

  getSessionQueue(id: string): Promise<QueueState> {
    return rpc("getSessionQueue", this.trpc.sessions.queue.query({ id }));
  }

  clearSessionQueue(id: string): Promise<QueueState> {
    return rpc("clearSessionQueue", this.trpc.sessions.clearQueue.mutate({ id }));
  }

  listAuthProviders(): Promise<AuthProviders> {
    return rpc("listAuthProviders", this.trpc.auth.providers.query({}));
  }

  startAuthLogin(providerId: string): Promise<AuthLoginJob> {
    return rpc("startAuthLogin", this.trpc.auth.startLogin.mutate({ providerId }));
  }

  getAuthLoginJob(jobId: string): Promise<AuthLoginJob> {
    return rpc("getAuthLoginJob", this.trpc.auth.getLogin.query({ jobId }));
  }

  submitAuthLoginInput(jobId: string, value: string): Promise<AuthLoginJob> {
    return rpc("submitAuthLoginInput", this.trpc.auth.submitLoginInput.mutate({ jobId, value }));
  }

  cancelAuthLogin(jobId: string): Promise<void> {
    return rpc("cancelAuthLogin", this.trpc.auth.cancelLogin.mutate({ jobId }));
  }

  getSessionSettings(id: string): Promise<SessionControls> {
    return rpc("getSessionSettings", this.trpc.sessions.controls.query({ id }));
  }

  patchSessionSetting(id: string, key: string, value: string | boolean): Promise<SessionControls> {
    return rpc("patchSessionSetting", this.trpc.sessions.patchControl.mutate({ id, key, value }));
  }

  getSessionStats(id: string): Promise<SessionStats> {
    return rpc("getSessionStats", this.trpc.sessions.stats.query({ id }));
  }

  getSessionTree(id: string): Promise<SessionTree> {
    return rpc("getSessionTree", this.trpc.sessions.tree.query({ id }));
  }

  navigateSessionTree(id: string, opts: { entryId: string; summarize?: boolean }): Promise<void> {
    return rpc("navigateSessionTree", this.trpc.sessions.navigateTree.mutate({ id, ...opts }));
  }

  lsFs(path?: string): Promise<FsListing> {
    return rpc("lsFs", this.trpc.fs.ls.query({ path }));
  }

  listCommands(sessionId?: string): Promise<Commands> {
    return sessionId === undefined
      ? rpc("listCommands", this.trpc.commands.list.query({}))
      : rpc("listSessionCommands", this.trpc.sessions.commands.query({ id: sessionId }));
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
