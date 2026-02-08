"""
Intent Commitment Service

Generates replay-safe and fork-safe intent commitments.
commitment = hash(intent_data, nonce, chain_id, block_number)
"""
import hashlib
import os
import secrets
from datetime import datetime
from typing import Any


# Default chain ID for Starknet Sepolia
CHAIN_ID = os.getenv("STARKNET_CHAIN_ID", "0x534e5f5345504f4c4941")  # SN_SEPOLIA


class IntentService:
    """
    Service for managing intent commitments.
    """
    
    def __init__(self, chain_id: str | None = None):
        self.chain_id = chain_id or CHAIN_ID
        
        # In-memory commitment tracking
        self._commitments: dict[str, dict] = {}
        self._user_commitments: dict[str, list[str]] = {}
    
    async def create_commitment(
        self,
        user_address: str,
        intent_data: dict[str, Any],
        block_number: int | None = None
    ) -> dict[str, Any]:
        """
        Create a new intent commitment.
        
        commitment = hash(intent_data, nonce, chain_id, block_number)
        """
        # Generate nonce
        nonce = "0x" + secrets.token_hex(16)
        
        # Use provided block number or simulate
        if block_number is None:
            block_number = int(datetime.utcnow().timestamp()) % 1000000
        
        # Serialize intent data
        intent_str = str(sorted(intent_data.items()))
        
        # Generate commitment
        commitment_input = f"{intent_str}{nonce}{self.chain_id}{block_number}"
        commitment = "0x" + hashlib.sha256(commitment_input.encode()).hexdigest()[:64]
        
        timestamp = datetime.utcnow().isoformat()
        
        record = {
            "commitment": commitment,
            "user": user_address,
            "intent_data": intent_data,
            "nonce": nonce,
            "chain_id": self.chain_id,
            "block_number": block_number,
            "timestamp": timestamp,
            "used": False,
            "action_hash": None,
            "on_chain": False
        }
        
        # Store locally
        self._commitments[commitment] = record
        
        if user_address not in self._user_commitments:
            self._user_commitments[user_address] = []
        self._user_commitments[user_address].append(commitment)
        
        return record
    
    async def submit_commitment(
        self,
        commitment: str,
        tx_hash: str
    ) -> dict[str, Any]:
        """
        Confirm commitment was submitted on-chain.
        """
        if commitment in self._commitments:
            self._commitments[commitment]["on_chain"] = True
            self._commitments[commitment]["tx_hash"] = tx_hash
        
        return {
            "commitment": commitment,
            "tx_hash": tx_hash,
            "status": "submitted"
        }
    
    async def use_commitment(
        self,
        commitment: str,
        action_hash: str
    ) -> dict[str, Any]:
        """
        Mark commitment as used (for replay prevention).
        """
        if commitment not in self._commitments:
            return {
                "success": False,
                "reason": "Commitment not found"
            }
        
        record = self._commitments[commitment]
        
        if record["used"]:
            return {
                "success": False,
                "reason": "Commitment already used"
            }
        
        record["used"] = True
        record["action_hash"] = action_hash
        record["used_at"] = datetime.utcnow().isoformat()
        
        return {
            "success": True,
            "commitment": commitment,
            "action_hash": action_hash
        }
    
    async def is_commitment_valid(
        self,
        commitment: str,
        max_block_window: int = 100
    ) -> dict[str, Any]:
        """
        Check if commitment is valid and unused.
        """
        if commitment not in self._commitments:
            return {
                "is_valid": False,
                "reason": "Commitment not found"
            }
        
        record = self._commitments[commitment]
        
        if record["used"]:
            return {
                "is_valid": False,
                "reason": "Commitment already used"
            }
        
        # Note: In production, would check actual block number
        # For now, commitments are valid if not used
        
        return {
            "is_valid": True,
            "commitment": commitment,
            "chain_id": record["chain_id"],
            "block_number": record["block_number"]
        }
    
    async def get_commitment(self, commitment: str) -> dict[str, Any] | None:
        """Get commitment record."""
        return self._commitments.get(commitment)
    
    async def get_user_commitments(self, user_address: str) -> list[dict[str, Any]]:
        """Get all commitments for a user."""
        commitment_ids = self._user_commitments.get(user_address, [])
        return [self._commitments[cid] for cid in commitment_ids if cid in self._commitments]


# Singleton instance
_intent_service: IntentService | None = None


def get_intent_service() -> IntentService:
    """Get or create the intent service singleton."""
    global _intent_service
    if _intent_service is None:
        _intent_service = IntentService()
    return _intent_service
