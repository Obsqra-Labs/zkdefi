"""Tests for swap calldata builder fallback behavior."""

from __future__ import annotations

import asyncio

import app.services.ekubo_execution_service as svc


def test_build_calldata_for_allocation_fallback_to_onchain(monkeypatch):
    async def fake_build_swap_calldata(*args, **kwargs):
        return {
            "error": "Ekubo API unavailable",
            "contract_address": None,
            "entrypoint": None,
            "calldata": None,
        }

    async def fake_discover_pool_on_chain(*args, **kwargs):
        return {"fee_u128": 123, "tick_spacing": 60, "extension": "0"}

    monkeypatch.setattr(svc, "build_swap_calldata", fake_build_swap_calldata)
    monkeypatch.setattr(svc, "discover_pool_on_chain", fake_discover_pool_on_chain)

    result = asyncio.run(
        svc.build_calldata_for_allocation(
            strategy="ekubo_strk_to_usdc",
            amount_in_wei=1000,
            chain_id="0x534e5f5345504f4c4941",
        )
    )

    assert result["error"] is None
    assert result["entrypoint"] == "swap"
    assert result["contract_address"] == svc.EKUBO_ROUTER_SEPOLIA


def test_build_swap_calldata_uses_positive_i129_sign_field():
    result = svc._build_swap_calldata_with_pool_params(
        token_in="0x10",
        token_out="0x20",
        amount_in_wei=12345,
        fee_u128=1,
        tick_spacing=60,
        extension="0",
        expected_out=1000,
        route=["0x10", "0x20"],
        slippage_bps=50,
    )

    assert result["entrypoint"] == "swap"
    # Final felt for Router.swap TokenAmount is i129.sign (bool), not min_out.
    assert result["calldata"][-1] == "0"
    assert result["calldata"][-2] == "12345"
    assert result["calldata"][-3] == "0x10"


def test_build_multihop_calldata_uses_positive_i129_sign_field():
    route_nodes = [
        {
            "token0": "0x10",
            "token1": "0x20",
            "fee_u128": 1,
            "tick_spacing": 60,
            "extension": "0",
        },
        {
            "token0": "0x20",
            "token1": "0x30",
            "fee_u128": 1,
            "tick_spacing": 60,
            "extension": "0",
        },
    ]
    result = svc._build_multihop_calldata(
        token_in="0x10",
        amount_in_wei=456,
        route_nodes=route_nodes,
        route_tokens=["0x10", "0x20", "0x30"],
        expected_out=222,
        slippage_bps=50,
    )

    assert result["entrypoint"] == "multihop_swap"
    # Final felt for Router.multihop_swap TokenAmount is i129.sign (bool), not min_out.
    assert result["calldata"][-1] == "0"
    assert result["calldata"][-2] == "456"
    assert result["calldata"][-3] == "0x10"
