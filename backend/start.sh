#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ -d "venv" ]; then
  source venv/bin/activate
elif [ -d ".venv" ]; then
  source .venv/bin/activate
elif [ -x "../.venv_py311/bin/python3" ]; then
  export PATH="../.venv_py311/bin:$PATH"
fi
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8003
