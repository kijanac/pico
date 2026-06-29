import type { SystemInfo } from "@pico/protocol";
import { getJsonPreference, getPreference, removePreference, setJsonPreference, setPreference } from "@/shared/mobile/preferences";

export const DEFAULT_HOST_URL = "http://localhost:7777";

const HOSTS_KEY = "pico_hosts_v1";
const DEFAULT_HOST_ID_KEY = "pico_default_host_id";
const LEGACY_HOST_URL_KEY = "host_url";

export interface HostProfile {
  id: string;
  name: string;
  url: string;
  addedAt: number;
  lastSeenAt?: number;
  systemInfo?: SystemInfo;
}

let loaded = $state(false);
let hosts = $state<HostProfile[]>([]);
let defaultHostId = $state<string | null>(null);
let saving = $state(false);
let error = $state<string | null>(null);

const defaultHost = $derived(hosts.find((host) => host.id === defaultHostId) ?? hosts[0] ?? null);

function normalizeHostUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_HOST_URL;
}

function hostNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] || url;
  } catch {
    return url;
  }
}

function makeHost(url: string, systemInfo?: SystemInfo): HostProfile {
  const normalized = normalizeHostUrl(url);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: hostNameFromUrl(normalized),
    url: normalized,
    addedAt: now,
    lastSeenAt: now,
    ...(systemInfo ? { systemInfo } : {}),
  };
}

async function saveHosts(): Promise<void> {
  await setJsonPreference(HOSTS_KEY, hosts);
  if (defaultHostId) await setPreference(DEFAULT_HOST_ID_KEY, defaultHostId);
  else await removePreference(DEFAULT_HOST_ID_KEY);
}

async function loadHosts(): Promise<void> {
  const savedHosts = await getJsonPreference<HostProfile[] | null>(HOSTS_KEY, null);
  if (savedHosts) {
    hosts = savedHosts;
    const savedDefaultHostId = await getPreference(DEFAULT_HOST_ID_KEY);
    defaultHostId = savedHosts.some((host) => host.id === savedDefaultHostId)
      ? savedDefaultHostId
      : savedHosts[0]?.id ?? null;
    if (defaultHostId !== savedDefaultHostId) await saveHosts();
    return;
  }

  const legacyHostUrl = await getPreference(LEGACY_HOST_URL_KEY);
  if (legacyHostUrl?.trim()) {
    const host = makeHost(legacyHostUrl);
    hosts = [host];
    defaultHostId = host.id;
    await saveHosts();
    return;
  }

  hosts = [];
  defaultHostId = null;
}

export const hostRegistryState = {
  get loaded() { return loaded; },
  get hosts() { return hosts; },
  get defaultHostId() { return defaultHostId; },
  get defaultHost() { return defaultHost; },
  get hasHosts() { return hosts.length > 0; },
  get saving() { return saving; },
  get error() { return error; },

  getHost(id: string): HostProfile | null {
    return hosts.find((host) => host.id === id) ?? null;
  },

  async load(): Promise<void> {
    if (loaded) return;
    try {
      await loadHosts();
      error = null;
    } catch (caught) {
      error = String(caught);
    } finally {
      loaded = true;
    }
  },

  async addOrUpdateHost(url: string, systemInfo?: SystemInfo): Promise<HostProfile> {
    if (!loaded) await this.load();
    saving = true;
    try {
      const normalized = normalizeHostUrl(url);
      const existing = hosts.find((host) => host.url === normalized);
      const now = Date.now();
      const host = existing
        ? { ...existing, name: existing.name || hostNameFromUrl(normalized), lastSeenAt: now, ...(systemInfo ? { systemInfo } : {}) }
        : makeHost(normalized, systemInfo);

      hosts = existing
        ? hosts.map((candidate) => (candidate.id === existing.id ? host : candidate))
        : [...hosts, host];
      if (!defaultHostId) defaultHostId = host.id;
      await saveHosts();
      error = null;
      return host;
    } catch (caught) {
      error = String(caught);
      throw caught;
    } finally {
      saving = false;
    }
  },

  async setDefaultHost(hostId: string): Promise<void> {
    if (!hosts.some((host) => host.id === hostId)) return;
    defaultHostId = hostId;
    await saveHosts();
  },

  async removeHost(hostId: string): Promise<void> {
    hosts = hosts.filter((host) => host.id !== hostId);
    if (defaultHostId === hostId) defaultHostId = hosts[0]?.id ?? null;
    await saveHosts();
  },
};
