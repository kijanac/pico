import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import type { AuthLoginJob, AuthProvider } from "@pi-mobile/protocol";
import { getAgentServices, PiError, reloadAgentAuth } from "./pi.ts";

interface AuthJobState {
  job: AuthLoginJob;
  abort: AbortController;
  resolveInput?: (value: string) => void;
}

const nextId = (prefix: string) => `${prefix}_${randomUUID()}`;
const TERMINAL_JOB_TTL_MS = 60_000;
const isTerminalStatus = (status: AuthLoginJob["status"]) => ["success", "failed", "cancelled"].includes(status);

export class ProviderAuth extends Context.Tag("ProviderAuth")<
  ProviderAuth,
  {
    readonly listProviders: () => Effect.Effect<{ providers: AuthProvider[] }, PiError>;
    readonly startLogin: (providerId: string) => Effect.Effect<AuthLoginJob, PiError>;
    readonly getLogin: (jobId: string) => Effect.Effect<AuthLoginJob, PiError>;
    readonly submitLoginInput: (jobId: string, value: string) => Effect.Effect<AuthLoginJob, PiError>;
    readonly cancelLogin: (jobId: string) => Effect.Effect<void, PiError>;
  }
>() {}

export const ProviderAuthLive = Layer.effect(
  ProviderAuth,
  Effect.gen(function* () {
    const authJobs = new Map<string, AuthJobState>();
    const removeIfTerminalLater = (jobId: string) => {
      setTimeout(() => {
        const state = authJobs.get(jobId);
        if (state && isTerminalStatus(state.job.status)) authJobs.delete(jobId);
      }, TERMINAL_JOB_TTL_MS).unref();
    };
    const getDefaultServices = () =>
      Effect.tryPromise({
        try: () => getAgentServices(process.cwd()),
        catch: (e) => new PiError(`createAgentSessionServices failed: ${String(e)}`),
      });

    return {
      listProviders: () =>
        Effect.flatMap(getDefaultServices(), (services) =>
          Effect.sync(() => ({
            providers: services.modelRegistry.authStorage.getOAuthProviders().map((p) => {
              const status = services.modelRegistry.authStorage.getAuthStatus(p.id);
              return {
                id: p.id,
                name: p.name,
                configured: status.configured,
                ...(status.source ? { source: status.source } : {}),
                ...(status.label ? { label: status.label } : {}),
              };
            }),
          })),
        ),
      startLogin: (providerId) =>
        Effect.flatMap(getDefaultServices(), (services) =>
          Effect.sync(() => {
            const provider = services.modelRegistry.authStorage.getOAuthProviders().find((p) => p.id === providerId);
            if (!provider) throw new PiError(`auth provider not found: ${providerId}`);
            const id = nextId("auth");
            const abort = new AbortController();
            const state: AuthJobState = {
              abort,
              job: { id, providerId, providerName: provider.name, status: "starting" },
            };
            authJobs.set(id, state);
            void services.modelRegistry.authStorage.login(providerId, {
              signal: abort.signal,
              onAuth: (info) => {
                state.job = { ...state.job, status: "auth", authUrl: info.url, instructions: info.instructions };
              },
              onDeviceCode: (info) => {
                state.job = { ...state.job, status: "device", userCode: info.userCode, verificationUri: info.verificationUri };
              },
              onProgress: (progress) => {
                state.job = { ...state.job, status: "progress", progress };
              },
              onSelect: async () => providerId,
              onPrompt: async (prompt) => {
                state.job = { ...state.job, status: "prompt", promptMessage: prompt.message, promptPlaceholder: prompt.placeholder };
                return await new Promise<string>((resolve) => { state.resolveInput = resolve; });
              },
              onManualCodeInput: async () => {
                state.job = { ...state.job, status: "manual", promptMessage: "Paste the authorization code or final redirect URL" };
                return await new Promise<string>((resolve) => { state.resolveInput = resolve; });
              },
            }).then(() => {
              reloadAgentAuth();
              state.job = { ...state.job, status: "success" };
              removeIfTerminalLater(id);
            }).catch((e) => {
              state.job = { ...state.job, status: abort.signal.aborted ? "cancelled" : "failed", error: String(e) };
              removeIfTerminalLater(id);
            });
            return state.job;
          }),
        ),
      getLogin: (jobId) =>
        Effect.sync(() => {
          const state = authJobs.get(jobId);
          if (!state) throw new PiError(`auth job not found: ${jobId}`);
          return state.job;
        }),
      submitLoginInput: (jobId, value) =>
        Effect.sync(() => {
          const state = authJobs.get(jobId);
          if (!state) throw new PiError(`auth job not found: ${jobId}`);
          state.resolveInput?.(value);
          state.resolveInput = undefined;
          state.job = { ...state.job, status: "progress", progress: "Submitted authentication input…" };
          return state.job;
        }),
      cancelLogin: (jobId) =>
        Effect.sync(() => {
          const state = authJobs.get(jobId);
          if (!state) throw new PiError(`auth job not found: ${jobId}`);
          state.abort.abort();
          state.resolveInput?.("");
          state.job = { ...state.job, status: "cancelled" };
          removeIfTerminalLater(jobId);
        }),
    };
  }),
);
