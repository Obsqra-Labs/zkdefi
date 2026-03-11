from types import SimpleNamespace

from app.services.ezkl_kzg_serializer import (
    build_placeholder_kzg_calldata,
    serialize_ezkl_proof_to_kzg_calldata,
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
