"""
Contract execution adapter for MVP strategy deployment.

Design goals:
- Deterministic behavior by default (record-only mode; no fake tx hashes)
- Optional live submission via `starkli` when explicitly configured
- Stable response shape for API routes
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

_TX_HASH_RE = re.compile(r"0x[0-9a-fA-F]{64}")


def _u256_parts(value: int) -> tuple[int, int]:
    low = value % (2**128)
    high = value // (2**128)
    return low, high


def _pool_id_felt(pool_id: str) -> int:
    digest = hashlib.sha256(pool_id.encode("utf-8")).digest()
    return int.from_bytes(digest, "big") % (2**251)


def _extract_tx_hash(output: str) -> Optional[str]:
    match = _TX_HASH_RE.search(output or "")
    return match.group(0) if match else None


@dataclass
class ExecutionResult:
    success: bool
    mode: str
    deposit_id: str
    vault_tx_hash: Optional[str]
    allocation_tx_hashes: dict[str, Optional[str]]
    audit_trail_id: int
    error: Optional[str] = None


class ContractExecutor:
    def __init__(self) -> None:
        self.rpc_url = os.getenv("EXECUTOR_RPC_URL") or os.getenv("STARKNET_RPC_URL", "http://localhost:5050")
        self.account_path = os.getenv("EXECUTOR_ACCOUNT_PATH") or os.getenv("STARKNET_ACCOUNT")
        self.private_key = os.getenv("EXECUTOR_PRIVATE_KEY") or os.getenv("RELAYER_PRIVATE_KEY")

        # Optional configurable calls. If unset, executor remains in record-only mode.
        self.deposit_contract = os.getenv("EXECUTOR_DEPOSIT_CONTRACT") or os.getenv("PROOF_GATED_AGENT_ADDRESS")
        self.deposit_entrypoint = os.getenv("EXECUTOR_DEPOSIT_ENTRYPOINT")  # e.g. deposit_with_proof
        self.allocation_contract = os.getenv("EXECUTOR_ALLOCATION_CONTRACT")
        self.allocation_entrypoint = os.getenv("EXECUTOR_ALLOCATION_ENTRYPOINT")

        self.live_submit_enabled = os.getenv("EXECUTOR_LIVE_SUBMIT", "false").lower() == "true"
        self._starkli = shutil.which("starkli")

    def can_submit_live(self) -> bool:
        return bool(
            self.live_submit_enabled
            and self._starkli
            and self.account_path
            and self.private_key
        )

    async def _invoke(self, contract: str, entrypoint: str, calldata: list[str]) -> Optional[str]:
        if not self.can_submit_live():
            return None
        if not contract or not entrypoint:
            return None

        cmd = [
            str(self._starkli),
            "invoke",
            "--rpc",
            self.rpc_url,
            "--account",
            str(self.account_path),
            "--private-key",
            str(self.private_key),
            contract,
            entrypoint,
            *[str(x) for x in calldata],
        ]

        def _run() -> subprocess.CompletedProcess[str]:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _run)
        output = f"{result.stdout}\n{result.stderr}".strip()
        if result.returncode != 0:
            logger.error("starkli invoke failed (%s %s): %s", contract, entrypoint, output)
            return None
        tx_hash = _extract_tx_hash(output)
        if not tx_hash:
            logger.warning("starkli invoke succeeded but tx hash not found: %s", output)
        return tx_hash

    async def maybe_submit_deposit(
        self,
        user_address: str,
        deposit_amount_wei: int,
        risk_profile: str,
        llm_reasoning_hash: str,
    ) -> Optional[str]:
        if not self.can_submit_live():
            return None
        if not self.deposit_contract or not self.deposit_entrypoint:
            return None

        amount_low, amount_high = _u256_parts(int(deposit_amount_wei))
        proof_hash = _pool_id_felt(f"{user_address}:{risk_profile}:{llm_reasoning_hash}")

        # Generic calldata schema for configurable executor entrypoint:
        # [amount_low, amount_high, proof_hash]
        calldata = [str(amount_low), str(amount_high), str(proof_hash)]
        return await self._invoke(self.deposit_contract, self.deposit_entrypoint, calldata)

    async def maybe_submit_allocation(
        self,
        pool_id: str,
        amount_wei: int,
        protocol: str,
    ) -> Optional[str]:
        if not self.can_submit_live():
            return None
        if not self.allocation_contract or not self.allocation_entrypoint:
            return None

        amount_low, amount_high = _u256_parts(int(amount_wei))
        pool_felt = _pool_id_felt(pool_id)
        protocol_id = 1 if protocol.lower().startswith("ekubo") else 0

        # Generic calldata schema for configurable executor entrypoint:
        # [pool_felt, protocol_id, amount_low, amount_high]
        calldata = [str(pool_felt), str(protocol_id), str(amount_low), str(amount_high)]
        return await self._invoke(self.allocation_contract, self.allocation_entrypoint, calldata)

    async def execute_deposit_and_allocation(
        self,
        user_address: str,
        deposit_amount: int,
        risk_profile: str,
        allocation: dict[str, float],
        llm_reasoning_hash: str,
        expected_apy: float,
    ) -> ExecutionResult:
        try:
            now = int(time.time() * 1000)
            deposit_id = hashlib.sha256(
                f"{user_address}:{deposit_amount}:{risk_profile}:{now}".encode("utf-8")
            ).hexdigest()[:16]
            audit_trail_id = int(
                hashlib.sha256(
                    f"audit:{user_address}:{risk_profile}:{expected_apy}:{now}".encode("utf-8")
                ).hexdigest()[:8],
                16,
            )

            vault_tx_hash = await self.maybe_submit_deposit(
                user_address=user_address,
                deposit_amount_wei=int(deposit_amount),
                risk_profile=risk_profile,
                llm_reasoning_hash=llm_reasoning_hash,
            )

            allocation_tx_hashes: dict[str, Optional[str]] = {}
            for strategy_name, pct in allocation.items():
                amount_wei = int(int(deposit_amount) * float(pct))
                allocation_tx_hashes[strategy_name] = await self.maybe_submit_allocation(
                    pool_id=strategy_name,
                    amount_wei=amount_wei,
                    protocol="ekubo" if "ekubo" in strategy_name.lower() else "other",
                )

            any_live = vault_tx_hash is not None or any(v is not None for v in allocation_tx_hashes.values())
            mode = "live" if any_live else "recorded"

            return ExecutionResult(
                success=True,
                mode=mode,
                deposit_id=deposit_id,
                vault_tx_hash=vault_tx_hash,
                allocation_tx_hashes=allocation_tx_hashes,
                audit_trail_id=audit_trail_id,
            )
        except Exception as exc:
            logger.exception("execute_deposit_and_allocation failed")
            return ExecutionResult(
                success=False,
                mode="recorded",
                deposit_id="",
                vault_tx_hash=None,
                allocation_tx_hashes={},
                audit_trail_id=0,
                error=str(exc),
            )


_EXECUTOR_INSTANCE: Optional[ContractExecutor] = None


def get_executor() -> ContractExecutor:
    global _EXECUTOR_INSTANCE
    if _EXECUTOR_INSTANCE is None:
        _EXECUTOR_INSTANCE = ContractExecutor()
    return _EXECUTOR_INSTANCE

