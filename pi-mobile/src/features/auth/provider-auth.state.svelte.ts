import { Effect } from "effect";
import { settingsState } from "@/features/settings/settings.state.svelte";
import { cancelAuthLogin, getAuthLoginJob, listAuthProviders, saveAuthApiKey, startAuthLogin, submitAuthLoginInput } from "@/features/auth/api";
import { classifyHostFailure, hostIssueSummary } from "@/shared/lib/host-issues";
import { runHost } from "@/shared/lib/rpc-client";
import { haptics } from "@/shared/mobile/haptics";

type AuthProviders = Effect.Effect.Success<ReturnType<typeof listAuthProviders>>;
type AuthProvider = AuthProviders["providers"][number];
type AuthLoginJob = Effect.Effect.Success<ReturnType<typeof startAuthLogin>>;

export interface ProviderAuthStateOptions {
  onError: (message: string | null) => void;
  onConfigured?: () => void;
}

export interface ProviderAuthState {
  readonly providers: readonly AuthProvider[];
  readonly loading: boolean;
  readonly job: AuthLoginJob | null;
  readonly input: string;
  readonly apiKeyProvider: AuthProvider | null;
  readonly apiKeyInput: string;
  readonly savingApiKey: boolean;
  readonly startingProviderId: string | null;
  setInput(value: string): void;
  setApiKeyInput(value: string): void;
  selectApiKeyProvider(provider: AuthProvider | null): void;
  loadProviders(): Promise<void>;
  start(provider: AuthProvider): Promise<void>;
  saveApiKey(): Promise<void>;
  refreshJob(): Promise<void>;
  submit(): Promise<void>;
  cancel(): Promise<void>;
}

export function createProviderAuthState(opts: ProviderAuthStateOptions): ProviderAuthState {
  let providers = $state<readonly AuthProvider[]>([]);
  let loading = $state(false);
  let job = $state<AuthLoginJob | null>(null);
  let input = $state("");
  let apiKeyProvider = $state<AuthProvider | null>(null);
  let apiKeyInput = $state("");
  let savingApiKey = $state(false);
  let startingProviderId = $state<string | null>(null);

  const reportFailure = (error: unknown) =>
    classifyHostFailure(error, { url: settingsState.hostUrl }).pipe(
      Effect.andThen((issue) => Effect.sync(() => opts.onError(`${issue.title}: ${issue.message}`))),
    );

  async function loadProviders(): Promise<void> {
    loading = true;
    try {
      if (!settingsState.loaded) await settingsState.load();
      await runHost(
        listAuthProviders().pipe(
          Effect.tap((result) => Effect.sync(() => { providers = result.providers; opts.onError(null); })),
          Effect.catchAll(reportFailure),
        ),
      );
    } finally {
      loading = false;
    }
  }

  async function start(provider: AuthProvider): Promise<void> {
    if (provider.authType === "api_key") {
      apiKeyProvider = provider;
      apiKeyInput = "";
      opts.onError(null);
      return;
    }
    if (provider.authType === "setup") {
      opts.onError(hostIssueSummary({ hostErrorCode: "provider_auth_missing" }));
      return;
    }
    if (startingProviderId) return;
    startingProviderId = provider.id;
    opts.onError(null);
    try {
      await runHost(
        startAuthLogin(provider.id).pipe(
          Effect.tap((next) => Effect.sync(() => { job = next; })),
          Effect.catchAll(reportFailure),
        ),
      );
    } finally {
      startingProviderId = null;
    }
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKeyProvider || savingApiKey) return;
    const provider = apiKeyProvider;
    savingApiKey = true;
    opts.onError(null);
    try {
      await runHost(
        saveAuthApiKey(provider.id, apiKeyInput).pipe(
          Effect.tap((result) => Effect.sync(() => {
            providers = result.providers;
            apiKeyProvider = null;
            apiKeyInput = "";
            opts.onConfigured?.();
            haptics.success();
          })),
          Effect.catchAll(reportFailure),
        ),
      );
    } finally {
      savingApiKey = false;
    }
  }

  async function refreshJob(): Promise<void> {
    const current = job;
    if (!current) return;
    await runHost(
      getAuthLoginJob(current.id).pipe(
        Effect.tap((next) => Effect.sync(() => { job = next; })),
        Effect.catchAll(reportFailure),
      ),
    );
    if (job?.status === "success") {
      haptics.success();
      await loadProviders();
      opts.onConfigured?.();
    }
  }

  async function submit(): Promise<void> {
    const current = job;
    if (!current) return;
    await runHost(
      submitAuthLoginInput(current.id, input).pipe(
        Effect.tap((next) => Effect.sync(() => { job = next; input = ""; opts.onError(null); })),
        Effect.catchAll(reportFailure),
      ),
    );
  }

  async function cancel(): Promise<void> {
    const current = job;
    if (!current) return;
    await runHost(
      cancelAuthLogin(current.id).pipe(
        Effect.tap(() => Effect.sync(() => { job = null; opts.onError(null); })),
        Effect.catchAll(reportFailure),
      ),
    );
  }

  return {
    get providers() { return providers; },
    get loading() { return loading; },
    get job() { return job; },
    get input() { return input; },
    get apiKeyProvider() { return apiKeyProvider; },
    get apiKeyInput() { return apiKeyInput; },
    get savingApiKey() { return savingApiKey; },
    get startingProviderId() { return startingProviderId; },
    setInput(value: string) { input = value; },
    setApiKeyInput(value: string) { apiKeyInput = value; },
    selectApiKeyProvider(provider: AuthProvider | null) {
      apiKeyProvider = provider;
      apiKeyInput = "";
      opts.onError(null);
    },
    loadProviders,
    start,
    saveApiKey,
    refreshJob,
    submit,
    cancel,
  };
}

export function authJobShouldPoll(job: AuthLoginJob | null): boolean {
  return !!job && !["success", "failed", "cancelled", "prompt", "manual"].includes(job.status);
}
