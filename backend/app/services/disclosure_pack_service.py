"""
Disclosure Pack Service — selective disclosure from a PPP.

Given a full PPP and a list of claim keys, produces a minimal disclosure pack
that a verifier can consume without seeing the full profile.

Each pack is deterministically hashed so the holder can prove it was derived
from a specific PPP provenance without revealing unselected fields.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Valid claim keys a caller may request
# ---------------------------------------------------------------------------

VALID_CLAIM_KEYS = frozenset({
    "identity_binding",
    "reputation_tier",
    "execution_eligibility",
    "lending_eligibility",
    "risk_posture",
    "defi_activity",
    "builder_activity",
    "evidence",
})


# ---------------------------------------------------------------------------
# Claim extractors — each key maps to a function (ppp) -> claim dict
# ---------------------------------------------------------------------------

def _extract_identity_binding(ppp: dict[str, Any]) -> dict[str, Any]:
    identity = ppp.get("identity") or {}
    return {
        "linked_address_count": len(identity.get("linked_addresses") or []),
        "session_active_count": (identity.get("session_state") or {}).get("active_count", 0),
        "privacy_mode": identity.get("privacy_mode", "selective"),
    }


def _extract_reputation_tier(ppp: dict[str, Any]) -> dict[str, Any]:
    rep = ppp.get("reputation") or {}
    return {
        "tier": rep.get("tier", 0),
        "tier_name": rep.get("tier_name", "Unknown"),
        "letter_rating": rep.get("letter_rating", "D"),
    }


def _extract_execution_eligibility(ppp: dict[str, Any]) -> dict[str, Any]:
    claims = ppp.get("claims") or {}
    ee = claims.get("execution_eligibility") or {}
    return {
        "allowed": ee.get("allowed", False),
        "mode": ee.get("mode", "advisory"),
        "confidence_band": ee.get("confidence_band"),
    }


def _extract_lending_eligibility(ppp: dict[str, Any]) -> dict[str, Any]:
    claims = ppp.get("claims") or {}
    le = claims.get("lending_eligibility") or {}
    return {
        "allowed": le.get("allowed", False),
        "mode": le.get("mode", "advisory"),
    }


def _extract_risk_posture(ppp: dict[str, Any]) -> dict[str, Any]:
    claims = ppp.get("claims") or {}
    rp = claims.get("risk_posture") or {}
    return {
        "label": rp.get("label", "unknown"),
        "tier": rp.get("tier", 0),
        "composite_score": rp.get("composite_score", 0),
    }


def _extract_defi_activity(ppp: dict[str, Any]) -> dict[str, Any]:
    defi = (ppp.get("activity") or {}).get("defi") or {}
    return {
        "protocol_count": defi.get("protocol_count", 0),
        "position_count": defi.get("position_count", 0),
    }


def _extract_builder_activity(ppp: dict[str, Any]) -> dict[str, Any]:
    builder = (ppp.get("activity") or {}).get("builder") or {}
    return {
        "deploy_count": builder.get("deploy_count", 0),
        "verified_receipt_count": builder.get("verified_receipt_count", 0),
        "proof_count": builder.get("proof_count", 0),
    }


def _extract_evidence(ppp: dict[str, Any]) -> dict[str, Any]:
    evidence = ppp.get("evidence") or {}
    return {
        "receipt_root": evidence.get("receipt_root", "0x0"),
        "portfolio_snapshot_hash": evidence.get("portfolio_snapshot_hash", "0x0"),
        "proof_ref_count": len(evidence.get("proof_registry_refs") or []),
    }


_EXTRACTORS: dict[str, Any] = {
    "identity_binding": _extract_identity_binding,
    "reputation_tier": _extract_reputation_tier,
    "execution_eligibility": _extract_execution_eligibility,
    "lending_eligibility": _extract_lending_eligibility,
    "risk_posture": _extract_risk_posture,
    "defi_activity": _extract_defi_activity,
    "builder_activity": _extract_builder_activity,
    "evidence": _extract_evidence,
}


# ---------------------------------------------------------------------------
# Disclosure pack builder
# ---------------------------------------------------------------------------

def build_disclosure_pack(
    ppp: dict[str, Any],
    claim_keys: list[str],
) -> dict[str, Any]:
    """Build a selective disclosure pack from a PPP.

    Args:
        ppp: Full PPP v1 dict.
        claim_keys: List of claim keys to include.

    Returns:
        Disclosure pack dict with selected claims and binding metadata.

    Raises:
        ValueError: If any claim_key is not recognized.
    """
    invalid = set(claim_keys) - VALID_CLAIM_KEYS
    if invalid:
        raise ValueError(f"Unknown claim keys: {sorted(invalid)}")

    if not claim_keys:
        raise ValueError("At least one claim key is required")

    disclosed: dict[str, Any] = {}
    for key in claim_keys:
        extractor = _EXTRACTORS.get(key)
        if extractor:
            disclosed[key] = extractor(ppp)

    # Binding metadata ties the pack to a specific PPP generation
    provenance = ppp.get("provenance") or {}
    pack_payload = json.dumps(disclosed, sort_keys=True, separators=(",", ":"))
    pack_hash = hashlib.sha256(pack_payload.encode()).hexdigest()

    return {
        "version": "disclosure_pack.v1",
        "subject": ppp.get("subject"),
        "disclosed_claims": disclosed,
        "claim_keys": sorted(claim_keys),
        "binding": {
            "ppp_policy_hash": provenance.get("policy_hash", "0x0"),
            "ppp_generated_at": provenance.get("generated_at"),
            "pack_hash": f"0x{pack_hash[:40]}",
            "pack_generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Service class
# ---------------------------------------------------------------------------

class DisclosurePackService:
    """Generates selective disclosure packs from PPP data."""

    def __init__(self, passport_service=None):
        self._passport_service = passport_service

    def _get_passport_service(self):
        if self._passport_service is None:
            from app.services.portable_passport_service import get_portable_passport_service
            self._passport_service = get_portable_passport_service()
        return self._passport_service

    async def generate(
        self,
        address: str,
        claim_keys: list[str],
        *,
        request=None,
    ) -> dict[str, Any]:
        """Generate a disclosure pack for an address.

        Args:
            address: Starknet address.
            claim_keys: Which claims to include.
            request: Optional FastAPI Request for internal resolution.

        Returns:
            Disclosure pack dict.
        """
        ppp = await self._get_passport_service().get_passport(address, request=request)
        pack = build_disclosure_pack(ppp, claim_keys)

        logger.info(
            "disclosure_pack generated | address=%s claims=%s pack_hash=%s",
            address[:20],
            sorted(claim_keys),
            pack.get("binding", {}).get("pack_hash", "?"),
        )
        return pack


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: DisclosurePackService | None = None


def get_disclosure_pack_service() -> DisclosurePackService:
    global _instance
    if _instance is None:
        _instance = DisclosurePackService()
    return _instance
