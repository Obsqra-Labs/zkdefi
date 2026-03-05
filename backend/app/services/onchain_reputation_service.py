"""
On-Chain Reputation Reader — reads ReputationRegistry contract state.

Reads from the deployed ReputationRegistry contract at REPUTATION_REGISTRY_ADDRESS.
Provides real tier info, collateral amounts, user stats, and reputation scores
that the backend currently stores only locally.

Contract: ReputationRegistry (0x10d00b33...)
Uses starknet_py FullNodeClient.call_contract for read-only calls.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

from starknet_py.net.client_models import Call
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.hash.selector import get_selector_from_name

logger = logging.getLogger(__name__)


def _parse_int(val: str) -> int:
    val = val.strip()
    return int(val, 16) if val.startswith("0x") else int(val)


@dataclass
class OnChainReputation:
    """On-chain reputation data for a user."""
    user_address: str
    tier: str                    # "Strict" | "Standard" | "Express"
    tier_index: int
    reputation_score: int
    collateral_wei: int
    transaction_count: int
    total_volume: int
    first_interaction: int
    last_interaction: int
    successful_txns: int
    failed_txns: int
    can_use_relayer: bool
    relayer_delay_seconds: int
    daily_deposits: int
    daily_withdrawals: int
    collaborative_score: int
    graph_hash: str


TIER_NAMES = {0: "Strict", 1: "Standard", 2: "Express"}


class OnChainReputationService:
    """
    Reads live reputation data directly from the Starknet ReputationRegistry contract.
    """

    def __init__(self):
        self._client: Optional[FullNodeClient] = None
        self._registry_address = _parse_int(
            os.getenv("REPUTATION_REGISTRY_ADDRESS", "0x0")
        )
        self._rpc_url = os.getenv("STARKNET_RPC_URL", "http://127.0.0.1:6060")

    def _get_client(self) -> FullNodeClient:
        if self._client is None:
            self._client = FullNodeClient(node_url=self._rpc_url)
        return self._client

    async def _call(self, method: str, calldata: list[int]) -> list[int]:
        """Make a read-only contract call."""
        client = self._get_client()
        call = Call(
            to_addr=self._registry_address,
            selector=get_selector_from_name(method),
            calldata=calldata,
        )
        result = await client.call_contract(call)
        return [int(r) for r in result]

    async def get_user_tier(self, user_address: str) -> tuple[str, int]:
        """Get user's proof tier from on-chain."""
        try:
            user_int = _parse_int(user_address)
            result = await self._call("get_user_tier", [user_int])
            tier_idx = result[0] if result else 0
            return TIER_NAMES.get(tier_idx, "Unknown"), tier_idx
        except Exception as e:
            logger.warning("get_user_tier failed for %s: %s", user_address[:12], e)
            return "Strict", 0

    async def get_reputation_score(self, user_address: str) -> int:
        """Get user's ERC-8004 reputation score."""
        try:
            user_int = _parse_int(user_address)
            result = await self._call("get_reputation_score", [user_int])
            return result[0] if result else 0
        except Exception as e:
            logger.debug("get_reputation_score failed: %s", e)
            return 0

    async def get_user_collateral(self, user_address: str) -> int:
        """Get user's staked collateral (wei)."""
        try:
            user_int = _parse_int(user_address)
            result = await self._call("get_user_collateral", [user_int])
            # u256 = (low, high)
            if len(result) >= 2:
                return result[0] + (result[1] << 128)
            return result[0] if result else 0
        except Exception as e:
            logger.debug("get_user_collateral failed: %s", e)
            return 0

    async def get_user_stats(self, user_address: str) -> dict:
        """Get user's on-chain stats (UserStats struct)."""
        try:
            user_int = _parse_int(user_address)
            result = await self._call("get_user_stats", [user_int])
            if len(result) >= 6:
                return {
                    "transaction_count": result[0],
                    "total_volume_low": result[1],
                    "total_volume_high": result[2] if len(result) > 6 else 0,
                    "first_interaction": result[3] if len(result) > 3 else 0,
                    "last_interaction": result[4] if len(result) > 4 else 0,
                    "successful_txns": result[5] if len(result) > 5 else 0,
                    "failed_txns": result[6] if len(result) > 6 else 0,
                }
            return {}
        except Exception as e:
            logger.debug("get_user_stats failed: %s", e)
            return {}

    async def can_use_relayer(self, user_address: str) -> bool:
        """Check if user is allowed to use the relayer."""
        try:
            user_int = _parse_int(user_address)
            result = await self._call("can_use_relayer", [user_int])
            return bool(result[0]) if result else False
        except Exception as e:
            logger.debug("can_use_relayer failed: %s", e)
            return False

    async def get_relayer_delay(self, user_address: str) -> int:
        """Get user's relayer delay in seconds."""
        try:
            user_int = _parse_int(user_address)
            result = await self._call("get_relayer_delay", [user_int])
            return result[0] if result else 3600
        except Exception as e:
            logger.debug("get_relayer_delay failed: %s", e)
            return 3600

    async def get_collaborative_score(self, user_address: str) -> tuple[int, str]:
        """Get user's collaborative score (multiplier bps, graph hash)."""
        try:
            user_int = _parse_int(user_address)
            score_result = await self._call("get_collaborative_score", [user_int])
            score = score_result[0] if score_result else 0

            hash_result = await self._call("get_graph_hash", [user_int])
            graph_hash = hex(hash_result[0]) if hash_result else "0x0"

            return score, graph_hash
        except Exception as e:
            logger.debug("get_collaborative_score failed: %s", e)
            return 0, "0x0"

    async def get_full_reputation(self, user_address: str) -> OnChainReputation:
        """Get comprehensive on-chain reputation data for a user."""
        tier_name, tier_idx = await self.get_user_tier(user_address)
        score = await self.get_reputation_score(user_address)
        collateral = await self.get_user_collateral(user_address)
        stats = await self.get_user_stats(user_address)
        relayer_ok = await self.can_use_relayer(user_address)
        relayer_delay = await self.get_relayer_delay(user_address)
        collab_score, graph_hash = await self.get_collaborative_score(user_address)

        daily_deps = 0
        daily_wds = 0
        try:
            user_int = _parse_int(user_address)
            dep_result = await self._call("get_daily_deposit_count", [user_int])
            daily_deps = dep_result[0] if dep_result else 0
            wd_result = await self._call("get_daily_withdrawal_count", [user_int])
            daily_wds = wd_result[0] if wd_result else 0
        except Exception:
            pass

        return OnChainReputation(
            user_address=user_address,
            tier=tier_name,
            tier_index=tier_idx,
            reputation_score=score,
            collateral_wei=collateral,
            transaction_count=stats.get("transaction_count", 0),
            total_volume=stats.get("total_volume_low", 0),
            first_interaction=stats.get("first_interaction", 0),
            last_interaction=stats.get("last_interaction", 0),
            successful_txns=stats.get("successful_txns", 0),
            failed_txns=stats.get("failed_txns", 0),
            can_use_relayer=relayer_ok,
            relayer_delay_seconds=relayer_delay,
            daily_deposits=daily_deps,
            daily_withdrawals=daily_wds,
            collaborative_score=collab_score,
            graph_hash=graph_hash,
        )

    async def get_total_users(self) -> int:
        """Get total number of registered users."""
        try:
            result = await self._call("get_total_users", [])
            return result[0] if result else 0
        except Exception:
            return 0


# ── Singleton ─────────────────────────────────────────────────────────
_service: OnChainReputationService | None = None


def get_onchain_reputation_service() -> OnChainReputationService:
    global _service
    if _service is None:
        _service = OnChainReputationService()
    return _service
