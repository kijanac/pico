export interface HostCloudInitOptions {
  readonly tsAuthKey: string;
  readonly hostName: string;
}

export const PICO_REPO_URL = "https://github.com/kijanac/pi-mobile.git";
export const TAILSCALE_TAG = "tag:pico-host";

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export function renderHostCloudInit(options: HostCloudInitOptions): string {
  const lines = [
    "#cloud-config",
    "package_update: true",
    "packages:",
    "  - ca-certificates",
    "  - curl",
    "  - git",
    "runcmd:",
    "  - |",
    "    set -euo pipefail",
    `    export TS_AUTHKEY=${shellQuote(options.tsAuthKey.trim())}`,
    `    export PICO_HOSTNAME=${shellQuote(options.hostName.trim())}`,
    `    export TAILSCALE_TAG=${shellQuote(TAILSCALE_TAG)}`,
    "    export TAILSCALE_SERVE=1",
    "    export PICO_HOST_AUTO_DEPLOY=1",
    "    export PICO_HOST_AUTO_UPDATE=1",
    "    rm -rf /tmp/pico",
    `    git clone --depth=1 ${shellQuote(PICO_REPO_URL)} /tmp/pico`,
    "    /tmp/pico/packages/host/deploy/install.sh",
  ];

  return `${lines.join("\n")}\n`;
}
