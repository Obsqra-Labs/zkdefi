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
import json
from dataclasses import dataclass
from urllib import error as urllib_error
from urllib import request as urllib_request
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


@dataclass
class ExecutionTargetConfig:
    network_id: str
    rpc_url: str
    account_path: str
    private_key: str
    account_address: str
    deposit_contract: str
    deposit_entrypoint: str
    allocation_contract: str
    allocation_entrypoint: str
    live_submit_enabled: bool


class ContractExecutor:
    def __init__(self) -> None:
        self._starkli = shutil.which("starkli")

    def _resolve_target_config(self, network_id: str = "starknet_sepolia") -> ExecutionTargetConfig:
        resolved_network = (network_id or "starknet_sepolia").strip().lower() or "starknet_sepolia"
        is_mainnet = resolved_network == "starknet_mainnet"
        suffix = "_MAINNET" if is_mainnet else ""
        rpc_url = (
            (os.getenv("EXECUTOR_RPC_URL_MAINNET") or os.getenv("STARKNET_MAINNET_RPC_URL") or "")
            if is_mainnet
            else (
                os.getenv("EXECUTOR_RPC_URL")
                or os.getenv("STARKNET_RPC_URL", "http://localhost:5050")
                or "http://localhost:5050"
            )
        )
        account_path = (
            (os.getenv("EXECUTOR_ACCOUNT_PATH_MAINNET") or "")
            if is_mainnet
            else (
                os.getenv("EXECUTOR_ACCOUNT_PATH")
                or os.getenv("STARKNET_ACCOUNT")
                or ""
            )
        )
        private_key = (
            (os.getenv("EXECUTOR_PRIVATE_KEY_MAINNET") or "")
            if is_mainnet
            else (
                os.getenv("EXECUTOR_PRIVATE_KEY")
                or os.getenv("RELAYER_PRIVATE_KEY")
                or ""
            )
        )
        deposit_contract = (
            os.getenv(f"EXECUTOR_DEPOSIT_CONTRACT{suffix}")
            or os.getenv("EXECUTOR_DEPOSIT_CONTRACT")
            or os.getenv("PROOF_GATED_AGENT_ADDRESS")
            or ""
        )
        allocation_contract = (
            os.getenv(f"EXECUTOR_ALLOCATION_CONTRACT{suffix}")
            or os.getenv("EXECUTOR_ALLOCATION_CONTRACT")
            or ""
        )
        live_submit_enabled = (
            (os.getenv("EXECUTOR_LIVE_SUBMIT_MAINNET") or "false")
            if is_mainnet
            else (os.getenv("EXECUTOR_LIVE_SUBMIT") or "false")
        ).lower() == "true"
        account_address = self._read_account_address(account_path)
        return ExecutionTargetConfig(
            network_id=resolved_network,
            rpc_url=rpc_url,
            account_path=account_path,
            private_key=private_key,
            account_address=account_address,
            deposit_contract=deposit_contract,
            deposit_entrypoint=os.getenv(f"EXECUTOR_DEPOSIT_ENTRYPOINT{suffix}") or os.getenv("EXECUTOR_DEPOSIT_ENTRYPOINT") or "",
            allocation_contract=allocation_contract,
            allocation_entrypoint=os.getenv(f"EXECUTOR_ALLOCATION_ENTRYPOINT{suffix}") or os.getenv("EXECUTOR_ALLOCATION_ENTRYPOINT") or "",
            live_submit_enabled=live_submit_enabled,
        )

    def can_submit_live(self, network_id: str = "starknet_sepolia") -> bool:
        cfg = self._resolve_target_config(network_id)
        account_deployed = self._is_account_deployed(cfg)
        return bool(
            cfg.live_submit_enabled
            and self._starkli
            and cfg.account_path
            and cfg.private_key
            and account_deployed
        )

    def get_readiness(self, network_id: str = "starknet_sepolia") -> dict[str, object]:
        cfg = self._resolve_target_config(network_id)
        account_deployed = self._is_account_deployed(cfg)
        return {
            "network_id": cfg.network_id,
            "rpc_url": cfg.rpc_url,
            "account_path": cfg.account_path,
            "account_address": cfg.account_address,
            "live_submit_enabled": cfg.live_submit_enabled,
            "starkli_available": bool(self._starkli),
            "account_configured": bool(cfg.account_path),
            "private_key_configured": bool(cfg.private_key),
            "account_deployed": account_deployed,
            "can_submit_live": bool(
                cfg.live_submit_enabled
                and self._starkli
                and cfg.account_path
                and cfg.private_key
                and account_deployed
            ),
        }

    def _read_account_address(self, account_path: str) -> str:
        if not account_path:
            return ""
        try:
            with open(account_path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            return ""
        deployment = payload.get("deployment") if isinstance(payload, dict) else None
        if isinstance(deployment, dict):
            return str(deployment.get("address") or "").strip()
        return str(payload.get("address") or "").strip() if isinstance(payload, dict) else ""

    def _is_account_deployed(self, cfg: ExecutionTargetConfig) -> bool:
        if not cfg.rpc_url or not cfg.account_address:
            return False
        payload = json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "starknet_getClassHashAt",
                "params": {
                    "block_id": "latest",
                    "contract_address": cfg.account_address,
                },
                "id": 1,
            }
        ).encode("utf-8")
        req = urllib_request.Request(
            cfg.rpc_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=15) as response:
                body = response.read().decode("utf-8")
            parsed = json.loads(body)
        except (urllib_error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            return False
        return bool(parsed.get("result")) and not parsed.get("error")

    async def _invoke(
        self,
        contract: str,
        entrypoint: str,
        calldata: list[str],
        *,
        network_id: str = "starknet_sepolia",
    ) -> Optional[str]:
        cfg = self._resolve_target_config(network_id)
        if not self.can_submit_live(network_id):
            return None
        if not contract or not entrypoint:
            return None

        cmd = [
            str(self._starkli),
            "invoke",
            "--rpc",
            cfg.rpc_url,
            "--account",
            str(cfg.account_path),
            "--private-key",
            str(cfg.private_key),
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
        *,
        network_id: str = "starknet_sepolia",
    ) -> Optional[str]:
        cfg = self._resolve_target_config(network_id)
        if not self.can_submit_live(network_id):
            return None
        if not cfg.deposit_contract or not cfg.deposit_entrypoint:
            return None

        amount_low, amount_high = _u256_parts(int(deposit_amount_wei))
        proof_hash = _pool_id_felt(f"{user_address}:{risk_profile}:{llm_reasoning_hash}")

        # Generic calldata schema for configurable executor entrypoint:
        # [amount_low, amount_high, proof_hash]
        calldata = [str(amount_low), str(amount_high), str(proof_hash)]
        return await self._invoke(cfg.deposit_contract, cfg.deposit_entrypoint, calldata, network_id=network_id)

    async def maybe_submit_allocation(
        self,
        pool_id: str,
        amount_wei: int,
        protocol: str,
        *,
        network_id: str = "starknet_sepolia",
    ) -> Optional[str]:
        cfg = self._resolve_target_config(network_id)
        if not self.can_submit_live(network_id):
            return None
        if not cfg.allocation_contract or not cfg.allocation_entrypoint:
            return None

        amount_low, amount_high = _u256_parts(int(amount_wei))
        pool_felt = _pool_id_felt(pool_id)
        protocol_id = 1 if protocol.lower().startswith("ekubo") else 0

        # Generic calldata schema for configurable executor entrypoint:
        # [pool_felt, protocol_id, amount_low, amount_high]
        calldata = [str(pool_felt), str(protocol_id), str(amount_low), str(amount_high)]
        return await self._invoke(cfg.allocation_contract, cfg.allocation_entrypoint, calldata, network_id=network_id)

    async def execute_deposit_and_allocation(
        self,
        user_address: str,
        deposit_amount: int,
        risk_profile: str,
        allocation: dict[str, float],
        llm_reasoning_hash: str,
        expected_apy: float,
        *,
        network_id: str = "starknet_sepolia",
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
                network_id=network_id,
            )

            allocation_tx_hashes: dict[str, Optional[str]] = {}
            for strategy_name, pct in allocation.items():
                amount_wei = int(int(deposit_amount) * float(pct))
                allocation_tx_hashes[strategy_name] = await self.maybe_submit_allocation(
                    pool_id=strategy_name,
                    amount_wei=amount_wei,
                    protocol="ekubo" if "ekubo" in strategy_name.lower() else "other",
                    network_id=network_id,
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
