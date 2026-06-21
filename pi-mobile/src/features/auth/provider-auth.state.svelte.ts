import { settingsState } from "@/features/settings/settings.state.svelte";
import { healthcheckHostUrl, probeHostIdentity } from "@/features/settings/api";
import { cancelAuthLogin, getAuthLoginJob, listAuthProviders, saveAuthApiKey, startAuthLogin, submitAuthLoginInput } from "@/features/auth/api";
import { classifyHostRequestFailure, hostIssueSummary } from "@/shared/lib/host-issues";
import { haptics } from "@/shared/mobile/haptics";

type AuthProviders = Awaited<ReturnType<typeof listAuthProviders>>;
type AuthProvider = AuthProviders["providers"][number];
type AuthLoginJob = Awaited<ReturnType<typeof startAuthLogin>>;

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

  async function setHostFailure(error: unknown): Promise<void> {
    const issue = await classifyHostRequestFailure(error, { url: settingsState.hostUrl, healthcheck: healthcheckHostUrl, identityProbe: probeHostIdentity });
    opts.onError(`${issue.title}: ${issue.message}`);
  }

  async function loadProviders(): Promise<void> {
    loading = true;
    try {
      if (!settingsState.loaded) await settingsState.load();
      providers = (await listAuthProviders()).providers;
      opts.onError(null);
    } catch (error) {
      await setHostFailure(error);
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
      job = await startAuthLogin(provider.id);
    } catch (error) {
      await setHostFailure(error);
    } finally {
      startingProviderId = null;
    }
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKeyProvider || savingApiKey) return;
    savingApiKey = true;
    opts.onError(null);
    try {
      providers = (await saveAuthApiKey(apiKeyProvider.id, apiKeyInput)).providers;
      apiKeyProvider = null;
      apiKeyInput = "";
      opts.onConfigured?.();
      haptics.success();
    } catch (error) {
      await setHostFailure(error);
    } finally {
      savingApiKey = false;
    }
  }

  async function refreshJob(): Promise<void> {
    if (!job) return;
    try {
      const next = await getAuthLoginJob(job.id);
      job = next;
      if (next.status === "success") {
        haptics.success();
        await loadProviders();
        opts.onConfigured?.();
      }
    } catch (error) {
      await setHostFailure(error);
    }
  }

  async function submit(): Promise<void> {
    if (!job) return;
    try {
      job = await submitAuthLoginInput(job.id, input);
      input = "";
      opts.onError(null);
    } catch (error) {
      await setHostFailure(error);
    }
  }

  async function cancel(): Promise<void> {
    if (!job) return;
    try {
      await cancelAuthLogin(job.id);
      job = null;
      opts.onError(null);
    } catch (error) {
      await setHostFailure(error);
    }
  }

  return {
    get providers() {
      return providers;
    },
    get loading() {
      return loading;
    },
    get job() {
      return job;
    },
    get input() {
      return input;
    },
    get apiKeyProvider() {
      return apiKeyProvider;
    },
    get apiKeyInput() {
      return apiKeyInput;
    },
    get savingApiKey() {
      return savingApiKey;
    },
    get startingProviderId() {
      return startingProviderId;
    },
    setInput(value: string) {
      input = value;
    },
    setApiKeyInput(value: string) {
      apiKeyInput = value;
    },
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
