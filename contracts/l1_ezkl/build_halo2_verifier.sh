#!/usr/bin/env bash
set -euo pipefail

# One-shot build helper for large EZKL/Halo2 Solidity verifiers.
# Rationale: some generated verifiers hit a Yul stack limit when via-IR is enabled.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACT="$ROOT_DIR/out/EZKLVerifier.sol/Halo2Verifier.json"

echo "[l1_ezkl] Building Halo2 verifier in $ROOT_DIR"
cd "$ROOT_DIR"

build_default() {
  echo "[l1_ezkl] Attempt 1: project defaults (foundry.toml)"
  forge build
}

build_stack_safe() {
  echo "[l1_ezkl] Attempt 2: stack-safe profile (via_ir=false, solc=0.8.24)"
  FOUNDRY_VIA_IR=false forge build --force --no-auto-detect --use 0.8.24
}

if ! build_default; then
  echo "[l1_ezkl] Default build failed, trying stack-safe profile..."
  build_stack_safe
fi

if [[ ! -f "$ARTIFACT" ]]; then
  echo "[l1_ezkl] ERROR: build completed but artifact missing: $ARTIFACT" >&2
  exit 1
fi

echo "[l1_ezkl] OK: artifact present: $ARTIFACT"
echo "[l1_ezkl] Next: run deploy only after artifact exists."
