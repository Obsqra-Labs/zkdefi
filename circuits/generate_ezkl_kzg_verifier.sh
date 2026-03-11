#!/usr/bin/env bash
# Build the native Cairo EZKL KZG verifier package used by Path B.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/contracts/src/ezkl_kzg_verifier"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Missing verifier project at: $PROJECT_DIR"
  exit 1
fi

if ! command -v scarb >/dev/null 2>&1; then
  echo "scarb not found in PATH. Install Scarb first: https://docs.swmansion.com/scarb/"
  exit 1
fi

echo "=== Building native EZKL KZG Cairo verifier ==="
(
  cd "$PROJECT_DIR"
  scarb build
)

echo ""
echo "Build complete."
echo "Sierra: $PROJECT_DIR/target/dev/ezkl_kzg_verifier_EzklKzgVerifier.contract_class.json"
echo "CASM:   $PROJECT_DIR/target/dev/ezkl_kzg_verifier_EzklKzgVerifier.compiled_contract_class.json"
