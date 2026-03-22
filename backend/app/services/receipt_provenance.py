"""
Helpers for classifying receipt txs and resolving public settlements for proofs.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.db.decision_store import get_decision_store
from app.services.receipt_service import get_receipt_service


def voyager_tx_url(tx_hash: str | None) -> str | None:
    tx = str(tx_hash or "").strip()
    return f"https://sepolia.voyager.online/tx/{tx}" if tx else None


def starkscan_tx_url(tx_hash: str | None) -> str | None:
    tx = str(tx_hash or "").strip()
    return f"https://sepolia.starkscan.co/tx/{tx}" if tx else None


def etherscan_tx_url(tx_hash: str | None) -> str | None:
    tx = str(tx_hash or "").strip()
    return f"https://sepolia.etherscan.io/tx/{tx}" if tx else None


def tx_route_meta(
    tx_hash: str | None,
    *,
    tx_source: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tx = str(tx_hash or "").strip()
    meta = metadata if isinstance(metadata, dict) else {}
    source = str(tx_source or meta.get("tx_source") or "").strip().lower()
    network = str(meta.get("network") or "").strip().lower()
    public_chain = str(meta.get("public_chain") or "").strip().lower()

    if not tx:
        return {
            "tx_visibility": "missing",
            "public_receipt": False,
            "network": None,
            "public_chain": None,
            "explorer_url": None,
            "voyager_url": None,
            "starkscan_url": None,
            "etherscan_url": None,
        }

    if source in {"l2", "starknet_l2", "mirror"} or (
        network == "starknet_sepolia" and public_chain == "starknet_l2"
    ):
        voyager_url = voyager_tx_url(tx)
        starkscan_url = starkscan_tx_url(tx)
        return {
            "tx_visibility": "public",
            "public_receipt": True,
            "network": "starknet_sepolia",
            "public_chain": "starknet_l2",
            "explorer_url": voyager_url,
            "voyager_url": voyager_url,
            "starkscan_url": starkscan_url,
            "etherscan_url": None,
        }

    if source in {"l1", "ethereum", "ethereum_l1"} or (
        network == "ethereum_sepolia" and public_chain == "ethereum_l1"
    ):
        etherscan_url = etherscan_tx_url(tx)
        return {
            "tx_visibility": "public",
            "public_receipt": True,
            "network": "ethereum_sepolia",
            "public_chain": "ethereum_l1",
            "explorer_url": etherscan_url,
            "voyager_url": None,
            "starkscan_url": None,
            "etherscan_url": etherscan_url,
        }

    if source in {"l3", "madara", "madara_l3", "local_l3"}:
        return {
            "tx_visibility": "internal",
            "public_receipt": False,
            "network": "madara_l3",
            "public_chain": None,
            "explorer_url": None,
            "voyager_url": None,
            "starkscan_url": None,
            "etherscan_url": None,
        }

    return {
        "tx_visibility": "unknown",
        "public_receipt": False,
        "network": None,
        "public_chain": None,
        "explorer_url": None,
        "voyager_url": None,
        "starkscan_url": None,
        "etherscan_url": None,
    }


def summarize_public_receipts(receipts: list[dict[str, Any]]) -> dict[str, Any]:
    l1 = sum(1 for row in receipts if row.get("public_chain") == "ethereum_l1")
    l2 = sum(1 for row in receipts if row.get("public_chain") == "starknet_l2")
    latest = receipts[0] if receipts else None
    return {
        "count": len(receipts),
        "ethereum_l1": l1,
        "starknet_l2": l2,
        "latest_tx_hash": latest.get("tx_hash") if latest else None,
        "latest_network": latest.get("network") if latest else None,
    }


def _normalize_lookup_value(value: object) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    if text.startswith("0x"):
        try:
            felt_safe = int(text, 16) & ((1 << 252) - 1)
            return hex(felt_safe)
        except ValueError:
            body = text[2:].lstrip("0") or "0"
            return f"0x{body}"
    return text


def _normalized_hashes(values: Iterable[object]) -> set[str]:
    out: set[str] = set()
    for value in values:
        text = _normalize_lookup_value(value)
        if text:
            out.add(text)
    return out


def _row_matches_lookup(lookup_hashes: set[str], *values: object) -> bool:
    return any(_normalize_lookup_value(value) in lookup_hashes for value in values)


async def collect_public_receipts_for_hashes(
    proof_hashes: Iterable[object],
    *,
    user_address: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    lookup_hashes = _normalized_hashes(proof_hashes)
    if not lookup_hashes:
        return []

    addr = str(user_address or "").strip().lower()
    receipts = await get_receipt_service().get_user_receipts(addr) if addr else []
    decisions = await get_decision_store().get_user_history(addr, limit=1000) if addr else []

    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for row in receipts:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        if not _row_matches_lookup(
            lookup_hashes,
            row.get("proof_hash"),
            row.get("fact_hash"),
            metadata.get("proof_hash"),
            metadata.get("fact_hash"),
            metadata.get("bridge_fact_hash"),
        ):
            continue
        receipt_row = {
            "tx_hash": row.get("tx_hash"),
            "proof_hash": row.get("proof_hash"),
            "fact_hash": row.get("fact_hash") or metadata.get("fact_hash") or metadata.get("bridge_fact_hash"),
            "timestamp": row.get("timestamp"),
            "source": "receipt_store",
            "tx_source": metadata.get("tx_source"),
        }
        receipt_row.update(tx_route_meta(receipt_row.get("tx_hash"), metadata=metadata))
        if not receipt_row.get("public_receipt"):
            continue
        dedupe = (str(receipt_row.get("tx_hash")), str(receipt_row.get("source")))
        if dedupe in seen:
            continue
        seen.add(dedupe)
        out.append(receipt_row)

    for row in decisions:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        if not _row_matches_lookup(
            lookup_hashes,
            metadata.get("proof_hash"),
            metadata.get("fact_hash"),
            metadata.get("bridge_fact_hash"),
        ):
            continue
        for tx_source, tx_field in (("l1", "l1_tx_hash"), ("l2", "l2_tx_hash")):
            tx_hash = row.get(tx_field)
            decision_row = {
                "tx_hash": tx_hash,
                "proof_hash": metadata.get("proof_hash"),
                "fact_hash": metadata.get("fact_hash") or metadata.get("bridge_fact_hash") or metadata.get("proof_hash"),
                "timestamp": row.get("created_at"),
                "source": "decision_store",
                "tx_source": tx_source,
                "action": row.get("event_type"),
            }
            decision_row.update(tx_route_meta(tx_hash, tx_source=tx_source))
            if not decision_row.get("public_receipt"):
                continue
            dedupe = (str(decision_row.get("tx_hash")), str(decision_row.get("source")))
            if dedupe in seen:
                continue
            seen.add(dedupe)
            out.append(decision_row)

    out.sort(key=lambda row: str(row.get("timestamp") or ""), reverse=True)
    return out[:limit]
