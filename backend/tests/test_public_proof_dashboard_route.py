from __future__ import annotations

import app.api.routes.public_proof_dashboard as public_dashboard_routes


def test_public_proof_dashboard_route_returns_dashboard(monkeypatch):
    monkeypatch.setattr(
        public_dashboard_routes,
        "load_public_proof_dashboard",
        lambda: {
            "status": "ok",
            "entries": [{"lane": "ModelBridge", "tx_hash": "0x123"}],
            "excluded_lanes": [],
            "summary": {"public_entries_total": 1},
        },
    )

    payload = public_dashboard_routes.get_public_proof_dashboard()

    assert payload["status"] == "ok"
    assert payload["entries"][0]["lane"] == "ModelBridge"


def test_public_proof_dashboard_route_returns_markdown(monkeypatch):
    monkeypatch.setattr(
        public_dashboard_routes,
        "load_public_proof_dashboard_markdown",
        lambda: "ModelBridge public Starknet mirror tx\n",
    )

    response = public_dashboard_routes.get_public_proof_dashboard_markdown()

    assert response.body.decode("utf-8") == "ModelBridge public Starknet mirror tx\n"
