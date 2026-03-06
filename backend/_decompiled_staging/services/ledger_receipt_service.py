"""
Signed receipts and Merkle commitment roots for the private vault ledger.

Every ledger entry gets an HMAC-SHA256 signed receipt so that any auditor
(or the user themselves) can verify the operator never silently mutated a
past entry.  Commitment roots let the operator publish a single hash that
covers all vault balances at a point in time.
"""

import hashlib
import hmac
import json
import math
import os
from typing import Any


_ZERO_LEAF = hashlib.sha256(b"0").hexdigest()

_RECEIPT_FIELDS = (
    "entry_id",
    "vault_id",
    "tx_type",
    "amount_wei",
    "token",
    "dr_account",
    "cr_account",
    "refs",
)


class LedgerReceiptService:
    def __init__(self, operator_key: str | None = None):
        if operator_key is None:
            operator_key = os.urandom(32).hex()
        self._key = bytes.fromhex(operator_key)

    # ── receipts ──────────────────────────────────────────────────────

    def create_receipt(
        self,
        entry_id: str,
        vault_id: str,
        tx_type: str,
        amount_wei: int,
        token: str,
        dr_account: str,
        cr_account: str,
        refs: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            "entry_id": entry_id,
            "vault_id": vault_id,
            "tx_type": tx_type,
            "amount_wei": amount_wei,
            "token": token,
            "dr_account": dr_account,
            "cr_account": cr_account,
            "refs": refs,
        }
        receipt_hash = self._hash_payload(payload)
        signature = self._sign(receipt_hash)
        return {**payload, "receipt_hash": receipt_hash, "signature": signature}

    def verify_receipt(self, receipt: dict[str, Any]) -> bool:
        payload = {k: receipt[k] for k in _RECEIPT_FIELDS}
        expected_hash = self._hash_payload(payload)
        expected_sig = self._sign(expected_hash)
        return (
            hmac.compare_digest(expected_hash, receipt.get("receipt_hash", ""))
            and hmac.compare_digest(expected_sig, receipt.get("signature", ""))
        )

    # ── commitment roots ──────────────────────────────────────────────

    def compute_commitment_root(
        self, balances: list[dict[str, Any]]
    ) -> dict[str, Any]:
        leaves = [self._balance_leaf(b) for b in balances]
        root = _merkle_root(leaves)
        return {"root": f"0x{root}", "leaf_count": len(balances)}

    def inclusion_proof(
        self,
        vault_id: str,
        token: str,
        balances: list[dict[str, Any]],
    ) -> dict[str, Any]:
        leaves = [self._balance_leaf(b) for b in balances]
        idx = next(
            (
                i
                for i, b in enumerate(balances)
                if b["vault_id"] == vault_id and b["token"] == token
            ),
            None,
        )
        if idx is None:
            return {"verified": False, "path": [], "leaf_index": -1, "root": ""}

        tree = _build_tree(leaves)
        path = _merkle_path(tree, idx, len(_pad_leaves(leaves)))
        root = tree[-1][0]
        verified = _verify_path(leaves[idx], path, idx, root, len(_pad_leaves(leaves)))

        return {
            "verified": verified,
            "path": [{"sibling": s, "side": side} for s, side in path],
            "leaf_index": idx,
            "root": f"0x{root}",
        }

    # ── internals ─────────────────────────────────────────────────────

    @staticmethod
    def _hash_payload(payload: dict[str, Any]) -> str:
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return "0x" + hashlib.sha256(canonical.encode()).hexdigest()

    def _sign(self, receipt_hash: str) -> str:
        return hmac.new(self._key, receipt_hash.encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def _balance_leaf(b: dict[str, Any]) -> str:
        raw = f"{b['vault_id']}:{b['token']}:{b['balance']}"
        return hashlib.sha256(raw.encode()).hexdigest()


# ── Merkle helpers ────────────────────────────────────────────────────


def _next_pow2(n: int) -> int:
    if n <= 1:
        return 1
    return 1 << (n - 1).bit_length()


def _pad_leaves(leaves: list[str]) -> list[str]:
    size = _next_pow2(len(leaves))
    return leaves + [_ZERO_LEAF] * (size - len(leaves))


def _hash_pair(left: str, right: str) -> str:
    return hashlib.sha256((left + right).encode()).hexdigest()


def _build_tree(leaves: list[str]) -> list[list[str]]:
    """Return list of levels; level 0 = padded leaves, last level = [root]."""
    padded = _pad_leaves(leaves)
    levels: list[list[str]] = [padded]
    current = padded
    while len(current) > 1:
        next_level = [
            _hash_pair(current[i], current[i + 1]) for i in range(0, len(current), 2)
        ]
        levels.append(next_level)
        current = next_level
    return levels


def _merkle_root(leaves: list[str]) -> str:
    tree = _build_tree(leaves)
    return tree[-1][0]


def _merkle_path(
    tree: list[list[str]], leaf_idx: int, padded_size: int
) -> list[tuple[str, str]]:
    """Return [(sibling_hash, 'L'|'R'), ...] from leaf to root."""
    path: list[tuple[str, str]] = []
    idx = leaf_idx
    for level in tree[:-1]:
        if idx % 2 == 0:
            sibling = level[idx + 1]
            path.append((sibling, "R"))
        else:
            sibling = level[idx - 1]
            path.append((sibling, "L"))
        idx //= 2
    return path


def _verify_path(
    leaf: str,
    path: list[tuple[str, str]],
    leaf_idx: int,
    expected_root: str,
    padded_size: int,
) -> bool:
    current = leaf
    for sibling, side in path:
        if side == "R":
            current = _hash_pair(current, sibling)
        else:
            current = _hash_pair(sibling, current)
    return hmac.compare_digest(current, expected_root)
