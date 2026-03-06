# Source Generated with Decompyle++
# File: real_pool_aggregator.cpython-312.pyc (Python 3.12)

__doc__ = '\nReal pool aggregator for Starknet Sepolia.\n\nCurrent scope:\n- Fetches live Ekubo pair data from `prod-api.ekubo.org`\n- Normalizes it into a stable shape for strategy execution\n- Computes an estimated fee APY from 24h volume and TVL\n'
from __future__ import annotations
import logging
import os
from dataclasses import dataclass
from typing import Any, Optional
from app.services.ekubo_client import get_overview_pairs
logger = logging.getLogger(__name__)

def _as_float(value = None, default = None):
    pass
# WARNING: Decompyle incomplete


def _extract_items(payload = None):
    pass
# WARNING: Decompyle incomplete

# WARNING: Decompyle incomplete
