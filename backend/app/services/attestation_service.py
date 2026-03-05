"""
Attestation Service

Issues verifiable credit attestations from the Risk Profile so contracts and
third parties can verify "this user qualifies for X" without seeing the full passport.

An attestation captures: subject, letter_min, composite_min, credit_tier,
collateral_wei, unsecured_cap_wei, total_line_wei, sources, chain_id,
issued_at, expires_at, and an attestation_hash.
"""
from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass, asdict, fields
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.services.credit_line_service import compute_credit_line, CreditLine
from app.services.json_store import JsonStore
from app.services.receipt_service import get_receipt_service

logger = logging.getLogger(__name__)

WEI_PER_ETH = 10**18
ATTESTATION_VALIDITY_DAYS = 7

_attestation_store = JsonStore("attestations")


@dataclass
class CreditAttestation:
    subject: str
    letter_min: str
    composite_min: int
    credit_tier: Optional[str]
    collateral_wei: int
    unsecured_cap_wei: int
    total_line_wei: int
    rate_bps: int
    sources: list[str]
    chain_id: str
    issued_at: str
    expires_at: str
    attestation_hash: str
    stark_id: Optional[str] = None
    cross_chain_verified: bool = False
    chains: Optional[list[str]] = None
    input_fingerprint: Optional[str] = None


def _sha256_hex(data: str) -> str:
    return "0x" + hashlib.sha256(data.encode()).hexdigest()


def _compute_attestation_hash(att: dict[str, Any]) -> str:
    """Deterministic hash of attestation fields (excluding the hash itself)."""
    canonical = "|".join([
        str(att.get("subject", "")),
        str(att.get("letter_min", "")),
        str(att.get("composite_min", 0)),
        str(att.get("credit_tier", "")),
        str(att.get("collateral_wei", 0)),
        str(att.get("unsecured_cap_wei", 0)),
        str(att.get("total_line_wei", 0)),
        str(att.get("rate_bps", 0)),
        str(att.get("chain_id", "")),
        str(att.get("issued_at", "")),
        str(att.get("expires_at", "")),
    ])
    return _sha256_hex(canonical)


def _compute_input_fingerprint(
    *,
    composite_score: int,
    letter_rating: str,
    tier: int,
    credit_tier: Optional[str],
    collateral_eth: float,
    linked_address_count: int,
    cross_chain_verified: bool,
) -> str:
    raw = "|".join(
        [
            str(int(composite_score)),
            str(letter_rating),
            str(int(tier)),
            str(credit_tier or ""),
            f"{float(collateral_eth):.12f}",
            str(int(linked_address_count)),
            "1" if cross_chain_verified else "0",
        ]
    )
    return _sha256_hex(raw)


def _is_unexpired(att: dict[str, Any]) -> bool:
    expires_at = att.get("expires_at")
    if not isinstance(expires_at, str) or not expires_at:
        return False
    try:
        expiry = datetime.fromisoformat(expires_at)
    except Exception:
        return False
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry > datetime.now(timezone.utc)


def _to_attestation(row: dict[str, Any]) -> CreditAttestation:
    keys = {f.name for f in fields(CreditAttestation)}
    payload = {k: v for k, v in row.items() if k in keys}
    return CreditAttestation(**payload)


def issue_attestation(
    address: str,
    composite_score: int,
    letter_rating: str,
    tier: int,
    credit_tier: Optional[str],
    collateral_eth: float,
    chain_id: str,
    linked_address_count: int = 0,
    cross_chain_verified: bool = False,
    stark_id: Optional[str] = None,
    force_issue: bool = False,
) -> CreditAttestation:
    """Issue a credit attestation from profile data."""
    fingerprint = _compute_input_fingerprint(
        composite_score=composite_score,
        letter_rating=letter_rating,
        tier=tier,
        credit_tier=credit_tier,
        collateral_eth=collateral_eth,
        linked_address_count=linked_address_count,
        cross_chain_verified=cross_chain_verified,
    )

    if not force_issue:
        active = get_active_attestation(address)
        if active and active.get("input_fingerprint") == fingerprint:
            return _to_attestation(active)

    credit_line = compute_credit_line(
        collateral_eth=collateral_eth,
        tier=tier,
        letter_rating=letter_rating,
        credit_tier=credit_tier,
        linked_address_count=linked_address_count,
        cross_chain_verified=cross_chain_verified,
    )

    now = datetime.now(timezone.utc)
    issued_at = now.isoformat()
    expires_at = (now + timedelta(days=ATTESTATION_VALIDITY_DAYS)).isoformat()

    raw = {
        "subject": address,
        "letter_min": letter_rating,
        "composite_min": composite_score,
        "credit_tier": credit_tier,
        "collateral_wei": int(collateral_eth * WEI_PER_ETH),
        "unsecured_cap_wei": int(credit_line.unsecured_cap_eth * WEI_PER_ETH),
        "total_line_wei": int(credit_line.total_line_eth * WEI_PER_ETH),
        "rate_bps": credit_line.rate_bps,
        "chain_id": chain_id,
        "issued_at": issued_at,
        "expires_at": expires_at,
    }
    att_hash = _compute_attestation_hash(raw)

    sources = ["reputation", "identity", "proof_receipts"]

    att = CreditAttestation(
        subject=address,
        letter_min=letter_rating,
        composite_min=composite_score,
        credit_tier=credit_tier,
        collateral_wei=raw["collateral_wei"],
        unsecured_cap_wei=raw["unsecured_cap_wei"],
        total_line_wei=raw["total_line_wei"],
        rate_bps=raw["rate_bps"],
        sources=sources,
        chain_id=chain_id,
        issued_at=issued_at,
        expires_at=expires_at,
        attestation_hash=att_hash,
        stark_id=stark_id,
        cross_chain_verified=cross_chain_verified,
        chains=["starknet"] + (["ethereum"] if cross_chain_verified else []),
        input_fingerprint=fingerprint,
    )

    _attestation_store.set(att_hash, asdict(att))

    receipt_svc = get_receipt_service()
    receipt_svc.append_proof_receipt(
        user_address=address,
        proof_type="credit_attestation",
        threshold_or_model="credit_line_v1",
        result=f"letter={letter_rating},line={credit_line.total_line_eth:.4f}ETH",
        fact_hash=att_hash,
    )

    logger.info(
        "Issued attestation %s for %s: line=%.4f ETH, letter=%s",
        att_hash[:16],
        address[:12],
        credit_line.total_line_eth,
        letter_rating,
    )

    return att


def get_attestation(attestation_hash: str) -> Optional[dict[str, Any]]:
    return _attestation_store.get(attestation_hash)


def get_user_attestations(address: str) -> list[dict[str, Any]]:
    """Return all attestations for a given address, newest first."""
    all_atts = _attestation_store.values()
    user_atts = [a for a in all_atts if a.get("subject", "").lower() == address.lower()]
    user_atts.sort(key=lambda x: x.get("issued_at", ""), reverse=True)
    return user_atts


def get_active_attestation(address: str) -> Optional[dict[str, Any]]:
    """Return newest unexpired attestation for a user, if present."""
    for row in get_user_attestations(address):
        if _is_unexpired(row):
            return row
    return None


def build_register_proof_calldata(
    attestation_hash: str,
    agent_id: str = "zkdefi_credit",
) -> dict[str, Any]:
    """
    Build calldata for ValidationProofRegistry.register_proof to register
    an attestation on-chain. Returns the calldata array and contract address
    for frontend wallet signing.
    """
    import os
    contract = os.getenv(
        "VALIDATION_PROOF_REGISTRY_ADDRESS",
        "0x02e2faab2cad8ecdde5e991798673ddcc08983b872304a66e5f99fbd3aface23",
    )

    fact_hash_int = int(attestation_hash, 16) if attestation_hash.startswith("0x") else int(attestation_hash)
    fact_hash_felt = hex(fact_hash_int % (2**251))

    agent_id_int = int.from_bytes(agent_id.encode()[:31], "big")
    agent_id_felt = hex(agent_id_int % (2**251))

    proof_type_int = int.from_bytes(b"credit_attestation"[:31], "big")
    proof_type_felt = hex(proof_type_int % (2**251))

    action_type_int = int.from_bytes(b"lending_eligibility"[:31], "big")
    action_type_felt = hex(action_type_int % (2**251))

    verifier_address = os.getenv("GARAGA_VERIFIER_ADDRESS", "0x0")

    return {
        "contract": contract,
        "entrypoint": "register_proof",
        "calldata": [
            fact_hash_felt,
            agent_id_felt,
            proof_type_felt,
            action_type_felt,
            verifier_address,
        ],
    }


def to_vc_format(att: dict[str, Any]) -> dict[str, Any]:
    """Convert an attestation to W3C Verifiable Credential JSON-LD shape."""
    subject_id = att.get("stark_id") or att.get("subject", "")
    return {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://obsqra.xyz/credentials/v1",
        ],
        "type": ["VerifiableCredential", "CreditAttestation"],
        "issuer": "did:starknet:obsqra",
        "credentialSubject": {
            "id": f"did:starknet:{subject_id}",
            "creditLine": {
                "total_wei": str(att.get("total_line_wei", 0)),
                "unsecured_wei": str(att.get("unsecured_cap_wei", 0)),
                "collateral_wei": str(att.get("collateral_wei", 0)),
                "rate_bps": str(att.get("rate_bps", 0)),
            },
            "letter_rating": att.get("letter_min", "D"),
            "credit_tier": att.get("credit_tier"),
            "sources": att.get("sources", []),
            "chain_id": att.get("chain_id", ""),
            "cross_chain_verified": att.get("cross_chain_verified", False),
            "chains": att.get("chains", []),
        },
        "proof": {
            "type": "SHA256",
            "verificationMethod": "ValidationProofRegistry",
            "proofValue": att.get("attestation_hash", ""),
        },
        "issuanceDate": att.get("issued_at", ""),
        "expirationDate": att.get("expires_at", ""),
    }
