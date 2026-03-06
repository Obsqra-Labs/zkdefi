# Source Generated with Decompyle++
# File: shared_pool_service.cpython-312.pyc (Python 3.12)

'''Shared pool service (manager envelope + member overrides, file-backed).'''
from __future__ import annotations
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
DATA_DIR.mkdir(parents = True, exist_ok = True)
POOLS_FILE = DATA_DIR / 'shared_pools.json'
MEMBERS_FILE = DATA_DIR / 'shared_pool_members.json'
SETTLEMENT_RANK = {
    'public_transfer': 0,
    'hashed_claim': 1,
    'internal_ledger': 2 }
RELAY_RANK = {
    'none': 0,
    'optional': 1,
    'required': 2 }

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _normalize_address(value = None):
    if not value:
        value
    raw = ''.strip().lower()
    if not raw:
        return ''
    without = raw[2:] if raw.startswith('0x') else raw
    stripped = without.lstrip('0')
    if not stripped:
        stripped
    return f'''0x{'0'}'''


def _normalize_pool_id(value = None):
    if not value:
        value
    raw = ''.strip().lower().replace(' ', '_')
    return raw


def _normalize_allowlist(items = None):
    if not items:
        return []
    out = None
    for item in items:
        if not item:
            item
        text = str('').strip().lower()
        if not text:
            continue
        if text.startswith('0x'):
            text = _normalize_address(text)
        if not text not in out:
            continue
        out.append(text)
    return out


def _deep_merge(base = None, patch = None):
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
            continue
        out[key] = copy.deepcopy(value)
    return out


def _read_file(path = None):
    if not path.exists():
        return { }
    payload = json.loads(path.read_text(encoding = 'utf-8'))
    if isinstance(payload, dict):
        return payload
    return { }
# WARNING: Decompyle incomplete


def _write_file(path = None, payload = None):
    path.parent.mkdir(parents = True, exist_ok = True)
    path.write_text(json.dumps(payload, indent = 2, sort_keys = True), encoding = 'utf-8')


def _pool_key(pool_id = None):
    return _normalize_pool_id(pool_id)


def _member_key(member_address = None):
    return _normalize_address(member_address)


def _shared_pool_id(manager_address = None, hint = None):
