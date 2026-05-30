import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AuthLoginJob, AuthProvider } from "@pi-mobile/protocol";
import { PiError } from "./pi.ts";
import { setupFauxIfEnabled } from "./pi-faux.ts";

interface AuthJobState {
  job: AuthLoginJob;
  abort: AbortController;
  resolveInput?: (value: string) => void;
}

const nextId = (prefix: string) => `${prefix}_${randomUUID()}`;

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

export const ProviderAuthLive = Layer.sync(ProviderAuth, () => {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  setupFauxIfEnabled(authStorage);
  const authJobs = new Map<string, AuthJobState>();

  return {
    listProviders: () =>
      Effect.sync(() => ({
        providers: modelRegistry.authStorage.getOAuthProviders().map((p) => {
          const status = modelRegistry.authStorage.getAuthStatus(p.id);
          return {
            id: p.id,
            name: p.name,
            configured: status.configured,
            ...(status.source ? { source: status.source } : {}),
            ...(status.label ? { label: status.label } : {}),
          };
        }),
      })),
    startLogin: (providerId) =>
      Effect.sync(() => {
        const provider = modelRegistry.authStorage.getOAuthProviders().find((p) => p.id === providerId);
        if (!provider) throw new PiError(`auth provider not found: ${providerId}`);
        const id = nextId("auth");
        const abort = new AbortController();
        const state: AuthJobState = {
          abort,
          job: { id, providerId, providerName: provider.name, status: "starting" },
        };
        authJobs.set(id, state);
        void modelRegistry.authStorage.login(providerId, {
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
          state.job = { ...state.job, status: "success" };
        }).catch((e) => {
          state.job = { ...state.job, status: abort.signal.aborted ? "cancelled" : "failed", error: String(e) };
        });
        return state.job;
      }),
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
      }),
  };
});
