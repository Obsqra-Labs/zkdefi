#!/bin/bash
# Run zkde.fi E2E test suite

cd "$(dirname "$0")"

# Detect and activate the correct venv
if [ -f ".venv_py311/bin/activate" ]; then
    source .venv_py311/bin/activate
elif [ -f "backend/venv/bin/activate" ]; then
    source backend/venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
else
    echo "Error: No virtual environment found. Create one with: python3 -m venv .venv_py311"
    exit 1
fi

export STARKNET_RPC_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7"
# Optional: BACKEND_URL=http://localhost:8003 ./run_tests.sh --full-privacy-only  (quick path check)
python3 tests/e2e_test_suite.py "$@"
