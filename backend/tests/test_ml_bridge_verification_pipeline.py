import pytest

from app.services.proof_pipeline import ProofMode, ProofPipeline


class _NoopSequencer:
    async def submit_proof(self, **kwargs):  # noqa: ANN003
        return kwargs


def _disable_event_log(monkeypatch, pipeline: ProofPipeline) -> None:
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(pipeline, "_log_proof_event", _noop)
    monkeypatch.setattr(
        "app.services.proof_sequencer_client.get_sequencer_client",
        lambda: _NoopSequencer(),
    )


@pytest.mark.asyncio
async def test_l3_strict_success(monkeypatch):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    async def fake_l3(**kwargs):
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": True,
            "mode": "groth16_garaga",
            "tx_hash": "0xabc",
            "error": None,
        }

    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="risk_model",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
    )

    assert result["can_execute"] is True
    assert result["verification"]["primary_authority"] == "l3"
    assert result["verification"]["l3"]["verified_on_chain"] is True


@pytest.mark.asyncio
async def test_l3_strict_blocks_hash_only(monkeypatch):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    async def fake_l3(**kwargs):
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": False,
            "mode": "hash_only",
            "tx_hash": None,
            "error": "hash-only fallback",
        }

    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="risk_model",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
    )

    assert result["can_execute"] is False
    assert result["verification"]["failure_reason"] == "hash-only fallback"


@pytest.mark.asyncio
async def test_dual_allows_mirror_failure_when_l3_primary_succeeds(monkeypatch):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    async def fake_l3(**kwargs):
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": True,
            "mode": "groth16_garaga",
            "tx_hash": "0xabc",
            "error": None,
        }

    async def fake_l2(**kwargs):
        return {
            "attempted": True,
            "success": False,
            "verified_on_chain": False,
            "mode": "l2_unverified",
            "tx_hash": None,
            "error": "mirror not available",
        }

    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)
    monkeypatch.setattr(pipeline, "_verify_l2_bridge", fake_l2)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="risk_model",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="dual",
    )

    assert result["can_execute"] is True
    assert result["verification"]["primary_authority"] == "l3"
    assert result["verification"]["mirror_status"] == "mirror_failed"


@pytest.mark.asyncio
async def test_l2_strict_blocks_when_unverified(monkeypatch):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    async def fake_l2(**kwargs):
        return {
            "attempted": True,
            "success": False,
            "verified_on_chain": False,
            "mode": "l2_unverified",
            "tx_hash": None,
            "error": "not found",
        }

    monkeypatch.setattr(pipeline, "_verify_l2_bridge", fake_l2)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="risk_model",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l2",
    )

    assert result["can_execute"] is False
    assert result["verification"]["primary_authority"] == "l2"
    assert result["verification"]["failure_reason"] == "not found"


@pytest.mark.asyncio
async def test_native_kzg_path_sends_kzg_calldata(monkeypatch):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    captured = {}

    async def fake_l3(**kwargs):
        captured.update(kwargs)
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": True,
            "mode": "native_kzg",
            "tx_hash": "0xkzg",
            "error": None,
        }

    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="risk_model",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="EzklNativeKzg",
    )

    assert result["bridge_circuit_used"] == "EzklNativeKzg"
    assert result["bridge_proof"]["bridge_backend"] in {
        "native_kzg_placeholder",
        "native_kzg_ezkl_serialized_no_mpcheck",
        "native_kzg_ezkl_serialized_mpcheck",
    }
    assert captured["proof_type"] == "native_kzg"
    assert captured["kzg_calldata"]
    assert captured["groth16_calldata"] is None
    if result["bridge_proof"]["bridge_backend"] in {
        "native_kzg_ezkl_serialized_no_mpcheck",
        "native_kzg_ezkl_serialized_mpcheck",
    }:
        assert result["bridge_proof"]["proof_hash"] == result["bridge_proof"]["kzg_payload"]["fact_hash_felt"]
    assert result["can_execute"] is True
