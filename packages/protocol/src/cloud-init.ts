export interface BridgeCloudInitOptions {
  readonly tsAuthKey: string;
  readonly bridgeHostname: string;
}

export const BRIDGE_REPO_URL = "https://github.com/kijanac/pi-mobile.git";
export const TAILSCALE_TAG = "tag:pi-bridge";

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export function renderBridgeCloudInit(options: BridgeCloudInitOptions): string {
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
    `    export BRIDGE_HOSTNAME=${shellQuote(options.bridgeHostname.trim())}`,
    `    export TAILSCALE_TAG=${shellQuote(TAILSCALE_TAG)}`,
    "    export TAILSCALE_SERVE=1",
    "    export PI_BRIDGE_AUTO_DEPLOY=1",
    "    export PI_BRIDGE_AUTO_UPDATE=1",
    "    rm -rf /tmp/pico",
    `    git clone --depth=1 ${shellQuote(BRIDGE_REPO_URL)} /tmp/pico`,
    "    /tmp/pico/bridge/deploy/install.sh",
  ];

  return `${lines.join("\n")}\n`;
}
