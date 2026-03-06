# Source Generated with Decompyle++
# File: sim.cpython-312.pyc (Python 3.12)

'''Proxy routes to the market-maker-sim service (port 8099).

Exposes the sim state, events, and contract addresses through the main
backend API so the frontend can consume a single origin.

All data forwarded from the sim is tagged with `data_quality: "simulated"`
so downstream consumers never confuse it with real market data.
'''
from __future__ import annotations
import os
from typing import Any
import httpx
from fastapi import APIRouter, HTTPException
router = APIRouter(prefix = '/sim', tags = [
    'sim'])
_SIM_BASE = os.getenv('MM_SIM_URL', 'http://localhost:8099')
_TIMEOUT = 5

async def _proxy_get(path = None):
    '''Forward a GET request to the sim service.'''
    pass
# WARNING: Decompyle incomplete

sim_health = (lambda : pass# WARNING: Decompyle incomplete
)()
sim_state = (lambda : pass# WARNING: Decompyle incomplete
)()
sim_events = (lambda : pass# WARNING: Decompyle incomplete
)()
sim_contracts = (lambda : pass# WARNING: Decompyle incomplete
)()
sim_scenarios = (lambda : pass# WARNING: Decompyle incomplete
)()
