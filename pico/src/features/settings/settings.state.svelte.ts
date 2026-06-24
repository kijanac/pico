import { getPreference, setPreference } from "@/shared/mobile/preferences";

export const DEFAULT_HOST_URL = "http://localhost:7777";

const HOST_URL_KEY = "host_url";
const LEGACY_HOST_URL_KEY = "bridge_url";
const WELCOME_SKIPPED_KEY = "welcome_skipped";

let loaded = $state(false);
let hostUrl = $state(DEFAULT_HOST_URL);
let hostUrlConfigured = $state(false);
let welcomeSkipped = $state(false);
let saving = $state(false);
let error = $state<string | null>(null);

export const settingsState = {
  get loaded() {
    return loaded;
  },

  get hostUrl() {
    return hostUrl;
  },

  get hostUrlConfigured() {
    return hostUrlConfigured;
  },

  get welcomeSkipped() {
    return welcomeSkipped;
  },

  get saving() {
    return saving;
  },

  get error() {
    return error;
  },

  async load(): Promise<void> {
    try {
      const savedHostUrl = await getPreference(HOST_URL_KEY) ?? await getPreference(LEGACY_HOST_URL_KEY);
      hostUrlConfigured = Boolean(savedHostUrl?.trim());
      hostUrl = normalizeHostUrl(savedHostUrl);
      welcomeSkipped = (await getPreference(WELCOME_SKIPPED_KEY)) === "true";
      error = null;
    } catch (caught) {
      error = String(caught);
    } finally {
      loaded = true;
    }
  },

  async setHostUrl(nextUrl: string): Promise<void> {
    saving = true;
    try {
      hostUrl = normalizeHostUrl(nextUrl);
      hostUrlConfigured = true;
      await setPreference(HOST_URL_KEY, hostUrl);
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
};

function normalizeHostUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_HOST_URL;
}
