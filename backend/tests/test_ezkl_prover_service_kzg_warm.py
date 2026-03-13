from __future__ import annotations

from pathlib import Path

import pytest

from app.services.ezkl_prover_service import EZKLModelArtifacts, EZKLProof, EZKLProverService


def _artifacts(tmp_path: Path, model_name: str = "yield_forecast") -> EZKLModelArtifacts:
    model_dir = tmp_path / model_name
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "vk.key").write_text("vk")
    return EZKLModelArtifacts(
        model_name=model_name,
        onnx_path=model_dir / f"{model_name}.onnx",
        compiled_model_path=model_dir / "network.compiled",
        settings_path=model_dir / "settings.json",
        pk_path=model_dir / "pk.key",
        vk_path=model_dir / "vk.key",
        srs_path=model_dir / "kzg.srs",
        model_hash="11" * 32,
    )


def _proof(model_name: str = "yield_forecast") -> EZKLProof:
    return EZKLProof(
        proof_bytes=b"\x11",
        proof_hex="0x11",
        public_inputs=[1.0],
        inference_output=[2.0],
        model_hash="0x" + "22" * 32,
        model_name=model_name,
        proof_hash="0x" + "33" * 32,
        verify_key_hash="0x" + "44" * 32,
        raw_proof_json={"proof": [1], "instances": [[1]]},
    )


@pytest.mark.asyncio
async def test_prove_inference_warms_kzg_bundle_by_default(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("EZKL_PROVER_WARM_KZG_ON_PROVE", raising=False)
    monkeypatch.setattr(
        EZKLProverService,
        "_check_ezkl_available",
        lambda self: setattr(self, "_use_python_api", True),
    )
    service = EZKLProverService()
    artifacts = _artifacts(tmp_path)
    service._models[artifacts.model_name] = artifacts
    fake_proof = _proof(artifacts.model_name)

    async def _fake_prove(_artifacts, _input_data):
        return fake_proof

    seen: dict[str, str] = {}

    def _fake_warm(proof, *, model_name: str = "", model_dir=None):
        seen["model_name"] = model_name
        seen["model_dir"] = str(model_dir)
        return {
            "kzg_warm_attempted": True,
            "kzg_mpcheck_bundle_present": True,
            "kzg_bundle_injected_source": "test",
        }

    monkeypatch.setattr(service, "_prove_inference_python", _fake_prove)
    monkeypatch.setattr(
        "app.services.ezkl_kzg_serializer.warm_kzg_bundle_cache_for_proof",
        _fake_warm,
    )

    result = await service.prove_inference(artifacts.model_name, [[0.1]])

    assert result is fake_proof
    assert seen["model_name"] == artifacts.model_name
    assert seen["model_dir"].endswith(artifacts.model_name)
    assert getattr(result, "kzg_bundle_meta", {}).get("kzg_warm_attempted") is True


@pytest.mark.asyncio
async def test_prove_inference_skips_kzg_warm_when_disabled(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("EZKL_PROVER_WARM_KZG_ON_PROVE", "false")
    monkeypatch.setattr(
        EZKLProverService,
        "_check_ezkl_available",
        lambda self: setattr(self, "_use_python_api", True),
    )
    service = EZKLProverService()
    artifacts = _artifacts(tmp_path)
    service._models[artifacts.model_name] = artifacts
    fake_proof = _proof(artifacts.model_name)

    async def _fake_prove(_artifacts, _input_data):
        return fake_proof

    monkeypatch.setattr(service, "_prove_inference_python", _fake_prove)

    called = {"warm": False}

    def _fake_warm(*args, **kwargs):
        called["warm"] = True
        return {"kzg_warm_attempted": True}

    monkeypatch.setattr(
        "app.services.ezkl_kzg_serializer.warm_kzg_bundle_cache_for_proof",
        _fake_warm,
    )

    result = await service.prove_inference(artifacts.model_name, [[0.1]])

    assert result is fake_proof
    assert called["warm"] is False
    assert not hasattr(result, "kzg_bundle_meta")
