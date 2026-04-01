"""Tests for PassportExportService — sign + verify round-trip."""
import json
import time
from datetime import datetime, timedelta, timezone

import pytest

from app.services.passport_export_service import PassportExportService

_TEST_SECRET = "ab" * 32  # 64 hex chars = 32 bytes


@pytest.fixture
def svc():
    return PassportExportService(signing_secret=_TEST_SECRET)


SAMPLE_PPP = {
    "version": "ppp.v1",
    "subject": "0x0348914bed4fdc65399d347c4498d778b75d5835d9276027a4357fe78b4a7eb3",
    "reputation": {"tier": 3, "tier_name": "Verified", "composite_score": 42},
    "provenance": {"generated_at": "2026-06-01T00:00:00+00:00", "policy_hash": "0xabc"},
}


def test_sign_and_verify(svc: PassportExportService):
    envelope = svc.sign_envelope(SAMPLE_PPP, payload_type="ppp_v1")

    assert envelope["envelope_version"] == "signed_export.v1"
    assert envelope["issuer"] == "zkde.fi"
    assert envelope["payload_type"] == "ppp_v1"
    assert envelope["payload"] == SAMPLE_PPP
    assert "signature" in envelope
    assert "signed_at" in envelope
    assert "expires_at" in envelope

    result = svc.verify_envelope(envelope)
    assert result["valid"] is True
    assert result["reason"] is None
    assert result["payload_type"] == "ppp_v1"


def test_tamper_detection(svc: PassportExportService):
    envelope = svc.sign_envelope(SAMPLE_PPP)

    # Tamper with the payload
    tampered = json.loads(json.dumps(envelope))
    tampered["payload"]["reputation"]["tier"] = 99

    result = svc.verify_envelope(tampered)
    assert result["valid"] is False
    assert result["reason"] == "signature_mismatch"


def test_tamper_metadata(svc: PassportExportService):
    envelope = svc.sign_envelope(SAMPLE_PPP)

    tampered = json.loads(json.dumps(envelope))
    tampered["issuer"] = "evil.fi"

    result = svc.verify_envelope(tampered)
    assert result["valid"] is False
    assert result["reason"] == "signature_mismatch"


def test_missing_signature(svc: PassportExportService):
    envelope = svc.sign_envelope(SAMPLE_PPP)
    del envelope["signature"]

    result = svc.verify_envelope(envelope)
    assert result["valid"] is False
    assert result["reason"] == "missing_signature"


def test_expired_envelope(svc: PassportExportService):
    envelope = svc.sign_envelope(SAMPLE_PPP, ttl_hours=0)
    # ttl_hours=0 → expires_at is None (no expiry). Use a real expired time.
    # Manually set expires_at to the past and re-sign.
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    env_copy = {k: v for k, v in envelope.items() if k != "signature"}
    env_copy["expires_at"] = past

    import hmac as _hmac
    import hashlib
    key = bytes.fromhex(_TEST_SECRET)
    canonical = json.dumps(env_copy, sort_keys=True, separators=(",", ":"))
    sig = _hmac.new(key, canonical.encode(), hashlib.sha256).hexdigest()
    env_copy["signature"] = sig

    result = svc.verify_envelope(env_copy, check_expiry=True)
    assert result["valid"] is False
    assert result["reason"] == "expired"


def test_no_expiry(svc: PassportExportService):
    envelope = svc.sign_envelope(SAMPLE_PPP, ttl_hours=None)
    assert envelope["expires_at"] is None

    result = svc.verify_envelope(envelope, check_expiry=True)
    assert result["valid"] is True


def test_disclosure_pack_type(svc: PassportExportService):
    pack = {
        "version": "disclosure_pack.v1",
        "subject": "0x0348…",
        "disclosed_claims": {"reputation_tier": {"tier": 3}},
    }
    envelope = svc.sign_envelope(pack, payload_type="disclosure_pack.v1")
    assert envelope["payload_type"] == "disclosure_pack.v1"

    result = svc.verify_envelope(envelope)
    assert result["valid"] is True
    assert result["payload_type"] == "disclosure_pack.v1"


def test_different_keys_fail():
    svc1 = PassportExportService(signing_secret="aa" * 32)
    svc2 = PassportExportService(signing_secret="bb" * 32)

    envelope = svc1.sign_envelope(SAMPLE_PPP)
    result = svc2.verify_envelope(envelope)
    assert result["valid"] is False
    assert result["reason"] == "signature_mismatch"


def test_missing_secret_raises():
    import os
    old = os.environ.pop("PASSPORT_SIGNING_SECRET", None)
    try:
        with pytest.raises(RuntimeError, match="PASSPORT_SIGNING_SECRET"):
            PassportExportService(signing_secret="")
    finally:
        if old is not None:
            os.environ["PASSPORT_SIGNING_SECRET"] = old
