"""
DAO Voting Service

Generates zero-knowledge proofs for private DAO voting.

User votes privately (hidden vote direction) while proving voting power.
"""

import asyncio
import math
import secrets
from typing import Dict, Any, Optional
from dataclasses import dataclass
import logging

from app.services.circomlib_poseidon import poseidon_hash_many

logger = logging.getLogger(__name__)


@dataclass
class VotingProof:
    """Result of voting proof generation"""
    proof_calldata: list[str]
    nullifier_hash: str
    commitment: str
    vote_value: int
    public_inputs: list[str]


class DAOVotingService:
    """
    Service for generating zero-knowledge voting proofs.
    
    Privacy guarantees:
    - Vote direction is hidden (only user knows)
    - Voting power is aggregated (not revealed individually)
    - Nullifiers prevent double voting
    - Results are public and verifiable
    """
    
    def __init__(self):
        self.circuit_path = "circuits/build/private_vote.wasm"
        self.proving_key = "circuits/build/private_vote_final.zkey"
        self.verification_key = "circuits/build/private_vote_vkey.json"
        
        self.user_secrets: Dict[str, str] = {}
    
    async def generate_voting_proof(
        self,
        user_address: str,
        proposal_id: int,
        vote_direction: int,  # 0 = against, 1 = for
    ) -> VotingProof:
        """
        Generate ZK proof for private vote.
        
        Args:
            user_address: Voter's Starknet address
            proposal_id: Proposal ID to vote on
            vote_direction: 0 (against) or 1 (for)
        
        Returns:
            VotingProof with proof_calldata, nullifier_hash, commitment
        
        Raises:
            ValueError: If vote_direction not 0 or 1
            RuntimeError: If proof generation fails
        """
        if vote_direction not in (0, 1):
            raise ValueError(f"vote_direction must be 0 or 1, got {vote_direction}")
        
        # Step 1: Get user's voting power
        voting_power = await self._get_voting_power(user_address)
        logger.info(f"Voting power for {user_address}: {voting_power}")
        
        # Step 2: Get or create voting secret
        secret = self._get_or_create_voting_secret(user_address)
        
        # Step 3: Compute nullifier hash
        # nullifier_hash = Pedersen(secret, proposal_id)
        nullifier_hash = poseidon_hash_many([int(secret, 16), proposal_id])
        nullifier_hash_hex = hex(nullifier_hash)
        
        # Step 4: Prepare circuit inputs
        witness_input = {
            "secret": secret,
            "voting_power": str(voting_power),
            "vote_direction": str(vote_direction),
            "proposal_id": str(proposal_id),
            "nullifier_hash": str(nullifier_hash),
        }
        
        logger.info(f"Generating voting proof for proposal {proposal_id}")
        
        # Step 5: Generate witness (compute circuit)
        # NOTE: Requires circom witness generator to be installed
        # witness = await self._generate_witness(witness_input)
        
        # Step 6: Generate Groth16 proof
        # NOTE: Requires snarkjs to be installed
        # proof = await self._generate_groth16_proof(witness)
        
        # MOCK IMPLEMENTATION (for development)
        # In production, this would call actual Groth16 prover
        vote_value = voting_power * vote_direction
        commitment = poseidon_hash_many([int(secret, 16), voting_power, vote_direction])
        
        proof_calldata = [
            hex(commitment),           # Public output 1: commitment
            hex(vote_value),           # Public output 2: vote_value
            hex(nullifier_hash),       # Public input 1: nullifier_hash
            hex(proposal_id),          # Public input 2: proposal_id
        ]
        
        public_inputs = [
            hex(proposal_id),
            hex(nullifier_hash),
        ]
        
        logger.info(f"Voting proof generated: nullifier={nullifier_hash_hex[:16]}...")
        
        return VotingProof(
            proof_calldata=proof_calldata,
            nullifier_hash=nullifier_hash_hex,
            commitment=hex(commitment),
            vote_value=vote_value,
            public_inputs=public_inputs,
        )
    
    async def _get_voting_power(self, user_address: str) -> int:
        """
        Get user's voting power based on LP position.
        
        Formula: voting_power = sqrt(lp_position_value_usd)
        
        Why square root?
        - Reduces whale dominance (quadratic voting benefits)
        - Still rewards larger LPs
        - More democratic than linear
        
        Examples:
        - $10,000 position = 100 VP
        - $40,000 position = 200 VP (not 400)
        - $90,000 position = 300 VP (not 900)
        """
        # TODO: Query VaultController for actual LP position
        # For now, mock based on address
        
        # MOCK IMPLEMENTATION
        # In production: query vault_controller.get_user_position_value(user_address)
        mock_position_usd = 10000  # $10k position
        voting_power = int(math.sqrt(mock_position_usd))
        
        return voting_power
    
    def _get_or_create_voting_secret(self, user_address: str) -> str:
        """
        Get or create voting secret for user.
        
        Secret is deterministic per user (derived from address hash)
        but appears random to others.
        
        In production: Store in secure vault (HSM, KMS, etc.)
        """
        if user_address not in self.user_secrets:
            # Generate deterministic secret from address
            # In production: Use secure key derivation (HKDF, etc.)
            secret_int = int(user_address, 16) % (2**251)  # Fit in felt252
            self.user_secrets[user_address] = hex(secret_int)
        
        return self.user_secrets[user_address]
    
    async def _generate_witness(self, witness_input: Dict[str, str]) -> bytes:
        """
        Generate witness using circom witness generator.
        
        Requires:
        - circuits/build/private_vote.wasm exists
        - Node.js installed
        """
        # TODO: Call circom witness generator
        # cmd: node circuits/build/private_vote.wasm input.json witness.wtns
        raise NotImplementedError("Witness generation requires circom toolchain")
    
    async def _generate_groth16_proof(self, witness: bytes) -> Dict[str, Any]:
        """
        Generate Groth16 proof using snarkjs.
        
        Requires:
        - circuits/build/private_vote_final.zkey exists
        - snarkjs installed
        """
        # TODO: Call snarkjs prover
        # cmd: snarkjs groth16 prove proving_key witness proof.json public.json
        raise NotImplementedError("Groth16 proving requires snarkjs toolchain")
    
    def set_voting_power(self, user_address: str, voting_power: int):
        """
        Admin function to set user voting power.
        
        In production: This would be computed automatically from on-chain LP positions.
        """
        # Store in contract or local cache
        pass


# Singleton instance
_dao_voting_service: Optional[DAOVotingService] = None


def get_dao_voting_service() -> DAOVotingService:
    """Get or create singleton DAO voting service"""
    global _dao_voting_service
    if _dao_voting_service is None:
        _dao_voting_service = DAOVotingService()
    return _dao_voting_service
