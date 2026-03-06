"""
RelayerVaultProcessor — processes vault v2 jobs: deploy commits, deploy executes,
and withdrawal payouts.

In production, each process_* method would build and submit Starknet transactions.
Currently uses simulated tx hashes for the local accounting flow.
"""

import hashlib
import time
from typing import Optional


class RelayerVaultProcessor:

    def __init__(self, deploy_svc=None, withdrawal_svc=None):
        self._deploy_svc = deploy_svc
        self._withdrawal_svc = withdrawal_svc

    def process_pending_commits(self):
        """Find CREATED deploy proposals and submit commit_proposal transactions."""
        if not self._deploy_svc:
            return []
        results = []
        pending = self._deploy_svc.list_by_status("CREATED")
        for proposal in pending:
            simulated_tx = "0x" + hashlib.sha256(
                f"commit:{proposal['proposal_hash']}:{time.time()}".encode()
            ).hexdigest()[:40]
            self._deploy_svc.mark_committed(proposal["proposal_hash"], tx_hash=simulated_tx)
            results.append({
                "proposal_hash": proposal["proposal_hash"],
                "status": "COMMITTED",
                "tx_hash": simulated_tx,
            })
        return results

    def process_pending_executes(self):
        """Find COMMITTED deploy proposals (past cooldown) and submit execute_proposal transactions."""
        if not self._deploy_svc:
            return []
        results = []
        committed = self._deploy_svc.list_by_status("COMMITTED")
        for proposal in committed:
            simulated_tx = "0x" + hashlib.sha256(
                f"execute:{proposal['proposal_hash']}:{time.time()}".encode()
            ).hexdigest()[:40]
            self._deploy_svc.settle_execution(proposal["proposal_hash"], tx_hash=simulated_tx)
            results.append({
                "proposal_hash": proposal["proposal_hash"],
                "status": "EXECUTED",
                "tx_hash": simulated_tx,
            })
        return results

    def process_pending_withdrawals(self):
        """Find REQUESTED withdrawals and submit payout transactions."""
        if not self._withdrawal_svc:
            return []
        results = []
        pending = self._withdrawal_svc.list_pending()
        for wd in pending:
            if wd["status"] != "REQUESTED":
                continue
            simulated_tx = "0x" + hashlib.sha256(
                f"withdraw:{wd['withdrawal_id']}:{time.time()}".encode()
            ).hexdigest()[:40]
            self._withdrawal_svc.mark_sent(wd["withdrawal_id"], tx_hash=simulated_tx)
            results.append({
                "withdrawal_id": wd["withdrawal_id"],
                "status": "SENT",
                "tx_hash": simulated_tx,
            })
        return results

    def process_all(self):
        """Run all pending job types."""
        commits = self.process_pending_commits()
        executes = self.process_pending_executes()
        withdrawals = self.process_pending_withdrawals()
        return {
            "commits": commits,
            "executes": executes,
            "withdrawals": withdrawals,
        }
