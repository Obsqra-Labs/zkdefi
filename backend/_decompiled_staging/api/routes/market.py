# Source Generated with Decompyle++
# File: market.cpython-312.pyc (Python 3.12)

'''Market surface routes for cross-DEX dashboard intelligence.'''
from __future__ import annotations
import os
from typing import Any
from fastapi import APIRouter, HTTPException
from app.services.ekubo_config import get_ekubo_chain_id
from app.services.market_surface_service import get_market_surface
router = APIRouter(prefix = '/market', tags = [
    'market'])

def _market_surface_enabled():
    return os.getenv('EKUBO_MARKET_SURFACE_ENABLED', 'true').strip().lower() == 'true'

market_surface = (lambda : pass# WARNING: Decompyle incomplete
)()
