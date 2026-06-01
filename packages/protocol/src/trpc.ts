import { initTRPC } from "@trpc/server";
import * as v from "valibot";
import type {
  AuthLoginJob,
  AuthProviders,
  BridgeUpdateStatus,
  Commands,
  GitBranchesResponse,
  QueueState,
  SessionControls,
  SessionMeta,
  SessionStats,
  SessionTree,
  SystemInfo,
} from "./index.ts";

export interface BridgeIdentity {
  readonly user?: string;
  readonly claimed: boolean;
}

export interface BridgeClaimResult {
  readonly claimed: true;
  readonly owner: string;
}

export interface FsListing {
  path: string;
  parent: string | null;
  home: string;
  entries: Array<{ name: string; hidden: boolean }>;
}

export type EmptyInput = Record<string, never>;
export type IdInput = { id: string };
export type ListSessionsInput = { archived?: boolean };
export type CreateSessionInput = { cwd: string; title: string; branch?: string };
export type PatchSessionInput = IdInput & { title?: string; archived?: boolean };
export type PatchControlInput = IdInput & { key: string; value: string | boolean };
export type CompactSessionInput = IdInput & { instructions?: string };
export type NavigateTreeInput = IdInput & { entryId: string; summarize?: boolean };
export type ProviderIdInput = { providerId: string };
export type AuthJobInput = { jobId: string };
export type AuthInput = AuthJobInput & { value: string };
export type AuthApiKeyInput = ProviderIdInput & { apiKey: string };
export type FsLsInput = { path?: string };
export type GitBranchesInput = { cwd: string };

export interface SystemTrpcService {
  readonly info: () => Promise<SystemInfo>;
  readonly updateStatus: () => Promise<BridgeUpdateStatus>;
  readonly triggerUpdate: () => Promise<BridgeUpdateStatus>;
  readonly identity: () => Promise<BridgeIdentity>;
  readonly claim: () => Promise<BridgeClaimResult>;
}

export interface SessionTrpcService {
  readonly list: (input: ListSessionsInput) => Promise<SessionMeta[]>;
  readonly create: (input: CreateSessionInput) => Promise<SessionMeta>;
  readonly patch: (input: PatchSessionInput) => Promise<SessionMeta>;
  readonly remove: (input: IdInput) => Promise<void>;
  readonly controls: (input: IdInput) => Promise<SessionControls>;
  readonly patchControl: (input: PatchControlInput) => Promise<SessionControls>;
  readonly compact: (input: CompactSessionInput) => Promise<void>;
  readonly queue: (input: IdInput) => Promise<QueueState>;
  readonly clearQueue: (input: IdInput) => Promise<QueueState>;
  readonly stats: (input: IdInput) => Promise<SessionStats>;
  readonly tree: (input: IdInput) => Promise<SessionTree>;
  readonly navigateTree: (input: NavigateTreeInput) => Promise<void>;
  readonly commands: (input: IdInput) => Promise<Commands>;
}

export interface AuthTrpcService {
  readonly providers: () => Promise<AuthProviders>;
  readonly startLogin: (input: ProviderIdInput) => Promise<AuthLoginJob>;
  readonly getLogin: (input: AuthJobInput) => Promise<AuthLoginJob>;
  readonly submitLoginInput: (input: AuthInput) => Promise<AuthLoginJob>;
  readonly saveApiKey: (input: AuthApiKeyInput) => Promise<AuthProviders>;
  readonly cancelLogin: (input: AuthJobInput) => Promise<void>;
}

export interface FsTrpcService {
  readonly ls: (input: FsLsInput) => Promise<FsListing>;
}

export interface GitTrpcService {
  readonly branches: (input: GitBranchesInput) => Promise<GitBranchesResponse>;
}

export interface BridgeTrpcServices {
  readonly system: SystemTrpcService;
  readonly sessions: SessionTrpcService;
  readonly auth: AuthTrpcService;
  readonly commands: { readonly list: () => Promise<Commands> };
  readonly fs: FsTrpcService;
  readonly git: GitTrpcService;
}

const t = initTRPC.context<BridgeTrpcServices>().create();
const procedure = t.procedure;

const Empty = v.optional(v.object({}), {});
const Id = v.object({ id: v.string() });
const ListSessions = v.optional(v.object({ archived: v.optional(v.boolean()) }), {});
const CreateSession = v.object({ cwd: v.pipe(v.string(), v.trim(), v.nonEmpty()), title: v.pipe(v.string(), v.trim(), v.nonEmpty()), branch: v.optional(v.string()) });
const PatchSession = v.object({ id: v.string(), title: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty())), archived: v.optional(v.boolean()) });
const PatchControl = v.object({ id: v.string(), key: v.string(), value: v.union([v.string(), v.boolean()]) });
const CompactSession = v.object({ id: v.string(), instructions: v.optional(v.string()) });
const NavigateTree = v.object({ id: v.string(), entryId: v.string(), summarize: v.optional(v.boolean()) });
const ProviderId = v.object({ providerId: v.string() });
const AuthJob = v.object({ jobId: v.string() });
const AuthInputBody = v.object({ jobId: v.string(), value: v.string() });
const AuthApiKey = v.object({ providerId: v.string(), apiKey: v.pipe(v.string(), v.trim(), v.nonEmpty()) });
const FsLs = v.optional(v.object({ path: v.optional(v.string()) }), {});
const GitBranches = v.object({ cwd: v.pipe(v.string(), v.trim(), v.nonEmpty()) });

export const appRouter = t.router({
  system: t.router({
    info: procedure.input(Empty).query(({ ctx }) => ctx.system.info()),
    updateStatus: procedure.input(Empty).query(({ ctx }) => ctx.system.updateStatus()),
    triggerUpdate: procedure.input(Empty).mutation(({ ctx }) => ctx.system.triggerUpdate()),
    identity: procedure.input(Empty).query(({ ctx }) => ctx.system.identity()),
    claim: procedure.input(Empty).mutation(({ ctx }) => ctx.system.claim()),
  }),
  sessions: t.router({
    list: procedure.input(ListSessions).query(({ ctx, input }) => ctx.sessions.list(input)),
    create: procedure.input(CreateSession).mutation(({ ctx, input }) => ctx.sessions.create(input)),
    patch: procedure.input(PatchSession).mutation(({ ctx, input }) => ctx.sessions.patch(input)),
    remove: procedure.input(Id).mutation(({ ctx, input }) => ctx.sessions.remove(input)),
    controls: procedure.input(Id).query(({ ctx, input }) => ctx.sessions.controls(input)),
    patchControl: procedure.input(PatchControl).mutation(({ ctx, input }) => ctx.sessions.patchControl(input)),
    compact: procedure.input(CompactSession).mutation(({ ctx, input }) => ctx.sessions.compact(input)),
    queue: procedure.input(Id).query(({ ctx, input }) => ctx.sessions.queue(input)),
    clearQueue: procedure.input(Id).mutation(({ ctx, input }) => ctx.sessions.clearQueue(input)),
    stats: procedure.input(Id).query(({ ctx, input }) => ctx.sessions.stats(input)),
    tree: procedure.input(Id).query(({ ctx, input }) => ctx.sessions.tree(input)),
    navigateTree: procedure.input(NavigateTree).mutation(({ ctx, input }) => ctx.sessions.navigateTree(input)),
    commands: procedure.input(Id).query(({ ctx, input }) => ctx.sessions.commands(input)),
  }),
  auth: t.router({
    providers: procedure.input(Empty).query(({ ctx }) => ctx.auth.providers()),
    startLogin: procedure.input(ProviderId).mutation(({ ctx, input }) => ctx.auth.startLogin(input)),
    getLogin: procedure.input(AuthJob).query(({ ctx, input }) => ctx.auth.getLogin(input)),
    submitLoginInput: procedure.input(AuthInputBody).mutation(({ ctx, input }) => ctx.auth.submitLoginInput(input)),
    saveApiKey: procedure.input(AuthApiKey).mutation(({ ctx, input }) => ctx.auth.saveApiKey(input)),
    cancelLogin: procedure.input(AuthJob).mutation(({ ctx, input }) => ctx.auth.cancelLogin(input)),
  }),
  commands: t.router({
    list: procedure.input(Empty).query(({ ctx }) => ctx.commands.list()),
  }),
  fs: t.router({
    ls: procedure.input(FsLs).query(({ ctx, input }) => ctx.fs.ls(input)),
  }),
  git: t.router({
    branches: procedure.input(GitBranches).query(({ ctx, input }) => ctx.git.branches(input)),
  }),
});

export type AppRouter = typeof appRouter;
