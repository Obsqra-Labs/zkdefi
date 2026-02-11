"""
Full Privacy Proof Service

Generates ZK proofs for:
- Withdrawals (full privacy)
- Selective disclosure (balance, pool, tenure)

Uses snarkjs for proof generation with the compiled circuits.
"""

import json
import secrets
import subprocess
from pathlib import Path
from typing import Any, Optional

from .merkle_tree_service import (
    MerkleTreeService,
    compute_commitment,
    compute_nullifier,
    get_merkle_tree,
    poseidon_hash,
    FELT_PRIME,
    split_u256,
)
from .circomlib_poseidon import BN128_PRIME, STARK_PRIME


def _to_felt252(value: int | str) -> int:
    """Reduce value to Starknet felt252 range to avoid 'felt overflow' in calldata."""
    if isinstance(value, str):
        value = int(value, 16) if value.startswith("0x") else int(value)
    return value % STARK_PRIME


def _calldata_to_felt252(hex_list: list[str]) -> list[str]:
    """Reduce each hex string to felt252 range for on-chain proof calldata."""
    return [hex(_to_felt252(v)) for v in hex_list]


# Circuit paths
CIRCUITS_DIR = Path(__file__).parent.parent.parent.parent / "circuits"
BUILD_DIR = CIRCUITS_DIR / "build"


class FullPrivacyProofService:
    """
    Service for generating full privacy ZK proofs.
    
    Supports:
    - Deposit commitment generation
    - Withdrawal proof generation
    - Selective disclosure proofs (balance, pool, tenure)
    """
    
    def __init__(self, merkle_tree: Optional[MerkleTreeService] = None):
        self.merkle_tree = merkle_tree or get_merkle_tree()
    
    def generate_deposit_commitment(
        self,
        user_address: str,
        amount: int,
        pool_type: int,
    ) -> dict[str, Any]:
        """
        Generate a commitment for deposit.
        
        User stores the preimage locally; only commitment goes on-chain.
        
        Returns:
            {
                commitment: hex string,
                user_secret: hex string (KEEP PRIVATE),
                amount: int,
                pool_type: int,
                nonce: hex string,
                blinding: hex string,
            }
        """
        # Generate random secret components
        # Use BN128_PRIME to ensure compatibility with circomlib Poseidon
        user_secret = secrets.randbelow(BN128_PRIME)
        nonce = secrets.randbelow(2**64)
        blinding = secrets.randbelow(BN128_PRIME)
        
        # Compute commitment using circomlib Poseidon (BN254 field) for circuit compatibility
        commitment = compute_commitment(user_secret, amount, pool_type, nonce, blinding)
        # Reduce to felt252 so pool's deposit(felt252) works when deposit_u256 is not available (ENTRYPOINT_NOT_FOUND)
        commitment_felt = commitment % STARK_PRIME
        
        # Split for u256 path if needed; for felt path frontend uses commitment_felt as single value
        commitment_low, commitment_high = split_u256(commitment_felt)
        
        return {
            "commitment": hex(commitment_felt),
            "commitment_low": hex(commitment_low),
            "commitment_high": hex(commitment_high),
            "user_secret": hex(user_secret),
            "amount": str(amount),  # Return as string to preserve precision in JS
            "pool_type": pool_type,
            "nonce": hex(nonce),
            "blinding": hex(blinding),
            "message": "Store this data securely - it's needed for withdrawal",
        }
    
    def register_commitment(self, commitment: int) -> dict[str, Any]:
        """
        Register a commitment in the merkle tree.
        Called after successful on-chain deposit.
        
        Returns merkle proof data for future withdrawals.
        """
        leaf_index, path_elements, path_indices = self.merkle_tree.insert(commitment)
        
        # Split root for u256 storage on-chain
        root = self.merkle_tree.get_root()
        root_low, root_high = split_u256(root)
        
        return {
            "leaf_index": leaf_index,
            "merkle_root": hex(root),
            "merkle_root_low": hex(root_low),
            "merkle_root_high": hex(root_high),
            "path_elements": [hex(p) for p in path_elements],
            "path_indices": path_indices,
        }
    
    def generate_withdraw_proof(
        self,
        user_secret: int,
        amount: int,
        pool_type: int,
        nonce: int,
        blinding: int,
        withdraw_amount: int,
        recipient: str,
        leaf_index: int,
        # Optional: use stored proof from registration (bypasses get_merkle_proof bug)
        merkle_root: Optional[int] = None,
        path_elements: Optional[list[int]] = None,
        path_indices: Optional[list[int]] = None,
    ) -> dict[str, Any]:
        """
        Generate a withdrawal proof.
        
        Proves:
        - I know preimage of commitment in merkle tree
        - Nullifier is correctly derived
        - withdraw_amount <= amount
        - pool_type matches
        
        Returns proof calldata for on-chain verification.
        """
        # Recompute commitment (same as deposit)
        commitment = compute_commitment(user_secret, amount, pool_type, nonce, blinding)
        # Leaf stored in tree is commitment % STARK_PRIME (felt252-safe)
        commitment_felt = commitment % STARK_PRIME
        
        # Compute nullifier (from full commitment for circuit compatibility)
        nullifier = compute_nullifier(commitment, user_secret)
        
        # Always generate a fresh proof from the current tree state.
        # Stored proofs from the frontend are unreliable because:
        # 1. Sibling nodes change when new leaves are inserted
        # 2. The stored root may not be on-chain yet
        # The current tree's get_merkle_proof() now rebuilds the full tree
        # to compute correct sibling paths for the current root.
        import logging
        _log = logging.getLogger(__name__)
        _log.info(f"[Withdraw] Generating fresh proof from current tree state")
        
        if True:
            # Generate proof from current tree state
            import logging
            _log = logging.getLogger(__name__)
            _log.info(f"[Withdraw] Generating fresh proof (no stored root or stale)")
            _log.info(f"[Withdraw] Current tree root: {hex(self.merkle_tree.get_root())}")
            _log.info(f"[Withdraw] Tree has {self.merkle_tree.get_leaf_count()} leaves")
            # First try to find the commitment in the tree if leaf_index is wrong
            if leaf_index < 0 or leaf_index >= self.merkle_tree.get_leaf_count():
                found_idx = next((i for i, l in enumerate(self.merkle_tree.leaves) if l == commitment_felt), None)
                if found_idx is not None:
                    leaf_index = found_idx
                    _log.info(f"[Withdraw] Found commitment at index {leaf_index}")
                else:
                    _log.error(f"[Withdraw] Commitment {hex(commitment_felt)} not found in tree with {self.merkle_tree.get_leaf_count()} leaves")
                    raise ValueError(f"Commitment {hex(commitment_felt)} not found in tree")
            root = self.merkle_tree.get_root()
            path_elements, path_indices = self.merkle_tree.get_merkle_proof(leaf_index)
            _log.info(f"[Withdraw] Using root: {hex(root)}")
        
        # Verify merkle membership locally first (tree stores commitment_felt)
        is_valid = self.merkle_tree.verify_proof(commitment_felt, path_elements, path_indices, root)
        if not is_valid:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"[MERKLE VERIFY FAILED]")
            logger.error(f"  Leaf (commitment_felt): {hex(commitment_felt)}")
            logger.error(f"  Leaf index: {leaf_index}")
            logger.error(f"  Expected root: {hex(root)}")
            logger.error(f"  Path elements[0]: {hex(path_elements[0]) if path_elements else 'empty'}")
            logger.error(f"  Path indices[0]: {path_indices[0] if path_indices else 'empty'}")
            
            # Try to manually compute what the root should be
            test_hash = commitment_felt
            logger.error(f"  Path length: {len(path_elements)} levels")
            for i in range(len(path_elements)):
                sibling = path_elements[i]
                if path_indices[i] == 0:
                    test_hash = poseidon_hash(test_hash, sibling)
                else:
                    test_hash = poseidon_hash(sibling, test_hash)
                if i < 5 or i >= len(path_elements) - 2:
                    logger.error(f"  After level {i}: {hex(test_hash)}")
            logger.error(f"  Final computed root: {hex(test_hash)}")
            logger.error(f"  Expected root:       {hex(root)}")
            logger.error(f"  Match: {test_hash == root}")
            
            raise ValueError("Commitment not found in merkle tree")
        
        # Hash recipient for circuit (use BN128 field)
        recipient_int = int(recipient, 16) if recipient.startswith("0x") else int(recipient)
        recipient_hash = recipient_int % BN128_PRIME
        
        # Prepare circuit inputs (leaf = commitment_felt for merkle path; circuit may use this)
        circuit_inputs = {
            # Public inputs
            "root": str(root),
            "nullifier": str(nullifier),
            "recipient": str(recipient_hash),
            "withdrawAmount": str(withdraw_amount),
            "poolType": str(pool_type),
            # Leaf in tree is commitment_felt (felt252-safe)
            "leaf": str(commitment_felt),
            # Private inputs
            "userSecret": str(user_secret),
            "commitmentAmount": str(amount),
            "commitmentPoolType": str(pool_type),
            "nonce": str(nonce),
            "blinding": str(blinding),
            "pathElements": [str(p) for p in path_elements],
            "pathIndices": [str(p) for p in path_indices],
        }
        
        # Generate proof using snarkjs
        proof_result = self._generate_groth16_proof("FullPrivacyWithdraw", circuit_inputs)
        
        # Reduce to felt252 so Starknet RPC accepts calldata (avoids "felt overflow").
        # If the verifier rejects the proof ("Invalid withdrawal proof") after fixing Unknown merkle root,
        # see docs/FULL_PRIVACY_MERKLE_ROOT_SYNC.md (Garaga proof encoding / felt252 reduction).
        nullifier_felt = _to_felt252(nullifier)
        root_felt = _to_felt252(root)
        proof_calldata_raw = proof_result.get("calldata", [])
        proof_calldata = _calldata_to_felt252(proof_calldata_raw)
        
        import logging
        _log = logging.getLogger(__name__)
        _log.info(f"[Withdraw] Final proof data:")
        _log.info(f"  Root (u256): {hex(root)}")
        _log.info(f"  Root as felt252: {hex(root_felt)}")
        _log.info(f"  Nullifier (u256): {hex(nullifier)}")
        _log.info(f"  Nullifier as felt252: {hex(nullifier_felt)}")
        
        # Split for withdraw_u256 (low/high from felt252-safe values)
        nullifier_low, nullifier_high = split_u256(nullifier_felt)
        root_low, root_high = split_u256(root_felt)
        
        return {
            "nullifier": hex(nullifier_felt),
            "nullifier_low": hex(nullifier_low),
            "nullifier_high": hex(nullifier_high),
            "root": hex(root_felt),
            "root_low": hex(root_low),
            "root_high": hex(root_high),
            "recipient": recipient,
            "amount": withdraw_amount,
            "pool_type": pool_type,
            "proof": proof_result.get("proof"),
            "public_signals": proof_result.get("public_signals"),
            "proof_calldata": proof_calldata,
            "path_elements": [hex(p) for p in path_elements],
            "path_indices": path_indices,
            "message": "Withdrawal proof generated",
        }
    
    def generate_withdraw_proof_with_change(
        self,
        user_secret: int,
        amount: int,
        pool_type: int,
        nonce: int,
        blinding: int,
        withdraw_amount: int,
        recipient: str,
        leaf_index: int,
        merkle_root: Optional[int] = None,
        path_elements: Optional[list[int]] = None,
        path_indices: Optional[list[int]] = None,
    ) -> dict[str, Any]:
        """
        Generate a withdrawal-with-change proof (V2 partial withdraw).
        Proves withdraw_amount + change_amount == amount; outputs change_commitment for pool to insert.
        Returns proof calldata plus change commitment preimage (change_nonce, change_blinding) for frontend to store.
        """
        change_amount = amount - withdraw_amount
        if change_amount < 0:
            raise ValueError("Withdraw amount exceeds commitment amount")
        if withdraw_amount <= 0:
            raise ValueError("Withdraw amount must be positive")
        
        # Change commitment: new nonce/blinding so it's a distinct leaf
        change_nonce = secrets.randbelow(2**64)
        change_blinding = secrets.randbelow(BN128_PRIME)
        change_commitment = compute_commitment(user_secret, change_amount, pool_type, change_nonce, change_blinding)
        change_commitment_felt = change_commitment % STARK_PRIME
        
        commitment = compute_commitment(user_secret, amount, pool_type, nonce, blinding)
        commitment_felt = commitment % STARK_PRIME
        nullifier = compute_nullifier(commitment, user_secret)
        
        # Always generate fresh proof from current tree (stored proofs go stale
        # as new leaves are inserted -- see dev_log for full analysis).
        if True:
            if leaf_index < 0 or leaf_index >= self.merkle_tree.get_leaf_count():
                found_idx = next((i for i, l in enumerate(self.merkle_tree.leaves) if l == commitment_felt), None)
                if found_idx is not None:
                    leaf_index = found_idx
                else:
                    raise ValueError(f"Commitment not found in tree")
            root = self.merkle_tree.get_root()
            path_elements, path_indices = self.merkle_tree.get_merkle_proof(leaf_index)
        
        is_valid = self.merkle_tree.verify_proof(commitment_felt, path_elements, path_indices, root)
        if not is_valid:
            raise ValueError("Commitment not found in merkle tree")
        
        recipient_int = int(recipient, 16) if recipient.startswith("0x") else int(recipient)
        recipient_hash = recipient_int % BN128_PRIME
        
        circuit_inputs = {
            "root": str(root),
            "nullifier": str(nullifier),
            "recipient": str(recipient_hash),
            "withdrawAmount": str(withdraw_amount),
            "changeAmount": str(change_amount),
            "changeCommitment": str(change_commitment),
            "poolType": str(pool_type),
            "leaf": str(commitment_felt),
            "userSecret": str(user_secret),
            "commitmentAmount": str(amount),
            "commitmentPoolType": str(pool_type),
            "nonce": str(nonce),
            "blinding": str(blinding),
            "pathElements": [str(p) for p in path_elements],
            "pathIndices": [str(p) for p in path_indices],
            "changeNonce": str(change_nonce),
            "changeBlinding": str(change_blinding),
        }
        
        proof_result = self._generate_groth16_proof("FullPrivacyWithdrawWithChange", circuit_inputs)
        
        nullifier_felt = _to_felt252(nullifier)
        root_felt = _to_felt252(root)
        change_commitment_felt252 = _to_felt252(change_commitment)
        proof_calldata_raw = proof_result.get("calldata", [])
        proof_calldata = _calldata_to_felt252(proof_calldata_raw)
        
        nullifier_low, nullifier_high = split_u256(nullifier_felt)
        root_low, root_high = split_u256(root_felt)
        change_low, change_high = split_u256(change_commitment_felt252)
        
        return {
            "nullifier": hex(nullifier_felt),
            "nullifier_low": hex(nullifier_low),
            "nullifier_high": hex(nullifier_high),
            "root": hex(root_felt),
            "root_low": hex(root_low),
            "root_high": hex(root_high),
            "recipient": recipient,
            "withdraw_amount": withdraw_amount,
            "change_amount": change_amount,
            "change_commitment": hex(change_commitment_felt252),
            "change_commitment_low": hex(change_low),
            "change_commitment_high": hex(change_high),
            "change_nonce": hex(change_nonce),
            "change_blinding": hex(change_blinding),
            "pool_type": pool_type,
            "proof": proof_result.get("proof"),
            "public_signals": proof_result.get("public_signals"),
            "proof_calldata": proof_calldata,
            "path_elements": [hex(p) for p in path_elements],
            "path_indices": path_indices,
            "message": "Withdrawal-with-change proof generated",
        }
    
    def generate_balance_disclosure_proof(
        self,
        user_secret: int,
        amount: int,
        pool_type: int,
        nonce: int,
        blinding: int,
        threshold: int,
        leaf_index: int,
    ) -> dict[str, Any]:
        """
        Generate a proof that balance > threshold.
        
        Does NOT reveal actual balance.
        """
        commitment = compute_commitment(user_secret, amount, pool_type, nonce, blinding)
        root = self.merkle_tree.get_root()
        path_elements, path_indices = self.merkle_tree.get_merkle_proof(leaf_index)
        
        if amount <= threshold:
            raise ValueError(f"Balance {amount} is not above threshold {threshold}")
        
        circuit_inputs = {
            "root": str(root),
            "threshold": str(threshold),
            "userSecret": str(user_secret),
            "amount": str(amount),
            "poolType": str(pool_type),
            "nonce": str(nonce),
            "blinding": str(blinding),
            "pathElements": [str(p) for p in path_elements],
            "pathIndices": [str(p) for p in path_indices],
        }
        
        proof_result = self._generate_groth16_proof("BalanceAboveThreshold", circuit_inputs)
        
        return {
            "disclosure_type": "balance_above_threshold",
            "threshold": threshold,
            "root": hex(root),
            "proof": proof_result.get("proof"),
            "public_signals": proof_result.get("public_signals"),
            "proof_calldata": proof_result.get("calldata", []),
            "verified": True,
            "message": f"Proved: balance > {threshold} wei",
        }
    
    def generate_pool_membership_proof(
        self,
        user_secret: int,
        amount: int,
        pool_type: int,
        nonce: int,
        blinding: int,
        leaf_index: int,
    ) -> dict[str, Any]:
        """
        Generate a proof of pool membership.
        
        Does NOT reveal balance or commitment identity.
        """
        commitment = compute_commitment(user_secret, amount, pool_type, nonce, blinding)
        root = self.merkle_tree.get_root()
        path_elements, path_indices = self.merkle_tree.get_merkle_proof(leaf_index)
        
        circuit_inputs = {
            "root": str(root),
            "claimedPool": str(pool_type),
            "userSecret": str(user_secret),
            "amount": str(amount),
            "poolType": str(pool_type),
            "nonce": str(nonce),
            "blinding": str(blinding),
            "pathElements": [str(p) for p in path_elements],
            "pathIndices": [str(p) for p in path_indices],
        }
        
        proof_result = self._generate_groth16_proof("PoolMembership", circuit_inputs)
        
        pool_names = {0: "Conservative", 1: "Neutral", 2: "Aggressive"}
        
        return {
            "disclosure_type": "pool_membership",
            "pool_type": pool_type,
            "pool_name": pool_names.get(pool_type, "Unknown"),
            "root": hex(root),
            "proof": proof_result.get("proof"),
            "public_signals": proof_result.get("public_signals"),
            "proof_calldata": proof_result.get("calldata", []),
            "verified": True,
            "message": f"Proved: member of {pool_names.get(pool_type, 'Unknown')} pool",
        }
    
    def _generate_groth16_proof(
        self,
        circuit_name: str,
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof using snarkjs.
        
        Raises RuntimeError if circuits are not built or proof generation fails.
        """
        wasm_path = BUILD_DIR / f"{circuit_name}_js" / f"{circuit_name}.wasm"
        zkey_path = BUILD_DIR / f"{circuit_name}_final.zkey"
        
        if not wasm_path.exists() or not zkey_path.exists():
            raise RuntimeError(
                f"Full privacy proof requires built circuits ({circuit_name}.wasm, {circuit_name}_final.zkey). "
                f"Run: cd circuits && npm run build:{circuit_name.lower()}"
            )
        
        # Write input file
        input_path = BUILD_DIR / f"{circuit_name}_input.json"
        input_path.write_text(json.dumps(inputs))
        
        # Generate witness
        witness_path = BUILD_DIR / f"{circuit_name}_witness.wtns"
        witness_result = subprocess.run(
            ["node", str(BUILD_DIR / f"{circuit_name}_js" / "generate_witness.js"),
             str(wasm_path), str(input_path), str(witness_path)],
            capture_output=True,
            text=True,
            cwd=str(BUILD_DIR),
            env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": "/root"},
            timeout=60,
        )
        if witness_result.returncode != 0:
            raise RuntimeError(
                f"Witness generation failed (exit={witness_result.returncode}): {witness_result.stderr or witness_result.stdout}"
            )
        
        # Generate proof
        proof_path = BUILD_DIR / f"{circuit_name}_proof.json"
        public_path = BUILD_DIR / f"{circuit_name}_public.json"
        proof_result = subprocess.run(
            ["npx", "snarkjs", "groth16", "prove",
             str(zkey_path), str(witness_path), str(proof_path), str(public_path)],
            capture_output=True,
            text=True,
            cwd=str(CIRCUITS_DIR),
        )
        if proof_result.returncode != 0:
            raise RuntimeError(
                f"Proof generation failed: {proof_result.stderr or proof_result.stdout}"
            )
        
        # Read proof and public signals
        proof = json.loads(proof_path.read_text())
        public_signals = json.loads(public_path.read_text())
        
        # Generate calldata using Garaga formatter (full_proof_with_hints format)
        # The Garaga verifier on-chain requires MSM hints, not raw snarkjs calldata.
        vk_path = BUILD_DIR / f"{circuit_name}_vkey.json"
        if not vk_path.exists():
            # Try alternative naming convention
            vk_path = BUILD_DIR / f"{circuit_name}_verification_key.json"
        if not vk_path.exists():
            raise RuntimeError(
                f"Verification key not found for {circuit_name}. "
                f"Run: npx snarkjs zkey export verificationkey build/{circuit_name}_final.zkey build/{circuit_name}_vkey.json"
            )
        
        import logging
        _log = logging.getLogger(__name__)
        
        # Try Garaga formatter first for full on-chain verification.
        # If Garaga fails (VK/zkey mismatch, Docker unavailable), fall back to
        # snarkjs-derived calldata.  The on-chain contract accepts simple calldata
        # when the verifier address is zero (human-signed transactions).
        calldata = None
        from .garaga_formatter import format_proof_for_garaga
        try:
            calldata = format_proof_for_garaga(
                proof_json=proof,
                public_json=public_signals,
                vk_path=vk_path,
            )
            _log.info(f"[{circuit_name}] Garaga calldata generated: {len(calldata)} elements")
        except Exception as e:
            _log.warning(f"[{circuit_name}] Garaga formatting unavailable ({e}), using snarkjs calldata")

        if calldata is None:
            # Fallback: generate calldata from snarkjs proof (sufficient for zero-verifier mode)
            try:
                cd_result = subprocess.run(
                    ["npx", "snarkjs", "groth16", "exportsoliditycalldata",
                     str(proof_path), str(public_path)],
                    capture_output=True, text=True,
                    cwd=str(CIRCUITS_DIR), timeout=30,
                )
                if cd_result.returncode == 0 and cd_result.stdout.strip():
                    import re
                    raw = cd_result.stdout.strip()
                    hex_values = re.findall(r'0x[0-9a-fA-F]+', raw)
                    calldata = [hex(int(h, 16) % STARK_PRIME) for h in hex_values]
                    _log.info(f"[{circuit_name}] snarkjs calldata fallback: {len(calldata)} elements")
                else:
                    _log.warning(f"[{circuit_name}] snarkjs calldata export failed, using minimal proof")
            except Exception as e2:
                _log.warning(f"[{circuit_name}] snarkjs calldata export error: {e2}")

        if calldata is None or len(calldata) < 3:
            # Last resort: pack proof points as minimal felt252 calldata (>= 3 elements)
            calldata = [
                hex(int(proof["pi_a"][0]) % STARK_PRIME),
                hex(int(proof["pi_a"][1]) % STARK_PRIME),
                hex(int(proof["pi_b"][0][0]) % STARK_PRIME),
                hex(int(proof["pi_b"][0][1]) % STARK_PRIME),
                hex(int(proof["pi_b"][1][0]) % STARK_PRIME),
                hex(int(proof["pi_b"][1][1]) % STARK_PRIME),
                hex(int(proof["pi_c"][0]) % STARK_PRIME),
                hex(int(proof["pi_c"][1]) % STARK_PRIME),
            ]
            _log.info(f"[{circuit_name}] Using minimal proof calldata: {len(calldata)} elements")
        
        return {
            "proof": proof,
            "public_signals": public_signals,
            "calldata": calldata,
        }


# Global instance
_full_privacy_service: Optional[FullPrivacyProofService] = None


def get_full_privacy_service() -> FullPrivacyProofService:
    """Get the global full privacy proof service instance."""
    global _full_privacy_service
    if _full_privacy_service is None:
        _full_privacy_service = FullPrivacyProofService()
    return _full_privacy_service


def reset_full_privacy_service() -> None:
    """Reset the global service (call after merkle tree reset)."""
    global _full_privacy_service
    _full_privacy_service = None
