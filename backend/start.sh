#!/bin/bash
cd /opt/obsqra.starknet/zkdefi/backend
source venv/bin/activate
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8003
