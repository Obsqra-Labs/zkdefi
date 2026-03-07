import pytest

from app.services.snapshot_forecaster_service import SnapshotForecasterService


@pytest.fixture
def svc() -> SnapshotForecasterService:
    service = SnapshotForecasterService(store_prefix="snapshot_forecaster_test_service")
    service.clear_all()
    return service


@pytest.mark.asyncio
async def test_commit_reveal_score_roundtrip(svc: SnapshotForecasterService):
    window = await svc.create_window(
        pair_id="ETH/USDC",
        window_open_ts=1_710_000_000,
        window_close_ts=1_710_000_300,
        cadence_id="5m",
        snapshot_data={"mid_price": 3000.0, "liq_depth": 1_000_000},
        feature_vector={"ret_1m": 12.0, "vol_5m": 55.0},
        feature_schema_id="snapshot_forecaster.v1",
        attest_snapshot=False,
    )

    outputs = {"r5": 100, "r30": -10, "r240": 90, "p5": 7000, "p30": 3000, "p240": 6500}
    salt = "demo-salt-1"
    commitment = svc.build_prediction_commitment(
        window_id=window["window_id"],
        model_hash="0xmodelhash",
        schema_id="snapshot_forecaster.v1",
        outputs_scaled=outputs,
        salt=salt,
    )

    forecast = svc.commit_prediction(
        window_id=window["window_id"],
        model_identity={"model_hash": "0xmodelhash", "schema_id": "snapshot_forecaster.v1"},
        prediction_commitment=commitment,
        horizons_min=[5, 30, 240],
        subject_id="0xabc",
    )
    assert forecast["status"] == "committed"

    revealed = svc.reveal_prediction(
        forecast_id=forecast["forecast_id"],
        outputs_scaled=outputs,
        salt=salt,
        ezkl_receipt={"proof_hash": "0xproof", "verified_locally": True, "verified_on_chain": False},
    )
    assert revealed["status"] == "revealed"
    assert revealed["trust_mode"] == "offchain_ezkl_verified"

    svc.upsert_outcomes(
        window_id=window["window_id"],
        outcomes=[
            {"horizon_min": 5, "actual_return_bps": 80},
            {"horizon_min": 30, "actual_return_bps": -20},
            {"horizon_min": 240, "actual_return_bps": 110},
        ],
        source_id="test_feed",
    )

    score = svc.score_prediction(forecast_id=forecast["forecast_id"])
    assert score["forecast_id"] == forecast["forecast_id"]
    assert score["metrics"]["directional_accuracy"] == pytest.approx(1.0)
    assert score["metrics"]["mae_bps"] == pytest.approx(16.666666, rel=1e-5)
    assert score["trust_mode"] == "offchain_ezkl_verified"

    rep = svc.get_subject_reputation("0xAbC")
    assert rep["sample_size"] == 1
    assert rep["trust_score"] > 0


@pytest.mark.asyncio
async def test_reveal_rejects_commitment_mismatch(svc: SnapshotForecasterService):
    window = await svc.create_window(
        pair_id="STRK/USDC",
        window_open_ts=1_710_100_000,
        window_close_ts=1_710_100_300,
        cadence_id="5m",
        snapshot_data={"price": 1.2},
        attest_snapshot=False,
    )
    outputs = {"r5": 5, "r30": 10, "r240": -2, "p5": 5500, "p30": 5600, "p240": 4900}

    forecast = svc.commit_prediction(
        window_id=window["window_id"],
        model_identity={"model_hash": "0xmodelhash2", "schema_id": "snapshot_forecaster.v1"},
        outputs_scaled=outputs,
        salt="correct-salt",
    )

    with pytest.raises(ValueError, match="does not match committed"):
        svc.reveal_prediction(
            forecast_id=forecast["forecast_id"],
            outputs_scaled=outputs,
            salt="wrong-salt",
        )


def test_output_bounds_enforced(svc: SnapshotForecasterService):
    with pytest.raises(ValueError, match="outside"):
        svc._validate_outputs(  # noqa: SLF001 - direct validation hook is intentional
            {"r5": 9000, "r30": 0, "r240": 0, "p5": 5000, "p30": 5000, "p240": 5000},
            {"return_min_bps": -5000, "return_max_bps": 5000, "prob_min": 0, "prob_max": 10000},
        )

