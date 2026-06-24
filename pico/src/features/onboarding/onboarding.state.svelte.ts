import type { CarouselAPI } from "@/shared/ui/carousel/context";
import { connectAndClaimHost } from "@/features/onboarding/api";
import { classifyHostIssue, type HostIssue } from "@/shared/lib/host-issues";
import { runAt } from "@/shared/lib/rpc-client";
import { haptics } from "@/shared/mobile/haptics";

export const onboardingSteps = ["host", "connect", "providers", "done"] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

const CONNECT_INDEX = 1;
const PROVIDERS_INDEX = 2;

export interface OnboardingState {
  readonly currentIndex: number;
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly connectIssue: HostIssue | null;
  readonly authError: string | null;
  readonly providerConfigured: boolean;
  readonly maxAllowedIndex: number;
  setCarouselApi(api: CarouselAPI | undefined): void;
  setAuthError(message: string | null): void;
  markProviderConfigured(): void;
  syncCarouselToIndex(): void;
  bindCarouselSelection(): (() => void) | undefined;
  go(index: number): void;
  back(): void;
  next(): void;
  connect(url: string, token?: string): Promise<void>;
}

export function createOnboardingState(): OnboardingState {
  let currentIndex = $state(0);
  let carouselApi = $state<CarouselAPI | undefined>();
  let connected = $state(false);
  let connecting = $state(false);
  let connectIssue = $state<HostIssue | null>(null);
  let authError = $state<string | null>(null);
  let providerConfigured = $state(false);

  // The connect step is always reachable; everything past it needs a claimed host.
  const maxAllowedIndex = $derived(connected ? onboardingSteps.length - 1 : CONNECT_INDEX);

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
    currentIndex = Math.min(Math.max(0, index), maxAllowedIndex);
  }

  function back(): void {
    currentIndex = Math.max(0, currentIndex - 1);
  }

  function next(): void {
    currentIndex = Math.min(maxAllowedIndex, currentIndex + 1);
  }

  async function connect(url: string, token?: string): Promise<void> {
    if (connecting) return;
    connecting = true;
    connectIssue = null;
    try {
      await runAt(url, connectAndClaimHost(url, token));
      connected = true;
      haptics.success();
      currentIndex = PROVIDERS_INDEX; // advance within the flow, not out to sessions
    } catch (caught) {
      connectIssue = classifyHostIssue(caught, { url });
    } finally {
      connecting = false;
    }
  }

  return {
    get currentIndex() { return currentIndex; },
    get connected() { return connected; },
    get connecting() { return connecting; },
    get connectIssue() { return connectIssue; },
    get authError() { return authError; },
    get providerConfigured() { return providerConfigured; },
    get maxAllowedIndex() { return maxAllowedIndex; },
    setCarouselApi(api: CarouselAPI | undefined) { carouselApi = api; },
    setAuthError(message: string | null) { authError = message; },
    markProviderConfigured() { providerConfigured = true; },
    syncCarouselToIndex,
    bindCarouselSelection,
    go,
    back,
    next,
    connect,
  };
}
