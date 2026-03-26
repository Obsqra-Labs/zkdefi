"""Test env: no fleet, no bot wallet — fast CI, no live RPC from trading loops."""
from __future__ import annotations

import os

# Must run before `api.main` is imported (see test_api fixture order).
os.environ.setdefault("FLEET_ENABLED", "false")
os.environ.setdefault("BOT_ACCOUNT_ADDRESS", "")
os.environ.setdefault("BOT_PRIVATE_KEY", "")
os.environ.setdefault("MM_SIM_ADMIN_KEY", "dev-admin-key")
