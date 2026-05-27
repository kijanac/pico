#!/usr/bin/env bash
# pi-bridge first-time install. Run as root on the Hetzner box, idempotent.
#
# What it does:
#   - creates the pi-bridge system user + data dir
#   - installs node 24+, pnpm (via corepack), tailscale if missing
#   - drops the systemd unit
#   - seeds /etc/pi-bridge/env from env.example (only if it doesn't exist;
#     existing secrets are preserved across re-runs)
#
# What it does NOT do:
#   - copy source files (deploy.sh handles that)
#   - start the service (run `systemctl start pi-bridge` after deploy.sh)
#   - configure `tailscale serve` (see deploy/README.md for that step)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "install.sh must run as root (try: sudo ./install.sh)" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME=pi-bridge
INSTALL_DIR=/opt/pi-mobile-workspace
DATA_DIR=/var/lib/pi-bridge
WORKSPACES_DIR=/var/lib/pi-bridge/workspaces
ETC_DIR=/etc/pi-bridge

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

step "system user"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin "$USER_NAME"
  echo "  created user $USER_NAME"
else
  echo "  user $USER_NAME exists"
fi

step "directories"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$INSTALL_DIR" "$DATA_DIR" "$WORKSPACES_DIR"
install -d -o root -g "$USER_NAME" -m 0750 "$ETC_DIR"
echo "  $INSTALL_DIR   (source)"
echo "  $DATA_DIR      (db + pi sessions, HOME for $USER_NAME)"
echo "  $WORKSPACES_DIR (git repos shown in the mobile cwd picker)"
echo "  $ETC_DIR       (secrets, mode 0750)"

step "node 24+"
if command -v node >/dev/null 2>&1 && node --version | grep -qE '^v(2[4-9]|[3-9][0-9])\.'; then
  echo "  $(node --version) ok"
else
  # NodeSource setup for Debian/Ubuntu. Skip on other distros — operator
  # can install node 24+ by hand and re-run.
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs
  else
    echo "  ERROR: node 24+ not found and this isn't an apt-based distro." >&2
    echo "  install node 24+ manually and re-run install.sh." >&2
    exit 1
  fi
fi

step "pnpm via corepack"
corepack enable
corepack prepare pnpm@10.5.2 --activate
echo "  pnpm $(pnpm --version)"

step "git"
if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y git openssh-client
  else
    echo "  WARNING: git not installed and this isn't an apt-based distro." >&2
    echo "  install git manually before cloning repos." >&2
  fi
else
  echo "  $(git --version)"
fi

step "tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
  else
    echo "  WARNING: tailscale not installed and this isn't an apt-based distro." >&2
    echo "  install tailscale manually before exposing the bridge." >&2
  fi
else
  echo "  $(tailscale version | head -1)"
fi

step "systemd unit"
install -o root -g root -m 0644 "$HERE/pi-bridge.service" /etc/systemd/system/pi-bridge.service
systemctl daemon-reload
systemctl enable pi-bridge >/dev/null
echo "  installed + enabled (not started yet — run deploy.sh first)"

step "env file"
if [[ ! -f "$ETC_DIR/env" ]]; then
  install -o root -g "$USER_NAME" -m 0640 "$HERE/env.example" "$ETC_DIR/env"
  echo "  seeded $ETC_DIR/env from env.example"
  echo "  → optional: edit it for API-key mode, or use pi /login as the pi-bridge user"
else
  echo "  $ETC_DIR/env already exists (preserved)"
fi

step "done"
cat <<'EOF'

Next steps:
  1. From your laptop, run bridge/deploy/deploy.sh to push the workspace
  2. Authenticate pi on the server:
       cd /opt/pi-mobile-workspace/bridge
       sudo -u pi-bridge HOME=/var/lib/pi-bridge pnpm exec pi
       # inside pi: /login, choose provider, complete browser/device flow, /quit
     Or edit /etc/pi-bridge/env for API-key mode.
  3. systemctl start pi-bridge
  4. journalctl -u pi-bridge -f            # verify it's healthy
  5. tailscale up                          # if not already up
  6. tailscale serve --bg --https=443 http://localhost:7777
  7. Open the mobile app → Settings → set the bridge URL to your tailnet
     HTTPS URL (e.g. https://<host>.<tailnet>.ts.net)
EOF
