"""
RelayerVaultProcessor — processes vault v2 jobs: deploy commits, deploy executes,
and withdrawal payouts.

Submits real Starknet transactions via starknet_py Account.execute_v3.
Uses the same Account / RPC pattern as CommitRevealService.
"""

from __future__ import annotations

import json
import logging
import os
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


class RelayerVaultProcessor:

    def __init__(self, deploy_svc=None, withdrawal_svc=None):
        self._deploy_svc = deploy_svc
        self._withdrawal_svc = withdrawal_svc
        self._account: Optional[Account] = None

        self._vault_controller = _parse_int(
            os.getenv("VAULT_CONTROLLER_ADDRESS", "0x0")
        )
        self._rpc_url = os.getenv("STARKNET_RPC_URL", "http://127.0.0.1:6060")
        self._executor_key = os.getenv("EXECUTOR_PRIVATE_KEY", "")
        self._executor_address = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS", "")

    async def _ensure_account(self) -> Account:
        if self._account is not None:
            return self._account
        if not self._executor_key or not self._executor_address:
            raise RuntimeError("EXECUTOR_PRIVATE_KEY or executor address not configured")
        client = FullNodeClient(node_url=self._rpc_url)
        key_pair = KeyPair.from_private_key(_parse_int(self._executor_key))
        self._account = Account(
            address=_parse_int(self._executor_address),
            client=client,
            key_pair=key_pair,
            chain=StarknetChainId.SEPOLIA,
        )
        self._account._cairo_version = 1
        return self._account

    async def _submit_call(self, call: Call, description: str) -> str | None:
        """Submit an on-chain transaction. Returns tx_hash hex string or None."""
        account = await self._ensure_account()
        try:
            resp = await account.execute_v3(calls=[call], auto_estimate=True)
            await account.client.wait_for_tx(resp.transaction_hash)
            tx_hash = hex(resp.transaction_hash)
            logger.info("Relayer %s: tx=%s", description, tx_hash[:20])
            return tx_hash
        except Exception as e:
            logger.error("Relayer %s failed: %s", description, e)
            return None

    async def process_pending_commits(self):
        """Find CREATED deploy proposals → submit commit_proposal on-chain."""
        if not self._deploy_svc:
            return []
        results = []
        pending = self._deploy_svc.list_by_status("CREATED")
        for proposal in pending:
            # Recompute proposal_hash as Poseidon from stored adapters/amounts/salt
            adapters = json.loads(proposal["adapters"]) if isinstance(proposal["adapters"], str) else proposal["adapters"]
            amounts = [int(a) for a in (json.loads(proposal["amounts"]) if isinstance(proposal["amounts"], str) else proposal["amounts"])]
            salt_str = proposal.get("salt", "0")
            salt = _parse_int(salt_str) if isinstance(salt_str, str) and salt_str.startswith("0x") else int(salt_str, 16) if isinstance(salt_str, str) and len(salt_str) == 32 else int(salt_str) if isinstance(salt_str, str) else salt_str

            # Poseidon hash: [salt, adapter0, amount0_low, amount0_high, ...]
            hash_elements = [salt]
            for addr, amt in zip(adapters, amounts):
                addr_int = _parse_int(addr) if isinstance(addr, str) else addr
                hash_elements.append(addr_int)
                hash_elements.append(amt & ((1 << 128) - 1))  # low
                hash_elements.append(amt >> 128)                # high
            proposal_hash_int = poseidon_hash_many(hash_elements)

            commit_call = Call(
                to_addr=self._vault_controller,
                selector=get_selector_from_name("commit_proposal"),
                calldata=[proposal_hash_int],
            )
            tx_hash = await self._submit_call(commit_call, f"commit_proposal({proposal['proposal_hash'][:12]})")

            if tx_hash:
                self._deploy_svc.mark_committed(proposal["proposal_hash"], tx_hash=tx_hash)
                results.append({
                    "proposal_hash": proposal["proposal_hash"],
                    "status": "COMMITTED",
                    "tx_hash": tx_hash,
                })
            else:
                logger.warning("Commit failed for %s — leaving as CREATED", proposal["proposal_hash"][:12])
        return results

    async def process_pending_executes(self):
        """Find COMMITTED deploy proposals (past cooldown) → submit execute_proposal on-chain."""
        if not self._deploy_svc:
            return []
        results = []
        committed = self._deploy_svc.list_by_status("COMMITTED")
        for proposal in committed:
            adapters = json.loads(proposal["adapters"]) if isinstance(proposal["adapters"], str) else proposal["adapters"]
            amounts = [int(a) for a in (json.loads(proposal["amounts"]) if isinstance(proposal["amounts"], str) else proposal["amounts"])]
            salt_str = proposal.get("salt", "0")
            salt = _parse_int(salt_str) if isinstance(salt_str, str) and salt_str.startswith("0x") else int(salt_str, 16) if isinstance(salt_str, str) and len(salt_str) == 32 else int(salt_str) if isinstance(salt_str, str) else salt_str

            # Build execute_proposal calldata:
            # [len(adapters), adapter0, adapter1, ..., len(amounts), amount0_low, amount0_high, ..., salt]
            calldata = [len(adapters)]
            for addr in adapters:
                calldata.append(_parse_int(addr) if isinstance(addr, str) else addr)
            calldata.append(len(amounts))
            for amt in amounts:
                calldata.extend([amt & ((1 << 128) - 1), amt >> 128])
            calldata.append(salt)

            execute_call = Call(
                to_addr=self._vault_controller,
                selector=get_selector_from_name("execute_proposal"),
                calldata=calldata,
            )
            tx_hash = await self._submit_call(execute_call, f"execute_proposal({proposal['proposal_hash'][:12]})")

            if tx_hash:
                self._deploy_svc.settle_execution(proposal["proposal_hash"], tx_hash=tx_hash)
                results.append({
                    "proposal_hash": proposal["proposal_hash"],
                    "status": "EXECUTED",
                    "tx_hash": tx_hash,
                })
            else:
                logger.warning("Execute failed for %s — leaving as COMMITTED", proposal["proposal_hash"][:12])
        return results

    async def process_pending_withdrawals(self):
        """Find REQUESTED withdrawals → submit ERC20 transfer payout on-chain."""
        if not self._withdrawal_svc:
            return []
        results = []
        pending = self._withdrawal_svc.list_pending()
        for wd in pending:
            if wd["status"] != "REQUESTED":
                continue

            destination = _parse_int(wd["destination"]) if isinstance(wd["destination"], str) else wd["destination"]
            amount = int(wd["amount_wei"])
            token_addr = _parse_int(wd["token"]) if isinstance(wd["token"], str) else wd["token"]

            # ERC20 transfer(recipient, amount_u256)
            transfer_call = Call(
                to_addr=token_addr,
                selector=get_selector_from_name("transfer"),
                calldata=[destination, amount & ((1 << 128) - 1), amount >> 128],
            )
            tx_hash = await self._submit_call(transfer_call, f"withdrawal({wd['withdrawal_id'][:12]})")

            if tx_hash:
                self._withdrawal_svc.mark_sent(wd["withdrawal_id"], tx_hash=tx_hash)
                results.append({
                    "withdrawal_id": wd["withdrawal_id"],
                    "status": "SENT",
                    "tx_hash": tx_hash,
                })
            else:
                logger.warning("Withdrawal tx failed for %s — leaving as REQUESTED", wd["withdrawal_id"][:12])
        return results

    async def process_all(self):
        """Run all pending job types."""
        commits = await self.process_pending_commits()
        executes = await self.process_pending_executes()
        withdrawals = await self.process_pending_withdrawals()
        return {
            "commits": commits,
            "executes": executes,
            "withdrawals": withdrawals,
        }
