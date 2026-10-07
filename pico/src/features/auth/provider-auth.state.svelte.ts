import { Effect } from "effect";
import { cancelAuthLogin, getAuthLoginJob, listAuthProviders, saveAuthApiKey, startAuthLogin, submitAuthLoginInput } from "@/features/auth/api";
import { diagnoseHostFailure, hostIssueSummary, issueText } from "@/shared/lib/host-issues";
import { runRpc } from "@/shared/lib/rpc-client";

type AuthProviders = Effect.Effect.Success<ReturnType<typeof listAuthProviders>>;
type AuthProvider = AuthProviders["providers"][number];
type AuthLoginJob = Effect.Effect.Success<ReturnType<typeof startAuthLogin>>;

export interface ProviderAuthStateOptions {
  onError: (message: string | null) => void;
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
  submit(value?: string): Promise<void>;
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

  // Every message goes through here, so a failure's later, sharper diagnosis
  // can't replace a newer message or a cleared one.
  let messages = 0;
  const showError = (message: string | null) => {
    messages += 1;
    opts.onError(message);
  };
  const reportFailure = (error: unknown) =>
    Effect.sync(() => {
      const mine = messages + 1;
      showError(issueText(diagnoseHostFailure(error, (better) => {
        if (mine === messages) opts.onError(issueText(better));
      })));
    });

  async function loadProviders(): Promise<void> {
    loading = true;
    try {
      await runRpc(
        listAuthProviders().pipe(
          Effect.tap((result) => Effect.sync(() => { providers = result.providers; showError(null); })),
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
      showError(null);
      return;
    }
    if (provider.authType === "setup") {
      showError(hostIssueSummary({ hostErrorCode: "provider_auth_missing" }));
      return;
    }
    if (startingProviderId) return;
    startingProviderId = provider.id;
    showError(null);
    try {
      await runRpc(
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
    showError(null);
    try {
      await runRpc(
        saveAuthApiKey(provider.id, apiKeyInput).pipe(
          Effect.tap((result) => Effect.sync(() => {
            providers = result.providers;
            apiKeyProvider = null;
            apiKeyInput = "";
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
    await runRpc(
      getAuthLoginJob(current.id).pipe(
        Effect.tap((next) => Effect.sync(() => { job = next; })),
        Effect.catchAll(reportFailure),
      ),
    );
    if (job?.status === "success") await loadProviders();
  }

  async function submit(value = input): Promise<void> {
    const current = job;
    if (!current) return;
    await runRpc(
      submitAuthLoginInput(current.id, value).pipe(
        Effect.tap((next) => Effect.sync(() => { job = next; input = ""; showError(null); })),
        Effect.catchAll(reportFailure),
      ),
    );
  }

  async function cancel(): Promise<void> {
    const current = job;
    if (!current) return;
    await runRpc(
      cancelAuthLogin(current.id).pipe(
        Effect.tap(() => Effect.sync(() => { job = null; showError(null); })),
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
      showError(null);
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
  return !!job && !["success", "failed", "cancelled", "select", "prompt", "manual"].includes(job.status);
}
