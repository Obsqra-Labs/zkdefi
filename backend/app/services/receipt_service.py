"""
Constraint Receipt Service

Generates and manages on-chain receipts for agent actions.
Receipts provide transparency without revealing strategy details.
"""
import hashlib
from datetime import datetime
from typing import Any

from app.services.zkdefi_agent_service import ZkdefiAgentService


class ReceiptService:
    """
    Service for managing constraint receipts.
    """
    
    def __init__(self):
        self.agent_service = ZkdefiAgentService()
        
        # In-memory receipt tracking
        self._receipts: dict[str, dict] = {}
        self._user_receipts: dict[str, list[str]] = {}
    
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
        
        if user_address not in self._user_receipts:
            self._user_receipts[user_address] = []
        self._user_receipts[user_address].append(receipt_id)
        
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
        
        return {
            "receipt_id": receipt_id,
            "tx_hash": tx_hash,
            "status": "confirmed"
        }
    
    async def get_receipt(self, receipt_id: str) -> dict[str, Any] | None:
        """Get receipt by ID."""
        return self._receipts.get(receipt_id)
    
    async def get_user_receipts(self, user_address: str) -> list[dict[str, Any]]:
        """Get all receipts for a user."""
        receipt_ids = self._user_receipts.get(user_address, [])
        return [self._receipts[rid] for rid in receipt_ids if rid in self._receipts]
    
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
