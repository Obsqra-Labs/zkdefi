"""
Ekubo Contract Executor – Starknet Sepolia on-chain LP management.

IPositions ABI (fetched from 0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5):
  mint_and_deposit(pool_key: PoolKey, bounds: Bounds, min_liquidity: u128)
  collect_fees(id: u64, pool_key: PoolKey, bounds: Bounds)
  withdraw(id: u64, pool_key: PoolKey, bounds: Bounds, liquidity: u128,
           min_token0: u128, min_token1: u128, collect_fees: bool)
  get_token_info(id: u64, pool_key: PoolKey, bounds: Bounds)

PoolKey  = { token0, token1, fee: u128, tick_spacing: u128, extension: ContractAddress }
Bounds   = { lower: i129, upper: i129 }
i129     = { mag: u128, sign: bool }   (sign=False → positive, sign=True → negative)

Fee tier encoding: fee = fraction_of_100pct * 2^128
  FEE_01PCT  = 0.0001 * 2^128
  FEE_05PCT  = 0.0005 * 2^128
  FEE_30PCT  = 0.0030 * 2^128
  FEE_100PCT = 0.0100 * 2^128
"""

import logging
import math
import os
from typing import Dict, Optional

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models import StarknetChainId
from starknet_py.contract import Contract
from starknet_py.hash.selector import get_selector_from_name

logger = logging.getLogger(__name__)

# ── Cached contract instances (avoid re-fetching ABI on every call) ──────────
_contract_cache: dict[str, Contract] = {}

async def _get_positions_contract(rpc_url: str) -> Contract:
    """Return a cached Contract instance for the Ekubo Positions contract."""
    cache_key = f"positions:{rpc_url}"
    if cache_key not in _contract_cache:
        client = FullNodeClient(node_url=rpc_url)
        _contract_cache[cache_key] = await Contract.from_address(
            address=int(EKUBO_POSITIONS, 16), provider=client,
            proxy_config=False,
        )
    return _contract_cache[cache_key]

# ── Contract addresses ──────────────────────────────────────────────────────
EKUBO_CORE      = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_POSITIONS = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"

# Token addresses on Sepolia (canonical, matching ekubo_config.py)
ETH  = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
# Fake USDC with deeper Sepolia liquidity (from ekubo_config.py)
FUSDC = "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23"

# ── Ekubo fee tiers: fee = percentage_fraction * 2^128 ───────────────────────
_TWO128 = 1 << 128
FEE_01PCT  = int(0.0001 * _TWO128)   # 0.01 %  tick_spacing=200
FEE_05PCT  = int(0.0005 * _TWO128)   # 0.05 %  tick_spacing=200
FEE_30PCT  = int(0.003  * _TWO128)   # 0.30 %  tick_spacing=1000
FEE_100PCT = int(0.01   * _TWO128)   # 1.00 %  tick_spacing=5000

# Sepolia USDC v2 (alternative address used by some positions)
USDC_V2 = "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080"

# Pair table: token0 < token1 by address (Ekubo convention)
# NOTE: token0 must be numerically smaller than token1
_PAIR_DEFAULTS: dict[str, dict] = {
    "STRK/ETH":      {"token0": STRK, "token1": ETH,     "fee": FEE_30PCT,  "tick_spacing": 1000},
    "STRK/ETH_005":  {"token0": STRK, "token1": ETH,     "fee": FEE_05PCT,  "tick_spacing": 200},
    "STRK/ETH_100":  {"token0": STRK, "token1": ETH,     "fee": FEE_100PCT, "tick_spacing": 5000},
    "STRK/USDC_V2":  {"token0": STRK, "token1": USDC_V2, "fee": FEE_30PCT,  "tick_spacing": 1000},
    "STRK/FUSDC":    {"token0": STRK, "token1": FUSDC,   "fee": FEE_30PCT,  "tick_spacing": 1000},
    "ETH/USDC":      {"token0": ETH,  "token1": USDC,    "fee": FEE_05PCT,  "tick_spacing": 200},
    "ETH/USDC_V2":   {"token0": ETH,  "token1": USDC_V2, "fee": FEE_05PCT,  "tick_spacing": 200},
    "STRK/USDC":     {"token0": STRK, "token1": USDC,    "fee": FEE_30PCT,  "tick_spacing": 1000},
}

# Map raw fee_tier integer (from position JSON) → (on-chain fee, tick_spacing)
_FEE_TIER_MAP: dict[int, tuple[int, int]] = {
    100:  (FEE_01PCT,  200),   # 0.01%
    500:  (FEE_05PCT,  200),   # 0.05%
    3000: (FEE_30PCT,  1000),  # 0.30%
    10000:(FEE_100PCT, 5000),  # 1.00%
}

# Starknet-valid token addresses (exclude L1 bridged)
_STARKNET_TOKENS: set[str] = {
    ETH.lower(), STRK.lower(), USDC.lower(), USDC_V2.lower(), FUSDC.lower(),
    "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",  # USDT
    "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",  # WBTC
    "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3",  # DAI
}

def is_starknet_token(addr: str) -> bool:
    """Return True if addr is a known Starknet (not L1) token address."""
    return addr.strip().lower() in _STARKNET_TOKENS

# ── Tick math helpers ─────────────────────────────────────────────────────────
_LOG10001 = math.log(1.0001)

def price_to_tick(price: float) -> int:
    """Convert a decimal price (token1 per token0) to an Ekubo tick."""
    if price <= 0:
        raise ValueError(f"price must be positive, got {price}")
    return math.floor(math.log(price) / _LOG10001)

def tick_to_price(tick: int) -> float:
    return 1.0001 ** tick

def align_tick(tick: int, tick_spacing: int, *, floor: bool = True) -> int:
    """Round tick to the nearest multiple of tick_spacing."""
    if floor:
        return (tick // tick_spacing) * tick_spacing
    return math.ceil(tick / tick_spacing) * tick_spacing

def _i129(value: int) -> dict:
    """Serialise a signed integer as an Ekubo i129 struct dict."""
    return {"mag": abs(value), "sign": value < 0}


# ── Custom exceptions ─────────────────────────────────────────────────────────
class ExecutorNotConfigured(RuntimeError):
    """Raised when EkuboContractExecutor is called without valid account credentials."""


# ── Main executor ─────────────────────────────────────────────────────────────
class EkuboContractExecutor:
    """Executes LP strategies on Ekubo (Sepolia) via starknet.py RPC calls."""

    def __init__(
        self,
        rpc_url: str | None = None,
        account_address: str | None = None,
        private_key: str | None = None,
    ):
        self.rpc_url = (
            rpc_url
            or os.getenv("EXECUTOR_RPC_URL")
            or os.getenv("STARKNET_RPC_URL_V08")
            or "https://api.cartridge.gg/x/starknet/sepolia"
        )
        self.account_address = (
            account_address
            or os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS")
        )
        self.private_key = (
            private_key
            or os.getenv("EXECUTOR_PRIVATE_KEY")
            or os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY")
        )

    def _is_configured(self) -> bool:
        return bool(self.account_address and self.private_key)

    def _require_configured(self) -> None:
        if not self._is_configured():
            raise ExecutorNotConfigured(
                "EkuboContractExecutor requires EXECUTOR_PRIVATE_KEY and "
                "FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS (or equivalent env vars)."
            )

    def _get_account(self):
        from starknet_py.net.account.account import Account
        from starknet_py.net.signer.stark_curve_signer import KeyPair
        from starknet_py.net.models.typed_data import ResourceBoundsMapping as _RBM  # noqa: F401

        client = FullNodeClient(node_url=self.rpc_url)
        pk = self.private_key  # type: ignore[assignment]
        addr = self.account_address  # type: ignore[assignment]
        key_int  = int(pk, 16)   if pk.startswith("0x")   else int(pk)
        addr_int = int(addr, 16) if addr.startswith("0x") else int(addr)
        account = Account(
            address=addr_int,
            client=client,
            key_pair=KeyPair.from_private_key(key_int),
            chain=StarknetChainId.SEPOLIA,
        )
        account._cairo_version = 1   # avoid pending-block get_class_at
        return account

    async def _execute(self, account, calls: list) -> str:
        """Submit a multicall with automatic fee estimation (v3 resource bounds)."""
        from starknet_py.net.client_models import ResourceBoundsMapping as _RBM

        nonce = await account.get_nonce(block_number="latest")
        draft = await account._prepare_invoke_v3(
            calls, resource_bounds=_RBM.init_with_zeros(), nonce=nonce
        )
        estimated = await account.estimate_fee(draft, block_number="latest")
        rbm = estimated.to_resource_bounds()
        resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
        await account.client.wait_for_tx(resp.transaction_hash)
        return hex(resp.transaction_hash)

    # ── Public API ─────────────────────────────────────────────────────────────

    async def connect(self) -> bool:
        """Verify the RPC node is reachable."""
        try:
            client = FullNodeClient(node_url=self.rpc_url)
            block = await client.get_block_number()
            logger.info("Connected to Sepolia RPC at block %d", block)
            return True
        except Exception as exc:
            logger.error("RPC connect failed (%s): %s", self.rpc_url, exc)
            return False

    def get_pair_info(self, pair: str) -> dict:
        """Return PoolKey components for a known pair string."""
        info = _PAIR_DEFAULTS.get(pair)
        if info is None:
            raise ValueError(f"Unknown pair '{pair}'. Known: {list(_PAIR_DEFAULTS)}")
        return dict(info)

    async def create_lp_position(
        self,
        pair: str,
        amount0_human: float,
        amount1_human: float,
        lower_price: Optional[float] = None,
        upper_price: Optional[float] = None,
        lower_tick:  Optional[int]   = None,
        upper_tick:  Optional[int]   = None,
        decimals0: int = 18,
        decimals1: int = 18,
        min_liquidity: int = 0,
    ) -> Dict:
        """
        Create a new Ekubo LP position.

        Tick range can be specified either as prices (lower_price/upper_price)
        or directly as ticks (lower_tick/upper_tick).  Defaults to full range.

        Flow (push model – Ekubo requires tokens transferred IN before deposit):
          1. ERC-20 transfer token0 → Positions contract
          2. ERC-20 transfer token1 → Positions contract
          3. mint_and_deposit_and_clear_both(pool_key, bounds, min_liquidity)
             – deposits available tokens and returns any unused remainder.
        """
        self._require_configured()
        info = self.get_pair_info(pair)

        tick_spacing = info["tick_spacing"]

        # Resolve tick range
        if lower_tick is None:
            if lower_price is not None:
                lower_tick = align_tick(price_to_tick(lower_price), tick_spacing, floor=True)
            else:
                lower_tick = align_tick(-887272, tick_spacing, floor=True)
        if upper_tick is None:
            if upper_price is not None:
                upper_tick = align_tick(price_to_tick(upper_price), tick_spacing, floor=False)
            else:
                upper_tick = align_tick(887272, tick_spacing, floor=False)

        logger.info(
            "create_lp_position %s ticks=[%d, %d] amounts=%s/%s",
            pair, lower_tick, upper_tick, amount0_human, amount1_human,
        )

        amount0_wei = int(amount0_human * 10 ** decimals0)
        amount1_wei = int(amount1_human * 10 ** decimals1)
        positions_int = int(EKUBO_POSITIONS, 16)

        try:
            account = self._get_account()

            # Load contracts (ABI auto-fetched from chain)
            token0_contract = await Contract.from_address(
                address=int(info["token0"], 16), provider=account,
                proxy_config=False,
            )
            token1_contract = await Contract.from_address(
                address=int(info["token1"], 16), provider=account,
                proxy_config=False,
            )
            positions_contract = await Contract.from_address(
                address=positions_int, provider=account,
                proxy_config=False,
            )

            pool_key = {
                "token0":       int(info["token0"], 16),
                "token1":       int(info["token1"], 16),
                "fee":          info["fee"],
                "tick_spacing": tick_spacing,
                "extension":    0,
            }
            bounds = {
                "lower": _i129(lower_tick),
                "upper": _i129(upper_tick),
            }

            calls = []
            # Push model: transfer tokens TO the Positions contract
            if amount0_wei > 0:
                calls.append(
                    token0_contract.functions['transfer'].prepare_call(positions_int, amount0_wei)
                )
            if amount1_wei > 0:
                calls.append(
                    token1_contract.functions['transfer'].prepare_call(positions_int, amount1_wei)
                )
            # mint + deposit + auto-return unused tokens
            calls.append(
                positions_contract.functions['mint_and_deposit_and_clear_both'].prepare_call(
                    pool_key, bounds, min_liquidity
                )
            )

            tx_hash = await self._execute(account, calls)
            logger.info("create_lp_position tx: %s", tx_hash)
            return {
                "success":      True,
                "tx_hash":      tx_hash,
                "pair":         pair,
                "lower_tick":   lower_tick,
                "upper_tick":   upper_tick,
                "amount0_wei":  amount0_wei,
                "amount1_wei":  amount1_wei,
            }

        except ExecutorNotConfigured:
            raise
        except Exception as exc:
            logger.error("create_lp_position failed: %s", exc)
            return {"success": False, "error": str(exc), "tx_hash": None}

    async def collect_fees(
        self,
        position_id: int,
        pair: str,
        lower_tick: int,
        upper_tick: int,
    ) -> Dict:
        """
        Collect accumulated fees from an LP position.

        Calls: collect_fees(id, pool_key, bounds)
        """
        self._require_configured()
        info = self.get_pair_info(pair)
        logger.info("collect_fees position=%s pair=%s", position_id, pair)

        try:
            account = self._get_account()
            positions_contract = await Contract.from_address(
                address=int(EKUBO_POSITIONS, 16), provider=account,
                proxy_config=False,
            )

            pool_key = {
                "token0":       int(info["token0"], 16),
                "token1":       int(info["token1"], 16),
                "fee":          info["fee"],
                "tick_spacing": info["tick_spacing"],
                "extension":    0,
            }
            bounds = {
                "lower": _i129(lower_tick),
                "upper": _i129(upper_tick),
            }

            call = positions_contract.functions['collect_fees'].prepare_call(
                position_id, pool_key, bounds
            )
            tx_hash = await self._execute(account, [call])
            logger.info("collect_fees tx: %s", tx_hash)
            return {"success": True, "tx_hash": tx_hash, "position_id": position_id}

        except ExecutorNotConfigured:
            raise
        except Exception as exc:
            logger.error("collect_fees failed: %s", exc)
            return {"success": False, "position_id": position_id, "error": str(exc)}

    async def remove_liquidity(
        self,
        position_id: int,
        pair: str,
        lower_tick: int,
        upper_tick: int,
        liquidity: int,
        min_token0: int = 0,
        min_token1: int = 0,
        collect_fees_on_withdraw: bool = True,
    ) -> Dict:
        """
        Remove liquidity from an LP position.

        Calls: withdraw(id, pool_key, bounds, liquidity, min_token0, min_token1, collect_fees)
        """
        self._require_configured()
        info = self.get_pair_info(pair)
        logger.info(
            "remove_liquidity position=%s pair=%s liquidity=%s",
            position_id, pair, liquidity,
        )

        try:
            account = self._get_account()
            positions_contract = await Contract.from_address(
                address=int(EKUBO_POSITIONS, 16), provider=account,
                proxy_config=False,
            )

            pool_key = {
                "token0":       int(info["token0"], 16),
                "token1":       int(info["token1"], 16),
                "fee":          info["fee"],
                "tick_spacing": info["tick_spacing"],
                "extension":    0,
            }
            bounds = {
                "lower": _i129(lower_tick),
                "upper": _i129(upper_tick),
            }

            call = positions_contract.functions['withdraw'].prepare_call(
                position_id,
                pool_key,
                bounds,
                liquidity,
                min_token0,
                min_token1,
                collect_fees_on_withdraw,
            )
            tx_hash = await self._execute(account, [call])
            logger.info("remove_liquidity tx: %s", tx_hash)
            return {
                "success":     True,
                "tx_hash":     tx_hash,
                "position_id": position_id,
                "liquidity":   liquidity,
            }

        except ExecutorNotConfigured:
            raise
        except Exception as exc:
            logger.error("remove_liquidity failed: %s", exc)
            return {"success": False, "error": str(exc)}

    async def get_token_info(
        self,
        position_id: int,
        pair: str,
        lower_tick: int,
        upper_tick: int,
    ) -> Dict:
        """
        Read token amounts held in an LP position (view call, no tx needed).

        Calls: get_token_info(id, pool_key, bounds) → (amount0, amount1)
        """
        _U64_MAX = (1 << 64) - 1
        if position_id > _U64_MAX:
            return {"success": False, "position_id": position_id,
                    "error": "position_id exceeds u64 range (not a real Ekubo NFT ID)"}

        info = self.get_pair_info(pair)
        try:
            positions_contract = await _get_positions_contract(self.rpc_url)

            pool_key = {
                "token0":       int(info["token0"], 16),
                "token1":       int(info["token1"], 16),
                "fee":          info["fee"],
                "tick_spacing": info["tick_spacing"],
                "extension":    0,
            }
            bounds = {
                "lower": _i129(lower_tick),
                "upper": _i129(upper_tick),
            }

            # Use dict-style access (starknet.py v0.29 returns dict, not attr-obj)
            fn = positions_contract.functions['get_token_info']
            result = await fn.call(
                position_id, pool_key, bounds, block_number="latest"
            )
            r = result[0] if isinstance(result, (list, tuple)) else result
            if hasattr(r, '_asdict'):
                d = r._asdict()
            elif isinstance(r, dict):
                d = dict(r)
            else:
                d = {}
            return {
                "success":     True,
                "position_id": position_id,
                "amount0":     d.get('amount0', result[0] if isinstance(result, (list, tuple)) else 0),
                "amount1":     d.get('amount1', result[1] if isinstance(result, (list, tuple)) and len(result) > 1 else 0),
                "liquidity":   d.get('liquidity', 0),
                "fees0":       d.get('fees0', 0),
                "fees1":       d.get('fees1', 0),
            }
        except Exception as exc:
            logger.warning("get_token_info failed: %s", exc)
            return {"success": False, "position_id": position_id, "error": str(exc)}

    async def get_token_info_raw(
        self,
        position_id: int,
        token0: str,
        token1: str,
        fee_tier: int,
        lower_tick: int,
        upper_tick: int,
    ) -> Dict:
        """
        Read token amounts using raw token addresses and fee_tier integer.
        Bypasses _PAIR_DEFAULTS – resolves fee encoding on the fly.
        """
        _U64_MAX = (1 << 64) - 1

        if position_id > _U64_MAX:
            return {"success": False, "position_id": position_id,
                    "error": "position_id exceeds u64 range (not a real Ekubo NFT ID)"}

        if not is_starknet_token(token0) or not is_starknet_token(token1):
            return {"success": False, "position_id": position_id,
                    "error": "Non-Starknet token address (L1 bridged)"}

        fee_info = _FEE_TIER_MAP.get(fee_tier)
        if not fee_info:
            return {"success": False, "position_id": position_id,
                    "error": f"Unknown fee_tier {fee_tier}"}

        on_chain_fee, tick_spacing = fee_info
        try:
            positions_contract = await _get_positions_contract(self.rpc_url)

            pool_key = {
                "token0":       int(token0, 16),
                "token1":       int(token1, 16),
                "fee":          on_chain_fee,
                "tick_spacing": tick_spacing,
                "extension":    0,
            }
            bounds = {
                "lower": _i129(lower_tick),
                "upper": _i129(upper_tick),
            }

            fn = positions_contract.functions['get_token_info']
            result = await fn.call(
                position_id, pool_key, bounds, block_number="latest"
            )
            r = result[0] if isinstance(result, (list, tuple)) else result
            if hasattr(r, '_asdict'):
                d = r._asdict()
            elif isinstance(r, dict):
                d = dict(r)
            else:
                d = {}
            return {
                "success":     True,
                "position_id": position_id,
                "amount0":     d.get('amount0', result[0] if isinstance(result, (list, tuple)) else 0),
                "amount1":     d.get('amount1', result[1] if isinstance(result, (list, tuple)) and len(result) > 1 else 0),
                "liquidity":   d.get('liquidity', 0),
                "fees0":       d.get('fees0', 0),
                "fees1":       d.get('fees1', 0),
            }
        except Exception as exc:
            logger.warning("get_token_info_raw failed: %s", exc)
            return {"success": False, "position_id": position_id, "error": str(exc)}


async def main():
    """Smoke-test: connect + read a position."""
    import asyncio
    executor = EkuboContractExecutor()
    ok = await executor.connect()
    print("RPC reachable:", ok)
    if ok:
        info = await executor.get_token_info(0, "STRK/ETH", -887000, 887000)
        print("token_info position 0:", info)

if __name__ == "__main__":
    asyncio.run(main())
