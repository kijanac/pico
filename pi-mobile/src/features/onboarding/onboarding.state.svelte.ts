import { renderBridgeCloudInit } from "@pico/protocol";
import type { CarouselAPI } from "@/shared/ui/carousel/context";
import { settingsState } from "@/features/settings/settings.state.svelte";
import { claimReachableBridge, healthcheckBridgeUrl } from "@/features/onboarding/api";
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
  readonly bridgeHostname: string;
  readonly showAdvanced: boolean;
  readonly copied: string | null;
  readonly connectState: ConnectState;
  readonly connectMessage: string;
  readonly authError: string | null;
  readonly providerConfigured: boolean;
  readonly tailnetDns: string;
  readonly bridgeUrl: string;
  readonly cloudInit: string;
  readonly hasSetupInputs: boolean;
  readonly maxAllowedIndex: number;
  setCarouselApi(api: CarouselAPI | undefined): void;
  setTsAuthKey(value: string): void;
  setTailnet(value: string): void;
  setBridgeHostname(value: string): void;
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
  waitForBridge(): Promise<void>;
}

export function createOnboardingState(): OnboardingState {
  let loaded = $state(false);
  let currentIndex = $state(0);
  let carouselApi = $state<CarouselAPI | undefined>();
  let tsAuthKey = $state("");
  let tailnet = $state("");
  let bridgeHostname = $state(randomBridgeHostname());
  let showAdvanced = $state(false);
  let copied = $state<string | null>(null);
  let connectState = $state<ConnectState>("idle");
  let connectMessage = $state("Paste the cloud-init into your provider, boot the box, then start waiting here.");
  let authError = $state<string | null>(null);
  let providerConfigured = $state(false);

  const tailnetDns = $derived(normalizeTailnet(tailnet));
  const bridgeUrl = $derived.by(() => {
    const host = bridgeHostname.trim().toLowerCase();
    return host && tailnetDns ? `https://${host}.${tailnetDns}` : "";
  });
  const cloudInit = $derived(renderBridgeCloudInit({ tsAuthKey, bridgeHostname }));
  const hasSetupInputs = $derived(tsAuthKey.trim().startsWith("tskey-auth-") && tailnetDns.endsWith(".ts.net"));
  const maxAllowedIndex = $derived.by(() => {
    if (providerConfigured) return 5;
    if (connectState === "claimed") return 4;
    if (hasSetupInputs) return 3;
    return 1;
  });

  async function load(): Promise<void> {
    await settingsState.load();
    tsAuthKey = settingsState.onboardingDraft.tsAuthKey ?? "";
    tailnet = settingsState.onboardingDraft.tailnet ?? "";
    bridgeHostname = settingsState.onboardingDraft.bridgeHostname ?? bridgeHostname;
    loaded = true;
  }

  function persistDraft(): Promise<void> {
    if (!loaded) return Promise.resolve();
    return settingsState.setOnboardingDraft({ tsAuthKey, tailnet, bridgeHostname });
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

  async function waitForBridge(): Promise<void> {
    if (!bridgeUrl || connectState === "polling") return;

    connectState = "polling";
    connectMessage = "Waiting for the bridge HTTPS endpoint to come online. This can take a few minutes on first boot…";

    for (let attempt = 1; attempt <= 60; attempt += 1) {
      if (await healthcheckBridgeUrl(bridgeUrl)) {
        connectState = "reachable";
        connectMessage = "Bridge is reachable. Saving URL and claiming it with your Tailscale identity…";
        await settingsState.setBridgeUrl(bridgeUrl);
        try {
          await claimReachableBridge(bridgeUrl);
          connectState = "claimed";
          connectMessage = "Bridge connected and claimed. You’re ready to continue.";
          await settingsState.clearOnboardingDraft();
          haptics.success();
          currentIndex = 4;
        } catch (error) {
          connectState = "failed";
          connectMessage = setupErrorMessage(error);
        }
        return;
      }
      connectMessage = `Still waiting for ${bridgeUrl}… (${attempt}/60)`;
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
    }

    connectState = "failed";
    connectMessage = "Timed out. Check VPS cloud-init logs and make sure Tailscale is connected on this phone.";
  }

  return {
    get loaded() { return loaded; },
    get currentIndex() { return currentIndex; },
    get carouselApi() { return carouselApi; },
    get tsAuthKey() { return tsAuthKey; },
    get tailnet() { return tailnet; },
    get bridgeHostname() { return bridgeHostname; },
    get showAdvanced() { return showAdvanced; },
    get copied() { return copied; },
    get connectState() { return connectState; },
    get connectMessage() { return connectMessage; },
    get authError() { return authError; },
    get providerConfigured() { return providerConfigured; },
    get tailnetDns() { return tailnetDns; },
    get bridgeUrl() { return bridgeUrl; },
    get cloudInit() { return cloudInit; },
    get hasSetupInputs() { return hasSetupInputs; },
    get maxAllowedIndex() { return maxAllowedIndex; },
    setCarouselApi(api: CarouselAPI | undefined) { carouselApi = api; },
    setTsAuthKey(value: string) { tsAuthKey = value; },
    setTailnet(value: string) { tailnet = value; },
    setBridgeHostname(value: string) { bridgeHostname = value; },
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
    waitForBridge,
  };
}

function normalizeTailnet(value: string): string {
  return value.trim().replace(/^https?:\/\//, "").replace(/^\.+/, "").replace(/\/+$/, "").toLowerCase();
}

function setupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("missing_tailscale_identity")) return "Tailscale identity missing. Connect Tailscale on this phone and try again.";
  if (message.includes("tailscale_user_not_bridge_owner")) return "This bridge is claimed by another Tailscale user.";
  if (message.includes("bridge is already claimed")) return "This bridge is already claimed.";
  return "Bridge is reachable, but claim failed. Check Tailscale and try again.";
}

function randomBridgeHostname(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return `pi-bridge-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
