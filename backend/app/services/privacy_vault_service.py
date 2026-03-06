"""
Privacy Vault Service: Shielded deposits and withdrawals through FullyShieldedPool
"""

import logging
import os
from typing import Any, Dict, List
from app.services.circomlib_poseidon import poseidon_hash_many as poseidon_hash
from app.services.proof_pipeline import ProofPipeline
from app.services.receipt_service import get_receipt_service

logger = logging.getLogger(__name__)

FULLY_SHIELDED_POOL_ADDRESS = os.getenv(
    "NEXT_PUBLIC_FULLY_SHIELDED_POOL_ADDRESS",
    "0x03dde5617d362a6f9202cd3955b4508e2bd6b1c5d35250153beeb6237c811559"
)


class PrivacyVaultService:
    """
    Manages privacy-preserving vault operations using FullyShieldedPool
    """
    
    def __init__(self):
        self.proof_pipeline = ProofPipeline()
        self.receipt_svc = get_receipt_service()
        self.nullifier_store: Dict[str, Dict[str, Any]] = {}  # In-memory for now
    
    async def shielded_deposit(
        self,
        user_address: str,
        amount_wei: int,
        nullifier: str,
    ) -> Dict[str, Any]:
        """
        Deposit funds through FullyShieldedPool with hidden amount.
        
        Process:
        1. Generate Poseidon commitment = Poseidon(nullifier, amount)
        2. Call FullyShieldedPool.deposit(commitment)
        3. Store encrypted nullifier
        4. Generate deposit proof
        5. Create receipt with commitment (not amount)
        
        Args:
            user_address: User's wallet address
            amount_wei: Deposit amount in wei
            nullifier: User-generated secret (32 bytes hex)
        
        Returns:
            {
                "commitment": str,
                "tx_hash": str,
                "proof_hash": str,
                "receipt_id": str,
            }
        """
        try:
            # 1. Generate Poseidon commitment
            nullifier_int = int(nullifier, 16) if nullifier.startswith("0x") else int(nullifier, 16)
            commitment = poseidon_hash([nullifier_int, amount_wei])
            commitment_hex = hex(commitment)
            
            logger.info(f"Generated commitment for shielded deposit: {commitment_hex}")
            
            # 2. Call FullyShieldedPool.deposit (TODO: implement contract call)
            tx_hash = await self._call_shielded_pool_deposit(commitment_hex, amount_wei)
            
            # 3. Store nullifier (encrypted in production)
            self._store_nullifier(user_address, commitment_hex, {
                "nullifier": nullifier,
                "amount_wei": amount_wei,
                "spent": False,
            })
            
            # 4. Generate deposit proof
            proof = await self.proof_pipeline.generate_private_deposit_proof(
                nullifier=nullifier,
                amount=amount_wei,
                commitment=commitment_hex,
            )
            
            # 5. Create receipt (commitment only, amount hidden)
            receipt = self.receipt_svc.create_receipt(
                user_address=user_address,
                action_type="shielded_deposit",
                amount=0,  # Amount hidden on-chain
                metadata={
                    "commitment": commitment_hex,
                    "proof_hash": proof.get("fact_hash", "0x0"),
                    "tx_hash": tx_hash,
                    "privacy_level": "full",
                }
            )
            
            return {
                "commitment": commitment_hex,
                "tx_hash": tx_hash,
                "proof_hash": proof.get("fact_hash", "0x0"),
                "receipt_id": receipt["receipt_id"],
            }
            
        except Exception as e:
            logger.error(f"Shielded deposit failed: {e}")
            raise
    
    async def shielded_withdraw(
        self,
        user_address: str,
        nullifier: str,
        amount_wei: int,
        recipient: str,
    ) -> Dict[str, Any]:
        """
        Withdraw funds from FullyShieldedPool using zero-knowledge proof.
        
        Process:
        1. Retrieve commitment from storage
        2. Generate withdrawal proof (proves ownership without revealing nullifier)
        3. Call FullyShieldedPool.withdraw(proof, recipient, amount)
        4. Mark nullifier as spent
        5. Create receipt (amount revealed on withdrawal)
        
        Args:
            user_address: User's wallet address
            nullifier: The secret used for deposit
            amount_wei: Amount to withdraw (must match deposit)
            recipient: Recipient address for funds
        
        Returns:
            {
                "tx_hash": str,
                "proof_hash": str,
                "receipt_id": str,
            }
        """
        try:
            # 1. Retrieve commitment
            nullifier_int = int(nullifier, 16) if nullifier.startswith("0x") else int(nullifier, 16)
            commitment = poseidon_hash([nullifier_int, amount_wei])
            commitment_hex = hex(commitment)
            
            stored = self._get_nullifier(user_address, commitment_hex)
            if not stored:
                raise ValueError(f"Commitment {commitment_hex} not found for user")
            
            if stored["spent"]:
                raise ValueError(f"Nullifier already spent for commitment {commitment_hex}")
            
            # 2. Generate withdrawal proof
            proof = await self.proof_pipeline.generate_private_withdraw_proof(
                nullifier=nullifier,
                amount=amount_wei,
                commitment=commitment_hex,
                recipient=recipient,
            )
            
            # 3. Call FullyShieldedPool.withdraw
            tx_hash = await self._call_shielded_pool_withdraw(
                proof_calldata=proof.get("calldata", []),
                recipient=recipient,
                amount=amount_wei,
            )
            
            # 4. Mark nullifier as spent
            self._mark_spent(user_address, commitment_hex)
            
            # 5. Create receipt (amount now revealed)
            receipt = self.receipt_svc.create_receipt(
                user_address=user_address,
                action_type="shielded_withdraw",
                amount=amount_wei,  # Revealed on withdrawal
                metadata={
                    "commitment": commitment_hex,
                    "proof_hash": proof.get("fact_hash", "0x0"),
                    "tx_hash": tx_hash,
                    "recipient": recipient,
                    "privacy_level": "revealed",
                }
            )
            
            return {
                "tx_hash": tx_hash,
                "proof_hash": proof.get("fact_hash", "0x0"),
                "receipt_id": receipt["receipt_id"],
            }
            
        except Exception as e:
            logger.error(f"Shielded withdraw failed: {e}")
            raise
    
    async def _call_shielded_pool_deposit(self, commitment: str, amount_wei: int) -> str:
        """
        Call FullyShieldedPool.deposit(commitment)
        
        TODO: Implement actual contract call when admin account is configured
        """
        if not self.admin_account:
            logger.warning("Shielded deposit call skipped: admin account not configured")
            return "0xmock_deposit_tx"
        
        try:
            # Load FullyShieldedPool contract
            pool = await Contract.from_address(
                address=int(FULLY_SHIELDED_POOL_ADDRESS, 16),
                provider=self.admin_account,
            )
            
            # Call deposit
            invocation = await pool.functions["deposit"].invoke_v1(
                commitment=int(commitment, 16),
                max_fee=int(1e16),
            )
            
            await invocation.wait_for_acceptance()
            
            return hex(invocation.hash)
            
        except Exception as e:
            logger.error(f"Shielded pool deposit failed: {e}")
            return "0x0"
    
    async def _call_shielded_pool_withdraw(
        self,
        proof_calldata: List[int],
        recipient: str,
        amount: int,
    ) -> str:
        """
        Call FullyShieldedPool.withdraw(proof, recipient, amount)
        """
        if not self.admin_account:
            logger.warning("Shielded withdraw call skipped: admin account not configured")
            return "0xmock_withdraw_tx"
        
        try:
            pool = await Contract.from_address(
                address=int(FULLY_SHIELDED_POOL_ADDRESS, 16),
                provider=self.admin_account,
            )
            
            invocation = await pool.functions["withdraw"].invoke_v1(
                proof=proof_calldata,
                recipient=int(recipient, 16),
                amount=amount,
                max_fee=int(2e16),
            )
            
            await invocation.wait_for_acceptance()
            
            return hex(invocation.hash)
            
        except Exception as e:
            logger.error(f"Shielded pool withdraw failed: {e}")
            return "0x0"
    
    def _store_nullifier(self, user_address: str, commitment: str, data: Dict[str, Any]):
        """
        Store nullifier (encrypted in production)
        
        TODO: Encrypt with user's wallet pubkey before storage
        """
        if user_address not in self.nullifier_store:
            self.nullifier_store[user_address] = {}
        
        self.nullifier_store[user_address][commitment] = data
        logger.debug(f"Stored nullifier for {user_address}, commitment: {commitment}")
    
    def _get_nullifier(self, user_address: str, commitment: str) -> Dict[str, Any] | None:
        """
        Retrieve nullifier data
        """
        return self.nullifier_store.get(user_address, {}).get(commitment)
    
    def _mark_spent(self, user_address: str, commitment: str):
        """
        Mark nullifier as spent (prevent double-spend)
        """
        if user_address in self.nullifier_store and commitment in self.nullifier_store[user_address]:
            self.nullifier_store[user_address][commitment]["spent"] = True
            logger.info(f"Marked nullifier spent: {commitment}")


# Singleton
_privacy_vault_service: PrivacyVaultService | None = None


def get_privacy_vault_service() -> PrivacyVaultService:
    global _privacy_vault_service
    if _privacy_vault_service is None:
        _privacy_vault_service = PrivacyVaultService()
    return _privacy_vault_service
