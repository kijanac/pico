import { v7 as randomUUIDv7 } from "uuid";
import { Context, Effect, Layer } from "effect";
import type { AuthLoginJob, AuthProvider, AuthProviders } from "@pico/protocol";
import { getAgentServices, PiError, reloadAgentAuth } from "./pi.ts";

interface AuthJobState {
  job: AuthLoginJob;
  abort: AbortController;
  resolveInput?: (value: string) => void;
}

const TERMINAL_JOB_TTL_MS = 60_000;
// Non-terminal (abandoned) logins expire after this.
const MAX_JOB_AGE_MS = 30 * 60_000;
const BEDROCK_PROVIDER_ID = "amazon-bedrock";
const isTerminalStatus = (status: AuthLoginJob["status"]) => ["success", "failed", "cancelled"].includes(status);

function authProvidersForServices(services: Awaited<ReturnType<typeof getAgentServices>>): AuthProviders {
  const authStorage = services.modelRegistry.authStorage;
  const oauthProviders = authStorage.getOAuthProviders();
  const providers = new Map<string, AuthProvider>();

  for (const provider of oauthProviders) {
    const status = services.modelRegistry.getProviderAuthStatus(provider.id);
    providers.set(provider.id, {
      id: provider.id,
      name: provider.name,
      configured: status.configured,
      authType: "oauth",
      ...(status.source ? { source: status.source } : {}),
      ...(status.label ? { label: status.label } : {}),
    });
  }

  const modelProviderIds = new Set(services.modelRegistry.getAll().map((model) => model.provider));
  for (const providerId of modelProviderIds) {
    if (providers.has(providerId)) continue;
    const status = services.modelRegistry.getProviderAuthStatus(providerId);
    providers.set(providerId, {
      id: providerId,
      name: services.modelRegistry.getProviderDisplayName(providerId),
      configured: status.configured,
      authType: providerId === BEDROCK_PROVIDER_ID ? "setup" : "api_key",
      ...(status.source ? { source: status.source } : {}),
      ...(status.label ? { label: status.label } : {}),
    });
  }

  return { providers: [...providers.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export class ProviderAuth extends Context.Tag("ProviderAuth")<
  ProviderAuth,
  {
    readonly listProviders: () => Effect.Effect<AuthProviders, PiError>;
    readonly startLogin: (providerId: string) => Effect.Effect<AuthLoginJob, PiError>;
    readonly saveApiKey: (providerId: string, apiKey: string) => Effect.Effect<AuthProviders, PiError>;
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
        catch: (e) => new PiError({ message: `createAgentSessionServices failed: ${String(e)}`, cause: e }),
      });
    // Effect.sync treats a throw as a defect; Effect.try routes thrown PiErrors
    // into the typed channel the RPC layer maps to RequestError.
    const asPiError = (e: unknown): PiError => (e instanceof PiError ? e : new PiError({ message: String(e), cause: e }));

    return {
      listProviders: () =>
        Effect.flatMap(getDefaultServices(), (services) =>
          Effect.try({ try: () => authProvidersForServices(services), catch: asPiError }),
        ),
      startLogin: (providerId) =>
        Effect.flatMap(getDefaultServices(), (services) =>
          Effect.try({
            try: () => {
            const provider = services.modelRegistry.authStorage.getOAuthProviders().find((p) => p.id === providerId);
            if (!provider) throw new PiError({ message: `auth provider not found: ${providerId}` });
            const id = randomUUIDv7();
            const abort = new AbortController();
            const state: AuthJobState = {
              abort,
              job: { id, providerId, providerName: provider.name, status: "starting" },
            };
            authJobs.set(id, state);
            setTimeout(() => {
              const stale = authJobs.get(id);
              if (!stale) return;
              if (!isTerminalStatus(stale.job.status)) stale.abort.abort();
              authJobs.delete(id);
            }, MAX_JOB_AGE_MS).unref();
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
            },
            catch: asPiError,
          }),
        ),
      saveApiKey: (providerId, apiKey) =>
        Effect.flatMap(getDefaultServices(), (services) =>
          Effect.try({
            try: () => {
              const provider = services.modelRegistry.getAll().find((model) => model.provider === providerId);
              if (!provider) throw new PiError({ message: `auth provider not found: ${providerId}` });
              if (providerId === BEDROCK_PROVIDER_ID) throw new PiError({ message: "Amazon Bedrock requires AWS credentials on the Pico host" });
              services.modelRegistry.authStorage.set(providerId, { type: "api_key", key: apiKey.trim() });
              services.modelRegistry.refresh();
              reloadAgentAuth();
              return authProvidersForServices(services);
            },
            catch: asPiError,
          }),
        ),
      getLogin: (jobId) =>
        Effect.try({
          try: () => {
            const state = authJobs.get(jobId);
            if (!state) throw new PiError({ message: `auth job not found: ${jobId}` });
            return state.job;
          },
          catch: asPiError,
        }),
      submitLoginInput: (jobId, value) =>
        Effect.try({
          try: () => {
            const state = authJobs.get(jobId);
            if (!state) throw new PiError({ message: `auth job not found: ${jobId}` });
            state.resolveInput?.(value);
            state.resolveInput = undefined;
            state.job = { ...state.job, status: "progress", progress: "Submitted authentication input…" };
            return state.job;
          },
          catch: asPiError,
        }),
      cancelLogin: (jobId) =>
        Effect.try({
          try: () => {
            const state = authJobs.get(jobId);
            if (!state) throw new PiError({ message: `auth job not found: ${jobId}` });
            state.abort.abort();
            state.resolveInput?.("");
            state.job = { ...state.job, status: "cancelled" };
            removeIfTerminalLater(jobId);
          },
          catch: asPiError,
        }),
    };
  }),
);
