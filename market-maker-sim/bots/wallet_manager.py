"""
Bot wallet manager — wraps starknet-py Account for on-chain tx execution.

Provides a single shared Account that all bots use to submit transactions
on Starknet Sepolia.  Supports execute_v3 with auto fee estimation.

Gas budget: tracks daily STRK gas spend and refuses new TXs once the
configurable daily budget is exhausted (default 200 STRK/day).
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from datetime import datetime, timezone
from typing import Any

from starknet_py.contract import Contract
from starknet_py.net.account.account import Account
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair

logger = logging.getLogger(__name__)


class GasBudgetExhausted(RuntimeError):
    """Raised when the daily gas budget has been spent."""
    pass

# ABI cache (avoid refetching on every call)
_contract_cache: dict[str, Contract] = {}


class WalletManager:
    """Manages a single bot wallet for submitting on-chain transactions."""

    def __init__(self, rpc_url: str, account_address: str, private_key: str) -> None:
        self.rpc_url = rpc_url
        self._account_address = account_address
        self._private_key = private_key
        self._account: Account | None = None
        self._client: FullNodeClient | None = None
        self._execute_lock = asyncio.Lock()

        # ── Daily gas budget ──────────────────────────────────────────────
        # Budget in STRK (wei). Default 200 STRK/day.
        budget_strk = float(os.getenv("DAILY_GAS_BUDGET_STRK", "200"))
        self._daily_budget_wei: int = int(budget_strk * 10 ** 18)
        self._gas_spent_today_wei: int = 0
        self._budget_day: str = self._today()  # YYYY-MM-DD UTC
        self._total_tx_today: int = 0
        logger.info("Gas budget: %.0f STRK/day", budget_strk)

    # ── Budget helpers ────────────────────────────────────────────────────
    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _maybe_reset_budget(self) -> None:
        """Reset counters if the UTC day has rolled over."""
        today = self._today()
        if today != self._budget_day:
            logger.info(
                "Gas budget reset: spent %.4f STRK across %d TXs yesterday",
                self._gas_spent_today_wei / 1e18, self._total_tx_today,
            )
            self._gas_spent_today_wei = 0
            self._total_tx_today = 0
            self._budget_day = today

    def _record_gas(self, cost_wei: int) -> None:
        self._gas_spent_today_wei += cost_wei
        self._total_tx_today += 1

    @property
    def gas_budget_remaining_wei(self) -> int:
        self._maybe_reset_budget()
        return max(0, self._daily_budget_wei - self._gas_spent_today_wei)

    @property
    def gas_budget_status(self) -> dict[str, Any]:
        self._maybe_reset_budget()
        return {
            "budget_strk": round(self._daily_budget_wei / 1e18, 2),
            "spent_strk": round(self._gas_spent_today_wei / 1e18, 4),
            "remaining_strk": round(self.gas_budget_remaining_wei / 1e18, 4),
            "tx_today": self._total_tx_today,
            "budget_day": self._budget_day,
            "pct_used": round(
                self._gas_spent_today_wei / self._daily_budget_wei * 100, 1
            ) if self._daily_budget_wei > 0 else 0.0,
        }

    @property
    def configured(self) -> bool:
        return bool(self._account_address and self._private_key)

    @property
    def address(self) -> str:
        return self._account_address

    @property
    def address_int(self) -> int:
        a = self._account_address
        return int(a, 16) if a.startswith("0x") else int(a)

    def _get_client(self) -> FullNodeClient:
        if self._client is None:
            self._client = FullNodeClient(node_url=self.rpc_url)
        return self._client

    def get_account(self) -> Account:
        """Return a cached starknet-py Account instance."""
        if self._account is not None:
            return self._account
        if not self.configured:
            raise RuntimeError("Bot wallet not configured (set BOT_ACCOUNT_ADDRESS + BOT_PRIVATE_KEY)")

        pk = self._private_key
        addr = self._account_address
        key_int = int(pk, 16) if pk.startswith("0x") else int(pk)
        addr_int = int(addr, 16) if addr.startswith("0x") else int(addr)

        self._account = Account(
            address=addr_int,
            client=self._get_client(),
            key_pair=KeyPair.from_private_key(key_int),
            chain=StarknetChainId.SEPOLIA,
        )
        self._account._cairo_version = 1  # skip pending-block class lookup
        return self._account

    async def get_contract(self, address: str | int) -> Contract:
        """Return a cached Contract instance (ABI fetched from chain)."""
        addr_int = int(address, 16) if isinstance(address, str) and str(address).startswith("0x") else int(address)
        cache_key = f"{self.rpc_url}:{hex(addr_int)}"
        if cache_key not in _contract_cache:
            _contract_cache[cache_key] = await Contract.from_address(
                address=addr_int,
                provider=self.get_account(),
                proxy_config=False,
            )
        return _contract_cache[cache_key]

    async def execute(self, calls: list) -> str:
        """
        Submit a multicall with auto fee estimation (v3 resource bounds).
        Returns the transaction hash as hex string.
        """
        from starknet_py.net.client_models import ResourceBounds, ResourceBoundsMapping

        account = self.get_account()
        max_nonce_retries = 5  # increased for 10-agent fleet contention

        # Non-zero initial bounds so estimate_fee simulation passes
        # account __validate__ (which rejects zero resource bounds).
        _ESTIMATE_BOUNDS = ResourceBoundsMapping(
            l1_gas=ResourceBounds(max_amount=50_000, max_price_per_unit=10 ** 14),
            l2_gas=ResourceBounds(max_amount=50_000, max_price_per_unit=10 ** 12),
            l1_data_gas=ResourceBounds(max_amount=50_000, max_price_per_unit=10 ** 10),
        )

        STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"

        # ── Budget gate ───────────────────────────────────────────────────
        self._maybe_reset_budget()
        if self._gas_spent_today_wei >= self._daily_budget_wei:
            raise GasBudgetExhausted(
                f"Daily gas budget exhausted: {self._gas_spent_today_wei / 1e18:.2f} / "
                f"{self._daily_budget_wei / 1e18:.0f} STRK used today ({self._total_tx_today} TXs)"
            )

        # Serialize transactions from all bots to avoid mempool nonce races.
        async with self._execute_lock:
            for attempt in range(1, max_nonce_retries + 1):
                nonce = await account.get_nonce(block_number="latest")
                try:
                    # Prepare draft with generous bounds for estimation
                    draft = await account._prepare_invoke_v3(
                        calls,
                        resource_bounds=_ESTIMATE_BOUNDS,
                        nonce=nonce,
                    )
                    # Estimate actual fee
                    estimated = await account.estimate_fee(
                        draft, block_number="latest",
                    )

                    # Adaptively pick the largest safe multiplier that fits
                    # within the wallet's STRK balance (v3 fee token).
                    try:
                        strk_balance = await self.get_balance(STRK_TOKEN)
                    except Exception:
                        strk_balance = 0

                    rbm = None
                    for am, pm in [(1.5, 1.5), (1.3, 1.3), (1.1, 1.1), (1.05, 1.05)]:
                        candidate = estimated.to_resource_bounds(
                            amount_multiplier=am, unit_price_multiplier=pm,
                        )
                        max_cost = sum(
                            rb.max_amount * rb.max_price_per_unit
                            for rb in [candidate.l1_gas, candidate.l2_gas, candidate.l1_data_gas]
                        )
                        if strk_balance == 0 or max_cost <= int(strk_balance * 0.95):
                            rbm = candidate
                            logger.debug("Using fee multiplier %.1fx (cost %d, bal %d)", am, max_cost, strk_balance)
                            break

                    if rbm is None:
                        # Even 1.05x too high — use exact 1.0x as last resort
                        rbm = estimated.to_resource_bounds(
                            amount_multiplier=1.0, unit_price_multiplier=1.0,
                        )
                        max_cost = sum(
                            rb.max_amount * rb.max_price_per_unit
                            for rb in [rbm.l1_gas, rbm.l2_gas, rbm.l1_data_gas]
                        )
                        if strk_balance > 0 and max_cost > strk_balance:
                            raise RuntimeError(
                                f"Insufficient STRK for gas: need ~{max_cost / 1e18:.4f}, "
                                f"have {strk_balance / 1e18:.4f}"
                            )
                        logger.warning("Using exact 1.0x fee bounds (tight!)")

                    resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
                    tx_hash = hex(resp.transaction_hash)
                    logger.info("TX submitted: %s", tx_hash)

                    await account.client.wait_for_tx(resp.transaction_hash)
                    logger.info("TX confirmed: %s", tx_hash)

                    # Record actual gas cost (max_fee committed)
                    actual_cost = sum(
                        rb.max_amount * rb.max_price_per_unit
                        for rb in [rbm.l1_gas, rbm.l2_gas, rbm.l1_data_gas]
                    )
                    self._record_gas(actual_cost)
                    remaining = self.gas_budget_remaining_wei
                    if remaining < self._daily_budget_wei * 0.1:
                        logger.warning(
                            "Gas budget <10%%: %.4f STRK remaining (%d TXs today)",
                            remaining / 1e18, self._total_tx_today,
                        )
                    return tx_hash
                except Exception as exc:
                    msg = str(exc).lower()
                    is_nonce_error = (
                        "nonce" in msg
                        and (
                            "duplicate" in msg
                            or "too old" in msg
                            or "invalid transaction nonce" in msg
                        )
                    )
                    # Also retry on Account validation / code 55 (stale fee
                    # estimate from nonce contention between fleet agents)
                    is_validation_error = (
                        "account validation" in msg
                        or "code 55" in msg
                        or ("transaction execution" in msg and "error" in msg and "validate" in msg)
                    )
                    is_retryable = is_nonce_error or is_validation_error
                    if is_retryable and attempt < max_nonce_retries:
                        delay = 0.8 * attempt + random.uniform(0.1, 0.4)
                        logger.warning(
                            "Retryable TX error (attempt %d/%d, wait %.1fs): %s",
                            attempt, max_nonce_retries, delay, str(exc)[:120],
                        )
                        await asyncio.sleep(delay)
                        continue
                    raise

        raise RuntimeError("Failed to submit transaction after nonce retries")

    async def get_balance(self, token_address: str) -> int:
        """Read ERC-20 balance_of(self) in raw wei."""
        contract = await self.get_contract(token_address)
        try:
            result = await contract.functions["balance_of"].call(
                self.address_int, block_number="latest"
            )
            # Result can be a named tuple or single int depending on starknet-py version
            if isinstance(result, (list, tuple)):
                return int(result[0])
            return int(result)
        except Exception as exc:
            logger.warning("balance_of(%s) failed: %s", token_address[:12], exc)
            return 0

    async def approve_token(self, token_address: str, spender: str | int, amount: int) -> str:
        """Approve spender to spend amount of token. Returns tx hash."""
        contract = await self.get_contract(token_address)
        spender_int = int(spender, 16) if isinstance(spender, str) and str(spender).startswith("0x") else int(spender)
        call = contract.functions["approve"].prepare_call(spender_int, amount)
        return await self.execute([call])

    async def connect_test(self) -> dict[str, Any]:
        """Smoke-test: check RPC reachable and account configured."""
        client = self._get_client()
        try:
            block = await client.get_block_number()
            return {"ok": True, "block": block, "address": self._account_address}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
