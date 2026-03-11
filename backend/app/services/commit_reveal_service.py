"""
Commit-Reveal Service — wires agent rebalancer to on-chain VaultController + IntentCommitment.

Implements the MEV-resistant commit-reveal flow:
  1. Agent decides on a rebalance → generates proposal hash
  2. commit_proposal(proposal_hash) → on-chain VaultController
  3. submit_commitment(commitment, chain_id, block_number) → IntentCommitment
  4. Wait for cooldown period
  5. execute_proposal(adapters, amounts, salt) → VaultController (verifies Poseidon match)
  6. use_commitment(commitment, action_hash) → IntentCommitment (marks consumed)

Contracts:
  - VaultController at VAULT_CONTROLLER_ADDRESS
  - IntentCommitment at CONSTRAINT_RECEIPT_ADDRESS
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

from starknet_py.net.account.account import Account
from starknet_py.net.client_models import Call
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.selector import get_selector_from_name
from poseidon_py.poseidon_hash import poseidon_hash_many

logger = logging.getLogger(__name__)


def _parse_int(val: str) -> int:
    val = val.strip()
    return int(val, 16) if val.startswith("0x") else int(val)


@dataclass
class CommitRevealState:
    """Tracks a commit-reveal cycle."""
    proposal_hash: str
    commitment_hash: str
    committed_at_block: int
    committed_at_ts: int
    adapters: list[str]
    amounts: list[int]
    salt: int
    executed: bool = False
    execute_tx_hash: str = ""
    commit_tx_hash: str = ""


class CommitRevealService:
    """
    On-chain commit-reveal for MEV-resistant rebalancing.

    Wraps VaultController.commit_proposal / execute_proposal
    and IntentCommitment.submit_commitment / use_commitment.
    """

    def __init__(self):
        self._account: Optional[Account] = None
        self._client: Optional[FullNodeClient] = None

        self._vault_controller = _parse_int(
            os.getenv("VAULT_CONTROLLER_ADDRESS", "0x0")
        )
        self._intent_commitment = _parse_int(
            os.getenv("CONSTRAINT_RECEIPT_ADDRESS", "0x0")
        )

        self._rpc_url = os.getenv("STARKNET_RPC_URL", "http://127.0.0.1:6060")
        self._executor_key = os.getenv("EXECUTOR_PRIVATE_KEY", "")
        self._executor_address = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS", "")

        # Track pending commit-reveal cycles
        self._pending: dict[str, CommitRevealState] = {}

    async def _ensure_account(self) -> Account:
        if self._account is not None:
            return self._account

        if not self._executor_key or not self._executor_address:
            raise RuntimeError("EXECUTOR_PRIVATE_KEY not configured")

        self._client = FullNodeClient(node_url=self._rpc_url)
        key_pair = KeyPair.from_private_key(_parse_int(self._executor_key))
        self._account = Account(
            address=_parse_int(self._executor_address),
            client=self._client,
            key_pair=key_pair,
            chain=StarknetChainId.SEPOLIA,
        )
        self._account._cairo_version = 1
        return self._account

    async def _submit_call(self, call: Call, description: str) -> str | None:
        """Submit an on-chain transaction. Returns tx_hash hex or None."""
        account = await self._ensure_account()
        try:
            resp = await account.execute_v3(calls=[call], auto_estimate=True)
            await account.client.wait_for_tx(resp.transaction_hash)
            tx_hash = hex(resp.transaction_hash)
            logger.info("%s: tx=%s", description, tx_hash[:20])
            return tx_hash
        except Exception as e:
            logger.error("%s failed: %s", description, e)
            return None

    async def _get_block_number(self) -> int:
        """Get current block number from RPC."""
        account = await self._ensure_account()
        try:
            block = await account.client.get_block("latest")
            return block.block_number
        except Exception:
            return 0

    # ── Phase 1: Commit ───────────────────────────────────────────────

    async def commit_rebalance(
        self,
        adapters: list[str],
        amounts: list[int],
        salt: int | None = None,
    ) -> CommitRevealState:
        """
        Phase 1: Commit a rebalance proposal on-chain.

        Computes the Poseidon hash that VaultController will verify on execute.
        Also submits an IntentCommitment for replay protection.

        Args:
            adapters: List of adapter contract addresses
            amounts: List of u256 amounts per adapter
            salt: Random salt for the commitment (auto-generated if None)

        Returns:
            CommitRevealState tracking the pending commit-reveal cycle.
        """
        if salt is None:
            salt = int.from_bytes(os.urandom(16), "big") % (2**128)

        # Compute proposal hash using Poseidon — MUST match VaultController's
        # on-chain poseidon_hash_span([salt, adapter0, amount0_low, amount0_high, ...])
        hash_elements = [salt]
        for addr, amt in zip(adapters, amounts):
            addr_int = _parse_int(addr) if isinstance(addr, str) else addr
            hash_elements.append(addr_int)
            hash_elements.append(amt & ((1 << 128) - 1))  # low
            hash_elements.append(amt >> 128)                # high
        proposal_hash_int = poseidon_hash_many(hash_elements)
        proposal_hash = hex(proposal_hash_int)

        block_num = await self._get_block_number()

        # 1. VaultController.commit_proposal(proposal_hash)
        commit_call = Call(
            to_addr=self._vault_controller,
            selector=get_selector_from_name("commit_proposal"),
            calldata=[proposal_hash_int],
        )
        commit_tx = await self._submit_call(commit_call, "commit_proposal")

        # 2. IntentCommitment.submit_commitment(commitment, chain_id, block_number)
        chain_id = 0x534e5f5345504f4c4941  # SN_SEPOLIA as felt
        intent_call = Call(
            to_addr=self._intent_commitment,
            selector=get_selector_from_name("submit_commitment"),
            calldata=[proposal_hash_int, chain_id, block_num, 0],  # block as u64
        )
        if commit_tx:
            await self._submit_call(intent_call, "submit_commitment")

        state = CommitRevealState(
            proposal_hash=proposal_hash,
            commitment_hash=proposal_hash,  # Same for simplicity
            committed_at_block=block_num,
            committed_at_ts=int(time.time()),
            adapters=adapters,
            amounts=amounts,
            salt=salt,
            commit_tx_hash=commit_tx or "",
        )

        self._pending[proposal_hash] = state
        logger.info(
            "Commit-reveal: committed hash=%s, block=%d, tx=%s",
            proposal_hash[:16], block_num, (commit_tx or "none")[:16],
        )
        return state

    # ── Phase 2: Execute (after cooldown) ─────────────────────────────

    async def execute_rebalance(self, proposal_hash: str) -> CommitRevealState:
        """
        Phase 2: Execute a previously committed rebalance.

        Calls VaultController.execute_proposal with the original adapters, amounts, salt.
        The contract verifies the Poseidon hash matches the committed hash.

        Also calls IntentCommitment.use_commitment to mark it consumed.
        """
        state = self._pending.get(proposal_hash)
        if not state:
            raise ValueError(f"No pending commit for {proposal_hash[:16]}")

        if state.executed:
            raise ValueError("Already executed")

        # Build execute calldata
        calldata = [len(state.adapters)]
        for addr in state.adapters:
            calldata.append(_parse_int(addr) if isinstance(addr, str) else addr)
        calldata.append(len(state.amounts))
        for amt in state.amounts:
            calldata.extend([amt & ((1 << 128) - 1), amt >> 128])
        calldata.append(state.salt)

        execute_call = Call(
            to_addr=self._vault_controller,
            selector=get_selector_from_name("execute_proposal"),
            calldata=calldata,
        )
        exec_tx = await self._submit_call(execute_call, "execute_proposal")

        # Mark commitment as used
        if exec_tx:
            proposal_hash_int = int(proposal_hash, 16) % (2**251)
            action_hash = poseidon_hash_many([proposal_hash_int, get_selector_from_name("execute")])
            use_call = Call(
                to_addr=self._intent_commitment,
                selector=get_selector_from_name("use_commitment"),
                calldata=[proposal_hash_int, action_hash],
            )
            await self._submit_call(use_call, "use_commitment")

        state.executed = True
        state.execute_tx_hash = exec_tx or ""

        logger.info(
            "Commit-reveal: executed hash=%s, tx=%s",
            proposal_hash[:16], (exec_tx or "none")[:16],
        )
        return state

    # ── Query ─────────────────────────────────────────────────────────

    async def check_commitment_valid(self, commitment_hash: str) -> bool:
        """Check if a commitment is still valid on-chain."""
        try:
            account = await self._ensure_account()
            hash_int = _parse_int(commitment_hash)
            call = Call(
                to_addr=self._intent_commitment,
                selector=get_selector_from_name("is_commitment_valid"),
                calldata=[hash_int],
            )
            result = await account.client.call_contract(call)
            return bool(result[0]) if result else False
        except Exception as e:
            logger.debug("check_commitment_valid failed: %s", e)
            return False

    def get_pending_commits(self) -> list[dict]:
        """List all pending (uncommitted) commit-reveal cycles."""
        return [
            {
                "proposal_hash": state.proposal_hash[:16] + "...",
                "committed_at_block": state.committed_at_block,
                "executed": state.executed,
                "age_seconds": int(time.time()) - state.committed_at_ts,
            }
            for state in self._pending.values()
            if not state.executed
        ]


# ── Singleton ─────────────────────────────────────────────────────────
_service: CommitRevealService | None = None


def get_commit_reveal_service() -> CommitRevealService:
    global _service
    if _service is None:
        _service = CommitRevealService()
    return _service
