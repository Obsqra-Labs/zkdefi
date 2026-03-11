#!/usr/bin/env bash
# Build Noir EZKL-bridge circuit (nargo compile).
# Requires nargo on PATH. Artifacts under circuits/noir_ezkl_bridge/target/.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOIR_PKG="${SCRIPT_DIR}/noir_ezkl_bridge"
cd "$NOIR_PKG"
if ! command -v nargo >/dev/null 2>&1; then
  echo "nargo not found. Install Noir: https://noir-lang.org/docs/getting_started/installation/" >&2
  exit 1
fi
nargo compile
echo "Artifacts in: $NOIR_PKG/target/"
