#!/usr/bin/env bash
# Resolve the release version for CI and write it to $GITHUB_ENV.
# From the vX.Y.Z[-prerelease] tag when building one, otherwise from package.json.
#
# Usage: scripts/resolve-version.sh [ENV_NAME]   (default ENV_NAME: VERSION)
set -euo pipefail

NAME="${1:-VERSION}"
if [[ "${GITHUB_REF_TYPE:-}" == "tag" && "${GITHUB_REF_NAME:-}" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
  VALUE="${BASH_REMATCH[1]}"
else
  VALUE="$(node -p "require('./package.json').version")"
fi

echo "$NAME=$VALUE" >> "${GITHUB_ENV:?}"
echo "resolved $NAME=$VALUE"
