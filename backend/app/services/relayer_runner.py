"""
Relayer runner: submits Tier-2 withdrawals, Tier-3 deposits, and Tier-2H claim payouts on-chain.

Enable with RELAYER_RUNNER_ENABLED=true. Requires a funded relayer account.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from starknet_py.contract import Contract
from starknet_py.net.account.account import Account
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair

from app import config
from app.api import relayer as relayer_api

_log = logging.getLogger(__name__)


def _parse_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    v = value.strip()
    if not v:
        return None
    return int(v, 16) if v.startswith("0x") else int(v)


def _resolve_chain_id(value: str) -> StarknetChainId:
    if not value:
        return StarknetChainId.SEPOLIA
    v = value.lower()
    if v in {"sepolia", "sn_sepolia", "alpha-sepolia"}:
        return StarknetChainId.SEPOLIA
    if v in {"mainnet", "sn_main", "alpha-mainnet"}:
        return StarknetChainId.MAINNET
    try:
        raw = int(value, 16) if value.startswith("0x") else int(value)
    except ValueError:
        return StarknetChainId.SEPOLIA
    for candidate in (StarknetChainId.SEPOLIA, StarknetChainId.MAINNET):
        try:
            if int(candidate) == raw:
                return candidate
        except Exception:
            continue
    return StarknetChainId.SEPOLIA


def _extract_tx_hash(output: str) -> str | None:
    match = re.search(r"0x[0-9a-fA-F]{64}", output)
    return match.group(0) if match else None


def _resolve_starkli_account_path(relayer_address: Optional[int]) -> Optional[str]:
    env_path = os.getenv("RELAYER_STARKLI_ACCOUNT") or os.getenv("STARKNET_ACCOUNT")
    if env_path and os.path.exists(env_path):
        return env_path
    if relayer_address is None:
        return None
    for root in (Path("/root/.starkli/accounts"), Path("/root/.starkli-wallets")):
        if not root.exists():
            continue
        for path in root.rglob("*.json"):
            try:
                data = json.loads(path.read_text())
            except Exception:
                continue
            addr = data.get("address") or data.get("account_address") or (data.get("deployment") or {}).get("address")
            if not addr:
                continue
            try:
                addr_int = int(addr, 16) if str(addr).startswith("0x") else int(addr)
            except Exception:
                continue
            if addr_int == relayer_address:
                return str(path)
    return None


@dataclass
class RelayerRunnerConfig:
    enabled: bool
    dry_run: bool
    poll_seconds: float
    max_batch: int
    wait_for_tx: bool
    rpc_url: str
    chain_id: StarknetChainId
    relayer_address: Optional[int]
    relayer_private_key: Optional[int]
    pool_address: Optional[int]
    confidential_transfer_address: Optional[int]
    escrow_address: Optional[int]
    hashed_withdraw_pool_address: Optional[int]
    ledger_payout_mode: str
    use_cli: bool
    starkli_account: Optional[str]


class RelayerRunner:
    def __init__(self, cfg: RelayerRunnerConfig):
        self.cfg = cfg
        self._account: Optional[Account] = None
        self._pool_contract: Optional[Contract] = None
        self._confidential_transfer: Optional[Contract] = None
        self._escrow_contract: Optional[Contract] = None
        self._starkli_account_path: Optional[str] = None

    @classmethod
    def from_env(cls) -> "RelayerRunner":
        enabled = os.getenv("RELAYER_RUNNER_ENABLED", "false").lower() == "true"
        dry_run = os.getenv("RELAYER_DRY_RUN", "false").lower() == "true"
        poll_seconds = float(os.getenv("RELAYER_POLL_SECONDS", "5"))
        max_batch = int(os.getenv("RELAYER_MAX_BATCH", "4"))
        wait_for_tx = os.getenv("RELAYER_WAIT_FOR_TX", "true").lower() == "true"
        rpc_url = os.getenv("RELAYER_RPC_URL", config.STARKNET_RPC_URL)
        chain_id = _resolve_chain_id(os.getenv("RELAYER_CHAIN_ID", config.STARKNET_CHAIN_ID))
        relayer_address = _parse_int(os.getenv("RELAYER_ADDRESS"))
        relayer_private_key = _parse_int(os.getenv("RELAYER_PRIVATE_KEY"))
        pool_address = _parse_int(config.FULLY_SHIELDED_POOL_ADDRESS)
        confidential_transfer_address = _parse_int(config.CONFIDENTIAL_TRANSFER_ADDRESS)
        escrow_address = _parse_int(config.TIER2H_ESCROW_ADDRESS)
        hashed_withdraw_pool_address = _parse_int(config.HASHED_WITHDRAW_POOL_ADDRESS)
        ledger_payout_mode = config.LEDGER_PAYOUT_MODE
        use_cli = os.getenv("RELAYER_RUNNER_USE_CLI", "false").lower() == "true"
        starkli_account = os.getenv("RELAYER_STARKLI_ACCOUNT") or os.getenv("STARKNET_ACCOUNT")
        cfg = RelayerRunnerConfig(
            enabled=enabled,
            dry_run=dry_run,
            poll_seconds=poll_seconds,
            max_batch=max_batch,
            wait_for_tx=wait_for_tx,
            rpc_url=rpc_url,
            chain_id=chain_id,
            relayer_address=relayer_address,
            relayer_private_key=relayer_private_key,
            pool_address=pool_address,
            confidential_transfer_address=confidential_transfer_address,
            escrow_address=escrow_address,
            hashed_withdraw_pool_address=hashed_withdraw_pool_address,
            ledger_payout_mode=ledger_payout_mode,
            use_cli=use_cli,
            starkli_account=starkli_account,
        )
        return cls(cfg)

    def _get_starkli_account_path(self) -> Optional[str]:
        if self._starkli_account_path is not None:
            return self._starkli_account_path
        if self.cfg.starkli_account and os.path.exists(self.cfg.starkli_account):
            self._starkli_account_path = self.cfg.starkli_account
            return self._starkli_account_path
        self._starkli_account_path = _resolve_starkli_account_path(self.cfg.relayer_address)
        return self._starkli_account_path

    async def _cli_invoke(self, contract: int, entrypoint: str, calldata: list[str]) -> Optional[str]:
        starkli = shutil.which("starkli")
        if not starkli:
            raise RuntimeError("starkli not found on PATH")
        if not self.cfg.relayer_private_key:
            raise RuntimeError("Relayer private key not configured for CLI runner")
        account_path = self._get_starkli_account_path()
        if not account_path:
            raise RuntimeError("Relayer account JSON not found for CLI runner")

        cmd = [
            starkli,
            "invoke",
            "--rpc",
            self.cfg.rpc_url,
            "--account",
            account_path,
            "--private-key",
            hex(self.cfg.relayer_private_key),
            hex(contract) if isinstance(contract, int) else str(contract),
            entrypoint,
            *[str(c) for c in calldata],
        ]

        def _run():
            return subprocess.run(cmd, capture_output=True, text=True, timeout=90)

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _run)
        output = (result.stdout or "") + (result.stderr or "")
        if result.returncode != 0:
            raise RuntimeError(f"starkli invoke failed: {output}")
        return _extract_tx_hash(output)

    async def _cli_call(self, contract: int, entrypoint: str, calldata: list[str]) -> list[str]:
        starkli = shutil.which("starkli")
        if not starkli:
            raise RuntimeError("starkli not found on PATH")
        cmd = [
            starkli,
            "call",
            "--rpc",
            self.cfg.rpc_url,
            hex(contract) if isinstance(contract, int) else str(contract),
            entrypoint,
            *[str(c) for c in calldata],
        ]

        def _run():
            return subprocess.run(cmd, capture_output=True, text=True, timeout=60)

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _run)
        output = (result.stdout or "") + (result.stderr or "")
        if result.returncode != 0:
            raise RuntimeError(f"starkli call failed: {output}")
        data = json.loads(output)
        return [str(item) for item in data]

    async def _ensure_account(self) -> None:
        if self.cfg.dry_run:
            return
        if self._account is not None:
            return
        if not self.cfg.relayer_address or not self.cfg.relayer_private_key:
            raise RuntimeError("Relayer address/private key not configured.")
        client = FullNodeClient(node_url=self.cfg.rpc_url)
        key_pair = KeyPair.from_private_key(self.cfg.relayer_private_key)
        self._account = Account(
            address=self.cfg.relayer_address,
            client=client,
            key_pair=key_pair,
            chain=self.cfg.chain_id,
        )

    async def _ensure_pool_contract(self) -> None:
        if self.cfg.dry_run:
            return
        await self._ensure_account()
        if self._pool_contract is not None:
            return
        if not self.cfg.pool_address:
            raise RuntimeError("FULLY_SHIELDED_POOL_ADDRESS not configured.")
        self._pool_contract = await Contract.from_address(
            address=self.cfg.pool_address,
            provider=self._account,
        )

    async def _ensure_confidential_transfer(self) -> None:
        if self.cfg.dry_run:
            return
        await self._ensure_account()
        if self._confidential_transfer is not None:
            return
        if not self.cfg.confidential_transfer_address:
            raise RuntimeError("CONFIDENTIAL_TRANSFER_ADDRESS not configured.")
        self._confidential_transfer = await Contract.from_address(
            address=self.cfg.confidential_transfer_address,
            provider=self._account,
        )

    async def _ensure_escrow_contract(self) -> None:
        if self.cfg.dry_run:
            return
        await self._ensure_account()
        if self._escrow_contract is not None:
            return
        if not self.cfg.escrow_address:
            raise RuntimeError("TIER2H_ESCROW_ADDRESS not configured.")
        self._escrow_contract = await Contract.from_address(
            address=self.cfg.escrow_address,
            provider=self._account,
        )

    async def _submit_withdrawal(self, req: dict) -> Optional[str]:
        if self.cfg.use_cli:
            return await self._submit_withdrawal_cli(req)
        proof = [_parse_int(p) for p in req.get("proof_calldata", [])]
        if any(p is None for p in proof):
            raise ValueError("Invalid proof calldata in request.")
        if self.cfg.dry_run:
            _log.info("DRY RUN withdraw request_id=%s", req.get("request_id"))
            return None
        await self._ensure_pool_contract()
        assert self._pool_contract is not None
        null_low = _parse_int(req.get("nullifier_low"))
        null_high = _parse_int(req.get("nullifier_high"))
        root_low = _parse_int(req.get("root_low"))
        root_high = _parse_int(req.get("root_high"))
        if None in (null_low, null_high, root_low, root_high):
            raise ValueError("Invalid root/nullifier values in request.")
        result = await self._pool_contract.functions["withdraw_relayed_u256"].invoke_v3(
            nullifier_low=null_low,
            nullifier_high=null_high,
            root_low=root_low,
            root_high=root_high,
            pool_type=int(req["pool_type"]),
            zk_proof=[int(p) for p in proof],
            auto_estimate=True,
        )
        tx_hash = hex(result.hash)
        if self.cfg.wait_for_tx:
            await result.wait_for_acceptance()
        return tx_hash

    async def _submit_deposit(self, req: dict) -> Optional[str]:
        if self.cfg.use_cli:
            return await self._submit_deposit_cli(req)
        amount = _parse_int(req.get("amount_wei"))
        if amount is None:
            raise ValueError("Invalid amount_wei in request.")
        amount_low = amount % (2**128)
        amount_high = amount // (2**128)
        if self.cfg.dry_run:
            _log.info("DRY RUN deposit request_id=%s amount=%s", req.get("request_id"), amount)
            return None
        await self._ensure_pool_contract()
        assert self._pool_contract is not None
        commitment_low = _parse_int(req.get("commitment_low"))
        commitment_high = _parse_int(req.get("commitment_high"))
        if None in (commitment_low, commitment_high):
            raise ValueError("Invalid commitment values in request.")
        result = await self._pool_contract.functions["deposit_u256"].invoke_v3(
            commitment_low=commitment_low,
            commitment_high=commitment_high,
            amount={"low": amount_low, "high": amount_high},
            auto_estimate=True,
        )
        tx_hash = hex(result.hash)
        if self.cfg.wait_for_tx:
            await result.wait_for_acceptance()
        return tx_hash

    async def _claim_exists_onchain(self, claim_low: int, claim_high: int) -> bool:
        if not self.cfg.hashed_withdraw_pool_address:
            raise RuntimeError("HASHED_WITHDRAW_POOL_ADDRESS not configured.")
        data = await self._cli_call(
            self.cfg.hashed_withdraw_pool_address,
            "is_claimed_u256",
            [str(claim_low), str(claim_high)],
        )
        if not data:
            return False
        try:
            return int(data[0], 16) != 0
        except Exception:
            return int(data[0]) != 0

    async def _submit_claim_payout(self, req: dict) -> Optional[str]:
        if self.cfg.ledger_payout_mode == "internal":
            claim_hash = _parse_int(req.get("claim_hash"))
            if claim_hash is None:
                raise ValueError("Invalid claim_hash in claim request.")
            claim_low = claim_hash % (2**128)
            claim_high = claim_hash // (2**128)
            if self.cfg.dry_run:
                _log.info("DRY RUN ledger-only claim request_id=%s", req.get("request_id"))
                return "ledger-only"
            claimed = await self._claim_exists_onchain(claim_low, claim_high)
            if not claimed:
                raise ValueError("Claim not registered on-chain.")
            _log.info("Ledger-only claim request_id=%s credited off-chain", req.get("request_id"))
            return "ledger-only"
        if self.cfg.use_cli:
            return await self._submit_claim_payout_cli(req)
        amount = _parse_int(req.get("amount_wei"))
        if amount is None:
            raise ValueError("Invalid amount_wei in claim request.")
        amount_low = amount % (2**128)
        amount_high = amount // (2**128)
        proof = [_parse_int(p) for p in req.get("proof_calldata", [])]
        if any(p is None for p in proof):
            raise ValueError("Invalid proof calldata in claim request.")
        if self.cfg.dry_run:
            _log.info("DRY RUN claim request_id=%s amount=%s", req.get("request_id"), amount)
            return None
        commitment_low = _parse_int(req.get("commitment_low"))
        commitment_high = _parse_int(req.get("commitment_high"))
        if None in (commitment_low, commitment_high):
            raise ValueError("Invalid commitment values in claim request.")
        claim_hash = _parse_int(req.get("claim_hash"))
        if claim_hash is None:
            raise ValueError("Invalid claim_hash in claim request.")
        claim_low = claim_hash % (2**128)
        claim_high = claim_hash // (2**128)

        if self.cfg.escrow_address:
            await self._ensure_escrow_contract()
            assert self._escrow_contract is not None
            result = await self._escrow_contract.functions["payout_claim_u256"].invoke_v3(
                claim_low=claim_low,
                claim_high=claim_high,
                amount={"low": amount_low, "high": amount_high},
                commitment_low=commitment_low,
                commitment_high=commitment_high,
                proof_calldata=[int(p) for p in proof],
                auto_estimate=True,
            )
        else:
            await self._ensure_confidential_transfer()
            assert self._confidential_transfer is not None
            result = await self._confidential_transfer.functions["private_deposit_u256"].invoke_v3(
                commitment_low=commitment_low,
                commitment_high=commitment_high,
                amount_public={"low": amount_low, "high": amount_high},
                proof_calldata=[int(p) for p in proof],
                auto_estimate=True,
            )
        tx_hash = hex(result.hash)
        if self.cfg.wait_for_tx:
            await result.wait_for_acceptance()
        return tx_hash

    async def _submit_withdrawal_cli(self, req: dict) -> Optional[str]:
        proof = [_parse_int(p) for p in req.get("proof_calldata", [])]
        if any(p is None for p in proof):
            raise ValueError("Invalid proof calldata in request.")
        if self.cfg.dry_run:
            _log.info("DRY RUN (CLI) withdraw request_id=%s", req.get("request_id"))
            return None
        if not self.cfg.pool_address:
            raise RuntimeError("FULLY_SHIELDED_POOL_ADDRESS not configured.")
        null_low = _parse_int(req.get("nullifier_low"))
        null_high = _parse_int(req.get("nullifier_high"))
        root_low = _parse_int(req.get("root_low"))
        root_high = _parse_int(req.get("root_high"))
        if None in (null_low, null_high, root_low, root_high):
            raise ValueError("Invalid root/nullifier values in request.")
        calldata = [
            str(null_low),
            str(null_high),
            str(root_low),
            str(root_high),
            str(int(req["pool_type"])),
            str(len(proof)),
            *[str(int(p)) for p in proof],
        ]
        return await self._cli_invoke(self.cfg.pool_address, "withdraw_relayed_u256", calldata)

    async def _submit_deposit_cli(self, req: dict) -> Optional[str]:
        amount = _parse_int(req.get("amount_wei"))
        if amount is None:
            raise ValueError("Invalid amount_wei in request.")
        if self.cfg.dry_run:
            _log.info("DRY RUN (CLI) deposit request_id=%s amount=%s", req.get("request_id"), amount)
            return None
        if not self.cfg.pool_address:
            raise RuntimeError("FULLY_SHIELDED_POOL_ADDRESS not configured.")
        commitment_low = _parse_int(req.get("commitment_low"))
        commitment_high = _parse_int(req.get("commitment_high"))
        if None in (commitment_low, commitment_high):
            raise ValueError("Invalid commitment values in request.")
        amount_low = amount % (2**128)
        amount_high = amount // (2**128)
        calldata = [
            str(commitment_low),
            str(commitment_high),
            str(amount_low),
            str(amount_high),
        ]
        return await self._cli_invoke(self.cfg.pool_address, "deposit_u256", calldata)

    async def _submit_claim_payout_cli(self, req: dict) -> Optional[str]:
        amount = _parse_int(req.get("amount_wei"))
        if amount is None:
            raise ValueError("Invalid amount_wei in claim request.")
        proof = [_parse_int(p) for p in req.get("proof_calldata", [])]
        if any(p is None for p in proof):
            raise ValueError("Invalid proof calldata in claim request.")
        if self.cfg.dry_run:
            _log.info("DRY RUN (CLI) claim request_id=%s amount=%s", req.get("request_id"), amount)
            return None
        commitment_low = _parse_int(req.get("commitment_low"))
        commitment_high = _parse_int(req.get("commitment_high"))
        if None in (commitment_low, commitment_high):
            raise ValueError("Invalid commitment values in claim request.")
        amount_low = amount % (2**128)
        amount_high = amount // (2**128)
        proof_str = [str(int(p)) for p in proof]
        if self.cfg.escrow_address:
            claim_hash = _parse_int(req.get("claim_hash"))
            if claim_hash is None:
                raise ValueError("Invalid claim_hash in claim request.")
            claim_low = claim_hash % (2**128)
            claim_high = claim_hash // (2**128)
            calldata = [
                str(claim_low),
                str(claim_high),
                str(amount_low),
                str(amount_high),
                str(commitment_low),
                str(commitment_high),
                str(len(proof_str)),
                *proof_str,
            ]
            return await self._cli_invoke(self.cfg.escrow_address, "payout_claim_u256", calldata)
        if not self.cfg.confidential_transfer_address:
            raise RuntimeError("CONFIDENTIAL_TRANSFER_ADDRESS not configured.")
        calldata = [
            str(commitment_low),
            str(commitment_high),
            str(amount_low),
            str(amount_high),
            str(len(proof_str)),
            *proof_str,
        ]
        return await self._cli_invoke(self.cfg.confidential_transfer_address, "private_deposit_u256", calldata)

    async def _submit_ledger_withdraw(self, req: dict) -> Optional[str]:
        """Submit one ledger-withdraw as ConfidentialTransfer.private_deposit_u256."""
        amount = _parse_int(req.get("amount_wei"))
        if amount is None:
            raise ValueError("Invalid amount_wei in ledger withdraw.")
        proof = [_parse_int(p) for p in req.get("proof_calldata", [])]
        if any(p is None for p in proof):
            raise ValueError("Invalid proof calldata in ledger withdraw.")
        commitment_low = _parse_int(req.get("commitment_low"))
        commitment_high = _parse_int(req.get("commitment_high"))
        if None in (commitment_low, commitment_high):
            raise ValueError("Invalid commitment in ledger withdraw.")
        if self.cfg.dry_run:
            _log.info("DRY RUN ledger withdraw withdraw_id=%s amount=%s", req.get("withdraw_id"), amount)
            return None
        amount_low = amount % (2**128)
        amount_high = amount // (2**128)
        if self.cfg.use_cli:
            proof_str = [str(int(p)) for p in proof]
            calldata = [
                str(commitment_low),
                str(commitment_high),
                str(amount_low),
                str(amount_high),
                str(len(proof_str)),
                *proof_str,
            ]
            return await self._cli_invoke(self.cfg.confidential_transfer_address, "private_deposit_u256", calldata)
        await self._ensure_confidential_transfer()
        assert self._confidential_transfer is not None
        result = await self._confidential_transfer.functions["private_deposit_u256"].invoke_v3(
            commitment_low=commitment_low,
            commitment_high=commitment_high,
            amount_public={"low": amount_low, "high": amount_high},
            proof_calldata=[int(p) for p in proof],
            auto_estimate=True,
        )
        tx_hash = hex(result.hash)
        if self.cfg.wait_for_tx:
            await result.wait_for_acceptance()
        return tx_hash

    async def process_once(self) -> None:
        if not self.cfg.enabled:
            return
        relayer_api.reload_state()
        ready_withdraws = relayer_api.get_ready_relay_requests(limit=self.cfg.max_batch)
        ready_deposits = relayer_api.get_ready_deposit_requests(limit=self.cfg.max_batch)
        ready_claims = relayer_api.get_ready_claim_requests(limit=self.cfg.max_batch)
        ready_ledger_withdraws = relayer_api.get_ready_ledger_withdraw_requests(limit=self.cfg.max_batch)
        stop_after_submit = not self.cfg.wait_for_tx
        submitted = False

        for req in ready_ledger_withdraws:
            withdraw_id = req.get("withdraw_id")
            try:
                tx_hash = await self._submit_ledger_withdraw(req)
                if tx_hash:
                    _log.info("Ledger withdraw %s tx=%s", withdraw_id, tx_hash)
                if not self.cfg.dry_run:
                    relayer_api.mark_ledger_withdraw_executed(int(withdraw_id), tx_hash=tx_hash)
                if stop_after_submit and tx_hash:
                    submitted = True
            except Exception as exc:
                _log.error("Ledger withdraw failed withdraw_id=%s err=%s", withdraw_id, exc)
            if submitted:
                return

        for req in ready_withdraws:
            request_id = req.get("request_id")
            try:
                tx_hash = await self._submit_withdrawal(req)
                if tx_hash:
                    _log.info("Relayed withdraw %s tx=%s", request_id, tx_hash)
                if not self.cfg.dry_run:
                    relayer_api.mark_relay_executed(int(request_id), tx_hash=tx_hash)
                if stop_after_submit and tx_hash:
                    submitted = True
            except Exception as exc:
                _log.error("Relayer withdraw failed request_id=%s err=%s", request_id, exc)
            if submitted:
                return

        for req in ready_deposits:
            request_id = req.get("request_id")
            try:
                tx_hash = await self._submit_deposit(req)
                if tx_hash:
                    _log.info("Relayed deposit %s tx=%s", request_id, tx_hash)
                if not self.cfg.dry_run:
                    relayer_api.mark_deposit_executed(int(request_id), tx_hash=tx_hash)
                if stop_after_submit and tx_hash:
                    submitted = True
            except Exception as exc:
                _log.error("Relayer deposit failed request_id=%s err=%s", request_id, exc)
            if submitted:
                return

        for req in ready_claims:
            request_id = req.get("request_id")
            try:
                tx_hash = await self._submit_claim_payout(req)
                if tx_hash:
                    _log.info("Relayed claim %s tx=%s", request_id, tx_hash)
                if not self.cfg.dry_run:
                    relayer_api.mark_claim_executed(int(request_id), tx_hash=tx_hash)
                if stop_after_submit and tx_hash:
                    submitted = True
            except Exception as exc:
                err_str = str(exc)
                if "Claim already paid" in err_str or "claim already paid" in err_str.lower():
                    _log.info("Claim request_id=%s already paid on-chain; marking executed", request_id)
                    if not self.cfg.dry_run:
                        relayer_api.mark_claim_executed(int(request_id), tx_hash=None)
                else:
                    _log.error("Relayer claim failed request_id=%s err=%s", request_id, exc)
            if submitted:
                return

    async def run_forever(self) -> None:
        if not self.cfg.enabled:
            _log.info("Relayer runner disabled (RELAYER_RUNNER_ENABLED=false).")
            return
        _log.info("Relayer runner starting (dry_run=%s poll=%.1fs max_batch=%s)", self.cfg.dry_run, self.cfg.poll_seconds, self.cfg.max_batch)
        while True:
            await self.process_once()
            await asyncio.sleep(self.cfg.poll_seconds)


async def maybe_start_relayer_runner() -> None:
    runner = RelayerRunner.from_env()
    if not runner.cfg.enabled:
        return
    asyncio.create_task(runner.run_forever())
