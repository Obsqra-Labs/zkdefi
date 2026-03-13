#!/usr/bin/env bash
# Generate Garaga HONK verifier for Noir EZKL-bridge circuit.
# Requires: Noir (nargo), Barretenberg (bb), Garaga CLI (pip install garaga==1.0.1).
# See: https://garaga.gitbook.io/garaga/deploy-your-snark-verifier-on-starknet/noir
#
# Steps:
#   1. nargo compile in circuits/noir_ezkl_bridge → target/<name>.json
#   2. bb write_vk -s ultra_honk --oracle_hash keccak -b target/<name>.json -o target/vk
#   3. garaga gen --system ultra_keccak_zk_honk --vk target/vk/vk
#   4. scarb build in generated project
#
# For Starknet-native transcript (~178M gas): if Garaga supports ultra_starknet_honk,
# use --system ultra_starknet_zk_honk (or per Garaga docs) and same vk.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOIR_PKG="${SCRIPT_DIR}/noir_ezkl_bridge"
TARGET="${NOIR_PKG}/target"
OUT_PROJECT_NAME="garaga_verifier_noir_ezkl_bridge"
CONTRACTS_SRC="${SCRIPT_DIR}/contracts/src"

cd "$NOIR_PKG"

if ! command -v nargo >/dev/null 2>&1; then
  echo "nargo not found. Install Noir (noirup): https://noir-lang.org/docs/getting_started/quick_start" >&2
  exit 1
fi

# Build circuit (creates target/*.json; exact name depends on Nargo.toml package name)
nargo compile
# Find the compiled JSON (noir_ezkl_bridge or similar)
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
  echo "bb (Barretenberg) not found. Install: bbup --version 3.0.0-nightly.20251104 or npm i @aztec/bb.js@3.0.0-nightly.20251104" >&2
  exit 1
fi

echo "=== Writing HONK verification key ==="
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

echo "=== Generating Garaga HONK verifier contract ==="
rm -rf "${CONTRACTS_SRC}/${OUT_PROJECT_NAME}"
# Generate into contracts/src so we have same layout as other verifiers
(cd "$CONTRACTS_SRC" && garaga gen --system ultra_keccak_zk_honk --vk "$VK_BIN" --project-name "$OUT_PROJECT_NAME")

VERIFIER_DIR="${CONTRACTS_SRC}/${OUT_PROJECT_NAME}"
if [ -d "$VERIFIER_DIR" ]; then
  (cd "$VERIFIER_DIR" && scarb build) || true
  echo ""
  echo "Noir EZKL-bridge HONK verifier: ${VERIFIER_DIR}"
  echo "Next: add to parent backend deploy_verifiers_l3.py and set L3_NOIR_EZKL_BRIDGE_HONK_VERIFIER_ADDRESS"
else
  echo "Garaga did not create ${VERIFIER_DIR}" >&2
  exit 1
fi
