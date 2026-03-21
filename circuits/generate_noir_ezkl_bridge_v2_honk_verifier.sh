#!/usr/bin/env bash
# Generate Garaga HONK verifier for Noir EZKL-bridge V2 circuit.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOIR_PKG="${SCRIPT_DIR}/noir_ezkl_bridge_v2"
TARGET="${NOIR_PKG}/target"
OUT_PROJECT_NAME="garaga_verifier_noir_ezkl_bridge_v2"
CONTRACTS_SRC="${SCRIPT_DIR}/contracts/src"

cd "$NOIR_PKG"

if ! command -v nargo >/dev/null 2>&1; then
  echo "nargo not found. Install Noir (noirup): https://noir-lang.org/docs/getting_started/quick_start" >&2
  exit 1
fi

nargo compile

COMPILED_JSON=""
for f in "${TARGET}"/*.json; do
  if [ -f "$f" ] && [ "$(basename "$f")" != "package_data.json" ]; then
    COMPILED_JSON="$f"
    break
  fi
done
if [ -z "$COMPILED_JSON" ] || [ ! -f "$COMPILED_JSON" ]; then
  echo "No compiled circuit JSON in $TARGET. Run: nargo compile" >&2
  exit 1
fi

if ! command -v bb >/dev/null 2>&1; then
  echo "bb (Barretenberg) not found." >&2
  exit 1
fi

bb write_vk -s ultra_honk --oracle_hash keccak -b "$COMPILED_JSON" -o "${TARGET}/vk"
VK_BIN="${TARGET}/vk/vk"
if [ ! -f "$VK_BIN" ]; then
  echo "Missing HONK vk binary at $VK_BIN after bb write_vk" >&2
  exit 1
fi

if ! command -v garaga >/dev/null 2>&1; then
  echo "garaga CLI not found. Install: pip install garaga==1.0.1" >&2
  exit 1
fi

rm -rf "${CONTRACTS_SRC}/${OUT_PROJECT_NAME}"
(cd "$CONTRACTS_SRC" && garaga gen --system ultra_keccak_zk_honk --vk "$VK_BIN" --project-name "$OUT_PROJECT_NAME")

VERIFIER_DIR="${CONTRACTS_SRC}/${OUT_PROJECT_NAME}"
if [ -d "$VERIFIER_DIR" ]; then
  (cd "$VERIFIER_DIR" && scarb build) || true
  echo ""
  echo "Noir EZKL-bridge V2 HONK verifier: ${VERIFIER_DIR}"
else
  echo "Garaga did not create ${VERIFIER_DIR}" >&2
  exit 1
fi
