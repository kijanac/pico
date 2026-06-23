#!/usr/bin/env bash
# pico-host push deploy from laptop.
#
# Usage from the repository root:
#   PICO_DEPLOY_HOST=root@mybox ./packages/host/deploy/deploy.sh
#
# Run from anywhere; the script anchors itself to its own location so
# rsync sources from the correct tree. Assumes install.sh has already
# run on the server.

set -euo pipefail

HOST="${PICO_DEPLOY_HOST:-}"
if [[ -z "$HOST" ]]; then
  echo "PICO_DEPLOY_HOST not set. Example:" >&2
  echo "  PICO_DEPLOY_HOST=root@1.2.3.4 ./packages/host/deploy/deploy.sh" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# deploy.sh lives in packages/host/deploy; the source root is the workspace root.
ROOT="$(cd "$HERE/../../.." && pwd)"
REMOTE=/opt/pi-mobile-workspace
VERSION="$(node -p "require('$ROOT/package.json').version")"
REMOTE_RELEASE="$REMOTE/releases/$VERSION"

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

step "preflight"
ssh -o ConnectTimeout=5 "$HOST" "test -d $REMOTE && id pico-host >/dev/null 2>&1" \
  || { echo "  server isn't set up — run packages/host/deploy/install.sh on it first" >&2; exit 1; }
echo "  $HOST:$REMOTE ready"

# Remember what `current` points at so a failed deploy can roll back.
# Empty on first deploy; equal to $REMOTE_RELEASE when redeploying the
# same version (in which case the old tree is gone and rollback is moot).
PREVIOUS="$(ssh "$HOST" "readlink -f $REMOTE/current 2>/dev/null || true")"

rollback() {
  if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$REMOTE_RELEASE" ]]; then
    echo "  rolling back to $(basename "$PREVIOUS")" >&2
    ssh "$HOST" "ln -sfn $PREVIOUS $REMOTE/current && systemctl restart pico-host" || true
  else
    echo "  no previous release to roll back to" >&2
  fi
}

step "rsync source"
# Push only what the Pico host needs from the workspace into a versioned release.
# The mobile app is built locally/on a Mac and is not needed on the server.
ssh "$HOST" "rm -rf $REMOTE_RELEASE.tmp && mkdir -p $REMOTE_RELEASE.tmp"
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
  --include='/packages/***' \
  --exclude='*' \
  "$ROOT/" "$HOST:$REMOTE_RELEASE.tmp/"
ssh "$HOST" "printf '%s\\n' '$VERSION' > $REMOTE_RELEASE.tmp/VERSION && \
  rm -rf $REMOTE_RELEASE && \
  mv $REMOTE_RELEASE.tmp $REMOTE_RELEASE && \
  ln -sfn $REMOTE_RELEASE $REMOTE/current"

step "pnpm install (prod)"
ssh "$HOST" "cd $REMOTE/current && \
  corepack enable && \
  pnpm --filter @pico/host... install --prod --frozen-lockfile && \
  chown -R pico-host:pico-host $REMOTE_RELEASE"

step "systemd units"
ssh "$HOST" "install -o root -g root -m 0644 $REMOTE/current/packages/host/deploy/pico-host.service /etc/systemd/system/pico-host.service && \
  install -o root -g root -m 0644 $REMOTE/current/packages/host/deploy/pico-host-update.service /etc/systemd/system/pico-host-update.service && \
  install -o root -g root -m 0644 $REMOTE/current/packages/host/deploy/pico-host-update.timer /etc/systemd/system/pico-host-update.timer && \
  install -o root -g root -m 0644 $REMOTE/current/packages/host/deploy/pico-host-update.path /etc/systemd/system/pico-host-update.path && \
  install -o root -g root -m 0755 $REMOTE/current/packages/host/deploy/update.sh $REMOTE/update.sh && \
  install -o root -g pico-host -m 0640 $REMOTE/current/packages/host/deploy/update-public-key.pem /etc/pico-host/update-public-key.pem && \
  systemctl daemon-reload && \
  systemctl enable --now pico-host-update.path >/dev/null"

step "restart"
ssh "$HOST" "systemctl restart pico-host && systemctl is-active pico-host" \
  || { echo "  restart FAILED — check 'journalctl -u pico-host -n 30'" >&2; rollback; exit 1; }

step "verify"
# Health-check via tailscale (works whether or not `tailscale serve` is
# proxying yet, since we hit the box from its own loopback over ssh). The
# service can be systemd-active before Node has bound the HTTP port, so retry.
if ssh "$HOST" "for i in {1..30}; do curl -fsS --max-time 3 http://127.0.0.1:7777/healthz >/dev/null && exit 0; sleep 1; done; exit 1"; then
  echo "  /healthz ok"
else
  echo "  /healthz FAILED — check 'journalctl -u pico-host -n 30'" >&2
  rollback
  exit 1
fi

step "done"
ssh "$HOST" "systemctl status pico-host --no-pager -n 5"
