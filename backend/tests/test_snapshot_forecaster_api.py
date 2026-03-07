from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.services.snapshot_forecaster_service import get_snapshot_forecaster_service

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_forecaster_store():
    svc = get_snapshot_forecaster_service()
    svc.clear_all()
    yield
    svc.clear_all()


def test_snapshot_forecaster_api_roundtrip():
    window_resp = client.post(
        "/api/v1/zkdefi/snapshot-forecaster/windows",
        json={
            "pair_id": "ETH/USDC",
            "network_id": "starknet_sepolia",
            "window_open_ts": 1710200000,
            "window_close_ts": 1710200300,
            "cadence_id": "5m",
            "snapshot_data": {"mid": 3200.5, "spread_bps": 4},
            "feature_schema_id": "snapshot_forecaster.v1",
            "feature_vector": {"ret_1m": 9.0, "vol_5m": 42.0},
            "attest_snapshot": False,
        },
    )
    assert window_resp.status_code == 200
    window = window_resp.json()
    assert window["network_id"] == "starknet_sepolia"
    window_id = window["window_id"]

    list_resp = client.get("/api/v1/zkdefi/snapshot-forecaster/windows?network_id=starknet_sepolia&limit=10")
    assert list_resp.status_code == 200
    assert list_resp.json()["count"] >= 1

    suggest_resp = client.post(
        f"/api/v1/zkdefi/snapshot-forecaster/windows/{window_id}/suggested-outputs",
        json={"horizons_min": [5, 30, 240]},
    )
    assert suggest_resp.status_code == 200
    suggested = suggest_resp.json()
    assert suggested["window_id"] == window_id
    assert suggested["network_id"] == "starknet_sepolia"
    assert set(suggested["outputs_scaled"].keys()) == {"r5", "r30", "r240", "p5", "p30", "p240"}

    commit_resp = client.post(
        "/api/v1/zkdefi/snapshot-forecaster/predictions/commit",
        json={
            "window_id": window_id,
            "model_identity": {"model_hash": "0xmodelhash", "schema_id": "snapshot_forecaster.v1"},
            "horizons_min": [5, 30, 240],
            "subject_id": "0xfeedbeef",
            "outputs_scaled": {"r5": 120, "r30": 45, "r240": 200, "p5": 7100, "p30": 6100, "p240": 7000},
            "salt": "secret-salt",
        },
    )
    assert commit_resp.status_code == 200
    forecast = commit_resp.json()
    forecast_id = forecast["forecast_id"]

    reveal_resp = client.post(
        f"/api/v1/zkdefi/snapshot-forecaster/predictions/{forecast_id}/reveal",
        json={
            "outputs_scaled": {"r5": 120, "r30": 45, "r240": 200, "p5": 7100, "p30": 6100, "p240": 7000},
            "salt": "secret-salt",
            "ezkl_receipt": {"proof_hash": "0xabc", "verified_locally": True},
        },
    )
    assert reveal_resp.status_code == 200
    revealed = reveal_resp.json()
    assert revealed["status"] == "revealed"
    assert revealed["trust_mode"] == "offchain_ezkl_verified"

    outcome_resp = client.post(
        f"/api/v1/zkdefi/snapshot-forecaster/windows/{window_id}/outcomes",
        json={
            "source_id": "unit_test_feed",
            "outcomes": [
                {"horizon_min": 5, "actual_return_bps": 110},
                {"horizon_min": 30, "actual_return_bps": 20},
                {"horizon_min": 240, "actual_return_bps": 180},
            ],
        },
    )
    assert outcome_resp.status_code == 200
    assert outcome_resp.json()["window_id"] == window_id

    score_resp = client.post(
        f"/api/v1/zkdefi/snapshot-forecaster/predictions/{forecast_id}/score",
        json={"ece_bins": 10},
    )
    assert score_resp.status_code == 200
    score = score_resp.json()
    assert score["forecast_id"] == forecast_id
    assert score["metrics"]["horizon_count"] == 3

    reputation_resp = client.get("/api/v1/zkdefi/snapshot-forecaster/reputation/0xfeedbeef")
    assert reputation_resp.status_code == 200
    reputation = reputation_resp.json()
    assert reputation["sample_size"] == 1
    assert "trust_score" in reputation

    history_resp = client.get("/api/v1/zkdefi/snapshot-forecaster/reputation/0xfeedbeef/history?limit=10")
    assert history_resp.status_code == 200
    history_payload = history_resp.json()
    assert history_payload["count"] == 1
    assert history_payload["history"][0]["forecast_id"] == forecast_id

    explain_resp = client.post(
        "/api/v1/zkdefi/snapshot-forecaster/explain",
        json={"forecast_id": forecast_id},
    )
    assert explain_resp.status_code == 200
    explain = explain_resp.json()
    assert explain["forecast_id"] == forecast_id
    assert explain["context_type"] == "snapshot_forecast_explain"
    assert isinstance(explain["narration"], str)
    assert explain["source"] in {"llm", "deterministic"}
