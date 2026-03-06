# Source Generated with Decompyle++
# File: ekubo_execution_service.cpython-312.pyc (Python 3.12)

'''
Ekubo execution: build swap calldata (Router) for vault/orchestration; optional live submit.
Uses ekubo_config + ekubo_client; same logic as dex swap-calldata.
On-chain pool discovery: when Ekubo API fails, call Ekubo Core get_pool_price via RPC
(PoolKey: token0, token1, fee, tick_spacing, extension) to find an initialized pool.
'''
import logging
import os
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, localcontext
from typing import Any
import httpx
from app.services.ekubo_config import EKUBO_CORE_SEPOLIA, EKUBO_ROUTER_SEPOLIA, SEPOLIA_ETH, SEPOLIA_STRK, SEPOLIA_USDC, get_ekubo_chain_id
from app.services.ekubo_client import get_pair_pools, get_pair_positions
logger = logging.getLogger(__name__)
STARKNET_RPC_URL = os.getenv('STARKNET_RPC_URL', 'https://starknet-sepolia-rpc.publicnode.com')
GET_POOL_PRICE_SELECTOR = 0x63ECB4395E589622A41A66715A0EAC930ABC9F0B92C0B1DCDA630ADFB2BF2D
ROUTER_QUOTE_SWAP_SELECTOR = 0x2904B7C28F3FD4556D8AA4F93483EA2077DD95E61C54DB86C2EA5FC1F3FFD54
_POOL_DISCOVERY_COMBOS: list[tuple[(float, int)]] = [
    (0.0005, 1000),
    (0.003, 60),
    (0.01, 60)]
_STRATEGY_PAIR: dict[(str, tuple[(str, str)])] = {
    'ekubo_eth_usdc': (SEPOLIA_USDC, SEPOLIA_ETH),
    'ekubo_strk_usdc': (SEPOLIA_USDC, SEPOLIA_STRK),
    'ekubo_strk_to_usdc': (SEPOLIA_STRK, SEPOLIA_USDC) }
_MULTIHOP_INTERMEDIATES: tuple[(str, ...)] = (SEPOLIA_ETH, SEPOLIA_USDC, SEPOLIA_STRK)
_TWO_128 = 2 ** 128

def _decimal_to_u128_fraction(fraction = None):
    if fraction <= 0:
        return 0
# WARNING: Decompyle incomplete


def _u128_from_float_fraction(fraction = None):
    if fraction <= 0:
        return 0
    return int(fraction * _TWO_128)


def _fee_candidates_from_raw(fee_raw = None):
    '''
    Return candidate u128 fee values. We intentionally include:
    - precise decimal conversion
    - float-derived conversion (historically used in this codebase)
    to maximize compatibility with existing Sepolia pool keys.
    '''
    pass
# WARNING: Decompyle incomplete


def _sorted_pair_tokens(token_a = None, token_b = None):
    if int(token_a, 16) < int(token_b, 16):
        return (token_a, token_b)
    return (None, token_a)
# WARNING: Decompyle incomplete


def _fee_to_u128(fee_raw = None):
    """
    Normalize fee into Ekubo's 0.128 fixed-point u128.
    Accepts:
    - hex/decimal u128 strings
    - decimal fractions (e.g. 0.003)
    - percentages (e.g. 0.3 -> 0.3%)
    - common fee tiers (500/3000/10000)
    """
    default_fee = _decimal_to_u128_fraction(Decimal('0.003'))
# WARNING: Decompyle incomplete


def _felt_to_hex(value = None):
    '''Normalize address/felt for starknet_call calldata (hex string).'''
    if isinstance(value, str):
        v = int(value, 16) if value.startswith('0x') else int(value)
        return hex(v)
    v = None(value)
    return hex(v)


def _pool_key_calldata_hex(token0 = None, token1 = None, fee_u128 = None, tick_spacing = ('0',), extension = ('token0', str, 'token1', str, 'fee_u128', int, 'tick_spacing', int, 'extension', str | int, 'return', list[str])):
    '''Build calldata for Core get_pool_price(pool_key). PoolKey: token0, token1, fee, tick_spacing, extension (5 felts).'''
    if isinstance(extension, str) and extension.startswith('0x'):
        pass
    elif isinstance(extension, str):
        pass
    
    ext = int(extension)
    return [
        _felt_to_hex(token0),
        _felt_to_hex(token1),
        _felt_to_hex(fee_u128),
        _felt_to_hex(tick_spacing),
        _felt_to_hex(ext)]


def _parse_felt(x = None):
    '''Parse felt from RPC result (hex or decimal string, or int).'''
    if isinstance(x, int):
        return x
    s = None(x).strip()
    if s.startswith('0x'):
        return int(s, 16)
    return None(s)


def _parse_int_any(x = None, default = None):
    if isinstance(x, int):
        return x
    if None(x, str):
        s = x.strip()
        if not s:
            return default
        if None.startswith('0x'):
            return int(s, 16)
        return None(s)
    if None(x, float):
        return int(x)
    return None(str(x))
# WARNING: Decompyle incomplete


def _is_negative_i129(mag = None, sign = None):
    if mag != 0:
        mag != 0
    return sign != 0


def _is_pool_initialized(result_felts = None):
    '''
    PoolPrice is sqrt_ratio (u256) + tick (i129). Return can be 4 felts (low, high, tick_mag, sign)
    or 1 packed felt. Non-zero sqrt_ratio means pool is initialized.
    '''
    if not result_felts:
        return False
    if len(result_felts) == 1:
        return _parse_felt(result_felts[0]) != 0
    low = None(result_felts[0])
    high = _parse_felt(result_felts[1])
    if not low != 0:
        low != 0
    return high != 0


async def _call_core_get_pool_price(rpc_url, core_address, token0 = None, token1 = None, fee_u128 = None, tick_spacing = ('0',), extension = ('rpc_url', str, 'core_address', str, 'token0', str, 'token1', str, 'fee_u128', int, 'tick_spacing', int, 'extension', str, 'return', tuple[(bool, list[str])])):
    '''
    Call Ekubo Core get_pool_price(pool_key) via starknet_call.
    Returns (success, result_felts). On revert or RPC error, success=False.
    '''
    pass
# WARNING: Decompyle incomplete


async def _call_router_quote_swap(rpc_url, token0, token1, fee_u128 = None, tick_spacing = None, token_in = None, amount_in_wei = ('0',), extension = ('rpc_url', str, 'token0', str, 'token1', str, 'fee_u128', int, 'tick_spacing', int, 'token_in', str, 'amount_in_wei', int, 'extension', str, 'return', tuple[(bool, list[str], str | None)])):
    pass
# WARNING: Decompyle incomplete


async def quote_swap_output(token_in, token_out, amount_in_wei = None, fee_u128 = None, tick_spacing = None, extension = ('0', None), rpc_url = ('token_in', str, 'token_out', str, 'amount_in_wei', int, 'fee_u128', int, 'tick_spacing', int, 'extension', str, 'rpc_url', str | None, 'return', dict[(str, Any)])):
    '''
    Quote Router.swap for a single pool key and return output amount for token_out.
    Returns {"ok": bool, "amount_out": int, "error": str | None}.
    '''
    pass
# WARNING: Decompyle incomplete


async def quote_multihop_output(route_nodes = None, token_in = None, amount_in_wei = None, rpc_url = (None,)):
    '''
    Sequentially quote a multihop route by chaining quote_swap_output per node.
    Returns {"ok", "amount_out", "route", "error"}.
    '''
    pass
# WARNING: Decompyle incomplete


async def discover_pool_on_chain(token_in = None, token_out = None, amount_in_wei = None, rpc_url = (None, None)):
    '''
    Discover an initialized Ekubo pool for (token_in, token_out) by calling Core get_pool_price
    for a set of (fee, tick_spacing) combos. token0 < token1 by integer value.
    Returns {"token0","token1","fee_u128","tick_spacing","extension","amount_out"} or None.
    '''
    pass
# WARNING: Decompyle incomplete


async def discover_pool_from_positions(chain_id = None, token_in = None, token_out = None, amount_in_wei = ('chain_id', str, 'token_in', str, 'token_out', str, 'amount_in_wei', int, 'return', dict[(str, Any)] | None)):
    '''
    Discover viable pool params from pair top-positions endpoint, then verify executable output
    with on-chain Router.quote_swap for the requested amount.
    '''
    pass
# WARNING: Decompyle incomplete


def _sorted_pool_candidates(top_pools = None):
    return sorted(top_pools, key = (lambda p: if not p.get('tvl0_total', 0):
p.get('tvl0_total', 0)if not p.get('tvl1_total', 0):
p.get('tvl1_total', 0)float(0) + float(0)), reverse = True)


def _calc_min_out(expected_out = None, slippage_bps = None):
    pass
# WARNING: Decompyle incomplete


def _build_swap_calldata_with_pool_params(token_in, token_out, amount_in_wei, fee_u128, tick_spacing = None, extension = None, expected_out = None, route = ('0', None, None, 50), slippage_bps = ('token_in', str, 'token_out', str, 'amount_in_wei', int, 'fee_u128', int, 'tick_spacing', int, 'extension', str, 'expected_out', int | None, 'route', list[str] | None, 'slippage_bps', int, 'return', dict[(str, Any)])):
    '''Build Router.swap calldata using given pool params (from API or on-chain discovery).'''
    to = token_out
    ti = token_in
    t0 = ti if int(ti, 16) < int(to, 16) else to
    t1 = to if t0 == ti else ti
    (sqrt_low, sqrt_high, skip_ahead) = (0, 0, 0)
    min_out_wei = _calc_min_out(expected_out, slippage_bps)
    if amount_in_wei < 0:
        amount_in_wei = 0
    calldata = [
        t0,
        t1,
        str(fee_u128),
        str(tick_spacing),
        extension,
        str(sqrt_low),
        str(sqrt_high),
        str(skip_ahead),
        token_in,
        str(amount_in_wei),
        '0']
    if not route:
        route
    result = {
        'contract_address': EKUBO_ROUTER_SEPOLIA,
        'entrypoint': 'swap',
        'calldata': calldata,
        'error': None,
        'route': [
            token_in,
            token_out] }
# WARNING: Decompyle incomplete


def _build_multihop_calldata(token_in, amount_in_wei = None, route_nodes = None, route_tokens = None, expected_out = (50,), slippage_bps = ('token_in', str, 'amount_in_wei', int, 'route_nodes', list[dict[(str, Any)]], 'route_tokens', list[str], 'expected_out', int, 'slippage_bps', int, 'return', dict[(str, Any)])):
    min_out_wei = _calc_min_out(expected_out, slippage_bps)
    if amount_in_wei < 0:
        amount_in_wei = 0
    calldata = [
        str(len(route_nodes))]
    for node in route_nodes:
        token0 = str(node['token0'])
        token1 = str(node['token1'])
        if not node.get('extension'):
            node.get('extension')
        calldata.extend([
            token0,
            token1,
            str(int(node['fee_u128'])),
            str(int(node['tick_spacing'])),
            str('0'),
            '0',
            '0',
            '0'])
    calldata.extend([
        token_in,
        str(amount_in_wei),
        '0'])
    return {
        'contract_address': EKUBO_ROUTER_SEPOLIA,
        'entrypoint': 'multihop_swap',
        'calldata': calldata,
        'error': None,
        'route': route_tokens,
        'expected_out': str(expected_out),
        'min_out': str(min_out_wei) }


async def _discover_multihop_route(chain_id = None, token_in = None, token_out = None, amount_in_wei = ('chain_id', str, 'token_in', str, 'token_out', str, 'amount_in_wei', int, 'return', dict[(str, Any)] | None)):
    pass
# WARNING: Decompyle incomplete


async def build_swap_calldata(chain_id = None, token_in = None, token_out = None, amount_in_wei = (50,), slippage_bps = ('chain_id', str, 'token_in', str, 'token_out', str, 'amount_in_wei', int, 'slippage_bps', int, 'return', dict[(str, Any)])):
    '''
    Build Router.swap calldata for Ekubo Sepolia.
    Returns { "contract_address", "entrypoint", "calldata" } for frontend to sign, or for executor to submit.
    '''
    pass
# WARNING: Decompyle incomplete


def strategy_to_pair(strategy = None):
    '''Return (token_in, token_out) for a strategy id, or None.'''
    if not strategy:
        strategy
    return _STRATEGY_PAIR.get(''.strip().lower())


def _build_swap_calldata_fallback(token_in = None, token_out = None, amount_in_wei = None):
    '''
    Build Router.swap calldata using fixed Sepolia pool params when Ekubo API is unavailable.
    Uses 0.05% fee, tick_spacing 1000 (mainnet-style). If you get NOT_INITIALIZED on-chain,
    no such pool exists on Sepolia yet; use Ekubo UI to confirm which pools are live.
    '''
    to = token_out
    ti = token_in
    t0 = ti if int(ti, 16) < int(to, 16) else to
    t1 = to if t0 == ti else ti
    fee_u128 = _decimal_to_u128_fraction(Decimal('0.0005'))
    tick_spacing = 1000
    extension = '0'
    (sqrt_low, sqrt_high, skip_ahead) = (0, 0, 0)
    if amount_in_wei < 0:
        amount_in_wei = 0
    calldata = [
        t0,
        t1,
        str(fee_u128),
        str(tick_spacing),
        extension,
        str(sqrt_low),
        str(sqrt_high),
        str(skip_ahead),
        token_in,
        str(amount_in_wei),
        '0']
    return {
        'contract_address': EKUBO_ROUTER_SEPOLIA,
        'entrypoint': 'swap',
        'calldata': calldata,
        'error': None }
# WARNING: Decompyle incomplete


async def build_calldata_for_allocation(strategy = None, amount_in_wei = None, chain_id = None):
    '''
    Build swap calldata for one allocation (strategy + amount in wei).
    Uses Ekubo API first. When API fails (e.g. 500 for Sepolia), runs on-chain pool discovery
    via Ekubo Core get_pool_price; if an initialized pool is found, returns swap calldata with
    that pool. Otherwise returns error and suggests app.ekubo.org.
    '''
    pass
# WARNING: Decompyle incomplete


async def submit_swap(contract_address = None, entrypoint = None, calldata = None):
    '''
    Submit a swap via ContractExecutor when EXECUTOR_LIVE_SUBMIT and account are set.
    Returns tx hash or None (e.g. not configured or invoke failed).
    '''
    pass
# WARNING: Decompyle incomplete


async def build_lp_add_calldata(chain_id, owner, token0, token1, amount0_wei, amount1_wei = None, fee_tier = None, lower_tick = None, upper_tick = (None, None, None), risk_profile = ('chain_id', str, 'owner', str, 'token0', str, 'token1', str, 'amount0_wei', int, 'amount1_wei', int, 'fee_tier', int, 'lower_tick', int | None, 'upper_tick', int | None, 'risk_profile', str | None, 'return', dict[(str, Any)])):
    '''
    Build Ekubo LP add-liquidity calldata via ekubo_lp_service.
    Returns approvals + calls compatible with frontend wallet execute.
    '''
    pass
# WARNING: Decompyle incomplete


async def build_lp_remove_calldata(owner = None, position_id = None, liquidity_bps = None):
    '''Build Ekubo LP remove-liquidity calldata via ekubo_lp_service.'''
    pass
# WARNING: Decompyle incomplete

