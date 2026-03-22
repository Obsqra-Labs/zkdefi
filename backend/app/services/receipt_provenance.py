"""
Helpers for classifying receipt txs and resolving public settlements for proofs.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.services.proof_projection import lane_model_alias
from app.services.showcase_artifacts import load_pathb_bundle_warm_report


def get_decision_store():
    from app.db.decision_store import get_decision_store as _get_decision_store

    return _get_decision_store()


def get_receipt_service():
    from app.services.receipt_service import get_receipt_service as _get_receipt_service

    return _get_receipt_service()


def get_proof_registry():
    from app.services.proof_registry import get_proof_registry as _get_proof_registry

    return _get_proof_registry()


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
        "latest_timestamp": latest.get("timestamp") if latest else None,
        "latest_match_scope": latest.get("proof_match_scope") if latest else None,
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


def _pathb_native_kzg_public_rows() -> list[dict[str, Any]]:
    report = load_pathb_bundle_warm_report()
    generated_at = report.get("generated_at")
    rows = report.get("rows") if isinstance(report.get("rows"), list) else []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("native_kzg_mirror_status") or "").strip().lower() != "mirrored":
            continue
        tx_hash = row.get("native_kzg_l2_tx_hash")
        if not tx_hash:
            continue
        model_name = row.get("model")
        proof_hash = row.get("proof_hash")
        receipt_row = {
            "tx_hash": tx_hash,
            "proof_hash": proof_hash,
            "fact_hash": proof_hash,
            "timestamp": generated_at,
            "source": "pathb_artifact",
            "tx_source": "l2",
            "action": "native_kzg_mirror",
            "bridge_lane": "native_kzg",
            "model_name": model_name,
            "proof_match_scope": "lane_model",
        }
        receipt_row.update(tx_route_meta(tx_hash, tx_source="l2"))
        out.append(receipt_row)
    return out


def _proof_registry_public_rows(user_address: str) -> list[dict[str, Any]]:
    addr = str(user_address or "").strip().lower()
    if not addr:
        return []

    try:
        records = get_proof_registry().list_proofs(user_address=addr, limit=5000, offset=0)
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    for record in records:
        record_dict = record.to_dict()
        metadata = record_dict.get("metadata") if isinstance(record_dict.get("metadata"), dict) else {}
        bridge_statement = metadata.get("bridge_statement") if isinstance(metadata.get("bridge_statement"), dict) else {}
        verification = metadata.get("verification") if isinstance(metadata.get("verification"), dict) else {}
        proof_hash = record_dict.get("proof_hash")
        fact_hash = (
            metadata.get("fact_hash")
            or metadata.get("bridge_fact_hash")
            or bridge_statement.get("fact_hash")
            or bridge_statement.get("bridge_fact_hash")
            or proof_hash
        )
        model_name = bridge_statement.get("model_name") or record_dict.get("model_name")
        bridge_lane = bridge_statement.get("lane") or metadata.get("bridge_lane")
        timestamp = (
            record_dict.get("submitted_at_iso")
            or record_dict.get("created_at_iso")
            or record_dict.get("created_at")
        )

        seen_candidates: set[tuple[str, str]] = set()
        candidates: list[tuple[str, str | None]] = []
        for tx_source in ("l1", "l2"):
            top_level_tx = str(metadata.get(f"{tx_source}_tx_hash") or "").strip() or None
            if top_level_tx:
                candidates.append((tx_source, top_level_tx))
            section = verification.get(tx_source)
            if isinstance(section, dict) and section.get("verified_on_chain"):
                section_tx = str(section.get("tx_hash") or "").strip() or None
                if section_tx:
                    candidates.append((tx_source, section_tx))

        for tx_source, tx_hash in candidates:
            if not tx_hash:
                continue
            dedupe_key = (tx_source, tx_hash)
            if dedupe_key in seen_candidates:
                continue
            seen_candidates.add(dedupe_key)
            receipt_row = {
                "tx_hash": tx_hash,
                "proof_hash": proof_hash,
                "fact_hash": fact_hash,
                "timestamp": timestamp,
                "source": "proof_registry_metadata",
                "tx_source": tx_source,
                "action": record_dict.get("action_type"),
                "bridge_lane": bridge_lane,
                "model_name": model_name,
                "proof_match_scope": "exact_hash",
            }
            receipt_row.update(tx_route_meta(tx_hash, tx_source=tx_source))
            if receipt_row.get("public_receipt"):
                out.append(receipt_row)
    return out


async def collect_public_receipts_for_hashes(
    proof_hashes: Iterable[object],
    *,
    user_address: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    receipt_index = await build_public_receipt_index_for_user(user_address or "")
    return public_receipts_from_index(receipt_index, proof_hashes, limit=limit)


async def build_public_receipt_index_for_user(user_address: str) -> dict[str, list[dict[str, Any]]]:
    addr = str(user_address or "").strip().lower()
    receipts = await get_receipt_service().get_user_receipts(addr) if addr else []
    decisions = await get_decision_store().get_user_history(addr, limit=1000) if addr else []

    index: dict[str, list[dict[str, Any]]] = {}
    seen: set[tuple[str, str]] = set()

    def _append_row(row: dict[str, Any], *aliases: object) -> None:
        dedupe = (
            str(row.get("tx_hash") or ""),
            str(row.get("public_chain") or row.get("network") or row.get("tx_source") or ""),
        )
        if dedupe in seen:
            return
        seen.add(dedupe)
        normalized_aliases = _normalized_hashes(aliases)
        for alias in normalized_aliases:
            index.setdefault(alias, []).append(row)

    for row in receipts:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        receipt_row = {
            "tx_hash": row.get("tx_hash"),
            "proof_hash": row.get("proof_hash"),
            "fact_hash": row.get("fact_hash") or metadata.get("fact_hash") or metadata.get("bridge_fact_hash"),
            "timestamp": row.get("timestamp"),
            "source": "receipt_store",
            "tx_source": metadata.get("tx_source"),
            "proof_match_scope": "exact_hash",
        }
        receipt_row.update(tx_route_meta(receipt_row.get("tx_hash"), metadata=metadata))
        if not receipt_row.get("public_receipt"):
            continue
        _append_row(
            receipt_row,
            row.get("proof_hash"),
            row.get("fact_hash"),
            metadata.get("proof_hash"),
            metadata.get("fact_hash"),
            metadata.get("bridge_fact_hash"),
        )

    for row in decisions:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
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
                "proof_match_scope": "exact_hash",
            }
            decision_row.update(tx_route_meta(tx_hash, tx_source=tx_source))
            if not decision_row.get("public_receipt"):
                continue
            _append_row(
                decision_row,
                metadata.get("proof_hash"),
                metadata.get("fact_hash"),
                metadata.get("bridge_fact_hash"),
            )

    for row in _proof_registry_public_rows(addr):
        _append_row(
            row,
            row.get("proof_hash"),
            row.get("fact_hash"),
        )

    for row in _pathb_native_kzg_public_rows():
        _append_row(
            row,
            row.get("proof_hash"),
            row.get("fact_hash"),
            lane_model_alias(row.get("bridge_lane"), row.get("model_name")),
        )

    for rows in index.values():
        rows.sort(key=lambda row: str(row.get("timestamp") or ""), reverse=True)
    return index


def public_receipts_from_index(
    receipt_index: dict[str, list[dict[str, Any]]],
    proof_hashes: Iterable[object],
    *,
    limit: int = 100,
) -> list[dict[str, Any]]:
    lookup_hashes = _normalized_hashes(proof_hashes)
    if not lookup_hashes:
        return []
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for alias in lookup_hashes:
        for row in receipt_index.get(alias, []):
            dedupe = (str(row.get("tx_hash")), str(row.get("source")))
            if dedupe in seen:
                continue
            seen.add(dedupe)
            out.append(row)

    out.sort(key=lambda row: str(row.get("timestamp") or ""), reverse=True)
    return out[:limit]
