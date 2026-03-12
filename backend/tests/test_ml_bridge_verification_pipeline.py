import pytest
import json
from pathlib import Path

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

    class _FakeEzklProof:
        proof_hash = "0x1234"
        model_hash = "0x5678"
        verify_key_hash = "0x9abc"
        public_inputs = [1.0]
        inference_output = [2.0]
        proof_hex = "0x11"
        proof_bytes = b"\x11"
        raw_proof_json = {
            "kzg_mpcheck_bundle": {
                "pair0": {
                    "x": "1",
                    "y": "2",
                },
                "pair1": {
                    "x": "3",
                    "y": "4",
                },
                "mpcheck_hint_felts": ["7"],
                "auto_build_hint": False,
            }
        }

        def to_dict(self):
            return {
                "proof_hash": self.proof_hash,
                "model_hash": self.model_hash,
            }

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

    async def fake_real_ezkl(**kwargs):
        return _FakeEzklProof(), True

    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)
    monkeypatch.setattr(pipeline, "_try_generate_real_ezkl_proof", fake_real_ezkl)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="risk_model",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="EzklNativeKzg",
    )

    assert result["bridge_circuit_used"] == "EzklNativeKzg"
    assert result["bridge_proof"]["bridge_backend"] == "native_kzg_ezkl_serialized_mpcheck"
    assert captured["proof_type"] == "native_kzg"
    assert captured["kzg_calldata"]
    assert captured["groth16_calldata"] is None
    assert result["bridge_proof"]["proof_hash"] == result["bridge_proof"]["kzg_payload"]["fact_hash_felt"]
    assert result["can_execute"] is True


@pytest.mark.asyncio
async def test_native_kzg_strict_blocks_placeholder(monkeypatch):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    async def fake_real_ezkl(**kwargs):
        return None, False

    called = {"l3": False}

    async def fake_l3(**kwargs):
        called["l3"] = True
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": True,
            "mode": "native_kzg",
            "tx_hash": "0xkzg",
            "error": None,
        }

    monkeypatch.setattr(pipeline, "_try_generate_real_ezkl_proof", fake_real_ezkl)
    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="risk_model",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="EzklNativeKzg",
    )

    assert result["bridge_proof"]["bridge_backend"] == "native_kzg_placeholder"
    assert result["can_execute"] is False
    assert "Real EZKL proof unavailable" in (result["verification"]["failure_reason"] or "")
    assert called["l3"] is False


@pytest.mark.asyncio
async def test_native_kzg_sidecar_bundle_enables_strict_path(monkeypatch, tmp_path: Path):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    bundle_file = tmp_path / "kzg_mpcheck_bundle.json"
    bundle_file.write_text(
        json.dumps(
            {
                "kzg_mpcheck_bundle": {
                    "pair0": {"x": "0x11", "y": "0x22"},
                    "pair1": {"x": "0x33", "y": "0x44"},
                    "mpcheck_hint_felts": ["0x5", "0x6"],
                    "auto_build_hint": False,
                }
            }
        )
    )
    monkeypatch.setenv("EZKL_KZG_BUNDLE_FILE", str(bundle_file))

    captured = {}

    class _FakeEzklProof:
        proof_hash = "0x1234"
        model_hash = "0x5678"
        verify_key_hash = "0x9abc"
        public_inputs = [1.0]
        inference_output = [2.0]
        proof_hex = "0x11"
        proof_bytes = b"\x11"
        raw_proof_json = {"proof": [1, 2, 3], "instances": [[1]]}
        model_name = "yield_forecast"

        def to_dict(self):
            return {
                "proof_hash": self.proof_hash,
                "model_hash": self.model_hash,
                "model_name": self.model_name,
            }

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

    async def fake_real_ezkl(**kwargs):
        return _FakeEzklProof(), True

    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)
    monkeypatch.setattr(pipeline, "_try_generate_real_ezkl_proof", fake_real_ezkl)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="yield_forecast",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="EzklNativeKzg",
    )

    assert result["can_execute"] is True
    assert result["bridge_proof"]["bridge_backend"] == "native_kzg_ezkl_serialized_mpcheck"
    assert result["bridge_proof"]["kzg_payload"]["kzg_bundle_injected"] is True
    assert captured["proof_type"] == "native_kzg"
    assert captured["kzg_calldata"]


@pytest.mark.asyncio
async def test_native_kzg_alias_model_resolves_trace_sidecar(monkeypatch, tmp_path: Path):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)
    monkeypatch.delenv("EZKL_KZG_BUNDLE_FILE", raising=False)
    monkeypatch.setenv("EZKL_KZG_BUNDLE_SCAN_MODELS", "false")

    models_root = tmp_path / "ezkl_models"
    alias_dir = models_root / "yield_forecast"
    trace_dir = alias_dir / ".kzg_trace_verifier"
    trace_dir.mkdir(parents=True, exist_ok=True)
    (trace_dir / "kzg_mpcheck_bundle.json").write_text(
        json.dumps(
            {
                "kzg_mpcheck_bundle": {
                    "pair0": {"x": "0x11", "y": "0x22"},
                    "pair1": {"x": "0x33", "y": "0x44"},
                    "mpcheck_hint_felts": ["0x5"],
                    "auto_build_hint": False,
                }
            }
        )
    )
    monkeypatch.setattr(pipeline, "_local_ezkl_models_root", lambda: models_root)

    captured = {}

    class _FakeEzklProof:
        proof_hash = "0x1234"
        model_hash = "0x5678"
        verify_key_hash = "0x9abc"
        public_inputs = [1.0]
        inference_output = [2.0]
        proof_hex = "0x11"
        proof_bytes = b"\x11"
        raw_proof_json = {"proof": [1], "instances": [[1]]}

        def to_dict(self):
            return {
                "proof_hash": self.proof_hash,
                "model_hash": self.model_hash,
            }

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

    async def fake_real_ezkl(**kwargs):
        return _FakeEzklProof(), True

    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)
    monkeypatch.setattr(pipeline, "_try_generate_real_ezkl_proof", fake_real_ezkl)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="yield_predictor",  # alias -> yield_forecast
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="EzklNativeKzg",
    )

    assert result["can_execute"] is True
    assert result["bridge_proof"]["bridge_backend"] == "native_kzg_ezkl_serialized_mpcheck"
    assert result["bridge_proof"]["kzg_payload"]["kzg_bundle_injected"] is True
    assert ".kzg_trace_verifier" in str(result["bridge_proof"]["kzg_payload"]["kzg_bundle_injected_source"])
    assert captured["proof_type"] == "native_kzg"
    assert captured["kzg_calldata"]


@pytest.mark.asyncio
async def test_modelbridge_prefers_real_ezkl_when_available(monkeypatch):
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    class _FakeEzklProof:
        proof_hash = "0x1234"
        model_hash = "0x5678"
        inference_output = [2.0]
        output_hash = "0x9999"
        raw_proof_json = {"proof": [1], "instances": [[1]]}

        def to_dict(self):
            return {
                "proof_hash": self.proof_hash,
                "model_hash": self.model_hash,
                "output_hash": self.output_hash,
            }

    async def fake_real_ezkl(**kwargs):
        return _FakeEzklProof(), True

    async def fake_l3(**kwargs):
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": True,
            "mode": "groth16_garaga",
            "tx_hash": "0xabc",
            "error": None,
        }

    monkeypatch.setattr(pipeline, "_try_generate_real_ezkl_proof", fake_real_ezkl)
    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="yield_predictor",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="ModelBridge",
    )

    assert result["can_execute"] is True
    assert result["trust_mode"] == "ezkl_local_verified_bridge"
    assert result["bridge_circuit_used"] == "ModelBridge"
    assert result["bridge_proof"]["bridge_backend"] == "groth16_modelbridge"


@pytest.mark.asyncio
async def test_modelbridge_require_real_ezkl_blocks_when_unavailable(monkeypatch):
    monkeypatch.setenv("MODELBRIDGE_REQUIRE_REAL_EZKL", "true")
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    async def fake_real_ezkl(**kwargs):
        return None, False

    called = {"l3": False}

    async def fake_l3(**kwargs):
        called["l3"] = True
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": True,
            "mode": "groth16_garaga",
            "tx_hash": "0xabc",
            "error": None,
        }

    monkeypatch.setattr(pipeline, "_try_generate_real_ezkl_proof", fake_real_ezkl)
    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="yield_predictor",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="ModelBridge",
    )

    assert result["can_execute"] is False
    assert result["trust_mode"] == "real_ezkl_required_unavailable"
    assert called["l3"] is False


@pytest.mark.asyncio
async def test_modelbridge_strict_blocks_when_groth16_unavailable(monkeypatch):
    monkeypatch.setenv("MODELBRIDGE_REQUIRE_REAL_GROTH16", "true")
    pipeline = ProofPipeline()
    _disable_event_log(monkeypatch, pipeline)

    class _FakeEzklProof:
        proof_hash = "0x1234"
        model_hash = "0x5678"
        inference_output = [2.0]
        output_hash = "0x9999"
        raw_proof_json = {"proof": [1], "instances": [[1]]}

        def to_dict(self):
            return {
                "proof_hash": self.proof_hash,
                "model_hash": self.model_hash,
                "output_hash": self.output_hash,
            }

    async def fake_real_ezkl(**kwargs):
        return _FakeEzklProof(), True

    def fail_groth16(*args, **kwargs):
        raise RuntimeError("missing zkey")

    called = {"l3": False}

    async def fake_l3(**kwargs):
        called["l3"] = True
        return {
            "attempted": True,
            "success": True,
            "verified_on_chain": True,
            "mode": "groth16_garaga",
            "tx_hash": "0xabc",
            "error": None,
        }

    monkeypatch.setattr(pipeline, "_try_generate_real_ezkl_proof", fake_real_ezkl)
    monkeypatch.setattr("app.services.groth16_prover.Groth16Prover.generate_model_bridge_proof", fail_groth16)
    monkeypatch.setattr(pipeline, "_verify_l3_bridge", fake_l3)

    result = await pipeline.generate_ml_proofs(
        user_address="0x1",
        model_name="yield_predictor",
        input_data=[[1.0, 2.0]],
        proof_mode=ProofMode.EZKL_BRIDGE,
        execution_chain="l3",
        bridge_circuit="ModelBridge",
    )

    assert result["can_execute"] is False
    assert result["bridge_proof"]["success"] is False
    assert result["bridge_proof"]["is_compliant"] is False
    assert "Groth16 proof unavailable" in (result["verification"]["failure_reason"] or "")
    assert called["l3"] is False


@pytest.mark.asyncio
async def test_dual_marks_mirror_unavailable(monkeypatch):
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
            "attempted": False,
            "success": False,
            "verified_on_chain": False,
            "mode": "l2_registry_unavailable",
            "tx_hash": None,
            "error": "endpoint unavailable",
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
    assert result["verification"]["mirror_status"] == "mirror_unavailable"
