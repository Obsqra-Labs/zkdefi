"""Unit tests for Ekubo LP calldata builder."""

from __future__ import annotations

import asyncio

import app.services.ekubo_lp_service as lp_service


async def _fake_pair_pools(*args, **kwargs):
    return {
        "topPools": [
            {
                "token0": "0x1",
                "token1": "0x2",
                "tvl0_total": "1000000",
                "tvl1_total": "1000000",
                "volume0_24h": "50000",
                "volume1_24h": "50000",
                "fee": "0.003",
                "tick_spacing": 60,
                "extension": "0",
                "core_address": "0xcore",
            }
        ]
    }


def test_build_lp_add_orders_approvals_then_call(monkeypatch, tmp_path):
    monkeypatch.setattr(lp_service, "get_pair_pools", _fake_pair_pools)
    monkeypatch.setenv("EKUBO_POSITIONS_FILE", str(tmp_path / "positions.json"))

    payload = asyncio.run(
        lp_service.build_lp_add(
            chain_id="0x534e5f5345504f4c4941",
            owner="0xowner",
            token0="0x1",
            token1="0x2",
            amount0=1000,
            amount1=2000,
            fee_tier=3000,
            lower_tick=-120,
            upper_tick=120,
            risk_profile="neutral",
        )
    )

    approvals = payload["approvals"]
    calls = payload["calls"]
    assert approvals[0]["token"] == "0x1"
    assert approvals[1]["token"] == "0x2"
    assert calls[0]["entrypoint"] == "mint_and_deposit"
    assert payload["position_id"].startswith("0x")


def test_build_lp_remove_returns_single_call(monkeypatch, tmp_path):
    monkeypatch.setenv("EKUBO_POSITIONS_FILE", str(tmp_path / "positions.json"))

    payload = asyncio.run(
        lp_service.build_lp_remove(
            owner="0xowner",
            position_id="0xpos",
            liquidity_bps=7500,
        )
    )

    assert payload["approvals"] == []
    assert len(payload["calls"]) == 1
    assert payload["calls"][0]["entrypoint"] == "withdraw_and_burn"
