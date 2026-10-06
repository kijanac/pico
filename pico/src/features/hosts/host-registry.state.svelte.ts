export interface HostProfile {
  id: string;
  name: string;
  url: string;
}

// The host serves this app, so it is the page's own origin.
const host: HostProfile = {
  id: "host",
  name: window.location.hostname.replace(/\..*$/, ""),
  url: window.location.origin,
};

export const hostRegistryState = {
  hosts: [host] as readonly HostProfile[],
  defaultHostId: host.id,

  getHost(id: string): HostProfile | null {
    return id === host.id ? host : null;
  },
};
