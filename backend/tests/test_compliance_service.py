"""
Tests for ComplianceService — profile registration, expiry, revocation, validation.
"""
from __future__ import annotations

import pytest

from app.services.compliance_service import ComplianceService


@pytest.fixture
def svc():
    return ComplianceService()


# ---------------------------------------------------------------------------
# register_profile
# ---------------------------------------------------------------------------

class TestRegisterProfile:
    @pytest.mark.asyncio
    async def test_register_valid_profile(self, svc: ComplianceService):
        p = await svc.register_profile(
            user_address="0xAlice",
            profile_type="kyc",
            statement_hash="0xSH",
            proof_hash="0xPH",
            threshold=1,
            result="eligible",
        )
        assert p["profile_id"].startswith("0x")
        assert p["profile_type"] == "kyc"
        assert p["profile_type_name"] == "KYC Eligibility"
        assert p["is_active"] is True
        assert p["on_chain"] is False

    @pytest.mark.asyncio
    async def test_invalid_profile_type_raises(self, svc: ComplianceService):
        with pytest.raises(ValueError, match="Invalid profile type"):
            await svc.register_profile(
                user_address="0xA",
                profile_type="unknown_type",
                statement_hash="0x",
                proof_hash="0x",
                threshold=0,
                result="x",
            )

    @pytest.mark.asyncio
    async def test_all_four_types_accepted(self, svc: ComplianceService):
        for ptype in ("kyc", "risk", "performance", "aggregation"):
            p = await svc.register_profile(
                user_address="0xA",
                profile_type=ptype,
                statement_hash="0x",
                proof_hash="0x",
                threshold=0,
                result="eligible",
            )
            assert p["profile_type"] == ptype


# ---------------------------------------------------------------------------
# confirm_profile
# ---------------------------------------------------------------------------

class TestConfirmProfile:
    @pytest.mark.asyncio
    async def test_confirm_adds_tx_hash(self, svc: ComplianceService):
        p = await svc.register_profile("0xA", "kyc", "0x", "0x", 0, "eligible")
        result = await svc.confirm_profile(p["profile_id"], "0xTX")
        assert result["status"] == "confirmed"
        stored = await svc.get_profile(p["profile_id"])
        assert stored["on_chain"] is True
        assert stored["tx_hash"] == "0xTX"


# ---------------------------------------------------------------------------
# revoke_profile
# ---------------------------------------------------------------------------

class TestRevokeProfile:
    @pytest.mark.asyncio
    async def test_revoke_deactivates_profile(self, svc: ComplianceService):
        p = await svc.register_profile("0xAlice", "kyc", "0x", "0x", 0, "eligible")
        result = await svc.revoke_profile(p["profile_id"], "0xAlice")
        assert result["status"] == "revoked"
        stored = await svc.get_profile(p["profile_id"])
        assert stored["is_active"] is False

    @pytest.mark.asyncio
    async def test_revoke_wrong_owner_raises(self, svc: ComplianceService):
        p = await svc.register_profile("0xAlice", "kyc", "0x", "0x", 0, "eligible")
        with pytest.raises(ValueError, match="Not profile owner"):
            await svc.revoke_profile(p["profile_id"], "0xBob")

    @pytest.mark.asyncio
    async def test_revoke_nonexistent_raises(self, svc: ComplianceService):
        with pytest.raises(ValueError, match="Profile not found"):
            await svc.revoke_profile("0xNONE", "0xAlice")


# ---------------------------------------------------------------------------
# get_user_profiles with expiry check
# ---------------------------------------------------------------------------

class TestGetUserProfiles:
    @pytest.mark.asyncio
    async def test_returns_profiles_with_validity(self, svc: ComplianceService):
        await svc.register_profile("0xAlice", "kyc", "0x", "0x", 0, "eligible", validity_days=30)
        profiles = await svc.get_user_profiles("0xAlice")
        assert len(profiles) == 1
        assert profiles[0]["is_valid"] is True
        assert profiles[0]["is_expired"] is False

    @pytest.mark.asyncio
    async def test_expired_profile_flagged(self, svc: ComplianceService):
        p = await svc.register_profile("0xAlice", "kyc", "0x", "0x", 0, "eligible", validity_days=0)
        # validity_days=0 means expiry == timestamp, so it's already expired
        # Force the expiry to be in the past
        from datetime import datetime, timedelta, timezone
        svc._profiles[p["profile_id"]]["expiry"] = (
            datetime.now(timezone.utc) - timedelta(days=1)
        ).isoformat()
        profiles = await svc.get_user_profiles("0xAlice")
        assert profiles[0]["is_expired"] is True
        assert profiles[0]["is_valid"] is False


# ---------------------------------------------------------------------------
# has_valid_profile
# ---------------------------------------------------------------------------

class TestHasValidProfile:
    @pytest.mark.asyncio
    async def test_returns_true_for_valid_profile(self, svc: ComplianceService):
        await svc.register_profile("0xAlice", "kyc", "0x", "0x", 0, "eligible", validity_days=30)
        result = await svc.has_valid_profile("0xAlice", "kyc")
        assert result["has_valid"] is True
        assert result["profile_type"] == "kyc"

    @pytest.mark.asyncio
    async def test_returns_false_when_no_profiles(self, svc: ComplianceService):
        result = await svc.has_valid_profile("0xNobody", "kyc")
        assert result["has_valid"] is False

    @pytest.mark.asyncio
    async def test_returns_false_when_wrong_type(self, svc: ComplianceService):
        await svc.register_profile("0xAlice", "kyc", "0x", "0x", 0, "eligible")
        result = await svc.has_valid_profile("0xAlice", "risk")
        assert result["has_valid"] is False

    @pytest.mark.asyncio
    async def test_returns_false_when_revoked(self, svc: ComplianceService):
        p = await svc.register_profile("0xAlice", "kyc", "0x", "0x", 0, "eligible")
        await svc.revoke_profile(p["profile_id"], "0xAlice")
        result = await svc.has_valid_profile("0xAlice", "kyc")
        assert result["has_valid"] is False


# ---------------------------------------------------------------------------
# generate_kyc_proof
# ---------------------------------------------------------------------------

class TestGenerateKycProof:
    @pytest.mark.asyncio
    async def test_eligible_proof(self, svc: ComplianceService):
        proof = await svc.generate_kyc_proof("0xAlice", is_eligible=True)
        assert proof["result"] == "eligible"
        assert proof["statement_hash"].startswith("0x")
        assert proof["proof_hash"].startswith("0x")

    @pytest.mark.asyncio
    async def test_ineligible_proof(self, svc: ComplianceService):
        proof = await svc.generate_kyc_proof("0xAlice", is_eligible=False)
        assert proof["result"] == "ineligible"


# ---------------------------------------------------------------------------
# Unimplemented proof generators
# ---------------------------------------------------------------------------

class TestSimulatedProofs:
    """With ALLOW_SIMULATED_PROOFS=true these methods return simulated proofs."""

    @pytest.mark.asyncio
    async def test_risk_compliance_returns_proof(self, svc: ComplianceService):
        result = await svc.generate_risk_compliance_proof("0xA", 20, 50)
        assert result["profile_type"] == "risk"
        assert result["result"] == "compliant"
        assert result["simulated"] is True

    @pytest.mark.asyncio
    async def test_performance_proof_returns_proof(self, svc: ComplianceService):
        result = await svc.generate_performance_proof("0xA", 100, 50)
        assert result["profile_type"] == "performance"
        assert result["result"] == "above"
        assert result["simulated"] is True

    @pytest.mark.asyncio
    async def test_aggregation_proof_returns_proof(self, svc: ComplianceService):
        result = await svc.generate_aggregation_proof("0xA", 10000, 5000)
        assert result["profile_type"] == "aggregation"
        assert result["result"] == "above"
        assert result["simulated"] is True
