import { renderHostCloudInit } from "@pico/protocol";
import { Effect } from "effect";
import type { CarouselAPI } from "@/shared/ui/carousel/context";
import { settingsState } from "@/features/settings/settings.state.svelte";
import { claimReachableHost, healthcheckHostUrl } from "@/features/onboarding/api";
import { classifyHostFailure, hostIssueSummary } from "@/shared/lib/host-issues";
import { runAt } from "@/shared/lib/rpc-client";
import { haptics } from "@/shared/mobile/haptics";

export const onboardingSteps = ["tailscale", "keys", "cloud-init", "connect", "providers", "done"] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];
export type ConnectState = "idle" | "polling" | "reachable" | "claimed" | "failed";

export interface OnboardingState {
  readonly loaded: boolean;
  readonly currentIndex: number;
  readonly carouselApi: CarouselAPI | undefined;
  readonly tsAuthKey: string;
  readonly tailnet: string;
  readonly hostName: string;
  readonly showAdvanced: boolean;
  readonly copied: string | null;
  readonly connectState: ConnectState;
  readonly connectMessage: string;
  readonly authError: string | null;
  readonly providerConfigured: boolean;
  readonly tailnetDns: string;
  readonly hostUrl: string;
  readonly cloudInit: string;
  readonly hasSetupInputs: boolean;
  readonly maxAllowedIndex: number;
  setCarouselApi(api: CarouselAPI | undefined): void;
  setTsAuthKey(value: string): void;
  setTailnet(value: string): void;
  setHostName(value: string): void;
  setShowAdvanced(value: boolean): void;
  setAuthError(message: string | null): void;
  markProviderConfigured(): void;
  load(): Promise<void>;
  persistDraft(): Promise<void>;
  syncCarouselToIndex(): void;
  bindCarouselSelection(): (() => void) | undefined;
  go(index: number): void;
  back(): void;
  next(): void;
  copy(text: string, label: string): Promise<void>;
  waitForHost(): Promise<void>;
}

export function createOnboardingState(): OnboardingState {
  let loaded = $state(false);
  let currentIndex = $state(0);
  let carouselApi = $state<CarouselAPI | undefined>();
  let tsAuthKey = $state("");
  let tailnet = $state("");
  let hostName = $state(randomHostName());
  let showAdvanced = $state(false);
  let copied = $state<string | null>(null);
  let connectState = $state<ConnectState>("idle");
  let connectMessage = $state("Paste the cloud-init into your provider, boot the box, then start waiting here.");
  let authError = $state<string | null>(null);
  let providerConfigured = $state(false);

  const tailnetDns = $derived(normalizeTailnet(tailnet));
  const hostUrl = $derived.by(() => {
    const host = hostName.trim().toLowerCase();
    return host && tailnetDns ? `https://${host}.${tailnetDns}` : "";
  });
  const cloudInit = $derived(renderHostCloudInit({ tsAuthKey, hostName }));
  const hasSetupInputs = $derived(tsAuthKey.trim().startsWith("tskey-auth-") && tailnetDns.endsWith(".ts.net"));
  const maxAllowedIndex = $derived.by(() => {
    if (providerConfigured) return 5;
    if (connectState === "claimed") return 4;
    if (hasSetupInputs) return 3;
    return 1;
  });

  async function load(): Promise<void> {
    await settingsState.load();
    // tsAuthKey is intentionally not restored — it is never persisted.
    tailnet = settingsState.onboardingDraft.tailnet ?? "";
    hostName = settingsState.onboardingDraft.hostName ?? hostName;
    loaded = true;
  }

  function persistDraft(): Promise<void> {
    if (!loaded) return Promise.resolve();
    return settingsState.setOnboardingDraft({ tailnet, hostName });
  }

  function syncCarouselToIndex(): void {
    carouselApi?.scrollTo(currentIndex);
  }

  function bindCarouselSelection(): (() => void) | undefined {
    const api = carouselApi;
    if (!api) return undefined;

    const onSelect = () => {
      const selected = api.selectedScrollSnap();
      if (selected > maxAllowedIndex) {
        api.scrollTo(currentIndex);
        return;
      }
      currentIndex = selected;
    };

    api.on("select", onSelect);
    return () => api.off("select", onSelect);
  }

  function go(index: number): void {
    currentIndex = Math.min(index, maxAllowedIndex);
  }

  function back(): void {
    currentIndex = Math.max(0, currentIndex - 1);
  }

  function next(): void {
    currentIndex = Math.min(maxAllowedIndex, currentIndex + 1);
  }

  async function copy(text: string, label: string): Promise<void> {
    await navigator.clipboard?.writeText(text);
    copied = label;
    window.setTimeout(() => {
      copied = null;
    }, 1200);
  }

  async function waitForHost(): Promise<void> {
    if (!hostUrl || connectState === "polling") return;

    connectState = "polling";
    connectMessage = "Waiting for the Pico host HTTPS endpoint to come online. This can take a few minutes on first boot…";

    for (let attempt = 1; attempt <= 60; attempt += 1) {
      if (await healthcheckHostUrl(hostUrl)) {
        connectState = "reachable";
        connectMessage = "Pico host is reachable. Saving URL and claiming it with your Tailscale identity…";
        await settingsState.setHostUrl(hostUrl);
        await runAt(
          hostUrl,
          claimReachableHost().pipe(
            Effect.tap(() => Effect.sync(() => {
              connectState = "claimed";
              connectMessage = "Pico host connected and claimed. You’re ready to continue.";
              haptics.success();
              currentIndex = 4;
            })),
            Effect.tap(() => Effect.promise(() => settingsState.clearOnboardingDraft())),
            Effect.catchAll((error) =>
              classifyHostFailure(error, { url: hostUrl }).pipe(
                Effect.andThen((issue) => Effect.sync(() => {
                  connectState = "failed";
                  connectMessage = `${issue.title}: ${issue.message}`;
                })),
              ),
            ),
          ),
        );
        return;
      }
      connectMessage = `Still waiting for ${hostUrl}… (${attempt}/60)`;
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
    }

    connectState = "failed";
    connectMessage = hostIssueSummary({ hostErrorCode: "host_unreachable" }, { url: hostUrl });
  }

  return {
    get loaded() { return loaded; },
    get currentIndex() { return currentIndex; },
    get carouselApi() { return carouselApi; },
    get tsAuthKey() { return tsAuthKey; },
    get tailnet() { return tailnet; },
    get hostName() { return hostName; },
    get showAdvanced() { return showAdvanced; },
    get copied() { return copied; },
    get connectState() { return connectState; },
    get connectMessage() { return connectMessage; },
    get authError() { return authError; },
    get providerConfigured() { return providerConfigured; },
    get tailnetDns() { return tailnetDns; },
    get hostUrl() { return hostUrl; },
    get cloudInit() { return cloudInit; },
    get hasSetupInputs() { return hasSetupInputs; },
    get maxAllowedIndex() { return maxAllowedIndex; },
    setCarouselApi(api: CarouselAPI | undefined) { carouselApi = api; },
    setTsAuthKey(value: string) { tsAuthKey = value; },
    setTailnet(value: string) { tailnet = value; },
    setHostName(value: string) { hostName = value; },
    setShowAdvanced(value: boolean) { showAdvanced = value; },
    setAuthError(message: string | null) { authError = message; },
    markProviderConfigured() { providerConfigured = true; },
    load,
    persistDraft,
    syncCarouselToIndex,
    bindCarouselSelection,
    go,
    back,
    next,
    copy,
    waitForHost,
  };
}

function normalizeTailnet(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/^\.+/, "").replace(/\/+$/, "").toLowerCase();
}

function randomHostName(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `pico-host-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
