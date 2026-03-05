#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt >/dev/null

export PYTHONPATH="$ROOT_DIR"
uvicorn api.main:app --host "${MM_SIM_HOST:-0.0.0.0}" --port "${MM_SIM_PORT:-8099}" --reload
