import { hostRegistryState } from "@/features/hosts/host-registry.state.svelte";
import { getPreference, setPreference } from "@/shared/mobile/preferences";

const WELCOME_SKIPPED_KEY = "welcome_skipped";

let loaded = $state(false);
let welcomeSkipped = $state(false);
let error = $state<string | null>(null);

export const settingsState = {
  get loaded() {
    return loaded && hostRegistryState.loaded;
  },

  get hostUrlConfigured() {
    return hostRegistryState.hasHosts;
  },

  get welcomeSkipped() {
    return welcomeSkipped;
  },

  get saving() {
    return hostRegistryState.saving;
  },

  get error() {
    return error ?? hostRegistryState.error;
  },

  async load(): Promise<void> {
    try {
      await hostRegistryState.load();
      welcomeSkipped = (await getPreference(WELCOME_SKIPPED_KEY)) === "true";
      error = null;
    } catch (caught) {
      error = String(caught);
    } finally {
      loaded = true;
    }
  },

  async skipWelcome(): Promise<void> {
    welcomeSkipped = true;
    await setPreference(WELCOME_SKIPPED_KEY, "true").catch(() => {});
  },
};
