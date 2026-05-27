#!/usr/bin/env bash
# pi-bridge push deploy from laptop.
#
# Usage from the repository root:
#   PI_BRIDGE_HOST=root@mybox ./bridge/deploy/deploy.sh
#
# Run from anywhere; the script anchors itself to its own location so
# rsync sources from the correct tree. Assumes install.sh has already
# run on the server.

set -euo pipefail

HOST="${PI_BRIDGE_HOST:-}"
if [[ -z "$HOST" ]]; then
  echo "PI_BRIDGE_HOST not set. Example:" >&2
  echo "  PI_BRIDGE_HOST=root@1.2.3.4 ./bridge/deploy/deploy.sh" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# deploy.sh lives in bridge/deploy; the source root is the workspace root.
ROOT="$(cd "$HERE/../.." && pwd)"
REMOTE=/opt/pi-mobile-workspace

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

step "preflight"
ssh -o ConnectTimeout=5 "$HOST" "test -d $REMOTE && id pi-bridge >/dev/null 2>&1" \
  || { echo "  server isn't set up — run bridge/deploy/install.sh on it first" >&2; exit 1; }
echo "  $HOST:$REMOTE ready"

step "rsync source"
# Push only what the bridge needs from the workspace: root pnpm metadata,
# the bridge package, and shared workspace packages. The mobile app is built
# locally/on a Mac and is not needed on the server.
rsync -av --delete \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.git/' \
  --exclude='.claude/' \
  --exclude='*.tar' \
  --exclude='*.tar.*' \
  --include='/package.json' \
  --include='/pnpm-lock.yaml' \
  --include='/pnpm-workspace.yaml' \
  --include='/bridge/***' \
  --include='/packages/***' \
  --exclude='*' \
  "$ROOT/" "$HOST:$REMOTE/"

step "pnpm install (prod)"
ssh "$HOST" "cd $REMOTE && \
  corepack enable && \
  pnpm --filter pi-bridge... install --prod --frozen-lockfile && \
  chown -R pi-bridge:pi-bridge $REMOTE"

step "restart"
ssh "$HOST" "systemctl restart pi-bridge && sleep 2 && systemctl is-active pi-bridge"

step "verify"
# Health-check via tailscale (works whether or not `tailscale serve` is
# proxying yet, since we hit the box from its own loopback over ssh).
if ssh "$HOST" "curl -fsS --max-time 3 http://127.0.0.1:7777/healthz" >/dev/null; then
  echo "  /healthz ok"
else
  echo "  /healthz FAILED — check 'journalctl -u pi-bridge -n 30'" >&2
  exit 1
fi

step "done"
ssh "$HOST" "systemctl status pi-bridge --no-pager -n 5"
