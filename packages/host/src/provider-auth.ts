import { v7 as randomUUIDv7 } from "uuid";
import { Context, Effect, Layer } from "effect";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AuthLoginJob, AuthProvider, AuthProviders } from "@pico/protocol";
import { getAgentModelRuntime } from "./pi.ts";
import { PiError } from "./session-runtime.ts";

interface AuthJobState {
  job: AuthLoginJob;
  abort: AbortController;
  resolveInput?: (value: string) => void;
}

const TERMINAL_JOB_TTL_MS = 60_000;
const MAX_JOB_AGE_MS = 30 * 60_000;
const BEDROCK_PROVIDER_ID = "amazon-bedrock";
const isTerminalStatus = (status: AuthLoginJob["status"]) =>
  ["success", "failed", "cancelled"].includes(status);

function authProvidersForRuntime(runtime: ModelRuntime): AuthProviders {
  const providers: AuthProvider[] = runtime.getProviders().map((provider) => {
    const status = runtime.getProviderAuthStatus(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      configured: status.configured,
      authType: provider.auth.oauth
        ? "oauth"
        : provider.id === BEDROCK_PROVIDER_ID
          ? "setup"
          : "api_key",
      ...(status.source ? { source: status.source } : {}),
      ...(status.label ? { label: status.label } : {}),
    };
  });
  return { providers: providers.sort((a, b) => a.name.localeCompare(b.name)) };
}

function updateJobFromEvent(
  state: AuthJobState,
  base: Pick<AuthLoginJob, "id" | "providerId" | "providerName">,
  event: AuthEvent,
): void {
  switch (event.type) {
    case "auth_url":
      state.job = {
        ...base,
        status: "auth",
        authUrl: event.url,
        ...(event.instructions ? { instructions: event.instructions } : {}),
      };
      return;
    case "device_code":
      state.job = {
        ...base,
        status: "device",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
      };
      return;
    case "progress":
      state.job = { ...base, status: "progress", progress: event.message };
      return;
    case "info":
      state.job = { ...base, status: "progress", progress: event.message };
  }
}

function waitForInput(state: AuthJobState, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      state.resolveInput = undefined;
      reject(new Error("Authentication prompt was cancelled"));
    };
    state.resolveInput = finish;
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function updateJobForPrompt(
  state: AuthJobState,
  base: Pick<AuthLoginJob, "id" | "providerId" | "providerName">,
  prompt: AuthPrompt,
): void {
  if (prompt.type === "select") {
    state.job = {
      ...base,
      status: "select",
      selectMessage: prompt.message,
      selectOptions: prompt.options.map(({ id, label }) => ({ id, label })),
    };
  } else if (prompt.type === "manual_code") {
    state.job = { ...base, status: "manual", promptMessage: prompt.message };
  } else {
    state.job = {
      ...base,
      status: "prompt",
      promptMessage: prompt.message,
      ...(prompt.placeholder ? { promptPlaceholder: prompt.placeholder } : {}),
    };
  }
}

function loginInteraction(
  state: AuthJobState,
  base: Pick<AuthLoginJob, "id" | "providerId" | "providerName">,
): AuthInteraction {
  return {
    signal: state.abort.signal,
    notify: (event) => updateJobFromEvent(state, base, event),
    prompt: async (prompt) => {
      updateJobForPrompt(state, base, prompt);
      return await waitForInput(state, prompt.signal ?? state.abort.signal);
    },
  };
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
    const asPiError = (error: unknown): PiError =>
      error instanceof PiError ? error : new PiError({ message: String(error), cause: error });
    const getRuntime = () =>
      Effect.tryPromise({
        try: getAgentModelRuntime,
        catch: (error) => new PiError({ message: `create ModelRuntime failed: ${String(error)}`, cause: error }),
      });
    const removeIfTerminalLater = (jobId: string) => {
      setTimeout(() => {
        const state = authJobs.get(jobId);
        if (state && isTerminalStatus(state.job.status)) authJobs.delete(jobId);
      }, TERMINAL_JOB_TTL_MS).unref();
    };

    return {
      listProviders: () =>
        Effect.map(getRuntime(), authProvidersForRuntime),

      startLogin: (providerId) =>
        Effect.flatMap(getRuntime(), (runtime) =>
          Effect.try({
            try: () => {
              const provider = runtime.getProvider(providerId);
              if (!provider?.auth.oauth) {
                throw new PiError({ message: `OAuth provider not found: ${providerId}` });
              }
              const id = randomUUIDv7();
              const abort = new AbortController();
              const base = { id, providerId, providerName: provider.name };
              const state: AuthJobState = {
                abort,
                job: { ...base, status: "starting" },
              };
              authJobs.set(id, state);
              setTimeout(() => {
                const stale = authJobs.get(id);
                if (!stale) return;
                if (!isTerminalStatus(stale.job.status)) stale.abort.abort();
                authJobs.delete(id);
              }, MAX_JOB_AGE_MS).unref();

              void runtime.login(providerId, "oauth", loginInteraction(state, base)).then(() => {
                state.job = { ...base, status: "success" };
                removeIfTerminalLater(id);
              }).catch((error) => {
                const message = String(error);
                state.job = abort.signal.aborted
                  ? { ...base, status: "cancelled", error: message }
                  : { ...base, status: "failed", error: message };
                removeIfTerminalLater(id);
              });
              return state.job;
            },
            catch: asPiError,
          }),
        ),

      saveApiKey: (providerId, apiKey) =>
        Effect.flatMap(getRuntime(), (runtime) =>
          Effect.tryPromise({
            try: async () => {
              const provider = runtime.getProvider(providerId);
              if (!provider?.auth.apiKey?.login) {
                throw new PiError({ message: `API-key provider not found: ${providerId}` });
              }
              if (providerId === BEDROCK_PROVIDER_ID) {
                throw new PiError({ message: "Amazon Bedrock requires AWS credentials on the Pico host" });
              }
              await runtime.login(providerId, "api_key", {
                prompt: async () => apiKey.trim(),
                notify: () => {},
              });
              return authProvidersForRuntime(runtime);
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
            const { id, providerId, providerName } = state.job;
            state.job = {
              id,
              providerId,
              providerName,
              status: "progress",
              progress: "Submitted authentication input…",
            };
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
            const { id, providerId, providerName } = state.job;
            state.job = { id, providerId, providerName, status: "cancelled" };
            removeIfTerminalLater(jobId);
          },
          catch: asPiError,
        }),
    };
  }),
);
