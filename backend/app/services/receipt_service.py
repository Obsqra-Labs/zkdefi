"""
Constraint Receipt Service

Generates and manages on-chain receipts for agent actions.
Receipts provide transparency without revealing strategy details.
Persists orchestration receipts to data/orchestration_receipts.json so they survive restart.
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

_RECEIPTS_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "orchestration_receipts.json"


def _load_receipts() -> tuple[dict[str, dict], dict[str, list[str]]]:
    """Load receipts from file if present."""
    if not _RECEIPTS_FILE.exists():
        return {}, {}
    try:
        raw = _RECEIPTS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data.get("receipts", {}), data.get("user_receipts", {})
    except Exception:
        return {}, {}


def _save_receipts(receipts: dict[str, dict], user_receipts: dict[str, list[str]]) -> None:
    """Persist receipts to file."""
    _RECEIPTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _RECEIPTS_FILE.write_text(
        json.dumps({"receipts": receipts, "user_receipts": user_receipts}, indent=2),
        encoding="utf-8",
    )


class ReceiptService:
    """
    Service for managing constraint receipts. Orchestration receipts are persisted to file.
    """
    
    def __init__(self):
        self._receipts: dict[str, dict]
        self._user_receipts: dict[str, list[str]]
        self._receipts, self._user_receipts = _load_receipts()
    
    def _persist(self) -> None:
        _save_receipts(self._receipts, self._user_receipts)
    
    async def create_receipt(
        self,
        user_address: str,
        constraints_hash: str,
        proof_hash: str,
        action_type: str,  # 'deposit', 'withdraw', 'rebalance'
        protocol_id: int,
        amount: int
    ) -> dict[str, Any]:
        """
        Create a new constraint receipt.
        
        Returns receipt with ID for on-chain submission.
        """
        timestamp = datetime.utcnow().isoformat()
        
        # Generate receipt ID
        receipt_id = "0x" + hashlib.sha256(
            f"{user_address}{constraints_hash}{proof_hash}{timestamp}".encode()
        ).hexdigest()[:64]
        
        receipt = {
            "receipt_id": receipt_id,
            "user": user_address,
            "constraints_hash": constraints_hash,
            "proof_hash": proof_hash,
            "action_type": action_type,
            "protocol_id": protocol_id,
            "amount": amount,
            "timestamp": timestamp,
            "on_chain": False
        }
        
        # Store locally
        self._receipts[receipt_id] = receipt
        
        key = (user_address or "").strip().lower()
        if key not in self._user_receipts:
            self._user_receipts[key] = []
        self._user_receipts[key].append(receipt_id)
        self._persist()
        return receipt
    
    async def confirm_receipt(
        self,
        receipt_id: str,
        tx_hash: str
    ) -> dict[str, Any]:
        """
        Confirm receipt was submitted on-chain.
        """
        if receipt_id in self._receipts:
            self._receipts[receipt_id]["on_chain"] = True
            self._receipts[receipt_id]["tx_hash"] = tx_hash
            self._persist()
        return {
            "receipt_id": receipt_id,
            "tx_hash": tx_hash,
            "status": "confirmed"
        }
    
    async def get_receipt(self, receipt_id: str) -> dict[str, Any] | None:
        """Get receipt by ID."""
        return self._receipts.get(receipt_id)
    
    async def get_user_receipts(self, user_address: str) -> list[dict[str, Any]]:
        """Get all receipts for a user. Address is normalized to lowercase for lookup."""
        key = (user_address or "").strip().lower()
        receipt_ids = self._user_receipts.get(key, [])
        return [self._receipts[rid] for rid in receipt_ids if rid in self._receipts]

    def delete_user_receipts(self, user_address: str) -> dict[str, int]:
        """
        Delete all persisted receipts for a user.
        Useful for deterministic local testing resets.
        """
        key = (user_address or "").strip().lower()
        if not key:
            return {"removed_receipts": 0, "removed_index_entries": 0}

        removed_receipts = 0
        removed_index_entries = 0

        direct_ids = list(self._user_receipts.get(key, []))
        for rid in direct_ids:
            if rid in self._receipts:
                del self._receipts[rid]
                removed_receipts += 1

        if key in self._user_receipts:
            removed_index_entries += len(self._user_receipts[key])
            del self._user_receipts[key]

        # Sweep for stale rows where index is missing but receipt.user still matches.
        stale_ids = [
            rid for rid, row in self._receipts.items()
            if str(row.get("user") or "").strip().lower() == key
        ]
        for rid in stale_ids:
            if rid in self._receipts:
                del self._receipts[rid]
                removed_receipts += 1

        # Remove deleted IDs from all user indices.
        existing_ids = set(self._receipts.keys())
        for ukey, ids in list(self._user_receipts.items()):
            filtered = [rid for rid in ids if rid in existing_ids]
            removed_index_entries += max(0, len(ids) - len(filtered))
            if filtered:
                self._user_receipts[ukey] = filtered
            else:
                del self._user_receipts[ukey]

        self._persist()
        return {
            "removed_receipts": removed_receipts,
            "removed_index_entries": removed_index_entries,
        }

    def append_proof_receipt(
        self,
        user_address: str,
        proof_type: str,
        threshold_or_model: str,
        result: str,
        snapshot_hash: str | None = None,
        tx_hash: str | None = None,
        fact_hash: str | None = None,
        model_hash: str | None = None,
        pool_id: str | None = None,
        withdraw_source: str | None = None,
    ) -> dict[str, Any]:
        """
        Append a proof-oriented receipt (risk_score, pool_safety, rebalance, etc.).
        Used by zkML and rebalancer; readable by risk passport and proof timeline.
        """
        timestamp = datetime.utcnow().isoformat()
        receipt_id = "0x" + hashlib.sha256(
            f"{user_address}{proof_type}{threshold_or_model}{result}{timestamp}".encode()
        ).hexdigest()[:64]
        receipt = {
            "receipt_id": receipt_id,
            "user": user_address,
            "proof_type": proof_type,
            "threshold_or_model": threshold_or_model,
            "result": result,
            "timestamp": timestamp,
            "snapshot_hash": snapshot_hash,
            "tx_hash": tx_hash,
            "fact_hash": fact_hash,
            "model_hash": model_hash,
            "pool_id": pool_id,
            "withdraw_source": withdraw_source,
            "on_chain": False,
        }
        self._receipts[receipt_id] = receipt
        key = (user_address or "").strip().lower()
        if key not in self._user_receipts:
            self._user_receipts[key] = []
        self._user_receipts[key].append(receipt_id)
        self._persist()
        return receipt

    def append_policy_compile_receipt(
        self,
        user_address: str,
        action_type: str,
        execution_intent: str,
        effective_policy_hash: str | None,
        execution_path: str | None,
        can_execute: bool,
        blocking_reasons: list[str] | None = None,
        warnings: list[str] | None = None,
        shared_pool_id: str | None = None,
    ) -> dict[str, Any]:
        """Append policy compile receipt for Vault OS route decisions."""
        result = "pass" if can_execute else "blocked"
        details = {
            "action_type": action_type,
            "execution_intent": execution_intent,
            "execution_path": execution_path,
            "blocking_reasons": blocking_reasons or [],
            "warnings": warnings or [],
            "shared_pool_id": shared_pool_id,
        }
        return self.append_proof_receipt(
            user_address=user_address,
            proof_type="policy_compile",
            threshold_or_model="vault_policy_compiler_v1",
            result=f"{result}:{json.dumps(details, separators=(',', ':'))}",
            snapshot_hash=effective_policy_hash,
            pool_id=shared_pool_id,
        )

    def append_shared_pool_execution_receipt(
        self,
        shared_pool_id: str,
        manager_address: str,
        member_address: str,
        proposal_id: str,
        status: str,
        compile_hash: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Append shared pool execution receipt for manager/member execution timeline."""
        return self.append_proof_receipt(
            user_address=member_address,
            proof_type="shared_pool_execution",
            threshold_or_model=proposal_id,
            result=f"{status}:{reason or ''}",
            snapshot_hash=compile_hash,
            pool_id=shared_pool_id,
            tx_hash=None,
            fact_hash=None,
            model_hash=manager_address,
        )

    def get_receipts_by_pool(self, pool_id: str) -> list[dict[str, Any]]:
        """Get all receipts that have this pool_id (e.g. pool_safety runs)."""
        return [
            r for r in self._receipts.values()
            if r.get("pool_id") == pool_id
        ]
    
    async def generate_constraints_hash(
        self,
        max_position: int,
        max_daily_yield_bps: int,
        min_withdraw_delay: int
    ) -> str:
        """Generate hash of user constraints."""
        return "0x" + hashlib.sha256(
            f"{max_position}{max_daily_yield_bps}{min_withdraw_delay}".encode()
        ).hexdigest()[:64]


# Singleton instance
_receipt_service: ReceiptService | None = None


def get_receipt_service() -> ReceiptService:
    """Get or create the receipt service singleton."""
    global _receipt_service
    if _receipt_service is None:
        _receipt_service = ReceiptService()
    return _receipt_service
