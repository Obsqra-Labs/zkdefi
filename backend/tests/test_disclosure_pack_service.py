"""Tests for the Disclosure Pack Service."""
from __future__ import annotations

import pytest

from app.services.disclosure_pack_service import (
    VALID_CLAIM_KEYS,
    DisclosurePackService,
    build_disclosure_pack,
)

# ---------------------------------------------------------------------------
# Fixture: minimal PPP v1 object
# ---------------------------------------------------------------------------

SAMPLE_PPP = {
    "version": "ppp.v1",
    "subject": {
        "starknet_address": "0xabc123",
        "subject_id": "did:zkdefi:0xabc123",
    },
    "identity": {
        "linked_addresses": ["0xeth1", "0xarb2"],
        "session_state": {"count": 3, "active_count": 1},
        "privacy_mode": "selective",
    },
    "reputation": {
        "tier": 1,
        "tier_name": "Standard",
        "score": 62,
        "credit_score": 700,
        "letter_rating": "B",
    },
    "activity": {
        "builder": {
            "deploy_count": 2,
            "verified_receipt_count": 5,
            "proof_count": 3,
        },
        "defi": {
            "tvl_usd": 12345.67,
            "protocol_count": 4,
            "position_count": 7,
            "turnover_30d_usd": 50000,
        },
    },
    "evidence": {
        "receipt_root": "0xdeadbeef",
        "portfolio_snapshot_hash": "0xcafebabe",
        "proof_registry_refs": ["0xp1", "0xp2", "0xp3"],
    },
    "claims": {
        "execution_eligibility": {
            "allowed": True,
            "mode": "allow",
            "reason_codes": [],
            "confidence_band": "high",
        },
        "lending_eligibility": {
            "allowed": False,
            "mode": "advisory",
            "max_ltv": 0.5,
            "reason_codes": ["passport_low_confidence"],
        },
        "risk_posture": {
            "label": "balanced",
            "tier": 1,
            "composite_score": 62,
        },
    },
    "provenance": {
        "generated_at": "2026-03-30T12:00:00+00:00",
        "policy_hash": "0xpolicyhash",
        "circuits": ["membership_v2"],
        "proof_mode": "hybrid",
    },
    "source_health": [],
}


# ---------------------------------------------------------------------------
# build_disclosure_pack — pure function tests
# ---------------------------------------------------------------------------


class TestBuildDisclosurePack:
    def test_single_claim(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["reputation_tier"])
        assert pack["version"] == "disclosure_pack.v1"
        assert pack["subject"]["starknet_address"] == "0xabc123"
        assert pack["claim_keys"] == ["reputation_tier"]
        assert pack["disclosed_claims"]["reputation_tier"]["tier"] == 1
        assert pack["disclosed_claims"]["reputation_tier"]["tier_name"] == "Standard"

    def test_multiple_claims(self):
        keys = ["reputation_tier", "execution_eligibility", "evidence"]
        pack = build_disclosure_pack(SAMPLE_PPP, keys)
        assert pack["claim_keys"] == sorted(keys)
        assert len(pack["disclosed_claims"]) == 3
        assert pack["disclosed_claims"]["execution_eligibility"]["allowed"] is True
        assert pack["disclosed_claims"]["evidence"]["receipt_root"] == "0xdeadbeef"

    def test_all_valid_keys(self):
        pack = build_disclosure_pack(SAMPLE_PPP, list(VALID_CLAIM_KEYS))
        assert len(pack["disclosed_claims"]) == len(VALID_CLAIM_KEYS)

    def test_binding_metadata(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["reputation_tier"])
        binding = pack["binding"]
        assert binding["ppp_policy_hash"] == "0xpolicyhash"
        assert binding["ppp_generated_at"] == "2026-03-30T12:00:00+00:00"
        assert binding["pack_hash"].startswith("0x")
        assert len(binding["pack_hash"]) == 42  # 0x + 40 hex

    def test_deterministic_hash(self):
        p1 = build_disclosure_pack(SAMPLE_PPP, ["reputation_tier"])
        p2 = build_disclosure_pack(SAMPLE_PPP, ["reputation_tier"])
        assert p1["binding"]["pack_hash"] == p2["binding"]["pack_hash"]

    def test_different_claims_different_hash(self):
        p1 = build_disclosure_pack(SAMPLE_PPP, ["reputation_tier"])
        p2 = build_disclosure_pack(SAMPLE_PPP, ["execution_eligibility"])
        assert p1["binding"]["pack_hash"] != p2["binding"]["pack_hash"]

    def test_invalid_claim_key_raises(self):
        with pytest.raises(ValueError, match="Unknown claim keys"):
            build_disclosure_pack(SAMPLE_PPP, ["reputation_tier", "nonexistent_key"])

    def test_empty_claim_keys_raises(self):
        with pytest.raises(ValueError, match="At least one claim key"):
            build_disclosure_pack(SAMPLE_PPP, [])


# ---------------------------------------------------------------------------
# Claim extractor coverage
# ---------------------------------------------------------------------------


class TestClaimExtractors:
    def test_identity_binding(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["identity_binding"])
        claim = pack["disclosed_claims"]["identity_binding"]
        assert claim["linked_address_count"] == 2
        assert claim["session_active_count"] == 1
        assert claim["privacy_mode"] == "selective"

    def test_lending_eligibility(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["lending_eligibility"])
        claim = pack["disclosed_claims"]["lending_eligibility"]
        assert claim["allowed"] is False
        assert claim["mode"] == "advisory"
        # max_ltv and reason_codes are stripped for disclosure
        assert "max_ltv" not in claim
        assert "reason_codes" not in claim

    def test_risk_posture(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["risk_posture"])
        claim = pack["disclosed_claims"]["risk_posture"]
        assert claim["label"] == "balanced"
        assert claim["composite_score"] == 62

    def test_defi_activity(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["defi_activity"])
        claim = pack["disclosed_claims"]["defi_activity"]
        assert claim["protocol_count"] == 4
        assert claim["position_count"] == 7
        # tvl_usd not disclosed
        assert "tvl_usd" not in claim

    def test_builder_activity(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["builder_activity"])
        claim = pack["disclosed_claims"]["builder_activity"]
        assert claim["deploy_count"] == 2
        assert claim["verified_receipt_count"] == 5
        assert claim["proof_count"] == 3

    def test_evidence(self):
        pack = build_disclosure_pack(SAMPLE_PPP, ["evidence"])
        claim = pack["disclosed_claims"]["evidence"]
        assert claim["receipt_root"] == "0xdeadbeef"
        assert claim["proof_ref_count"] == 3
        # Full refs not disclosed, just the count
        assert "proof_registry_refs" not in claim


# ---------------------------------------------------------------------------
# Edge cases — degraded/empty PPP
# ---------------------------------------------------------------------------


class TestDegradedPPP:
    def test_empty_identity(self):
        ppp = {**SAMPLE_PPP, "identity": {}}
        pack = build_disclosure_pack(ppp, ["identity_binding"])
        claim = pack["disclosed_claims"]["identity_binding"]
        assert claim["linked_address_count"] == 0
        assert claim["session_active_count"] == 0

    def test_missing_claims_section(self):
        ppp = {**SAMPLE_PPP, "claims": {}}
        pack = build_disclosure_pack(ppp, ["execution_eligibility"])
        claim = pack["disclosed_claims"]["execution_eligibility"]
        assert claim["allowed"] is False
        assert claim["mode"] == "advisory"

    def test_missing_provenance(self):
        ppp = {**SAMPLE_PPP, "provenance": {}}
        pack = build_disclosure_pack(ppp, ["reputation_tier"])
        assert pack["binding"]["ppp_policy_hash"] == "0x0"
        assert pack["binding"]["ppp_generated_at"] is None


# ---------------------------------------------------------------------------
# DisclosurePackService integration
# ---------------------------------------------------------------------------


class TestDisclosurePackService:
    @pytest.mark.asyncio
    async def test_generate_with_injected_passport_service(self):
        class FakePassportService:
            async def get_passport(self, address, *, request=None):
                return SAMPLE_PPP

        svc = DisclosurePackService(passport_service=FakePassportService())
        pack = await svc.generate("0xabc123", ["reputation_tier", "evidence"])
        assert pack["version"] == "disclosure_pack.v1"
        assert len(pack["disclosed_claims"]) == 2

    @pytest.mark.asyncio
    async def test_generate_invalid_keys_raises(self):
        class FakePassportService:
            async def get_passport(self, address, *, request=None):
                return SAMPLE_PPP

        svc = DisclosurePackService(passport_service=FakePassportService())
        with pytest.raises(ValueError, match="Unknown claim keys"):
            await svc.generate("0xabc123", ["bad_key"])
