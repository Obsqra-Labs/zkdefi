"""Contract tests for Portable Identity V3 + zkFICO additive endpoints."""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

backend = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend))

from app.main import app
from app.services.portable_identity_service import PortableIdentityService

client = TestClient(app)


def _rand_addr() -> str:
    return "0x" + uuid.uuid4().hex + uuid.uuid4().hex[:24]


def test_portable_identity_v3_lifecycle_contract() -> None:
    subject = _rand_addr()

    graph = client.get(f"/api/v1/zkdefi/identity/graph/{subject}")
    assert graph.status_code == 200
    graph_payload = graph.json()
    assert graph_payload.get("subject") == subject.lower()
    assert isinstance(graph_payload.get("version_matrix"), dict)

    linked = client.post(
        f"/api/v1/zkdefi/identity/graph/{subject}/link",
        json={
            "chain": "ethereum",
            "address": _rand_addr(),
            "verification_method": "signature_challenge",
            "verified": True,
            "confidence": 1.0,
            "identity_commitment": "0xabc123",
        },
    )
    assert linked.status_code == 200
    link_payload = linked.json()
    assert link_payload.get("status") == "ok"
    assert isinstance(link_payload.get("version_matrix"), dict)

    attribution = client.post(
        "/api/v1/zkdefi/attributions/query",
        json={"subject": subject, "window_days": 30, "include_evidence": True},
    )
    assert attribution.status_code == 200
    attribution_payload = attribution.json()
    assert attribution_payload.get("subject") == subject.lower()
    assert isinstance(attribution_payload.get("summary"), dict)

    claims = client.post(
        "/api/v1/zkdefi/claims/derive",
        json={"subject": subject, "window_days": 30, "min_confidence": 0.0},
    )
    assert claims.status_code == 200
    claims_payload = claims.json()
    assert isinstance(claims_payload.get("claims"), dict)
    assert isinstance(claims_payload.get("version_matrix"), dict)

    issue = client.post(
        "/api/v1/zkdefi/credentials/issue",
        json={
            "subject": subject,
            "template": "portable_identity_v3",
            "audience": "trade_desk",
            "claim_keys": ["reputation_score_0_100"],
            "ttl_hours": 12,
        },
    )
    assert issue.status_code == 200
    issued_payload = issue.json()
    credential = issued_payload.get("credential") or {}
    credential_id = credential.get("credential_id")
    revocation_id = credential.get("revocation_id")
    assert isinstance(credential_id, str) and credential_id.startswith("cred_")
    assert isinstance(revocation_id, str) and revocation_id.startswith("rev_")

    verify = client.post(
        "/api/v1/zkdefi/credentials/verify",
        json={"credential_id": credential_id},
    )
    assert verify.status_code == 200
    verify_payload = verify.json()
    assert verify_payload.get("verified") is True

    revoke = client.post(
        "/api/v1/zkdefi/credentials/revoke",
        json={"credential_id": credential_id, "reason": "test"},
    )
    assert revoke.status_code == 200
    revoke_payload = revoke.json()
    assert revoke_payload.get("revoked") is True

    revocation = client.get(f"/api/v1/zkdefi/credentials/revocation/{revocation_id}")
    assert revocation.status_code == 200
    revocation_payload = revocation.json()
    assert revocation_payload.get("revoked") is True


def test_risk_profile_v2_additive_portable_fields() -> None:
    address = _rand_addr()
    response = client.get(f"/api/v1/zkdefi/risk_profile/v2/{address}")
    assert response.status_code == 200
    payload = response.json()

    assert isinstance(payload.get("version_matrix"), dict)
    assert isinstance(payload.get("attribution_summary"), dict)
    assert isinstance(payload.get("credential_summary"), dict)


def test_zkfico_manifest_and_aggregate_contract() -> None:
    address = _rand_addr()

    manifest = client.get("/api/v1/zkdefi/reputation/pack/manifest")
    assert manifest.status_code == 200
    manifest_payload = manifest.json()
    circuits = manifest_payload.get("circuits") or []
    assert isinstance(circuits, list)
    assert any(c.get("proof_type") == "credit_eligibility" for c in circuits if isinstance(c, dict))
    assert isinstance(manifest_payload.get("flags"), dict)

    aggregate = client.get(f"/api/v1/zkdefi/reputation/zkfico/{address}")
    assert aggregate.status_code == 200
    aggregate_payload = aggregate.json()
    scores = aggregate_payload.get("scores") or {}
    assert "trust_score_0_100" in scores
    assert "fico_display_300_850" in scores
    assert isinstance(aggregate_payload.get("proofs"), list)
    assert isinstance(aggregate_payload.get("version_matrix"), dict)


def test_portable_identity_flag_aliases(monkeypatch) -> None:
    monkeypatch.setenv("PORTABLE_IDENTITY_V3", "false")
    svc = PortableIdentityService()
    assert svc.enabled() is False

    monkeypatch.delenv("PORTABLE_IDENTITY_V3", raising=False)
    monkeypatch.setenv("PORTABLE_IDENTITY_V3_ENABLED", "false")
    svc = PortableIdentityService()
    assert svc.enabled() is False
