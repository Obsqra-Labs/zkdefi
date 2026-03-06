# Source Generated with Decompyle++
# File: state.cpython-312.pyc (Python 3.12)

'''State and timeline routes for Vault OS convergence.'''
from __future__ import annotations
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from starknet_py.hash.selector import get_selector_from_name
from app.services.ekubo_config import EKUBO_ROUTER_SEPOLIA, SEPOLIA_ETH, SEPOLIA_FUSDC, SEPOLIA_STRK, SEPOLIA_USDC, get_ekubo_chain_id
from app.api.routes.dex import _fetch_avnu_quotes, _pick_best_avnu_quote
from app.services.ekubo_execution_service import build_swap_calldata
from app.services.ekubo_client import get_tokens
from app.services.market_surface_service import get_market_surface
from app.services.receipt_service import get_receipt_service
from app.services.shared_pool_service import POOLS_FILE
from app.services.vault_policy_service import get_vault_policy_service
router = APIRouter(tags = [
    'state'])
STARKNET_RPC_URL = os.getenv('STARKNET_RPC_URL', 'https://starknet-sepolia-rpc.publicnode.com')
BALANCE_OF_SELECTORS: 'tuple[str, ...]' = ('0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', hex(get_selector_from_name('balance_of')))
ALLOWANCE_SELECTOR = hex(get_selector_from_name('allowance'))
DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
LOCAL_COMMITMENTS_FILE = DATA_DIR / 'local_commitments_imports.json'
TOKEN_DECIMALS: 'dict[str, int]' = {
    '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d': 18,
    '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7': 18,
    '0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080': 6,
    '0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23': 6 }
TOKEN_SYMBOLS: 'dict[str, str]' = {
    '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d': 'STRK',
    '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7': 'ETH',
    '0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080': 'USDC',
    '0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23': 'fUSDC' }

class ExecutionPreflightRequest(BaseModel):
    amount_in: 'str' = 'ExecutionPreflightRequest'
    slippage_bps: 'int' = Field(default = 9500, ge = 0, le = 10000)
    user_address: 'str' = 'best'


class LocalCommitmentsMigrationRequest(BaseModel):
    user_address: 'str' = 'LocalCommitmentsMigrationRequest'
    commitments: 'dict[str, list[dict[str, Any]]]' = Field(default_factory = dict)
    apply_policy_preset: 'bool' = True


class ManualWalletEventRequest(BaseModel):
    action_type: "Literal['deposit', 'withdraw', 'swap', 'lp_add', 'lp_remove', 'deploy']" = 'ManualWalletEventRequest'
    venue: 'str' = 'privacy'
    tx_hash: 'str' = None
    amount_wei: 'str | None' = None
    asset: 'str | None' = None
    capital_source: "Literal['wallet_mode', 'private_capital'] | None" = None
    title: 'str | None' = None
    details: 'str | None' = None
    status: "Literal['pending', 'confirmed', 'failed', 'info']" = 'confirmed'


class WalletStateToken(BaseModel):
    decimals: 'int' = 'WalletStateToken'
    balance_raw: 'str | None' = None
    balance: 'str | None' = None
    allowance_raw: 'str | None' = None
    allowance: 'str | None' = None
    last_sync: 'str' = None


class WalletStateResponse(BaseModel):
    tokens: 'list[WalletStateToken]' = 'WalletStateResponse'


class TimelineEvent(BaseModel):
    status: "Literal['pending', 'confirmed', 'failed', 'info']" = 'TimelineEvent'
    tx_hash: 'str | None' = None
    receipt_id: 'str | None' = None
    venue: 'str | None' = None
    execution_path: 'str | None' = None
    policy_hash: 'str | None' = None
    details: 'str | None' = None
    meta: 'dict[str, Any] | None' = None


class TimelineResponse(BaseModel):
    count: 'int' = 'TimelineResponse'


class ExecutionPreflightResponse(BaseModel):
    impact_bps: 'int' = 'ExecutionPreflightResponse'
    warnings: 'list[str]' = Field(default_factory = list)
    blocking_reasons: 'list[str]' = Field(default_factory = list)
    liquidity_depth_usd: 'float | None' = None


class ManualWalletEventResponse(BaseModel):
    status: 'str' = 'ManualWalletEventResponse'


class WithdrawReadyEntry(BaseModel):
    amount_wei: 'str' = 'WithdrawReadyEntry'
    tx_hash: 'str | None' = None
    title: 'str | None' = None
    status: "Literal['pending', 'confirmed', 'failed', 'info']" = 'info'
    local_key: 'str | None' = None
    has_local_commitment_data: 'bool' = False


class WithdrawReadyRoute(BaseModel):
    can_withdraw_direct: 'bool' = 'WithdrawReadyRoute'
    notes: 'list[str]' = Field(default_factory = list)


class WithdrawReadyResponse(BaseModel):
    entries: 'list[WithdrawReadyEntry]' = 'WithdrawReadyResponse'


class CommitmentLedgerRoute(BaseModel):
    entries: 'list[dict[str, Any]]' = 'CommitmentLedgerRoute'


class CommitmentLedgerResponse(BaseModel):
    routes: 'list[CommitmentLedgerRoute]' = 'CommitmentLedgerResponse'


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _normalize_address(value = None):
    if not value:
        value
    raw = str('').strip().lower()
    if not raw:
        return ''
    without_prefix = raw[2:] if raw.startswith('0x') else raw
    stripped = without_prefix.lstrip('0')
    if not stripped:
        stripped
    return f'''0x{'0'}'''


def _parse_int(value = None, field_name = None):
    parsed = int(str(value))
    if parsed <= 0:
        raise HTTPException(status_code = 400, detail = f'''{field_name} must be positive''')
    return parsed
# WARNING: Decompyle incomplete


def _safe_float(value = None, fallback = None):
    return float(value)
# WARNING: Decompyle incomplete


def _format_units(amount_raw = None, decimals = None):
    pass
# WARNING: Decompyle incomplete


def _load_local_commitments():
    if not LOCAL_COMMITMENTS_FILE.exists():
        return { }
    payload = json.loads(LOCAL_COMMITMENTS_FILE.read_text(encoding = 'utf-8'))
    if isinstance(payload, dict):
        return payload
    return { }
# WARNING: Decompyle incomplete


def _save_local_commitments(payload = None):
    LOCAL_COMMITMENTS_FILE.parent.mkdir(parents = True, exist_ok = True)
    LOCAL_COMMITMENTS_FILE.write_text(json.dumps(payload, indent = 2, sort_keys = True), encoding = 'utf-8')


def _resolve_import_user(payload = None, address = None):
    direct = payload.get(address)
    if isinstance(direct, dict):
        return (address, direct)
    for key, value in None.items():
        if not _normalize_address(str(key)) == address:
            continue
        if not isinstance(value, dict):
            continue
        
        return None.items(), (str(key), value)
    return (None, None)


def _merge_commitment_rows(existing_rows = None, incoming_rows = None):
    pass
# WARNING: Decompyle incomplete


def _merge_commitment_payloads(existing = None, incoming = None):
    merged = { }
# WARNING: Decompyle incomplete


def _status_from_text(value = None):
    if not value:
        value
    normalized = ''.strip().lower()
    if normalized in frozenset({'ok', 'pass', 'success', 'executed', 'confirmed'}):
        return 'confirmed'
    if normalized in frozenset({'error', 'failed', 'reject', 'blocked', 'rejected'}):
        return 'failed'
    if normalized in frozenset({'queued', 'pending', 'proposed'}):
        return 'pending'
    return 'info'


def _parse_timestamp(raw = None):
    if not raw:
        raw
    text = str('').strip()
    if not text:
        return datetime.fromtimestamp(0, tz = timezone.utc)
    normalized = None.replace('Z', '+00:00')
    parsed = datetime.fromisoformat(normalized)
# WARNING: Decompyle incomplete


def _route_from_hint(value = None):
    if not value:
        value
    raw = str('').strip().lower()
    if not raw:
        return 'unknown'
    if 'full_privacy' in raw and 'fullprivacy' in raw and 'pool_c' in raw or 'poolc' in raw:
        return 'full_privacy_pool'
    if 'shielded' in raw and 'stealth' in raw or 'unlinkable' in raw:
        return 'shielded_pool'
    if 'hashed' in raw and 'pool_d' in raw and 'poold' in raw or 'claim' in raw:
        return 'hashed_withdraw_pool'
    if 'internal_ledger' in raw:
        return 'internal_ledger'
    return raw


def _route_label(path = None):
    if not path:
        path
    key = str('').strip().lower()
    if key == 'full_privacy_pool':
        return 'Full Privacy'
    if key == 'shielded_pool':
        return 'Shielded'
    if key == 'hashed_withdraw_pool':
        return 'Hashed Claims'
    if key == 'internal_ledger':
        return 'Internal Ledger'
    if key:
        return key.replace('_', ' ').title()


def _extract_amount_wei(row = None):
    pass
# WARNING: Decompyle incomplete


async def _starknet_call(contract = None, selector = None, calldata = None):
    pass
# WARNING: Decompyle incomplete


def _parse_u256(result = None):
    if isinstance(result, list) or len(result) < 2:
        return None
    low = int(result[0], 16) if result[0].startswith('0x') else int(result[0])
    high = int(result[1], 16) if result[1].startswith('0x') else int(result[1])
    return low + (high << 128)
# WARNING: Decompyle incomplete

history_timeline = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
state_withdraw_ready = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
state_commitment_ledger = (lambda user_address = None: pass# WARNING: Decompyle incomplete
)()
wallet_state = (lambda user_address = None, token = None: pass# WARNING: Decompyle incomplete
)()
execution_preflight = (lambda data = None: pass# WARNING: Decompyle incomplete
)()
migrate_local_commitments = (lambda data = None: pass# WARNING: Decompyle incomplete
)()
state_manual_wallet_event = (lambda data = None: pass# WARNING: Decompyle incomplete
)()
