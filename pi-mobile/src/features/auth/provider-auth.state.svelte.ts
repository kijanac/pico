import type { AuthLoginJob, AuthProvider } from "@pi-mobile/protocol";
import { settingsState } from "@/features/settings/settings.state.svelte";
import { cancelAuthLogin, getAuthLoginJob, listAuthProviders, saveAuthApiKey, startAuthLogin, submitAuthLoginInput } from "@/features/auth/api";
import { haptics } from "@/shared/mobile/haptics";

export interface ProviderAuthStateOptions {
  onError: (message: string | null) => void;
  onConfigured?: () => void;
}

export interface ProviderAuthState {
  readonly providers: AuthProvider[];
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
  let providers = $state<AuthProvider[]>([]);
  let loading = $state(false);
  let job = $state<AuthLoginJob | null>(null);
  let input = $state("");
  let apiKeyProvider = $state<AuthProvider | null>(null);
  let apiKeyInput = $state("");
  let savingApiKey = $state(false);
  let startingProviderId = $state<string | null>(null);

  async function loadProviders(): Promise<void> {
    loading = true;
    try {
      if (!settingsState.loaded) await settingsState.load();
      providers = (await listAuthProviders()).providers;
      opts.onError(null);
    } catch (error) {
      opts.onError(String(error));
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
      opts.onError(`${provider.name} must be configured on the bridge.`);
      return;
    }
    if (startingProviderId) return;
    startingProviderId = provider.id;
    opts.onError(null);
    try {
      job = await startAuthLogin(provider.id);
    } catch (error) {
      opts.onError(String(error));
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
      opts.onError(String(error));
    } finally {
      savingApiKey = false;
    }
  }

  async function refreshJob(): Promise<void> {
    if (!job) return;
    const next = await getAuthLoginJob(job.id);
    job = next;
    if (next.status === "success") {
      haptics.success();
      await loadProviders();
      opts.onConfigured?.();
    }
  }

  async function submit(): Promise<void> {
    if (!job) return;
    job = await submitAuthLoginInput(job.id, input);
    input = "";
  }

  async function cancel(): Promise<void> {
    if (!job) return;
    await cancelAuthLogin(job.id);
    job = null;
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
