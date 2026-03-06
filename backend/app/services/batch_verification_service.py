"""
BatchVerifierService — backend service for the on-chain BatchVerifier contract.

Manages the Tier 2 optimistic execution pipeline:
  1. queue_action() — queues an action for batch verification
  2. submit_batch_proof() — submits a batch proof covering pending actions
  3. challenge_action() — fraud proof challenge during challenge window
  4. get_pending_actions() — lists unverified pending actions

Contract: BatchVerifier at BATCH_VERIFIER_ADDRESS (0x285f944a...)
Uses starknet_py Account.execute_v3 pattern (same as relayer_runner.py).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

from starknet_py.net.account.account import Account
from starknet_py.net.client_models import ResourceBoundsMapping
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.net.client_models import Call

from app import config

logger = logging.getLogger(__name__)


@dataclass
class PendingAction:
    """Mirrors the on-chain PendingAction struct."""
    user: str                # ContractAddress hex
    action_hash: str         # felt252 hex
    timestamp: int
    verified: bool
    index: int               # Position in pending queue


@dataclass
class BatchSubmission:
    """Result of a batch proof submission."""
    batch_proof_hash: str
    action_count: int
    tx_hash: str
    timestamp: int
    success: bool
    error: str = ""


class BatchVerifierService:
    """
    Backend service wrapping the on-chain BatchVerifier contract.

    Provides Python-callable methods for the optimistic batch execution flow.
    """

    def __init__(self):
        self._account: Optional[Account] = None
        self._client: Optional[FullNodeClient] = None

        # Contract address
        self._contract_address = int(
            os.getenv("BATCH_VERIFIER_ADDRESS", "0x285f944a") or "0x0", 16
        )

        # RPC + keys
        self._rpc_url = getattr(config, "STARKNET_RPC_URL", None) or os.getenv(
            "STARKNET_RPC_URL", "http://127.0.0.1:6060"
        )
        self._executor_key = os.getenv("EXECUTOR_PRIVATE_KEY", "")
        self._executor_address = os.getenv(
            "FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS", ""
        )

        # Local tracking
        self._local_queue: list[dict] = []
        self._batch_history: list[BatchSubmission] = []

    async def _ensure_account(self) -> Account:
        """Lazy-initialise the starknet_py Account."""
        if self._account is not None:
            return self._account

        if not self._executor_key or not self._executor_address:
            raise RuntimeError(
                "EXECUTOR_PRIVATE_KEY / FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS not set"
            )

        self._client = FullNodeClient(node_url=self._rpc_url)
        key_pair = KeyPair.from_private_key(int(self._executor_key, 16))
        self._account = Account(
            address=int(self._executor_address, 16),
            client=self._client,
            key_pair=key_pair,
            chain=StarknetChainId.SEPOLIA,
        )
        self._account._cairo_version = 1
        logger.info("BatchVerifier account initialised: %s", self._executor_address[:16])
        return self._account

    # ── Queue Management ──────────────────────────────────────────────

    async def queue_action(
        self,
        user_address: str,
        action_hash: str,
    ) -> dict:
        """
        Queue an action on-chain for batch verification.

        Calls: BatchVerifier.queue_action(user, action_hash)
        """
        account = await self._ensure_account()

        user_int = int(user_address, 16) if isinstance(user_address, str) else user_address
        hash_int = int(action_hash, 16) if isinstance(action_hash, str) else action_hash

        call = Call(
            to_addr=self._contract_address,
            selector=get_selector_from_name("queue_action"),
            calldata=[user_int, hash_int],
        )

        try:
            estimate = await account.estimate_fee(calls=[call])
            resource_bounds = ResourceBoundsMapping(
                l1_gas=estimate.resource_bounds.l1_gas,
                l2_gas=estimate.resource_bounds.l2_gas,
                l1_data_gas=getattr(estimate.resource_bounds, "l1_data_gas", None),
            )

            resp = await account.execute_v3(calls=[call], resource_bounds=resource_bounds)
            await account.client.wait_for_tx(resp.transaction_hash)

            tx_hash = hex(resp.transaction_hash)
            logger.info("Action queued on-chain: user=%s, hash=%s, tx=%s",
                        user_address[:12], action_hash[:12], tx_hash[:16])

            # Track locally
            self._local_queue.append({
                "user": user_address,
                "action_hash": action_hash,
                "tx_hash": tx_hash,
                "timestamp": int(time.time()),
            })

            return {"status": "queued", "tx_hash": tx_hash}

        except Exception as e:
            logger.error("queue_action failed: %s", e)

            # Fallback: track locally for later batch
            self._local_queue.append({
                "user": user_address,
                "action_hash": action_hash,
                "tx_hash": None,
                "timestamp": int(time.time()),
                "local_only": True,
            })

            return {"status": "queued_locally", "error": str(e)}

    async def get_pending_count(self) -> int:
        """Read the on-chain pending action count."""
        try:
            account = await self._ensure_account()
            call = Call(
                to_addr=self._contract_address,
                selector=get_selector_from_name("get_pending_count"),
                calldata=[],
            )
            result = await account.client.call_contract(call)
            return int(result[0]) if result else len(self._local_queue)
        except Exception as e:
            logger.warning("get_pending_count failed, using local count: %s", e)
            return len(self._local_queue)

    async def get_pending_action(self, index: int) -> PendingAction | None:
        """Read a specific pending action from on-chain storage."""
        try:
            account = await self._ensure_account()
            call = Call(
                to_addr=self._contract_address,
                selector=get_selector_from_name("get_pending_action"),
                calldata=[index, 0],  # u64 = low, high
            )
            result = await account.client.call_contract(call)
            if result and len(result) >= 4:
                return PendingAction(
                    user=hex(result[0]),
                    action_hash=hex(result[1]),
                    timestamp=int(result[2]),
                    verified=bool(result[3]),
                    index=index,
                )
        except Exception as e:
            logger.debug("get_pending_action(%d) failed: %s", index, e)
        return None

    # ── Batch Proof Submission ────────────────────────────────────────

    async def submit_batch_proof(
        self,
        batch_proof_hash: str,
        action_count: int,
    ) -> BatchSubmission:
        """
        Submit a batch proof covering `action_count` pending actions.

        Calls: BatchVerifier.submit_batch_proof(batch_proof_hash, action_count)
        """
        account = await self._ensure_account()

        hash_int = int(batch_proof_hash, 16) if isinstance(batch_proof_hash, str) else batch_proof_hash

        call = Call(
            to_addr=self._contract_address,
            selector=get_selector_from_name("submit_batch_proof"),
            calldata=[hash_int, action_count, 0],  # action_count as u64
        )

        try:
            estimate = await account.estimate_fee(calls=[call])
            resource_bounds = ResourceBoundsMapping(
                l1_gas=estimate.resource_bounds.l1_gas,
                l2_gas=estimate.resource_bounds.l2_gas,
                l1_data_gas=getattr(estimate.resource_bounds, "l1_data_gas", None),
            )

            resp = await account.execute_v3(calls=[call], resource_bounds=resource_bounds)
            await account.client.wait_for_tx(resp.transaction_hash)

            tx_hash = hex(resp.transaction_hash)
            submission = BatchSubmission(
                batch_proof_hash=batch_proof_hash,
                action_count=action_count,
                tx_hash=tx_hash,
                timestamp=int(time.time()),
                success=True,
            )

            self._batch_history.append(submission)

            # Clear local queue for submitted actions
            self._local_queue = self._local_queue[action_count:]

            logger.info(
                "Batch proof submitted: hash=%s, count=%d, tx=%s",
                batch_proof_hash[:16], action_count, tx_hash[:16],
            )
            return submission

        except Exception as e:
            logger.error("submit_batch_proof failed: %s", e)
            submission = BatchSubmission(
                batch_proof_hash=batch_proof_hash,
                action_count=action_count,
                tx_hash="",
                timestamp=int(time.time()),
                success=False,
                error=str(e),
            )
            self._batch_history.append(submission)
            return submission

    # ── Challenge Mechanism ───────────────────────────────────────────

    async def challenge_action(
        self,
        action_index: int,
        fraud_proof_hash: str,
    ) -> dict:
        """
        Challenge a pending action with a fraud proof.

        Calls: BatchVerifier.challenge_action(action_index, fraud_proof_hash)
        """
        account = await self._ensure_account()

        hash_int = int(fraud_proof_hash, 16) if isinstance(fraud_proof_hash, str) else fraud_proof_hash

        call = Call(
            to_addr=self._contract_address,
            selector=get_selector_from_name("challenge_action"),
            calldata=[action_index, 0, hash_int],  # index as u64
        )

        try:
            estimate = await account.estimate_fee(calls=[call])
            resource_bounds = ResourceBoundsMapping(
                l1_gas=estimate.resource_bounds.l1_gas,
                l2_gas=estimate.resource_bounds.l2_gas,
                l1_data_gas=getattr(estimate.resource_bounds, "l1_data_gas", None),
            )

            resp = await account.execute_v3(calls=[call], resource_bounds=resource_bounds)
            await account.client.wait_for_tx(resp.transaction_hash)

            tx_hash = hex(resp.transaction_hash)
            logger.info("Challenge submitted: index=%d, tx=%s", action_index, tx_hash[:16])
            return {"status": "challenged", "tx_hash": tx_hash}

        except Exception as e:
            logger.error("challenge_action failed: %s", e)
            return {"status": "error", "error": str(e)}

    # ── Automatic Batch Processing ────────────────────────────────────

    async def process_batch(self) -> BatchSubmission | None:
        """
        Automatically batch-prove all pending actions.

        1. Reads pending count from on-chain
        2. Generates a batch proof hash from all pending action hashes
        3. Submits the batch proof
        """
        pending_count = await self.get_pending_count()
        if pending_count == 0:
            logger.debug("No pending actions to batch")
            return None

        # Build batch proof hash from pending actions
        hasher = hashlib.sha256()
        for i in range(pending_count):
            action = await self.get_pending_action(i)
            if action:
                hasher.update(action.action_hash.encode())

        # If on-chain read fails, use local queue
        if hasher.digest() == hashlib.sha256().digest():
            for item in self._local_queue:
                hasher.update(item["action_hash"].encode())

        batch_hash = "0x" + hasher.hexdigest()

        return await self.submit_batch_proof(batch_hash, pending_count)

    # ── Query ─────────────────────────────────────────────────────────

    async def get_challenge_window(self) -> int:
        """Read the challenge window (seconds) from on-chain."""
        try:
            account = await self._ensure_account()
            call = Call(
                to_addr=self._contract_address,
                selector=get_selector_from_name("get_challenge_window"),
                calldata=[],
            )
            result = await account.client.call_contract(call)
            return int(result[0]) if result else 3600
        except Exception as e:
            logger.debug("get_challenge_window failed: %s", e)
            return 3600  # Default 1 hour

    def get_batch_history(self) -> list[dict]:
        """Return local batch submission history."""
        return [
            {
                "batch_proof_hash": b.batch_proof_hash[:16] + "...",
                "action_count": b.action_count,
                "tx_hash": b.tx_hash[:16] + "..." if b.tx_hash else "",
                "timestamp": b.timestamp,
                "success": b.success,
            }
            for b in self._batch_history
        ]

    def get_local_queue(self) -> list[dict]:
        """Return the local pending action queue."""
        return self._local_queue.copy()


# ── Singleton ─────────────────────────────────────────────────────────
_service: BatchVerifierService | None = None


def get_batch_verifier_service() -> BatchVerifierService:
    global _service
    if _service is None:
        _service = BatchVerifierService()
    return _service
