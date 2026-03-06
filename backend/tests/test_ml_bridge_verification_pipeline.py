from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.services.proof_pipeline import ProofPipeline


class _FakeEzklProof:
    proof_hash = "0x" + ("1" * 64)
    model_hash = "2" * 64
    inference_output = [100.0] * 8

    def to_dict(self) -> dict:
        return {
            "proof_hash": self.proof_hash,
            "model_hash": self.model_hash,
            "inference_output": self.inference_output,
        }


class _FakeEzklProver:
    async def prove_inference(self, model_name: str, input_data: list[list[float]]):  # noqa: ARG002
        return _FakeEzklProof()

    async def verify_proof(self, proof: _FakeEzklProof):  # noqa: ARG002
        return True


class _FakeSequencer:
    async def submit_proof(self, **kwargs):  # noqa: ANN003
        return kwargs


async def _fake_generate_proof(circuit_name: str, inputs: dict):  # noqa: ARG001
    return {
        "circuit": "ModelBridge",
        "success": True,
        "is_compliant": True,
        "proof_hash": "0xbridgeproofhash",
        "proof": {"pi_a": ["1", "2"]},
        "public_signals": ["1"],
    }


def _build_pipeline(monkeypatch: pytest.MonkeyPatch) -> ProofPipeline:
    pipeline = ProofPipeline()
    pipeline.ezkl_prover = _FakeEzklProver()
    pipeline._log_proof_event = AsyncMock()
    pipeline._mirror_retry_count = 0
    monkeypatch.setattr("app.services.proof_sequencer_client.get_sequencer_client", lambda: _FakeSequencer())
    monkeypatch.setattr("app.services.zkml.circuit_scanner._generate_proof", _fake_generate_proof)
    monkeypatch.setattr("app.services.garaga_formatter.format_proof_for_garaga", lambda proof, signals, vk: ["1", "2"])
    return pipeline


@pytest.mark.asyncio
async def test_l3_strict_accepts_onchain_crypto_verify(monkeypatch: pytest.MonkeyPatch):
    pipeline = _build_pipeline(monkeypatch)
    pipeline._verify_l3_bridge = AsyncMock(return_value={
        "attempted": True,
        "success": True,
        "mode": "groth16_garaga",
        "verified_on_chain": True,
        "tx_hash": "0xl3tx",
        "latency_ms": 10.0,
        "error": None,
    })

    result = await pipeline.generate_ml_proofs(
        user_address="0xabc",
        model_name="creditworthiness",
        input_data=[[1.0] * 8],
        proof_mode="EZKL_BRIDGE",
        tier=1,
        execution_chain="l3",
    )

    assert result["can_execute"] is True
    assert result["verification"]["primary_authority"] == "l3"
    assert result["verification"]["l3"]["verified_on_chain"] is True
    assert result["verification"]["l3"]["mode"] == "groth16_garaga"


@pytest.mark.asyncio
async def test_l3_strict_blocks_hash_only_mode(monkeypatch: pytest.MonkeyPatch):
    pipeline = _build_pipeline(monkeypatch)
    pipeline._verify_l3_bridge = AsyncMock(return_value={
        "attempted": True,
        "success": True,
        "mode": "hash_only",
        "verified_on_chain": False,
        "tx_hash": "0xhashonly",
        "latency_ms": 9.0,
        "error": "hash-only fallback",
    })

    result = await pipeline.generate_ml_proofs(
        user_address="0xabc",
        model_name="creditworthiness",
        input_data=[[1.0] * 8],
        proof_mode="EZKL_BRIDGE",
        tier=1,
        execution_chain="l3",
    )

    assert result["can_execute"] is False
    assert "hash-only" in (result["verification"]["failure_reason"] or "")


@pytest.mark.asyncio
async def test_dual_run_l3_primary_allows_l2_mirror_failure(monkeypatch: pytest.MonkeyPatch):
    pipeline = _build_pipeline(monkeypatch)
    pipeline._verify_l3_bridge = AsyncMock(return_value={
        "attempted": True,
        "success": True,
        "mode": "groth16_garaga",
        "verified_on_chain": True,
        "tx_hash": "0xl3tx",
        "latency_ms": 12.0,
        "error": None,
    })
    pipeline._verify_l2_bridge = AsyncMock(return_value={
        "attempted": True,
        "success": False,
        "mode": "l2_unverified",
        "verified_on_chain": False,
        "tx_hash": None,
        "error": "L2 fact not verified",
    })

    result = await pipeline.generate_ml_proofs(
        user_address="0xabc",
        model_name="creditworthiness",
        input_data=[[1.0] * 8],
        proof_mode="EZKL_BRIDGE",
        tier=1,
        execution_chain="dual",
    )

    assert result["can_execute"] is True
    assert result["verification"]["primary_authority"] == "l3"
    assert result["verification"]["mirror_status"] == "mirror_failed"
    assert result["verification"]["l2"]["attempted"] is True


@pytest.mark.asyncio
async def test_l2_strict_blocks_when_l2_unverified(monkeypatch: pytest.MonkeyPatch):
    pipeline = _build_pipeline(monkeypatch)
    pipeline._verify_l2_bridge = AsyncMock(return_value={
        "attempted": True,
        "success": False,
        "mode": "l2_unverified",
        "verified_on_chain": False,
        "tx_hash": None,
        "error": "L2 verification failed",
    })

    result = await pipeline.generate_ml_proofs(
        user_address="0xabc",
        model_name="creditworthiness",
        input_data=[[1.0] * 8],
        proof_mode="EZKL_BRIDGE",
        tier=1,
        execution_chain="l2",
    )

    assert result["can_execute"] is False
    assert result["verification"]["primary_authority"] == "l2"
    assert "L2 verification failed" in (result["verification"]["failure_reason"] or "")
