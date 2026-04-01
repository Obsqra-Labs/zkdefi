"""Tests for the Portable Passport Service (PPP v1)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.portable_passport_service import (
    PortablePassportService,
    _build_ppp,
    _compute_policy_hash,
    _compute_receipt_root,
    _redact_public,
    _extract_evidence,
    _valid_address,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VALID_ADDRESS = "0x0348914bed4fdc65399d347c4498d778b75d5835d9276027a4357fe78b4a7eb3"
COLD_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000001"


def _mock_bundle(address: str, *, active: bool = True) -> dict[str, Any]:
    return {
        "address": address,
        "reputation": {
            "tier": 2 if active else 0,
            "tier_name": "Express" if active else "Strict",
            "tenure_days": 180 if active else 0,
            "transaction_count": 42 if active else 0,
            "collateral_eth": 1.5 if active else 0.0,
            "total_volume_eth": 12.5 if active else 0.0,
        },
        "risk_passport": {
            "composite_score": 72 if active else 0,
            "letter_rating": "B" if active else "D",
            "credit_score": 680 if active else None,
            "credit_tier": "standard" if active else None,
        },
        "onboarding": {"has_agent": active, "identity_commitment": "0xabc" if active else None},
        "linked_addresses": {"eth": "0xeee", "arb": "0xaaa"} if active else {},
        "compliance_summary": {"count": 0, "profiles": []},
        "session_summary": {"count": 2 if active else 0, "active_count": 1 if active else 0, "sessions": []},
        "dual_wallet_session": {"active": active, "status": "active" if active else "missing"},
        "governance": {"voting_power": 100.0 if active else 0.0},
        "portfolio_summary": {
            "total_value_usd": 50000.0 if active else 0.0,
            "protocol_count": 3 if active else 0,
            "position_count": 5 if active else 0,
            "snapshot_hash": "0xsnap123" if active else None,
            "scanned_at": "2026-03-30T00:00:00Z" if active else None,
        },
    }


def _mock_decision_payload(*, allowed: bool = True) -> dict[str, Any]:
    return {
        "decisions": {
            "relayer": {"mode": "allow" if allowed else "advisory", "reason_codes": [] if allowed else ["tier_below_standard"]},
            "execution": {"mode": "allow" if allowed else "advisory", "reason_codes": [] if allowed else ["onboarding_incomplete"]},
            "lending": {
                "mode": "allow" if allowed else "advisory",
                "reason_codes": [] if allowed else ["no_credit_line"],
                "limits": {"total_line_eth": 2.0 if allowed else 0},
            },
        }
    }


def _mock_receipts(n: int = 3) -> list[dict[str, Any]]:
    return [
        {"receipt_id": f"rcpt-{i}", "action_type": "swap", "on_chain": i % 2 == 0}
        for i in range(n)
    ]


def _mock_proofs(n: int = 2) -> list[dict[str, Any]]:
    return [
        {"proof_hash": f"0xproof{i}", "model_name": f"model_{i}"}
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# Unit: address validation
# ---------------------------------------------------------------------------

class TestAddressValidation:
    def test_valid_address(self):
        assert _valid_address(VALID_ADDRESS) is True

    def test_invalid_no_prefix(self):
        assert _valid_address("348914bed4fdc") is False

    def test_invalid_empty(self):
        assert _valid_address("") is False

    def test_invalid_non_hex(self):
        assert _valid_address("0xZZZZ") is False

    def test_whitespace_stripped(self):
        assert _valid_address(f"  {VALID_ADDRESS}  ") is True


# ---------------------------------------------------------------------------
# Unit: helpers
# ---------------------------------------------------------------------------

class TestHelpers:
    def test_receipt_root_empty(self):
        assert _compute_receipt_root([]) == "0x0"

    def test_receipt_root_deterministic(self):
        r = _mock_receipts(3)
        assert _compute_receipt_root(r) == _compute_receipt_root(r)

    def test_policy_hash_deterministic(self):
        d = _mock_decision_payload()["decisions"]
        assert _compute_policy_hash(d) == _compute_policy_hash(d)

    def test_policy_hash_changes_on_different_input(self):
        d1 = _mock_decision_payload(allowed=True)["decisions"]
        d2 = _mock_decision_payload(allowed=False)["decisions"]
        assert _compute_policy_hash(d1) != _compute_policy_hash(d2)


# ---------------------------------------------------------------------------
# Unit: PPP builder
# ---------------------------------------------------------------------------

class TestBuildPPP:
    def test_active_wallet(self):
        ppp = _build_ppp(
            VALID_ADDRESS,
            _mock_bundle(VALID_ADDRESS),
            _mock_decision_payload(),
            _mock_receipts(),
            _mock_proofs(),
            [],
        )
        assert ppp["version"] == "ppp.v1"
        assert ppp["subject"]["starknet_address"] == VALID_ADDRESS
        assert ppp["reputation"]["tier"] == 2
        assert ppp["reputation"]["letter_rating"] == "B"
        assert ppp["activity"]["builder"]["proof_count"] == 2
        assert ppp["activity"]["defi"]["tvl_usd"] == 50000.0
        assert ppp["claims"]["execution_eligibility"]["allowed"] is True
        assert len(ppp["evidence"]["proof_registry_refs"]) == 2

    def test_cold_wallet(self):
        ppp = _build_ppp(
            COLD_ADDRESS,
            _mock_bundle(COLD_ADDRESS, active=False),
            _mock_decision_payload(allowed=False),
            [],
            [],
            [],
        )
        assert ppp["version"] == "ppp.v1"
        assert ppp["reputation"]["tier"] == 0
        assert ppp["reputation"]["tier_name"] == "Strict"
        assert ppp["activity"]["builder"]["proof_count"] == 0
        assert ppp["activity"]["defi"]["tvl_usd"] == 0.0
        assert ppp["claims"]["execution_eligibility"]["allowed"] is False
        assert ppp["evidence"]["receipt_root"] == "0x0"

    def test_none_bundle_still_valid(self):
        """When bundle is unavailable, PPP should still be structurally valid."""
        ppp = _build_ppp(VALID_ADDRESS, None, None, [], [], [])
        assert ppp["version"] == "ppp.v1"
        assert ppp["reputation"]["tier"] == 0
        assert ppp["claims"]["execution_eligibility"]["mode"] == "advisory"


# ---------------------------------------------------------------------------
# Unit: public card redaction
# ---------------------------------------------------------------------------

class TestPublicCard:
    def test_score_banded(self):
        ppp = _build_ppp(VALID_ADDRESS, _mock_bundle(VALID_ADDRESS), _mock_decision_payload(), [], [], [])
        public = _redact_public(ppp)
        assert isinstance(public["reputation"]["score"], str)
        assert public["reputation"]["score"] == "60-79"

    def test_credit_score_removed(self):
        ppp = _build_ppp(VALID_ADDRESS, _mock_bundle(VALID_ADDRESS), _mock_decision_payload(), [], [], [])
        public = _redact_public(ppp)
        assert "credit_score" not in public["reputation"]

    def test_tvl_banded(self):
        ppp = _build_ppp(VALID_ADDRESS, _mock_bundle(VALID_ADDRESS), _mock_decision_payload(), [], [], [])
        public = _redact_public(ppp)
        assert isinstance(public["activity"]["defi"]["tvl_usd"], str)

    def test_source_health_stripped(self):
        ppp = _build_ppp(VALID_ADDRESS, _mock_bundle(VALID_ADDRESS), _mock_decision_payload(), [], [], [])
        ppp["source_health"] = [{"name": "test", "status": "ok"}]
        public = _redact_public(ppp)
        assert "source_health" not in public


# ---------------------------------------------------------------------------
# Unit: evidence extraction
# ---------------------------------------------------------------------------

class TestEvidenceExtraction:
    def test_minimal_shape(self):
        ppp = _build_ppp(VALID_ADDRESS, _mock_bundle(VALID_ADDRESS), _mock_decision_payload(), _mock_receipts(), _mock_proofs(), [])
        evidence = _extract_evidence(ppp)
        assert "evidence" in evidence
        assert "provenance" in evidence
        assert "subject" in evidence
        assert "reputation" not in evidence
        assert "claims" not in evidence


# ---------------------------------------------------------------------------
# Integration: PortablePassportService with mocked dependencies
# ---------------------------------------------------------------------------

class TestPortablePassportServiceIntegration:
    @pytest.fixture
    def svc(self):
        return PortablePassportService()

    @pytest.mark.asyncio
    async def test_get_passport_active_wallet(self, svc):
        bundle = _mock_bundle(VALID_ADDRESS)
        decisions = _mock_decision_payload()
        receipts = _mock_receipts()
        proof_records = []

        with patch("app.services.portable_passport_service._fetch_reputation_bundle") as mock_bundle, \
             patch("app.services.portable_passport_service._fetch_receipts") as mock_receipts_fn, \
             patch("app.services.portable_passport_service._fetch_proofs") as mock_proofs_fn, \
             patch("app.services.profile_decision_service.get_profile_decision_service") as mock_decision:

            from app.services.portable_passport_service import SourceHealth
            bh = SourceHealth("risk_profile_bundle"); bh.ok(50)
            rh = SourceHealth("receipts"); rh.ok(10)
            ph = SourceHealth("proof_registry"); ph.ok(5)

            mock_bundle.return_value = (bundle, bh)
            mock_receipts_fn.return_value = (receipts, rh)
            mock_proofs_fn.return_value = ([], ph)
            mock_decision.return_value.evaluate.return_value = decisions

            ppp = await svc.get_passport(VALID_ADDRESS)
            assert ppp["version"] == "ppp.v1"
            assert ppp["reputation"]["tier"] == 2
            assert len(ppp["source_health"]) == 4
            assert all(h["status"] == "ok" for h in ppp["source_health"])

    @pytest.mark.asyncio
    async def test_get_passport_degraded_source(self, svc):
        """One source fails — PPP should still return with error in source_health."""
        bundle = _mock_bundle(VALID_ADDRESS)
        decisions = _mock_decision_payload()

        with patch("app.services.portable_passport_service._fetch_reputation_bundle") as mock_bundle, \
             patch("app.services.portable_passport_service._fetch_receipts") as mock_receipts_fn, \
             patch("app.services.portable_passport_service._fetch_proofs") as mock_proofs_fn, \
             patch("app.services.profile_decision_service.get_profile_decision_service") as mock_decision:

            from app.services.portable_passport_service import SourceHealth
            bh = SourceHealth("risk_profile_bundle"); bh.ok(50)
            rh = SourceHealth("receipts"); rh.fail(100, "DB timeout")
            ph = SourceHealth("proof_registry"); ph.ok(5)

            mock_bundle.return_value = (bundle, bh)
            mock_receipts_fn.return_value = ([], rh)
            mock_proofs_fn.return_value = ([], ph)
            mock_decision.return_value.evaluate.return_value = decisions

            ppp = await svc.get_passport(VALID_ADDRESS)
            assert ppp["version"] == "ppp.v1"
            health_statuses = {h["name"]: h["status"] for h in ppp["source_health"]}
            assert health_statuses["receipts"] == "error"
            assert health_statuses["risk_profile_bundle"] == "ok"

    @pytest.mark.asyncio
    async def test_get_passport_invalid_address(self, svc):
        with pytest.raises(ValueError, match="Invalid address"):
            await svc.get_passport("not_an_address")

    @pytest.mark.asyncio
    async def test_get_public_card(self, svc):
        bundle = _mock_bundle(VALID_ADDRESS)
        decisions = _mock_decision_payload()

        with patch("app.services.portable_passport_service._fetch_reputation_bundle") as mock_bundle, \
             patch("app.services.portable_passport_service._fetch_receipts") as mock_receipts_fn, \
             patch("app.services.portable_passport_service._fetch_proofs") as mock_proofs_fn, \
             patch("app.services.profile_decision_service.get_profile_decision_service") as mock_decision:

            from app.services.portable_passport_service import SourceHealth
            bh = SourceHealth("risk_profile_bundle"); bh.ok(50)
            rh = SourceHealth("receipts"); rh.ok(10)
            ph = SourceHealth("proof_registry"); ph.ok(5)

            mock_bundle.return_value = (bundle, bh)
            mock_receipts_fn.return_value = ([], rh)
            mock_proofs_fn.return_value = ([], ph)
            mock_decision.return_value.evaluate.return_value = decisions

            public = await svc.get_public_card(VALID_ADDRESS)
            assert isinstance(public["reputation"]["score"], str)
            assert "credit_score" not in public["reputation"]
            assert "source_health" not in public
