"""
On-chain Agent Service — Calls AgentIdentity contract on Starknet Sepolia.

Provides mint_agent, record_execution, and get_agent_metadata through
starknet-py's Contract interface.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# Paths
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # backend/../..
_ABI_PATH = _PROJECT_ROOT / "contracts" / "target" / "dev" / "zkdefi_contracts_AgentIdentity.contract_class.json"

# Env
_RPC_URL = os.getenv("STARKNET_RPC_URL_V08", "https://api.cartridge.gg/x/starknet/sepolia")
_DEPLOYER_ADDRESS = os.getenv(
    "FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS",
    "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
)
_DEPLOYER_PRIVATE_KEY = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", "")
_AGENT_IDENTITY_ADDRESS = os.getenv("AGENT_IDENTITY_ADDRESS", "")


def _felt_from_str(s: str, max_bytes: int = 31) -> int:
    """Convert a string to a felt252 (max 31 bytes)."""
    encoded = s.encode("utf-8")[:max_bytes]
    return int.from_bytes(encoded, "big")


class OnchainAgentService:
    """Thin wrapper around the AgentIdentity contract."""

    def __init__(self):
        self._lock = threading.Lock()
        self._contract = None
        self._account = None
        self._available = False
        self._init_error: str | None = None
        self._init()

    def _init(self):
        """Lazy initialisation — silently disables if deps missing."""
        try:
            if not _AGENT_IDENTITY_ADDRESS or not _DEPLOYER_PRIVATE_KEY:
                self._init_error = "Missing AGENT_IDENTITY_ADDRESS or deployer key"
                logger.warning(f"OnchainAgentService disabled: {self._init_error}")
                return

            from starknet_py.net.full_node_client import FullNodeClient
            from starknet_py.net.account.account import Account
            from starknet_py.net.models import StarknetChainId
            from starknet_py.contract import Contract
            from starknet_py.net.signer.stark_curve_signer import KeyPair

            client = FullNodeClient(node_url=_RPC_URL)
            key_pair = KeyPair.from_private_key(int(_DEPLOYER_PRIVATE_KEY, 16))
            self._account = Account(
                address=int(_DEPLOYER_ADDRESS, 16),
                client=client,
                key_pair=key_pair,
                chain=StarknetChainId.SEPOLIA,
            )

            # Load ABI
            abi = json.loads(_ABI_PATH.read_text())["abi"]
            self._contract = Contract(
                address=int(_AGENT_IDENTITY_ADDRESS, 16),
                abi=abi,
                provider=self._account,
            )
            self._available = True
            logger.info(f"OnchainAgentService ready — contract {_AGENT_IDENTITY_ADDRESS}")

        except Exception as exc:
            self._init_error = str(exc)
            logger.warning(f"OnchainAgentService disabled: {exc}")

    @property
    def available(self) -> bool:
        return self._available

    async def mint_agent(
        self,
        name: str,
        identity_commitment: str | int,
        model_ids: list[str] | None = None,
    ) -> dict:
        """
        Mint an agent NFT on-chain.

        Returns dict with token_id and tx_hash on success,
        or error info on failure.
        """
        if not self._available:
            return {"success": False, "error": self._init_error or "Service not available"}

        try:
            name_felt = _felt_from_str(name)
            commitment_int = int(identity_commitment, 16) if isinstance(identity_commitment, str) else identity_commitment
            models = [_felt_from_str(m) for m in (model_ids or ["gpt-4o-mini"])]

            invocation = await self._contract.functions["mint_agent"].invoke_v3(
                name_felt,
                commitment_int,
                models,
                auto_estimate=True,
            )
            await invocation.wait_for_acceptance()

            logger.info(f"Minted agent '{name}' on-chain, tx: {hex(invocation.hash)}")
            return {
                "success": True,
                "tx_hash": hex(invocation.hash),
            }
        except Exception as exc:
            logger.error(f"mint_agent failed: {exc}")
            return {"success": False, "error": str(exc)}

    async def record_execution(self, token_id: int) -> dict:
        """Record an execution on-chain for an agent token."""
        if not self._available:
            return {"success": False, "error": self._init_error or "Service not available"}
        try:
            # token_id is u256 = (low, high)
            invocation = await self._contract.functions["record_execution"].invoke_v3(
                {"low": token_id, "high": 0},
                auto_estimate=True,
            )
            await invocation.wait_for_acceptance()
            return {"success": True, "tx_hash": hex(invocation.hash)}
        except Exception as exc:
            logger.error(f"record_execution failed: {exc}")
            return {"success": False, "error": str(exc)}

    async def get_agent_metadata(self, token_id: int) -> dict | None:
        """Read agent metadata from on-chain (view call)."""
        if not self._available:
            return None
        try:
            result = await self._contract.functions["get_agent_metadata"].call(
                {"low": token_id, "high": 0},
            )
            return {"raw": str(result)}
        except Exception as exc:
            logger.error(f"get_agent_metadata failed: {exc}")
            return None


# ── Singleton ───────────────────────────────────────────────────────────────
_instance: OnchainAgentService | None = None
_instance_lock = threading.Lock()


def get_onchain_agent_service() -> OnchainAgentService:
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = OnchainAgentService()
    return _instance
