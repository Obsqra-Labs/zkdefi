import pytest
from pydantic import ValidationError

from app.api import risk_passport
from app.api.risk_passport import L3VerifyProofRequest
from app.services.l3_proving_path_client import L3VerificationResult


class _StubL3Client:
    async def verify_proof(self, **kwargs):
        return L3VerificationResult(
            success=True,
            mode="groth16_garaga",
            fact_hash=kwargs["fact_hash"],
            tx_hash="0xabc",
            verified_on_chain=True,
            latency_ms=12.3,
            error="",
            abi_used="verify_ezkl_kzg_v1",
            verifier_state={"rpc_ok": True, "strict_binding_observed": True},
        )


@pytest.mark.asyncio
async def test_l3_verify_typed_body(monkeypatch):
    monkeypatch.setattr(
        "app.services.l3_proving_path_client.get_l3_proving_path_client",
        lambda: _StubL3Client(),
    )

    req = L3VerifyProofRequest(
        fact_hash="0x123",
        proof_type="groth16",
        circuit_name="ModelBridge",
        groth16_calldata=["0x1", "0x2"],
        execution_chain="dual",
    )
    payload = await risk_passport.l3_verify_proof(req)

    assert payload["success"] is True
    assert payload["execution_chain"] == "dual"
    assert payload["verified_on_chain"] is True
    assert payload["abi_used"] == "verify_ezkl_kzg_v1"
    assert payload["verifier_state"]["strict_binding_observed"] is True


def test_l3_verify_rejects_invalid_execution_chain():
    with pytest.raises(ValidationError):
        L3VerifyProofRequest(
            fact_hash="0x123",
            execution_chain="foo",
        )
