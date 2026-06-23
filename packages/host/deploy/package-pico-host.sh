#!/usr/bin/env bash
# Build the pico-host release artifact and signed manifest inputs.
#
# Usage:
#   packages/host/deploy/package-pico-host.sh [version]
#
# Outputs under dist/pico-host-release/:
#   pico-host-<version>.tar.gz
#   pico-host-release.json
#   pico-host-release.json.sig   (only when PICO_HOST_RELEASE_SIGNING_KEY_PEM is set)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/package.json').version")}" 
OUT_DIR="$ROOT/dist/pico-host-release"
STAGE="$OUT_DIR/stage/pico-host-$VERSION"
ARTIFACT="pico-host-$VERSION.tar.gz"
rm -rf "$OUT_DIR/stage"
mkdir -p "$STAGE" "$OUT_DIR"

cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/pnpm-workspace.yaml" "$STAGE/"
cp -a "$ROOT/packages" "$STAGE/"
printf '%s\n' "$VERSION" >"$STAGE/VERSION"

find "$STAGE" -type d \( -name node_modules -o -name dist \) -prune -exec rm -rf {} +
find "$STAGE" -name '*.tsbuildinfo' -delete

tar -C "$OUT_DIR/stage" -czf "$OUT_DIR/$ARTIFACT" "pico-host-$VERSION"
SHA256="$(sha256sum "$OUT_DIR/$ARTIFACT" | awk '{print $1}')"

(cd "$ROOT" && pnpm --filter @pico/host exec tsx deploy/admin.ts package-release "$VERSION" "$ARTIFACT" "$SHA256") >"$OUT_DIR/pico-host-release.json"

SIGNING_KEY_PEM="${PICO_HOST_RELEASE_SIGNING_KEY_PEM:-${RELEASE_SIGNING_KEY_PEM:-}}"
if [[ -n "$SIGNING_KEY_PEM" ]]; then
  KEY_FILE="$OUT_DIR/signing-key.pem"
  printf '%s' "$SIGNING_KEY_PEM" >"$KEY_FILE"
  chmod 0600 "$KEY_FILE"
  openssl dgst -sha256 -sign "$KEY_FILE" -out "$OUT_DIR/pico-host-release.json.sig" "$OUT_DIR/pico-host-release.json"
  rm -f "$KEY_FILE"
fi

echo "$OUT_DIR/$ARTIFACT"
echo "$OUT_DIR/pico-host-release.json"
[[ ! -f "$OUT_DIR/pico-host-release.json.sig" ]] || echo "$OUT_DIR/pico-host-release.json.sig"
