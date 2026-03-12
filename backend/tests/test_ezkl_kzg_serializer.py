import json
from types import SimpleNamespace

from app.services.ezkl_kzg_serializer import (
    build_placeholder_kzg_calldata,
    serialize_ezkl_proof_to_kzg_calldata,
    warm_kzg_bundle_cache_for_proof,
)


def test_placeholder_kzg_calldata_shape():
    calldata, meta = build_placeholder_kzg_calldata(
        proof_hash="0x1234",
        model_hash="0x5678",
        inference_output=[1.5, -2.25, 3.0],
        timestamp=1_711_111_111,
    )
    assert isinstance(calldata, list)
    assert len(calldata) >= 6
    assert calldata[0].startswith("0x")
    assert meta["format"] == "native_kzg_placeholder_v1"
    assert meta["output_count"] == 3


def test_real_ezkl_serialization_has_payload_sections():
    fake_proof = SimpleNamespace(
        proof_hash="0x" + "ab" * 32,
        model_hash="0x" + "cd" * 32,
        verify_key_hash="0x" + "ef" * 32,
        public_inputs=[1.0, 2.0, 3.0],
        inference_output=[4.0, 5.0],
        proof_hex="0x" + "11" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": {"pi": [1, 2, 3]}, "instances": [[1, 2, 3]]},
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(fake_proof)
    assert isinstance(calldata, list)
    assert len(calldata) > 10
    assert all(x.startswith("0x") for x in calldata)
    assert meta["format"] == "ezkl_kzg_v1"
    assert meta["fact_hash_felt"].startswith("0x")
    assert meta["public_inputs_count"] == 3
    assert meta["output_count"] == 2
    assert meta["proof_blob_felts"] > 0
    assert meta["kzg_mpcheck_bundle_present"] is False


def test_real_ezkl_serialization_accepts_explicit_mpcheck_bundle():
    fake_proof = SimpleNamespace(
        proof_hash="0x" + "aa" * 32,
        model_hash="0x" + "bb" * 32,
        verify_key_hash="0x" + "cc" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "22" * 64,
        proof_bytes=b"",
        raw_proof_json={
            "kzg_mpcheck_bundle": {
                "pair0": {"x": "0x123", "y": "0x456"},
                "pair1": {"x": "0x789", "y": "0xabc"},
                "mpcheck_hint_felts": ["0x1", "0x2", "0x3"],
                "auto_build_hint": False,
            }
        },
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(fake_proof)
    assert len(calldata) > 20
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert meta["kzg_mpcheck_hint_felts"] == 3
    assert meta["verification_semantics"] == "cryptographic_pairing"


def test_real_ezkl_serialization_extracts_pairings_bundle():
    fake_proof = SimpleNamespace(
        proof_hash="0x" + "33" * 32,
        model_hash="0x" + "44" * 32,
        verify_key_hash="0x" + "55" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "66" * 64,
        proof_bytes=b"",
        raw_proof_json={
            "pairings": [
                {"p": {"x": "0x111", "y": "0x222"}},
                {"p": {"x": "0x333", "y": "0x444"}},
            ],
            "hint_felts": ["0x9", "0xa"],
        },
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(fake_proof)
    assert len(calldata) > 20
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert meta["kzg_mpcheck_bundle_source"] == "top_level_pairings"
    assert meta["kzg_mpcheck_hint_felts"] == 2


def test_warm_kzg_bundle_cache_updates_proof_raw_json(tmp_path, monkeypatch):
    bundle_file = tmp_path / "kzg_mpcheck_bundle.json"
    bundle_file.write_text(
        """{
  "kzg_mpcheck_bundle": {
    "pair0": {"x": "0x111", "y": "0x222"},
    "pair1": {"x": "0x333", "y": "0x444"},
    "mpcheck_hint_felts": ["0x1", "0x2"],
    "auto_build_hint": false
  }
}"""
    )
    monkeypatch.setenv("EZKL_KZG_BUNDLE_FILE", str(bundle_file))

    fake_proof = SimpleNamespace(
        proof_hash="0x" + "aa" * 32,
        model_name="yield_forecast",
        raw_proof_json={"proof": [1, 2, 3], "instances": [[1]]},
    )
    meta = warm_kzg_bundle_cache_for_proof(
        fake_proof,
        model_name="yield_forecast",
        model_dir=tmp_path / "yield_forecast",
    )
    assert meta["kzg_warm_attempted"] is True
    assert meta["kzg_bundle_injected"] is True
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert isinstance(fake_proof.raw_proof_json, dict)
    assert isinstance(fake_proof.raw_proof_json.get("kzg_mpcheck_bundle"), dict)


def test_real_ezkl_serialization_injects_bundle_from_sidecar_file(tmp_path, monkeypatch):
    bundle_file = tmp_path / "kzg_mpcheck_bundle.json"
    bundle_file.write_text(
        """{
  "kzg_mpcheck_bundle": {
    "pair0": {"x": "0x11", "y": "0x22"},
    "pair1": {"x": "0x33", "y": "0x44"},
    "mpcheck_hint_felts": ["0x5", "0x6"]
  }
}"""
    )
    monkeypatch.setenv("EZKL_KZG_BUNDLE_FILE", str(bundle_file))

    fake_proof = SimpleNamespace(
        proof_hash="0x" + "77" * 32,
        model_hash="0x" + "88" * 32,
        verify_key_hash="0x" + "99" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "aa" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": [1, 2, 3], "instances": [[1]]},
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(
        fake_proof,
        model_name="tmp_model_no_sidecar",
        model_dir=tmp_path / "no_sidecar_model",
    )
    assert len(calldata) > 20
    assert meta["kzg_bundle_injected"] is True
    assert "file:" in str(meta["kzg_bundle_injected_source"])
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert meta["kzg_mpcheck_hint_felts"] == 2


def test_real_ezkl_serialization_injects_bundle_from_trace_sidecar(tmp_path, monkeypatch):
    monkeypatch.delenv("EZKL_KZG_BUNDLE_FILE", raising=False)
    monkeypatch.setenv("EZKL_KZG_BUNDLE_SCAN_MODELS", "false")

    model_dir = tmp_path / "yield_forecast"
    trace_dir = model_dir / ".kzg_trace_verifier"
    trace_dir.mkdir(parents=True, exist_ok=True)
    (trace_dir / "kzg_mpcheck_bundle.json").write_text(
        """{
  "kzg_mpcheck_bundle": {
    "pair0": {"x": "0x101", "y": "0x202"},
    "pair1": {"x": "0x303", "y": "0x404"},
    "mpcheck_hint_felts": ["0xa", "0xb"],
    "auto_build_hint": false
  }
}"""
    )

    fake_proof = SimpleNamespace(
        proof_hash="0x" + "66" * 32,
        model_hash="0x" + "77" * 32,
        verify_key_hash="0x" + "88" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "99" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": [1], "instances": [[1]]},
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(
        fake_proof,
        model_name="yield_forecast",
        model_dir=model_dir,
    )
    assert len(calldata) > 20
    assert meta["kzg_bundle_injected"] is True
    assert ".kzg_trace_verifier" in str(meta["kzg_bundle_injected_source"])
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert meta["kzg_mpcheck_hint_felts"] == 2


def test_real_ezkl_serialization_injects_bundle_from_hash_map(tmp_path, monkeypatch):
    proof_hash = "0x" + "ab" * 32
    bundle_file = tmp_path / "kzg_bundle.json"
    bundle_file.write_text(
        f"""{{
  "{proof_hash}": {{
    "pair0": {{"x": "0x111", "y": "0x222"}},
    "pair1": {{"x": "0x333", "y": "0x444"}},
    "mpcheck_hint_felts": ["0x7"]
  }}
}}"""
    )
    monkeypatch.setenv("EZKL_KZG_BUNDLE_FILE", str(bundle_file))

    fake_proof = SimpleNamespace(
        proof_hash=proof_hash,
        model_hash="0x" + "cd" * 32,
        verify_key_hash="0x" + "ef" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "bb" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": [9, 9], "instances": [[1]]},
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(
        fake_proof,
        model_name="tmp_model_no_sidecar",
        model_dir=tmp_path / "no_sidecar_model",
    )
    assert len(calldata) > 20
    assert meta["kzg_bundle_injected"] is True
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert meta["kzg_mpcheck_hint_felts"] == 1


def test_real_ezkl_serialization_injects_bundle_from_extractor_cmd(tmp_path, monkeypatch):
    extractor = tmp_path / "extractor.py"
    extractor.write_text(
        """#!/usr/bin/env python3
import json
import os
proof_path = os.getenv("EZKL_RAW_PROOF_JSON_PATH", "")
proof = json.loads(open(proof_path, "r").read()) if proof_path else {}
bundle = {
  "kzg_mpcheck_bundle": {
    "pair0": {"x": "0x1111", "y": "0x2222"},
    "pair1": {"x": "0x3333", "y": "0x4444"},
    "mpcheck_hint_felts": ["0x9"]
  }
}
if proof.get("proof") != [9, 9]:
    raise SystemExit(2)
print(json.dumps(bundle))
"""
    )
    extractor.chmod(0o755)
    monkeypatch.setenv("EZKL_KZG_BUNDLE_EXTRACTOR_CMD", f"python3 {extractor}")

    fake_proof = SimpleNamespace(
        proof_hash="0x" + "de" * 32,
        model_hash="0x" + "ad" * 32,
        verify_key_hash="0x" + "be" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "cc" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": [9, 9], "instances": [[1]]},
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(
        fake_proof,
        model_name="tmp_model_no_sidecar",
        model_dir=tmp_path / "no_sidecar_model",
    )
    assert len(calldata) > 20
    assert meta["kzg_bundle_injected"] is True
    assert str(meta["kzg_bundle_injected_source"]).startswith("extractor:")
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert meta["kzg_mpcheck_hint_felts"] == 1


def test_real_ezkl_serialization_auto_extractor_and_sidecar_cache(tmp_path, monkeypatch):
    extractor = tmp_path / "extractor.py"
    extractor.write_text(
        """#!/usr/bin/env python3
import json
bundle = {
  "kzg_mpcheck_bundle": {
    "pair0": {"x": "0x1111", "y": "0x2222"},
    "pair1": {"x": "0x3333", "y": "0x4444"},
    "mpcheck_hint_felts": ["0x9", "0xa"]
  }
}
print(json.dumps(bundle))
"""
    )
    extractor.chmod(0o755)

    model_dir = tmp_path / "model_dir"
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "vk.key").write_text("vk")
    (model_dir / "settings.json").write_text("{}")
    (model_dir / "kzg.srs").write_text("srs")

    monkeypatch.delenv("EZKL_KZG_BUNDLE_EXTRACTOR_CMD", raising=False)
    monkeypatch.setenv("EZKL_KZG_BUNDLE_AUTO_EXTRACT", "true")
    monkeypatch.setattr(
        "app.services.ezkl_kzg_serializer._default_bundle_extractor_cmd",
        lambda: f"python3 {extractor}",
    )

    proof_hash = "0x" + "f0" * 32
    fake_proof = SimpleNamespace(
        proof_hash=proof_hash,
        model_hash="0x" + "ad" * 32,
        verify_key_hash="0x" + "be" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "cc" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": [1, 2, 3], "instances": [[1]]},
    )

    calldata, meta = serialize_ezkl_proof_to_kzg_calldata(
        fake_proof,
        model_name="yield_forecast",
        model_dir=model_dir,
    )
    assert len(calldata) > 20
    assert meta["kzg_bundle_injected"] is True
    assert str(meta["kzg_bundle_injected_source"]).startswith("extractor:")
    assert meta["kzg_mpcheck_bundle_present"] is True
    assert meta["kzg_mpcheck_hint_felts"] == 2

    sidecar = model_dir / "kzg_mpcheck_bundle.json"
    assert sidecar.exists()
    sidecar_data = json.loads(sidecar.read_text())
    assert proof_hash in sidecar_data


def test_real_ezkl_serialization_records_extractor_failure(tmp_path, monkeypatch):
    extractor = tmp_path / "extractor_fail.py"
    extractor.write_text(
        """#!/usr/bin/env python3
import sys
print("forced extractor failure", file=sys.stderr)
raise SystemExit(7)
"""
    )
    extractor.chmod(0o755)

    monkeypatch.setenv("EZKL_KZG_BUNDLE_EXTRACTOR_CMD", f"python3 {extractor}")
    monkeypatch.setenv("EZKL_KZG_BUNDLE_AUTO_EXTRACT", "false")
    monkeypatch.setenv("EZKL_KZG_BUNDLE_SCAN_MODELS", "false")

    fake_proof = SimpleNamespace(
        proof_hash="0x" + "ab" * 32,
        model_hash="0x" + "cd" * 32,
        verify_key_hash="0x" + "ef" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "11" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": [1, 2, 3], "instances": [[1]]},
    )

    _, meta = serialize_ezkl_proof_to_kzg_calldata(
        fake_proof,
        model_name="tmp_model_no_sidecar",
        model_dir=tmp_path / "no_sidecar_model",
    )
    assert meta["kzg_bundle_injected"] is False
    assert meta["kzg_bundle_extractor_attempted"] is True
    assert "nonzero_exit:7" in str(meta["kzg_bundle_extractor_error"])
    assert meta["kzg_mpcheck_bundle_present"] is False


def test_real_ezkl_serialization_cross_model_scan_recaches_bundle(tmp_path, monkeypatch):
    monkeypatch.delenv("EZKL_KZG_BUNDLE_EXTRACTOR_CMD", raising=False)
    monkeypatch.setenv("EZKL_KZG_BUNDLE_AUTO_EXTRACT", "false")

    proof_hash = "0x" + "f1" * 32

    monkeypatch.setattr(
        "app.services.ezkl_kzg_serializer._scan_model_sidecars_by_proof_hash",
        lambda proof_hash, exclude_model_dir: (
            {
                "kzg_mpcheck_bundle": {
                    "pair0": {"x": "0x11", "y": "0x22"},
                    "pair1": {"x": "0x33", "y": "0x44"},
                    "mpcheck_hint_felts": ["0x5"],
                    "auto_build_hint": False,
                }
            },
            "model_scan:mock",
        ),
    )

    model_dir = tmp_path / "target_model"
    fake_proof = SimpleNamespace(
        proof_hash=proof_hash,
        model_hash="0x" + "cd" * 32,
        verify_key_hash="0x" + "ef" * 32,
        public_inputs=[1.0],
        inference_output=[2.0],
        proof_hex="0x" + "11" * 64,
        proof_bytes=b"",
        raw_proof_json={"proof": [1, 2, 3], "instances": [[1]]},
    )

    _, meta = serialize_ezkl_proof_to_kzg_calldata(
        fake_proof,
        model_name="tmp_model_no_sidecar",
        model_dir=model_dir,
    )
    assert meta["kzg_bundle_injected"] is True
    assert str(meta["kzg_bundle_injected_source"]) == "model_scan:mock"
    assert meta["kzg_bundle_extractor_attempted"] is False
    assert meta["kzg_mpcheck_bundle_present"] is True
    cached_path = str(meta.get("kzg_bundle_cached_path") or "")
    assert cached_path.endswith("kzg_mpcheck_bundle.json")
    sidecar = model_dir / "kzg_mpcheck_bundle.json"
    assert sidecar.exists()
    sidecar_data = json.loads(sidecar.read_text())
    assert proof_hash in sidecar_data
