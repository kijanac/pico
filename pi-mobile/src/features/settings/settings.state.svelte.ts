import {
  getJsonPreference,
  getPreference,
  removePreference,
  setJsonPreference,
  setPreference,
} from "@/shared/mobile/preferences";

export const DEFAULT_BRIDGE_URL = "http://localhost:7777";

const BRIDGE_URL_KEY = "bridge_url";
const ONBOARDING_DRAFT_KEY = "onboarding_draft";
const WELCOME_SKIPPED_KEY = "welcome_skipped";

// The tailscale auth key is deliberately absent: it can add nodes to your
// tailnet, and Capacitor Preferences is plaintext UserDefaults (not the
// Keychain), so the key stays in memory during setup and never touches disk.
export interface OnboardingDraft {
  readonly tailnet: string;
  readonly bridgeHostname: string;
}

let loaded = $state(false);
let bridgeUrl = $state(DEFAULT_BRIDGE_URL);
let bridgeUrlConfigured = $state(false);
let welcomeSkipped = $state(false);
let onboardingDraft = $state<Partial<OnboardingDraft>>({});
let saving = $state(false);
let error = $state<string | null>(null);

export const settingsState = {
  get loaded() {
    return loaded;
  },

  get bridgeUrl() {
    return bridgeUrl;
  },

  get bridgeUrlConfigured() {
    return bridgeUrlConfigured;
  },

  get welcomeSkipped() {
    return welcomeSkipped;
  },

  get onboardingDraft() {
    return onboardingDraft;
  },

  get saving() {
    return saving;
  },

  get error() {
    return error;
  },

  async load(): Promise<void> {
    try {
      const savedBridgeUrl = await getPreference(BRIDGE_URL_KEY);
      bridgeUrlConfigured = Boolean(savedBridgeUrl?.trim());
      bridgeUrl = normalizeBridgeUrl(savedBridgeUrl);
      welcomeSkipped = (await getPreference(WELCOME_SKIPPED_KEY)) === "true";
      onboardingDraft = await getJsonPreference<Partial<OnboardingDraft>>(ONBOARDING_DRAFT_KEY, {});
      error = null;
    } catch (caught) {
      error = String(caught);
    } finally {
      loaded = true;
    }
  },

  async setBridgeUrl(nextUrl: string): Promise<void> {
    saving = true;
    try {
      bridgeUrl = normalizeBridgeUrl(nextUrl);
      bridgeUrlConfigured = true;
      await setPreference(BRIDGE_URL_KEY, bridgeUrl);
      error = null;
    } catch (caught) {
      error = String(caught);
      throw caught;
    } finally {
      saving = false;
    }
  },

  async skipWelcome(): Promise<void> {
    welcomeSkipped = true;
    await setPreference(WELCOME_SKIPPED_KEY, "true").catch(() => {});
  },

  async setOnboardingDraft(draft: OnboardingDraft): Promise<void> {
    saving = true;
    try {
      onboardingDraft = draft;
      await setJsonPreference(ONBOARDING_DRAFT_KEY, draft);
      error = null;
    } catch (caught) {
      error = String(caught);
      throw caught;
    } finally {
      saving = false;
    }
  },

  async clearOnboardingDraft(): Promise<void> {
    saving = true;
    try {
      onboardingDraft = {};
      await removePreference(ONBOARDING_DRAFT_KEY);
      error = null;
    } catch (caught) {
      error = String(caught);
      throw caught;
    } finally {
      saving = false;
    }
  },
};

function normalizeBridgeUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_BRIDGE_URL;
}
