# Source Generated with Decompyle++
# File: market_surface_service.cpython-312.pyc (Python 3.12)

__doc__ = 'Cross-DEX market surface aggregation for dashboard intelligence.'
from __future__ import annotations
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
import os
import httpx
from app.services.ekubo_client import get_overview_pairs, get_tokens
from app.services.ekubo_config import SEPOLIA_ETH, SEPOLIA_STRK, SEPOLIA_USDC, get_ekubo_chain_id
from app.services.mainnet_oracle import FALLBACK_DATA, MarketSnapshot, get_oracle
logger = logging.getLogger(__name__)
# WARNING: Decompyle incomplete
