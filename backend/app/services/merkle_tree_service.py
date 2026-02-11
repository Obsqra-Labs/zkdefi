"""
Merkle Tree Service for Full Privacy Pool

Manages an incremental Poseidon-based merkle tree off-chain,
synchronized with the on-chain MerkleTree contract.

Uses circomlib Poseidon (BN254 field) for circuit compatibility.
Values may exceed felt252 - contracts use u256 split storage (low, high).
"""

import json
from pathlib import Path
from typing import Optional, Dict, Any

# Import BN254 Poseidon from circomlib wrapper
from .circomlib_poseidon import (
    poseidon_hash_two as _poseidon_hash_two,
    poseidon_hash_many as _poseidon_hash_many,
    poseidon_zero_hash,
    ensure_fits_felt252,
    BN128_PRIME,
    STARK_PRIME,
)

# Tree configuration
TREE_DEPTH = 20
ZERO_VALUE = 0

# Export for compatibility - use BN128 prime for this implementation
FELT_PRIME = BN128_PRIME


def poseidon_hash(left: int, right: int) -> int:
    """
    Compute Poseidon hash of two elements using circomlib (BN254 field).
    
    WARNING: Result may exceed STARK_PRIME. Contracts use u256 split storage.
    """
    return _poseidon_hash_two(left, right)


def compute_commitment(
    user_secret: int,
    amount: int,
    pool_type: int,
    nonce: int,
    blinding: int = 0
) -> int:
    """
    Compute commitment = poseidon(user_secret, amount, pool_type, nonce, blinding)
    Uses circomlib Poseidon (BN254) for circuit compatibility.
    
    WARNING: Result may exceed STARK_PRIME. Use u256 storage on-chain.
    """
    return _poseidon_hash_many([user_secret, amount, pool_type, nonce, blinding])


def compute_nullifier(commitment: int, user_secret: int) -> int:
    """
    Compute nullifier = poseidon(commitment, user_secret)
    Uses circomlib Poseidon (BN254) for circuit compatibility.
    
    WARNING: Result may exceed STARK_PRIME. Use u256 storage on-chain.
    """
    return _poseidon_hash_two(commitment, user_secret)


def split_u256(value: int) -> tuple[int, int]:
    """Split a u256 into (low, high) u128 parts for Starknet storage."""
    low = value % (2 ** 128)
    high = value // (2 ** 128)
    return low, high


def combine_u256(low: int, high: int) -> int:
    """Combine (low, high) u128 parts back into u256."""
    return low + (high * (2 ** 128))


class MerkleTreeService:
    """
    Off-chain incremental merkle tree for full privacy pool.
    Uses BN254 Poseidon for circuit compatibility.
    
    IMPORTANT: Stores proofs at insertion time because get_merkle_proof()
    cannot reliably reconstruct proofs for the incremental tree algorithm.
    """
    
    def __init__(self, depth: int = TREE_DEPTH, storage_path: Optional[str] = None):
        self.depth = depth
        self.storage_path = Path(storage_path) if storage_path else None
        self.zeros = self._compute_zeros()
        self.filled_subtrees = list(self.zeros)
        self.leaves: list[int] = []
        self.root = self._compute_empty_root()
        self.roots: list[int] = [self.root]
        
        # Store proofs at insertion time (keyed by leaf_index)
        self.stored_proofs: Dict[int, Dict[str, Any]] = {}
        
        if self.storage_path and self.storage_path.exists():
            self._load_state()
    
    def _compute_zeros(self) -> list[int]:
        """Compute zero values for each tree level using BN254 Poseidon."""
        zeros = [ZERO_VALUE]
        for level in range(self.depth):
            zeros.append(poseidon_zero_hash(level + 1))
        return zeros
    
    def _compute_empty_root(self) -> int:
        """Compute root of empty tree."""
        return self.zeros[self.depth]
    
    def insert(self, commitment: int) -> tuple[int, list[int], list[int]]:
        """
        Insert a commitment into the tree using incremental algorithm.
        Returns (leaf_index, path_elements, path_indices).
        
        IMPORTANT: The returned proof is ONLY valid at the root computed
        at this exact moment. Store it with the commitment for withdrawal.
        """
        if len(self.leaves) >= 2 ** self.depth:
            raise ValueError("Tree is full")
        
        current_index = len(self.leaves)
        self.leaves.append(commitment)
        
        current_hash = commitment
        path_elements = []
        path_indices = []
        
        for level in range(self.depth):
            if current_index % 2 == 0:
                # Left child: sibling is zero (or will be filled later)
                left = current_hash
                right = self.zeros[level]
                path_elements.append(right)
                path_indices.append(0)
                self.filled_subtrees[level] = current_hash
            else:
                # Right child: sibling is the filled_subtree from left
                left = self.filled_subtrees[level]
                right = current_hash
                path_elements.append(left)
                path_indices.append(1)
            
            current_hash = poseidon_hash(left, right)
            current_index = current_index // 2
        
        self.root = current_hash
        self.roots.append(self.root)
        
        # Store the proof for later retrieval
        leaf_index = len(self.leaves) - 1
        self.stored_proofs[leaf_index] = {
            "path_elements": path_elements,
            "path_indices": path_indices,
            "root": self.root,
        }
        
        if self.storage_path:
            self._save_state()
        
        return leaf_index, path_elements, path_indices
    
    def get_stored_proof(self, leaf_index: int) -> Optional[Dict[str, Any]]:
        """
        Get the stored proof from insertion time.
        This is the ONLY reliable way to get valid merkle proofs for this tree.
        """
        return self.stored_proofs.get(leaf_index)
    
    def get_merkle_proof(self, leaf_index: int) -> tuple[list[int], list[int]]:
        """
        Get merkle proof for a leaf valid against the CURRENT root.

        Rebuilds the full tree to compute correct sibling paths.
        This is the only reliable way to get a proof when multiple
        leaves have been inserted after the target leaf.
        """
        if leaf_index >= len(self.leaves):
            raise ValueError(f"Leaf index {leaf_index} out of range")
        path_elements, path_indices = self._compute_current_proof(leaf_index)
        # Sanity check: verify the proof against the current root
        if not self.verify_proof(self.leaves[leaf_index], path_elements, path_indices, self.root):
            import logging
            _log = logging.getLogger(__name__)
            _log.error(
                "CRITICAL: computed proof for leaf %d does not verify against root %s",
                leaf_index, hex(self.root),
            )
            raise ValueError(
                f"Internal error: proof for leaf {leaf_index} is inconsistent "
                f"with current root {hex(self.root)}"
            )
        return path_elements, path_indices

    def _compute_current_proof(self, leaf_index: int) -> tuple[list[int], list[int]]:
        """
        Compute a proof for `leaf_index` valid against `self.root`.

        Instead of building the entire 2^depth tree (which would be 1M+ nodes),
        we use a sparse approach: replay all insertions using the incremental
        algorithm, tracking filled_subtrees at each step.  After processing
        ALL leaves, the filled_subtrees represent the final tree state.
        Then we extract the sibling path for the target leaf from those subtrees.
        """
        n = len(self.leaves)
        # Replay all insertions to reconstruct the final filled_subtrees
        final_filled = [0] * self.depth
        for i in range(n):
            current_hash = self.leaves[i]
            current_index = i
            for level in range(self.depth):
                if current_index % 2 == 0:
                    final_filled[level] = current_hash
                    # Pair with zero (right sibling hasn't been inserted)
                    current_hash = poseidon_hash(current_hash, self.zeros[level])
                else:
                    # Pair with the stored left subtree
                    current_hash = poseidon_hash(final_filled[level], current_hash)
                current_index = current_index // 2

        # Now replay insertions AGAIN, but this time with the knowledge of
        # the final tree.  Actually, the simpler correct approach is to
        # rebuild only the path for leaf_index from the fully-computed tree.
        #
        # The cleanest approach: build a sparse dictionary of nodes.
        # node[(level, index)] = hash
        nodes: dict[tuple[int, int], int] = {}
        # Insert all leaves at level 0
        for i in range(n):
            nodes[(0, i)] = self.leaves[i]

        # For each level, compute parent nodes bottom-up (only for populated pairs)
        for level in range(self.depth):
            # Gather all indices at this level that have real values
            indices_at_level = sorted(set(
                idx for (lv, idx) in nodes if lv == level
            ))
            for idx in indices_at_level:
                pair_idx = idx ^ 1  # sibling
                left_idx = min(idx, pair_idx)
                right_idx = max(idx, pair_idx)
                left_val = nodes.get((level, left_idx), self.zeros[level])
                right_val = nodes.get((level, right_idx), self.zeros[level])
                parent_idx = left_idx // 2
                nodes[(level + 1, parent_idx)] = poseidon_hash(left_val, right_val)

        # Extract proof for leaf_index
        path_elements = []
        path_indices = []
        idx = leaf_index
        for level in range(self.depth):
            if idx % 2 == 0:
                sibling = nodes.get((level, idx + 1), self.zeros[level])
                path_indices.append(0)
            else:
                sibling = nodes.get((level, idx - 1), self.zeros[level])
                path_indices.append(1)
            path_elements.append(sibling)
            idx = idx // 2

        return path_elements, path_indices
    
    def _reconstruct_proof(self, leaf_index: int) -> tuple[list[int], list[int]]:
        """
        Attempt to reconstruct proof by simulating insertions.
        WARNING: This is slow and may not produce valid proofs for all indices.
        """
        # Simulate tree construction up to leaf_index to get proof
        temp_filled = [0] * self.depth
        path_elements = []
        path_indices = []
        
        # Process all leaves up to and including leaf_index
        for i in range(leaf_index + 1):
            temp_hash = self.leaves[i]
            temp_index = i
            
            if i == leaf_index:
                # Capture the proof for this leaf
                for level in range(self.depth):
                    if temp_index % 2 == 0:
                        path_elements.append(self.zeros[level])
                        path_indices.append(0)
                        temp_filled[level] = temp_hash
                    else:
                        path_elements.append(temp_filled[level])
                        path_indices.append(1)
                        temp_hash = poseidon_hash(temp_filled[level], temp_hash)
                    temp_index = temp_index // 2
            else:
                # Just update filled_subtrees
                for level in range(self.depth):
                    if temp_index % 2 == 0:
                        temp_filled[level] = temp_hash
                        break
                    else:
                        temp_hash = poseidon_hash(temp_filled[level], temp_hash)
                        temp_index = temp_index // 2
        
        return path_elements, path_indices
    
    def verify_proof(self, leaf: int, path_elements: list[int], path_indices: list[int], root: int) -> bool:
        """Verify a merkle proof."""
        current_hash = leaf
        for i in range(len(path_elements)):
            sibling = path_elements[i]
            if path_indices[i] == 0:
                current_hash = poseidon_hash(current_hash, sibling)
            else:
                current_hash = poseidon_hash(sibling, current_hash)
        return current_hash == root
    
    def is_known_root(self, root: int) -> bool:
        """Check if a root is in the recent root history."""
        return root in self.roots[-100:]
    
    def get_root(self) -> int:
        """Get the current merkle root."""
        return self.root
    
    def get_leaf_count(self) -> int:
        """Get the number of leaves in the tree."""
        return len(self.leaves)
    
    def _save_state(self):
        """Persist tree state to disk."""
        state = {
            "leaves": [hex(l) for l in self.leaves],
            "filled_subtrees": [hex(s) for s in self.filled_subtrees],
            "root": hex(self.root),
            "roots": [hex(r) for r in self.roots[-100:]],
            "stored_proofs": {
                str(k): {
                    "path_elements": [hex(p) for p in v["path_elements"]],
                    "path_indices": v["path_indices"],
                    "root": hex(v["root"]),
                }
                for k, v in self.stored_proofs.items()
            },
        }
        self.storage_path.write_text(json.dumps(state, indent=2))
    
    def _load_state(self):
        """Load tree state from disk."""
        try:
            state = json.loads(self.storage_path.read_text())
            self.leaves = [int(l, 16) for l in state["leaves"]]
            self.filled_subtrees = [int(s, 16) for s in state["filled_subtrees"]]
            self.root = int(state["root"], 16)
            self.roots = [int(r, 16) for r in state["roots"]]
            
            # Load stored proofs
            if "stored_proofs" in state:
                self.stored_proofs = {
                    int(k): {
                        "path_elements": [int(p, 16) for p in v["path_elements"]],
                        "path_indices": v["path_indices"],
                        "root": int(v["root"], 16),
                    }
                    for k, v in state["stored_proofs"].items()
                }
        except Exception as e:
            print(f"Warning: Could not load merkle tree state: {e}")


_merkle_tree: Optional[MerkleTreeService] = None


def get_merkle_tree() -> MerkleTreeService:
    """Get or create the singleton merkle tree instance."""
    global _merkle_tree
    if _merkle_tree is None:
        storage_path = Path(__file__).parent.parent.parent / "data" / "merkle_tree.json"
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        _merkle_tree = MerkleTreeService(storage_path=str(storage_path))
    return _merkle_tree


def reset_merkle_tree():
    """Reset the merkle tree (for testing or migration)."""
    global _merkle_tree
    storage_path = Path(__file__).parent.parent.parent / "data" / "merkle_tree.json"
    if storage_path.exists():
        storage_path.unlink()
    _merkle_tree = None


def find_commitment_in_tree(commitment: int) -> Optional[int]:
    """
    Find a commitment in the merkle tree and return its leaf index.
    Returns None if not found.
    """
    tree = get_merkle_tree()
    for i, leaf in enumerate(tree.leaves):
        if leaf == commitment:
            return i
    return None


def recompute_commitment_from_preimage(
    user_secret: int,
    amount: int,
    pool_type: int,
    nonce: int,
    blinding: int = 0
) -> tuple[int, Optional[int]]:
    """
    Recompute commitment from preimage and check if it exists in tree.
    Returns (commitment, leaf_index) or (commitment, None) if not in tree.
    """
    commitment = compute_commitment(user_secret, amount, pool_type, nonce, blinding)
    leaf_index = find_commitment_in_tree(commitment)
    return commitment, leaf_index
