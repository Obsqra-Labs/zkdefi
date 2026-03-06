# Source Generated with Decompyle++
# File: vault_activity.cpython-312.pyc (Python 3.12)

from fastapi import APIRouter, Query
import httpx
import asyncio
import json
import os
from pathlib import Path
router = APIRouter(prefix = '/vault', tags = [
    'vault'])
BASE = os.getenv('BACKEND_SELF_URL', 'http://127.0.0.1:8003')
DATA_DIR = Path(__file__).resolve().parents[3] / 'data'
get_vault_activity = (lambda address = None, limit = None: pass# WARNING: Decompyle incomplete
)()

def _normalize(item = None, source = None):
    if not item.get('description'):
        item.get('description')
        if not item.get('action'):
            item.get('action')
            if not item.get('reason'):
                item.get('reason')
    if not item.get('timestamp'):
        item.get('timestamp')
        if not item.get('created_at'):
            item.get('created_at')
            if not item.get('time'):
                item.get('time')
    return {
        'type': source,
        'description': source,
        'method': item.get('method', item.get('privacy_mode', '')),
        'timestamp': '',
        'hashes': {
            'tx': item.get('tx_hash', item.get('transaction_hash', '')),
            'commitment': item.get('commitment', item.get('commitment_hash', '')),
            'nullifier': item.get('nullifier', ''),
            'proof': item.get('proof_hash', item.get('proof', '')) },
        'asset': item.get('asset', item.get('token', 'STRK')),
        'amount': str(item.get('amount', item.get('value', ''))) }

get_yield_chart = (lambda days = None: pass# WARNING: Decompyle incomplete
)()
