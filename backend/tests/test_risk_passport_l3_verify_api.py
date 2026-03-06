from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
import app.services.l3_proving_path_client as l3_client_module

client = TestClient(app)


class _FakeVerifyResult:
    def __init__(self):
        self.success = True
        self.mode = "groth16_garaga"
        self.fact_hash = "0xfact"
        self.tx_hash = "0xtx"
        self.verified_on_chain = True
        self.latency_ms = 15.0
        self.error = ""


class _FakeL3Client:
    def __init__(self):
        self.last_payload = None

    async def verify_proof(self, **kwargs):  # noqa: ANN003
        self.last_payload = kwargs
        return _FakeVerifyResult()


def test_l3_verify_accepts_typed_body_and_passes_calldata(monkeypatch):
    fake = _FakeL3Client()
    monkeypatch.setattr(l3_client_module, "get_l3_proving_path_client", lambda: fake)

    response = client.post(
        "/api/v1/zkdefi/risk_passport/l3/verify",
        json={
            "fact_hash": "0xfact",
            "proof_type": "groth16",
            "circuit_name": "ModelBridge",
            "groth16_calldata": ["1", "2", "3"],
            "execution_chain": "dual",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["execution_chain"] == "dual"
    assert fake.last_payload is not None
    assert fake.last_payload["fact_hash"] == "0xfact"
    assert fake.last_payload["proof_type"] == "groth16"
    assert fake.last_payload["circuit_name"] == "ModelBridge"
    assert fake.last_payload["groth16_calldata"] == ["1", "2", "3"]
    assert fake.last_payload["execution_chain"] == "dual"


def test_l3_verify_requires_fact_hash():
    response = client.post(
        "/api/v1/zkdefi/risk_passport/l3/verify",
        json={
            "proof_type": "groth16",
            "circuit_name": "ModelBridge",
            "execution_chain": "l3",
        },
    )
    assert response.status_code == 422


def test_l3_verify_rejects_invalid_execution_chain():
    response = client.post(
        "/api/v1/zkdefi/risk_passport/l3/verify",
        json={
            "fact_hash": "0xfact",
            "proof_type": "groth16",
            "execution_chain": "invalid_chain",
        },
    )
    assert response.status_code == 422
