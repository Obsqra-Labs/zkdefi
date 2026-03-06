# Source Generated with Decompyle++
# File: ekubo.cpython-312.pyc (Python 3.12)

'''Canonical Ekubo routes for swap + LP operations.'''
from __future__ import annotations
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from fastapi import APIRouter, HTTPException, Query
import httpx
from pydantic import BaseModel, Field
from starknet_py.hash.selector import get_selector_from_name
from app.services.contract_executor import ContractExecutor
from app.services.ekubo_config import EKUBO_CORE_SEPOLIA, EKUBO_POSITIONS_SEPOLIA, EKUBO_ROUTER_SEPOLIA, SEPOLIA_FUSDC, SEPOLIA_STRK, SEPOLIA_USDC, SEPOLIA_ETH, get_ekubo_chain_id
from app.services.ekubo_execution_service import build_swap_calldata
from app.services.ekubo_lp_service import build_collect_fees, build_lp_add, build_lp_remove, import_onchain_positions, list_positions, preview_lp_position, purge_stale_positions, sync_onchain_balance, update_position_status, verify_tx_and_extract_nft_id
from app.services.receipt_service import get_receipt_service
router = APIRouter(prefix = '/ekubo', tags = [
    'ekubo'])
logger = logging.getLogger(__name__)
STARKNET_RPC_URL = os.getenv('STARKNET_RPC_URL', 'https://starknet-sepolia-rpc.publicnode.com')
BALANCE_OF_SELECTORS: 'tuple[str, ...]' = ('0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', hex(get_selector_from_name('balance_of')))
_TOKEN_DECIMALS: 'dict[str, int]' = {
    '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d': 18,
    '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7': 18,
    '0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080': 6,
    '0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23': 6 }
_TOKEN_SYMBOLS: 'dict[str, str]' = {
    '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d': 'STRK',
    '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7': 'ETH',
    '0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080': 'USDC',
    '0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23': 'fUSDC' }
ExecutionMode = Literal[('wallet', 'orchestrated')]
ExecutionModeRequest = Literal[('wallet', 'orchestrated', 'auto')]
RiskProfile = Literal[('conservative', 'neutral', 'aggressive')]

class SwapQuoteRequest(BaseModel):
    amount_in: 'str' = 'SwapQuoteRequest'
    slippage_bps: 'int' = Field(default = 9500, ge = 0, le = 10000)
    taker_address: 'str | None' = None


class SwapQuoteResponse(BaseModel):
    expires_at: 'str' = 'SwapQuoteResponse'
    warnings: 'list[str]' = Field(default_factory = list)


class ContractCall(BaseModel):
    calldata: 'list[str]' = 'ContractCall'


class ApprovalCall(BaseModel):
    amount: 'str' = 'ApprovalCall'


class BuildTxResponse(BaseModel):
    calls: 'list[ContractCall]' = 'BuildTxResponse'
    receipt_id: 'str | None' = None
    warnings: 'list[str]' = Field(default_factory = list)


class SwapBuildRequest(BaseModel):
    amount_in: 'str' = 'SwapBuildRequest'
    slippage_bps: 'int' = Field(default = 9500, ge = 0, le = 10000)
    taker_address: 'str | None' = None
    user_address: 'str | None' = None
    execution_mode: 'ExecutionModeRequest' = 'auto'
    wallet_connected: 'bool' = False


class LpPreviewRequest(BaseModel):
    fee_tier: 'int' = 'LpPreviewRequest'
    lower_tick: 'int | None' = None
    upper_tick: 'int | None' = None
    risk_profile: 'RiskProfile | None' = None


class LpPreviewResponse(BaseModel):
    upper_tick: 'int' = 'LpPreviewResponse'
    current_tick: 'int | None' = None
    single_sided_expected: 'bool' = False
    warnings: 'list[str]' = 'none'


class LpBuildRequest(BaseModel):
    fee_tier: 'int' = 'LpBuildRequest'
    lower_tick: 'int | None' = None
    upper_tick: 'int | None' = None
    risk_profile: 'RiskProfile | None' = None
    owner: 'str | None' = None
    execution_mode: 'ExecutionModeRequest' = 'auto'
    wallet_connected: 'bool' = False


class LpBuildResponse(BuildTxResponse):
    position_id: 'str | None' = None
    warnings: 'list[str]' = Field(default_factory = list)


class LpRemoveBuildRequest(BaseModel):
    position_id: 'str' = 'LpRemoveBuildRequest'
    liquidity_bps: 'int' = Field(default = 10000, ge = 1, le = 10000)
    execution_mode: 'ExecutionModeRequest' = 'auto'
    wallet_connected: 'bool' = False


class PositionsResponse(BaseModel):
    count: 'int' = 'PositionsResponse'


def _fallback_swap_quote(token_in = None, token_out = None, amount_in = None, slippage_bps = ('token_in', 'str', 'token_out', 'str', 'amount_in', 'int', 'slippage_bps', 'int', 'return', 'SwapQuoteResponse')):
    expected_out = max(1, int(amount_in * 0.995))
    min_out = int(expected_out * (1 - slippage_bps / 10000))
    amount_norm = amount_in / 1e+18
    price_impact_bps = int(min(2500, max(25, amount_norm * 10)))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds = 20)).isoformat()
    return SwapQuoteResponse(expected_out = str(expected_out), min_out = str(max(0, min_out)), price_impact_bps = price_impact_bps, route = [
        token_in,
        EKUBO_ROUTER_SEPOLIA,
        token_out], expires_at = expires_at)


def _normalize_hex_addr(value = None):
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


def _token_decimals(token_addr = None):
    return _TOKEN_DECIMALS.get(_normalize_hex_addr(token_addr), 18)


def _token_symbol(token_addr = None):
    return _TOKEN_SYMBOLS.get(_normalize_hex_addr(token_addr), 'token')


def _format_units(amount_raw = None, decimals = None):
    if amount_raw <= 0:
        return '0'
    whole = amount_raw // 10 ** decimals
    frac = amount_raw % 10 ** decimals
    if decimals == 0:
        return str(whole)
    frac_text = None(frac).rjust(decimals, '0').rstrip('0')
    if frac_text:
        return f'''{whole}.{frac_text}'''
    return None(whole)


async def _read_erc20_balance(token_address = None, owner = None):
    pass
# WARNING: Decompyle incomplete


def _amount_to_units(amount_raw = None, decimals = None):
    if amount_raw <= 0:
        return 0
    return float(amount_raw) / float(10 ** max(0, decimals))


def _swap_quote_sanity_warning(token_in = None, token_out = None, amount_in = None, expected_out = ('token_in', 'str', 'token_out', 'str', 'amount_in', 'int', 'expected_out', 'int', 'return', 'str | None')):
    '''
    Return a human-readable sanity error for obviously unhealthy rates.
    This protects manual users from draining into near-zero output testnet routes.
    '''
    in_addr = _normalize_hex_addr(token_in)
    out_addr = _normalize_hex_addr(token_out)
    strk = _normalize_hex_addr('0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d')
    eth = _normalize_hex_addr('0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7')
    usdc = _normalize_hex_addr(SEPOLIA_USDC)
    fusdc = _normalize_hex_addr(SEPOLIA_FUSDC)
    stable_like = {
        usdc,
        fusdc}
    min_usdc_out = float(os.getenv('SWAP_MIN_USDC_OUT', '0.1'))
    min_eth_usdc_rate = float(os.getenv('SWAP_MIN_ETH_USDC_RATE', '100'))
    max_eth_usdc_rate = float(os.getenv('SWAP_MAX_ETH_USDC_RATE', '100000'))
    min_strk_usdc_rate = float(os.getenv('SWAP_MIN_STRK_USDC_RATE', '0.05'))
    max_strk_usdc_rate = float(os.getenv('SWAP_MAX_STRK_USDC_RATE', '1000'))
    if in_addr in {
        strk,
        eth} and out_addr in stable_like:
        amount_in_units = _amount_to_units(amount_in, 18)
        amount_out_units = _amount_to_units(expected_out, 6)
        if amount_out_units < min_usdc_out:
            return f'''Liquidity warning: expected output is about ${amount_out_units:.6f} {_token_symbol(out_addr)}, below the ${min_usdc_out:.6f} threshold.'''
        if None <= 0:
            return 'Liquidity warning: invalid input amount.'
        implied_usdc_per_token = amount_out_units / amount_in_units
        if in_addr == eth and implied_usdc_per_token < min_eth_usdc_rate:
            return f'''Liquidity warning: implied ETH rate is about ${implied_usdc_per_token:.4f} per ETH, below floor ${min_eth_usdc_rate:.4f}.'''
        if None == strk and implied_usdc_per_token < min_strk_usdc_rate:
            return f'''Liquidity warning: implied STRK rate is about ${implied_usdc_per_token:.6f} per STRK, below floor ${min_strk_usdc_rate:.6f}.'''
        if None in stable_like and out_addr in {
            eth,
            strk}:
            amount_in_units = _amount_to_units(amount_in, 6)
            amount_out_units = _amount_to_units(expected_out, 18)
            if amount_out_units <= 0:
                return 'Liquidity warning: expected output is zero for this route.'
            implied_usdc_per_token = amount_in_units / amount_out_units
            if out_addr == eth:
                if implied_usdc_per_token < min_eth_usdc_rate or implied_usdc_per_token > max_eth_usdc_rate:
                    return f'''Liquidity warning: implied ETH rate is about ${implied_usdc_per_token:.4f} per ETH, outside band ${min_eth_usdc_rate:.4f}-${max_eth_usdc_rate:.4f}.'''
                if None == strk:
                    if implied_usdc_per_token < min_strk_usdc_rate or implied_usdc_per_token > max_strk_usdc_rate:
                        return f'''Liquidity warning: implied STRK rate is about ${implied_usdc_per_token:.6f} per STRK, outside band ${min_strk_usdc_rate:.6f}-${max_strk_usdc_rate:.6f}.'''

ekubo_capabilities = (lambda : pass# WARNING: Decompyle incomplete
)()
ekubo_positions = (lambda owner = None: pass# WARNING: Decompyle incomplete
)()
ekubo_swap_quote = (lambda body = None: pass# WARNING: Decompyle incomplete
)()
ekubo_swap_build = (lambda body = None: pass# WARNING: Decompyle incomplete
)()
ekubo_lp_preview = (lambda body = None: pass# WARNING: Decompyle incomplete
)()
ekubo_lp_add_build = (lambda body = None: pass# WARNING: Decompyle incomplete
)()
ekubo_lp_remove_build = (lambda body = None: pass# WARNING: Decompyle incomplete
)()

class PositionStatusUpdateRequest(BaseModel):
    position_id: 'str' = 'PositionStatusUpdateRequest'
    status: 'str' = 'active'
    tx_hash: 'str | None' = None
    ekubo_nft_id: 'int | None' = None

ekubo_lp_status_update = (lambda body = None: pass# WARNING: Decompyle incomplete
)()
ekubo_lp_sync = (lambda owner = None: pass# WARNING: Decompyle incomplete
)()
ekubo_lp_purge_stale = (lambda owner = None, max_age_hours = None: pass# WARNING: Decompyle incomplete
)()
ekubo_lp_verify_tx = (lambda tx_hash = None, owner = None, position_id = router.post('/lp/verify-tx'): pass# WARNING: Decompyle incomplete
)()
ekubo_lp_import_onchain = (lambda owner = None: pass# WARNING: Decompyle incomplete
)()
ekubo_lp_collect_fees_build = (lambda owner = None, position_id = None: pass# WARNING: Decompyle incomplete
)()

def _require_chain_id():
    chain_id = get_ekubo_chain_id()
    if not chain_id:
        raise HTTPException(status_code = 503, detail = 'EKUBO_CHAIN_ID not configured.')
    return str(chain_id).strip()


def _parse_positive_int(raw = None, field_name = None):
    value = int(raw)
    if value <= 0:
        raise HTTPException(status_code = 400, detail = f'''{field_name} must be positive.''')
    return value
# WARNING: Decompyle incomplete


def _parse_non_negative_int(raw = None, field_name = None):
    value = int(raw)
    if value < 0:
        raise HTTPException(status_code = 400, detail = f'''{field_name} must be non-negative.''')
    return value
# WARNING: Decompyle incomplete


def _resolve_execution_mode(mode = None, wallet_connected = None):
    if mode == 'wallet':
        return 'wallet'
    if mode == 'orchestrated':
        return 'orchestrated'
    if wallet_connected:
        return 'wallet'


def _lp_enabled():
    return os.getenv('EKUBO_LP_ENABLED', 'true').strip().lower() == 'true'


def _market_surface_enabled():
    return os.getenv('EKUBO_MARKET_SURFACE_ENABLED', 'true').strip().lower() == 'true'


class LpRecommendationRequest(BaseModel):
    user_address: 'str' = 'LpRecommendationRequest'
    risk_profile: "Literal['conservative', 'neutral', 'aggressive']" = 'neutral'


class LpRecommendationPool(BaseModel):
    reasoning: 'str' = 'LpRecommendationPool'


class LpRecommendationResponse(BaseModel):
    generated_at: 'str' = 'LpRecommendationResponse'
    source: 'str' = 'deterministic_engine'
    model: 'str | None' = None

ekubo_lp_recommend = (lambda body = None: pass# WARNING: Decompyle incomplete
)()
