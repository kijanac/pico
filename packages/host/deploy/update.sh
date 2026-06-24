#!/usr/bin/env bash
# Release-based pico-host updater with atomic symlink switch.

set -euo pipefail

APP_DIR="/opt/pico-workspace"
DATA_DIR="/var/lib/pico-host"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
STATE_FILE="$DATA_DIR/update-state.json"
REPO="kijanac/pico"
CHANNEL="stable"
PUBLIC_KEY="/etc/pico-host/update-public-key.pem"
HEALTH_URL="http://127.0.0.1:7777/healthz"
HEALTH_ATTEMPTS=30
HEALTH_DELAY=1
TMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

log() { printf '[pico-host-update] %s\n' "$*"; }
fatal() { printf '[pico-host-update] ERROR: %s\n' "$*" >&2; exit 1; }

dump_host_diagnostics() {
  log "pico-host status:"
  systemctl status pico-host --no-pager -l || true
  log "recent pico-host logs:"
  journalctl -u pico-host -n 80 --no-pager -o short-iso || true
}

health_check() {
  local url="$1"

  for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done

  return 1
}

admin() {
  (cd "$CURRENT_LINK" && pnpm --filter @pico/host exec tsx deploy/admin.ts "$@")
}

state_set() {
  admin state-set "$STATE_FILE" "$1" "$2" "${3:-}"
}

mkdir -p "$RELEASES_DIR" "$DATA_DIR"

CURRENT_VERSION="0.0.0"
if [[ -e "$CURRENT_LINK/VERSION" ]]; then
  CURRENT_VERSION="$(tr -d '[:space:]' <"$CURRENT_LINK/VERSION")"
fi
LAST_SEEN="$(admin state-last-seen "$STATE_FILE" "$CURRENT_VERSION")"

log "current=$CURRENT_VERSION lastSeen=$LAST_SEEN channel=$CHANNEL repo=$REPO"

API_URL="https://api.github.com/repos/$REPO/releases/latest"
RELEASE_JSON="$TMP_DIR/release.json"
curl -fsSL "$API_URL" -o "$RELEASE_JSON"

RELEASE_META="$(admin update-release "$RELEASE_JSON" "$CURRENT_VERSION" "$LAST_SEEN")" || fatal "failed to resolve release metadata"
mapfile -t RELEASE_FIELDS <<<"$RELEASE_META"
if [[ "${RELEASE_FIELDS[0]}" == "no_update" ]]; then
  log "no newer release (${RELEASE_FIELDS[1]})"
  exit 0
fi
[[ "${RELEASE_FIELDS[0]}" == "update" ]] || fatal "unexpected release metadata status: ${RELEASE_FIELDS[0]}"
VERSION="${RELEASE_FIELDS[1]}"
MANIFEST_URL="${RELEASE_FIELDS[2]}"
SIG_URL="${RELEASE_FIELDS[3]}"
MANIFEST="$TMP_DIR/pico-host-release.json"
SIG="$TMP_DIR/pico-host-release.json.sig"
curl -fsSL "$MANIFEST_URL" -o "$MANIFEST"

curl -fsSL "$SIG_URL" -o "$SIG"
[[ -f "$PUBLIC_KEY" ]] || fatal "manifest signature present but public key not found: $PUBLIC_KEY"
openssl dgst -sha256 -verify "$PUBLIC_KEY" -signature "$SIG" "$MANIFEST" >/dev/null || fatal "manifest signature verification failed"
log "manifest signature verified"

MANIFEST_META="$(admin update-manifest "$RELEASE_JSON" "$MANIFEST" "$VERSION")" || fatal "failed to resolve manifest metadata"
mapfile -t MANIFEST_FIELDS <<<"$MANIFEST_META"
MANIFEST_VERSION="${MANIFEST_FIELDS[0]}"
ARTIFACT="${MANIFEST_FIELDS[1]}"
EXPECTED_SHA="${MANIFEST_FIELDS[2]}"
ARTIFACT_URL="${MANIFEST_FIELDS[3]}"
state_set "$VERSION" seen

ARCHIVE="$TMP_DIR/$ARTIFACT"
curl -fL "$ARTIFACT_URL" -o "$ARCHIVE"
printf '%s  %s\n' "$EXPECTED_SHA" "$ARCHIVE" | sha256sum -c - >/dev/null || fatal "artifact checksum failed"
log "artifact checksum verified"

TARGET="$RELEASES_DIR/$VERSION"
rm -rf "$TARGET.tmp" "$TARGET"
mkdir -p "$TARGET.tmp"
tar -C "$TARGET.tmp" --strip-components=1 -xzf "$ARCHIVE"
cd "$TARGET.tmp"
pnpm --filter @pico/host... install --prod --frozen-lockfile
cd /
chown -R pico-host:pico-host "$TARGET.tmp"
mv "$TARGET.tmp" "$TARGET"

PREVIOUS=""
[[ ! -L "$CURRENT_LINK" ]] || PREVIOUS="$(readlink -f "$CURRENT_LINK")"
ln -sfn "$TARGET" "$CURRENT_LINK"

run_release_migrations() {
  local usage_migration="$CURRENT_LINK/packages/host/deploy/migrate-message-usage-shape.mjs"
  if [[ -f "$usage_migration" ]]; then
    log "running message usage migration"
    PICO_HOST_DB="$DATA_DIR/pico-host.db" node "$usage_migration" "$DATA_DIR/pico-host.db"
  fi
}

rollback() {
  local reason="$1"
  state_set "$VERSION" failed "$reason"
  if [[ -n "$PREVIOUS" ]]; then
    log "rolling back to $(basename "$PREVIOUS")"
    ln -sfn "$PREVIOUS" "$CURRENT_LINK"
    systemctl restart pico-host || true
  fi
}

sync_deploy_files() {
  if [[ -f "$CURRENT_LINK/packages/host/deploy/update.sh" ]]; then
    install -o root -g root -m 0755 "$CURRENT_LINK/packages/host/deploy/update.sh" "$APP_DIR/update.sh"
  fi

  if [[ -w /etc/systemd/system ]]; then
    for unit in pico-host.service pico-host-update.service pico-host-update.timer pico-host-update.path; do
      if [[ -f "$CURRENT_LINK/packages/host/deploy/$unit" ]]; then
        install -o root -g root -m 0644 "$CURRENT_LINK/packages/host/deploy/$unit" "/etc/systemd/system/$unit"
      fi
    done
    systemctl daemon-reload
    systemctl enable --now pico-host-update.path >/dev/null || true
  else
    log "skipping systemd unit refresh; /etc/systemd/system is not writable in this sandbox"
  fi
}

run_release_migrations

log "restarting pico-host on $VERSION"
if ! systemctl restart pico-host; then
  dump_host_diagnostics
  rollback restart_failed
  fatal "restart failed"
fi

log "waiting for health check at $HEALTH_URL"
if ! health_check "$HEALTH_URL"; then
  dump_host_diagnostics
  rollback health_check_failed
  fatal "health check failed"
fi

sync_deploy_files
state_set "$VERSION" updated

log "updated to $VERSION"
