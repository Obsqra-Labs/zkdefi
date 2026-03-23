from __future__ import annotations

import json

from app.services.proof_pipeline import ProofPipeline
from app.services.zkdefi_agent_service import _felt_int


def test_felt_int_parses_supported_formats() -> None:
    assert _felt_int("123") == 123
    assert _felt_int("0x7b") == 123
    assert _felt_int("7B") == 123
    assert _felt_int(b"\x00{") == 123


def test_felt_int_fails_soft_on_malformed_values() -> None:
    assert _felt_int("not_a_number") == 0
    assert _felt_int(["0x2a"]) == 42
    assert _felt_int([1, 2]) == 0


def test_coerce_input_rows_accepts_flat_input_vector() -> None:
    rows = ProofPipeline._coerce_input_rows([531, 2, 720, 3])
    assert rows == [[531.0, 2.0, 720.0, 3.0]]


def test_coerce_input_rows_accepts_nested_rows() -> None:
    rows = ProofPipeline._coerce_input_rows([[1, 2], [3.5, 4]])
    assert rows == [[1.0, 2.0], [3.5, 4.0]]


def test_normalize_ezkl_input_uses_feature_names_width(tmp_path) -> None:
    pipeline = ProofPipeline()
    model_root = tmp_path / "ezkl_models"
    model_dir = model_root / "creditworthiness"
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "training_metadata.json").write_text(
        json.dumps({"feature_names": [f"f{i}" for i in range(18)]})
    )

    pipeline._local_ezkl_models_root = lambda: model_root  # type: ignore[method-assign]
    rows = pipeline._normalize_ezkl_input_data(
        resolved_model_name="creditworthiness",
        input_data=[531, 2, 720, 3],
    )

    assert len(rows) == 1
    assert len(rows[0]) == 18
    assert rows[0][:4] == [531.0, 2.0, 720.0, 3.0]
    assert rows[0][4:] == [0.0] * 14


def test_normalize_ezkl_input_uses_norm_params_path_from_metadata(tmp_path) -> None:
    pipeline = ProofPipeline()
    model_root = tmp_path / "ezkl_models"
    model_dir = model_root / "creditworthiness"
    model_dir.mkdir(parents=True, exist_ok=True)

    norm_path = model_dir / "mlp_norm_params.json"
    norm_path.write_text(
        json.dumps(
            {
                "min": [0.0] * 18,
                "range": [100.0] * 18,
            }
        )
    )
    (model_dir / "training_metadata.json").write_text(
        json.dumps(
            {
                "feature_names": [f"f{i}" for i in range(18)],
                "norm_params_path": str(norm_path),
            }
        )
    )

    pipeline._local_ezkl_models_root = lambda: model_root  # type: ignore[method-assign]
    rows = pipeline._normalize_ezkl_input_data(
        resolved_model_name="creditworthiness",
        input_data=[[50.0] * 18],
    )

    assert len(rows) == 1
    assert all(abs(v - 0.5) < 1e-9 for v in rows[0])
