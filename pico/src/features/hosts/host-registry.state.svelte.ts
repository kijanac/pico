import type { SystemInfo } from "@pico/protocol";
import { getJsonPreference, getPreference, removePreference, setJsonPreference, setPreference } from "@/shared/mobile/preferences";

const HOSTS_KEY = "pico_hosts_v1";
const DEFAULT_HOST_ID_KEY = "pico_default_host_id";

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

function cleanHostUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  if (!url) throw new Error("Host URL is required");
  return url;
}

function hostNameFromUrl(url: string): string {
  return new URL(url).hostname.replace(/\..*$/, "");
}

function makeHost(url: string, systemInfo?: SystemInfo): HostProfile {
  const normalized = cleanHostUrl(url);
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

  hosts = [];
  defaultHostId = null;
}

export const hostRegistryState = {
  get loaded() { return loaded; },
  get hosts() { return hosts; },
  get defaultHostId() { return defaultHostId; },
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
      const normalized = cleanHostUrl(url);
      const existing = hosts.find((host) => host.url === normalized);
      const now = Date.now();
      const host = existing ?? makeHost(normalized, systemInfo);
      if (existing) {
        existing.name ||= hostNameFromUrl(normalized);
        existing.lastSeenAt = now;
        if (systemInfo) existing.systemInfo = systemInfo;
      } else {
        hosts.push(host);
      }
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

  async renameHost(hostId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Host name is required");
    const host = hosts.find((candidate) => candidate.id === hostId);
    if (!host) return;
    host.name = trimmed;
    await saveHosts();
  },

  async removeHost(hostId: string): Promise<void> {
    const index = hosts.findIndex((host) => host.id === hostId);
    if (index === -1) return;
    hosts.splice(index, 1);
    if (defaultHostId === hostId) {
      const nextDefault = hosts.at(0);
      defaultHostId = nextDefault ? nextDefault.id : null;
    }
    await saveHosts();
  },
};
