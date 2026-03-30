from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.portfolio_execution_gate import (
    MAINNET_V1_CIRCUITS,
    get_portfolio_execution_gate_service,
)
from app.services.portfolio_monitor_service import PortfolioMonitorService
from app.services.position_scanner import PortfolioSnapshot, Position


@pytest.fixture()
def gate_service(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.receipt_service._RECEIPT_DB_PATH", tmp_path / "receipts.db")
    monkeypatch.setattr("app.services.session_key_service._SESSION_DB_PATH", tmp_path / "session_keys.db")
    service = get_portfolio_execution_gate_service()
    service.monitor_service = PortfolioMonitorService(store_prefix=f"test_portfolio_monitor_state_{tmp_path.name}")
    service.monitor_service._store.clear()
    service.receipt_service._init_db()
    service.session_key_service._init_db()
    with service.receipt_service._db_lock, service.receipt_service._db_connect() as conn:
        conn.execute("DELETE FROM receipts")
    return service


def _mock_snapshot(address: str) -> PortfolioSnapshot:
    snapshot = PortfolioSnapshot(
        wallet_address=address,
        scanned_at="2026-03-28T00:00:00+00:00",
        positions=[
            Position(protocol="wallet", position_type="token", asset_symbol="ETH", amount=1.0, value_usd=3200),
            Position(protocol="wallet", position_type="token", asset_symbol="STRK", amount=1000.0, value_usd=720),
            Position(protocol="wallet", position_type="token", asset_symbol="USDC", amount=1200.0, value_usd=1200),
        ],
        total_value_usd=5120,
        protocol_count=2,
        position_count=3,
        protocols_found=["wallet", "ekubo"],
        snapshot_hash="0xsnapshot",
    )
    return snapshot


def _mock_scan_result():
    return {
        "results": [
            {
                "circuit": circuit,
                "success": True,
                "is_compliant": True,
                "proof_hash": f"0x{index + 1:02x}",
                "duration_ms": 12,
            }
            for index, circuit in enumerate(MAINNET_V1_CIRCUITS)
        ]
    }


@pytest.mark.asyncio
async def test_check_intent_returns_allowed_swap(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 10**17,
            "deadline": 100500,
            "nonce": 7,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "ekubo",
        },
    )

    assert result["allowed"] is True
    assert result["proof_mode"] == "groth16"
    assert result["policy_hash"].startswith("0x")
    assert result["intent_hash"].startswith("0x")
    assert result["receipt_id"].startswith("0x")
    assert len(result["constraint_results"]) >= len(MAINNET_V1_CIRCUITS)


@pytest.mark.asyncio
async def test_check_intent_can_prepare_execution_preview_and_warm_cache(monkeypatch, gate_service):
    gate_service._execution_prep_cache.clear()
    calls = {"avnu": 0}

    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    async def fake_build_avnu_swap_execution(**kwargs):
        calls["avnu"] += 1
        return {
            "venue": "avnu",
            "wallet_calls": [
                {
                    "contract_address": "0x123",
                    "entrypoint": "multi_route_swap",
                    "calldata": ["0x1", "0x2"],
                }
            ],
            "expected_out": 555555,
            "route": ["AVNU"],
            "error": None,
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)
    monkeypatch.setattr("app.services.portfolio_execution_gate.build_avnu_swap_execution", fake_build_avnu_swap_execution)

    intent = {
        "type": "swap",
        "token_in": "ETH",
        "token_out": "USDC",
        "amount_wei": 10**15,
        "deadline": 100500,
        "nonce": 7,
        "block_number": 100000,
        "max_slippage_bps": 50,
        "adapter_target": "best",
        "network_id": "starknet_mainnet",
    }

    result = await gate_service.check_intent(
        "0xabc123",
        intent,
        prepare_preview=True,
    )

    assert result["allowed"] is True
    assert result["execution_preview"]["execution_adapter"] == "avnu"
    assert result["execution_preview"]["wallet_call_count"] == 1
    assert result["execution_preview"]["cache_hit"] is False

    cached = await gate_service._execute_swap_intent({**intent, "owner_address": "0xabc123"}, False)
    assert cached["cache_hit"] is True
    assert calls["avnu"] == 1


@pytest.mark.asyncio
async def test_check_intent_blocks_when_policy_limit_exceeded(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 5 * 10**18,
            "deadline": 100500,
            "nonce": 7,
            "block_number": 100000,
            "max_slippage_bps": 250,
            "adapter_target": "ekubo",
        },
        policy_override={
            "max_value_per_action_usd": 1000.0,
            "max_slippage_bps": 100,
        },
    )

    assert result["allowed"] is False
    assert "action_value_exceeds_limit" in result["reason_codes"]
    assert "slippage_exceeds_limit" in result["reason_codes"]


@pytest.mark.asyncio
async def test_check_intent_allows_advisory_zkml_failures_when_policy_passes(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        results = _mock_scan_result()["results"]
        results[3] = {
            "circuit": "SafetyDiversification",
            "success": True,
            "is_compliant": False,
            "proof_hash": "0xdead",
            "duration_ms": 15,
        }
        results[10] = {
            "circuit": "HistoricalPerformanceAttestation",
            "success": False,
            "error": "Witness generation failed",
            "duration_ms": 21,
        }
        return {"results": results}

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 10**15,
            "deadline": 100500,
            "nonce": 8,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "ekubo",
        },
    )

    assert result["proof_mode"] == "advisory"
    assert result["allowed"] is True
    assert "zkml_non_compliant:SafetyDiversification" in result["reason_codes"]
    assert "zkml_proof_failed:HistoricalPerformanceAttestation" in result["reason_codes"]


@pytest.mark.asyncio
async def test_recommend_returns_rebalance_intent(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_get_recommendation(user_address: str, amount: float, risk_profile: str):
        assert user_address == "0xabc123"
        assert amount == pytest.approx(5120.0)
        assert risk_profile == "balanced"
        return {
            "recommended_pools": [
                {
                    "pool_id": "ekubo_eth_usdc",
                    "protocol": "Ekubo",
                    "pair": "ETH/USDC",
                    "allocation_percent": 30.0,
                    "allocation_amount": 1536.0,
                    "expected_apy": 0.275,
                    "risk_score": 35.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "ekubo_strk_usdc",
                    "protocol": "Ekubo",
                    "pair": "STRK/USDC",
                    "allocation_percent": 20.0,
                    "allocation_amount": 1024.0,
                    "expected_apy": 0.265,
                    "risk_score": 42.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "lending_strk",
                    "protocol": "Lending",
                    "pair": "STRK Lending",
                    "allocation_percent": 25.0,
                    "allocation_amount": 1280.0,
                    "expected_apy": 0.08,
                    "risk_score": 15.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "staking_strk",
                    "protocol": "Staking",
                    "pair": "STRK Staking",
                    "allocation_percent": 20.0,
                    "allocation_amount": 1024.0,
                    "expected_apy": 0.12,
                    "risk_score": 10.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "idle_reserve",
                    "protocol": "Idle",
                    "pair": "Reserve",
                    "allocation_percent": 5.0,
                    "allocation_amount": 256.0,
                    "expected_apy": 0.0,
                    "risk_score": 0.0,
                    "risk_flags": [],
                },
            ],
            "ai_reasoning": "Balanced allocator output.",
            "ai_confidence": 0.85,
            "expected_portfolio_apy": 0.181,
            "portfolio_risk_assessment": "Balanced mix across four strategy sleeves.",
            "recommendation_id": "rec_balanced",
            "attestation_hash": "0xattestation",
            "provenance": {"circuits_used": ["YieldOptimality_v1"]},
            "genome": {"yield": 63, "risk": 26, "volatility": 35, "liquidity": 85, "efficiency": 19},
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr(
        "app.services.strategy_recommendation_service.get_recommendation",
        fake_get_recommendation,
    )

    prior_receipt = await gate_service.receipt_service.create_receipt(
        user_address="0xabc123",
        constraints_hash="0xpolicy",
        proof_hash="0xswap",
        action_type="swap",
        metadata={
            "source": "execution_gate_v1",
            "stage": "execute",
            "status": "submitted",
        },
    )
    await gate_service.receipt_service.confirm_receipt(prior_receipt["receipt_id"], "0xtestswap")

    result = await gate_service.recommend("0xabc123")

    assert result["source"] == "allocator_v1"
    assert result["risk_profile"] == "balanced"
    assert result["intent"]["type"] == "rebalance"
    assert set(result["target_allocations"].keys()) == {"ETH", "STRK", "USDC"}
    assert result["target_allocations"] == {"ETH": 15.0, "STRK": 55.0, "USDC": 30.0}
    assert result["recommended_pools"][0]["pair"] == "ETH/USDC"
    assert result["derived_swap_steps"]
    assert result["execution_translation"]["strategy_sleeves_are_advisory"] is True
    assert result["execution_translation"]["sleeves"][0]["translated_asset_targets"] == {
        "ETH": 15.0,
        "USDC": 15.0,
    }
    assert result["drift_monitor"]["status"] == "rebalance"
    assert result["drift_monitor"]["largest_gap_asset"] == "ETH"
    assert result["drift_monitor"]["total_turnover_pct"] > 0
    assert result["drift_monitor"]["drivers"][0]["kind"] == "manual_swaps"


@pytest.mark.asyncio
async def test_recommend_uses_post_rebalance_snapshot_for_drift_attribution(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_get_recommendation(user_address: str, amount: float, risk_profile: str):
        return {
            "recommended_pools": [
                {
                    "pool_id": "ekubo_eth_usdc",
                    "protocol": "Ekubo",
                    "pair": "ETH/USDC",
                    "allocation_percent": 30.0,
                    "allocation_amount": 1536.0,
                    "expected_apy": 0.275,
                    "risk_score": 35.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "ekubo_strk_usdc",
                    "protocol": "Ekubo",
                    "pair": "STRK/USDC",
                    "allocation_percent": 20.0,
                    "allocation_amount": 1024.0,
                    "expected_apy": 0.265,
                    "risk_score": 42.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "lending_strk",
                    "protocol": "Lending",
                    "pair": "STRK Lending",
                    "allocation_percent": 25.0,
                    "allocation_amount": 1280.0,
                    "expected_apy": 0.08,
                    "risk_score": 15.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "staking_strk",
                    "protocol": "Staking",
                    "pair": "STRK Staking",
                    "allocation_percent": 20.0,
                    "allocation_amount": 1024.0,
                    "expected_apy": 0.12,
                    "risk_score": 10.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "idle_reserve",
                    "protocol": "Idle",
                    "pair": "Reserve",
                    "allocation_percent": 5.0,
                    "allocation_amount": 256.0,
                    "expected_apy": 0.0,
                    "risk_score": 0.0,
                    "risk_flags": [],
                },
            ],
            "ai_reasoning": "Balanced allocator output.",
            "ai_confidence": 0.85,
            "expected_portfolio_apy": 0.181,
            "portfolio_risk_assessment": "Balanced mix across four strategy sleeves.",
            "recommendation_id": "rec_balanced",
            "attestation_hash": "0xattestation",
            "provenance": {"circuits_used": ["YieldOptimality_v1"]},
            "genome": {"yield": 63, "risk": 26, "volatility": 35, "liquidity": 85, "efficiency": 19},
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr(
        "app.services.strategy_recommendation_service.get_recommendation",
        fake_get_recommendation,
    )

    receipt = await gate_service.receipt_service.create_receipt(
        user_address="0xabc123",
        constraints_hash="0xpolicy",
        proof_hash="0xrebalance",
        action_type="rebalance",
        metadata={
            "source": "execution_gate_v1",
            "stage": "execute",
            "status": "submitted",
            "gate": {
                "target_allocations": {"ETH": 15.0, "STRK": 55.0, "USDC": 30.0},
            },
            "execution": {
                "portfolio_after": {
                    "allocations": {"ETH": 16.0, "STRK": 54.0, "USDC": 30.0},
                },
            },
        },
    )
    await gate_service.receipt_service.confirm_receipt(receipt["receipt_id"], "0xrebtx")

    result = await gate_service.recommend("0xabc123")

    kinds = [item["kind"] for item in result["drift_monitor"]["drivers"]]
    assert "post_rebalance_market_drift" in kinds


@pytest.mark.asyncio
async def test_recommend_prefers_best_next_move_for_small_wallet(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return PortfolioSnapshot(
            wallet_address=address,
            scanned_at="2026-03-28T00:00:00+00:00",
            positions=[
                Position(protocol="wallet", position_type="token", asset_symbol="ETH", amount=0.00076647802782701, value_usd=1.5402682560),
                Position(protocol="wallet", position_type="token", asset_symbol="STRK", amount=69.68082469279078, value_usd=2.3924723020),
                Position(protocol="wallet", position_type="token", asset_symbol="USDC", amount=2.128029, value_usd=2.1274884806),
            ],
            total_value_usd=6.0602290386,
            protocol_count=0,
            position_count=3,
            protocols_found=["wallet"],
            snapshot_hash="0xsmall-recommend",
        )

    async def fake_get_recommendation(user_address: str, amount: float, risk_profile: str):
        return {
            "recommended_pools": [
                {
                    "pool_id": "ekubo_eth_usdc",
                    "protocol": "Ekubo",
                    "pair": "ETH/USDC",
                    "allocation_percent": 30.0,
                    "allocation_amount": 1.8180687116,
                    "expected_apy": 0.24,
                    "risk_score": 35.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "ekubo_strk_usdc",
                    "protocol": "Ekubo",
                    "pair": "STRK/USDC",
                    "allocation_percent": 20.0,
                    "allocation_amount": 1.2120458077,
                    "expected_apy": 0.23,
                    "risk_score": 42.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "lending_strk",
                    "protocol": "Lending",
                    "pair": "STRK Lending",
                    "allocation_percent": 25.0,
                    "allocation_amount": 1.5150572596,
                    "expected_apy": 0.08,
                    "risk_score": 15.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "staking_strk",
                    "protocol": "Staking",
                    "pair": "STRK Staking",
                    "allocation_percent": 20.0,
                    "allocation_amount": 1.2120458077,
                    "expected_apy": 0.12,
                    "risk_score": 10.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "idle_reserve",
                    "protocol": "Idle",
                    "pair": "Reserve",
                    "allocation_percent": 5.0,
                    "allocation_amount": 0.3030114519,
                    "expected_apy": 0.0,
                    "risk_score": 0.0,
                    "risk_flags": [],
                },
            ],
            "ai_reasoning": "Small wallets should take the most executable next move first.",
            "ai_confidence": 0.81,
            "expected_portfolio_apy": 0.14,
            "portfolio_risk_assessment": "Lean into STRK with a single executable step first.",
            "recommendation_id": "rec_small_wallet",
            "attestation_hash": "0xattestation",
            "provenance": {"circuits_used": ["YieldOptimality_v1"]},
            "genome": {"yield": 61, "risk": 31, "volatility": 42, "liquidity": 83, "efficiency": 27},
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr(
        "app.services.strategy_recommendation_service.get_recommendation",
        fake_get_recommendation,
    )

    result = await gate_service.recommend("0xabc123")

    assert result["recommendation_mode"] == "best_next_move"
    assert result["allocator_target_allocations"] == {"ETH": 15.0, "STRK": 55.0, "USDC": 30.0}
    assert result["derived_swap_steps"] == [
        {
            "from_asset": "ETH",
            "to_asset": "STRK",
            "value_usd": 0.63,
            "amount": pytest.approx(0.000196875),
            "amount_wei": 196875000000000,
        }
    ]
    assert result["target_allocations"]["ETH"] == pytest.approx(15.0, abs=0.1)
    assert result["target_allocations"]["STRK"] == pytest.approx(49.9, abs=0.2)
    assert result["target_allocations"]["USDC"] == pytest.approx(35.1, abs=0.2)
    assert result["rebalance_summary"]["headline"].startswith("Take the cleanest next move")
    assert "longer-horizon suggested mix" in result["rebalance_summary"]["why"]
    assert result["recommended_route_label"] == "ETH → STRK"
    assert result["recommended_route_detail"] is None
    assert result["recommended_alternatives"][0]["route_label"] == "ETH → STRK"
    assert result["recommended_alternatives"][0]["selected"] is True


@pytest.mark.asyncio
async def test_recommend_prefers_routable_small_wallet_candidate(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return PortfolioSnapshot(
            wallet_address=address,
            scanned_at="2026-03-28T00:00:00+00:00",
            positions=[
                Position(protocol="wallet", position_type="token", asset_symbol="ETH", amount=0.0021875, value_usd=7.0),
                Position(protocol="wallet", position_type="token", asset_symbol="STRK", amount=5.5555555556, value_usd=4.0),
                Position(protocol="wallet", position_type="token", asset_symbol="USDC", amount=2.0, value_usd=2.0),
            ],
            total_value_usd=13.0,
            protocol_count=0,
            position_count=3,
            protocols_found=["wallet"],
            snapshot_hash="0xroute-aware",
        )

    async def fake_get_recommendation(user_address: str, amount: float, risk_profile: str):
        return {
            "recommended_pools": [
                {
                    "pool_id": "eth_lending",
                    "protocol": "Lending",
                    "pair": "ETH Lending",
                    "allocation_percent": 20.0,
                    "allocation_amount": 2.6,
                    "expected_apy": 0.08,
                    "risk_score": 15.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "strk_lending",
                    "protocol": "Lending",
                    "pair": "STRK Lending",
                    "allocation_percent": 20.0,
                    "allocation_amount": 2.6,
                    "expected_apy": 0.08,
                    "risk_score": 15.0,
                    "risk_flags": [],
                },
                {
                    "pool_id": "idle_reserve",
                    "protocol": "Idle",
                    "pair": "Reserve",
                    "allocation_percent": 60.0,
                    "allocation_amount": 7.8,
                    "expected_apy": 0.0,
                    "risk_score": 0.0,
                    "risk_flags": [],
                },
            ],
            "ai_reasoning": "Preserve reserve and reduce concentration.",
            "ai_confidence": 0.74,
            "expected_portfolio_apy": 0.05,
            "portfolio_risk_assessment": "Cash-heavy defensive mix.",
            "recommendation_id": "rec_route_aware",
            "attestation_hash": "0xattestation",
            "provenance": {"circuits_used": ["YieldOptimality_v1"]},
            "genome": {"yield": 41, "risk": 22, "volatility": 28, "liquidity": 91, "efficiency": 44},
        }

    async def fake_execute_swap_intent(intent, execute_live, *, use_cache=True):
        if intent["token_in"] == "ETH":
            return {
                "status": "error",
                "wallet_calls": [],
                "execution_adapter": "best",
                "route": [],
                "error": "No AVNU liquidity for this pair.",
            }
        return {
            "status": "prepared",
            "wallet_calls": [
                {
                    "contract_address": "0x123",
                    "entrypoint": "multi_route_swap",
                    "calldata": ["0x1", "0x2"],
                }
            ],
            "execution_adapter": "avnu",
            "route": ["AVNU"],
            "expected_out": "1400000",
            "error": None,
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr(
        "app.services.strategy_recommendation_service.get_recommendation",
        fake_get_recommendation,
    )
    monkeypatch.setattr(gate_service, "_execute_swap_intent", fake_execute_swap_intent)

    result = await gate_service.recommend("0xabc123")

    assert result["recommendation_mode"] == "best_next_move"
    assert result["allocator_target_allocations"] == {"ETH": 20.0, "STRK": 20.0, "USDC": 60.0}
    assert result["derived_swap_steps"] == [
        {
            "from_asset": "STRK",
            "to_asset": "USDC",
            "value_usd": 1.4,
            "amount": pytest.approx(1.9444444444),
            "amount_wei": 1944444444444444416,
        }
    ]
    assert result["rebalance_summary"]["headline"].startswith("Take the cleanest routed move")
    assert "strk" in result["rebalance_summary"]["why"].lower()
    assert "avnu" in result["rebalance_summary"]["why"].lower()
    assert result["recommended_route_label"] == "STRK → USDC"
    assert result["recommended_route_detail"] == "AVNU via AVNU"
    assert len(result["recommended_alternatives"]) == 1
    assert result["recommended_alternatives"][0]["route_label"] == "STRK → USDC"
    assert result["recommended_alternatives"][0]["route_detail"] == "AVNU via AVNU"
    assert result["recommended_alternatives"][0]["fee_warning"] is True
    assert result["recommended_alternatives"][0]["selected"] is True


@pytest.mark.asyncio
async def test_confirm_wallet_execution_receipt_updates_tx_hash(gate_service):
    receipt = await gate_service.receipt_service.create_receipt(
        user_address="0xabc123",
        constraints_hash="0xpolicy",
        proof_hash="0xintent",
        action_type="swap",
        metadata={"source": "execution_gate_v1", "stage": "execute", "status": "prepared"},
    )

    result = await gate_service.confirm_wallet_execution_receipt(
        "0xabc123",
        receipt["receipt_id"],
        "0xtx123",
    )
    updated = await gate_service.receipt_service.get_receipt(receipt["receipt_id"])

    assert result["status"] == "submitted"
    assert updated is not None
    assert updated["tx_hash"] == "0xtx123"
    assert updated["metadata"]["status"] == "submitted"


@pytest.mark.asyncio
async def test_execute_swap_prefers_avnu_when_ekubo_has_no_route(monkeypatch, gate_service):
    async def fake_build_swap_calldata(*args, **kwargs):
        return {"error": "No executable Ekubo liquidity for this pair."}

    async def fake_build_avnu_swap_execution(**kwargs):
        return {
            "venue": "avnu",
            "wallet_calls": [
                {
                    "contract_address": "0x123",
                    "entrypoint": "multi_route_swap",
                    "calldata": ["0x1", "0x2"],
                }
            ],
            "expected_out": 123456,
            "route": ["AVNU"],
            "error": None,
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.build_swap_calldata", fake_build_swap_calldata)
    monkeypatch.setattr("app.services.portfolio_execution_gate.build_avnu_swap_execution", fake_build_avnu_swap_execution)

    result = await gate_service._execute_swap_intent(
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 10**15,
            "max_slippage_bps": 50,
            "adapter_target": "best",
            "network_id": "starknet_mainnet",
            "owner_address": "0xabc123",
        },
        False,
    )

    assert result["status"] == "prepared"
    assert result["execution_adapter"] == "avnu"
    assert result["wallet_calls"]


@pytest.mark.asyncio
async def test_check_intent_blocks_fee_inefficient_tiny_rebalance(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return PortfolioSnapshot(
            wallet_address=address,
            scanned_at="2026-03-28T00:00:00+00:00",
            positions=[
                Position(protocol="wallet", position_type="token", asset_symbol="ETH", amount=0.0001, value_usd=0.32),
                Position(protocol="wallet", position_type="token", asset_symbol="STRK", amount=0.3, value_usd=0.216),
                Position(protocol="wallet", position_type="token", asset_symbol="USDC", amount=0.1, value_usd=0.1),
            ],
            total_value_usd=0.636,
            protocol_count=1,
            position_count=3,
            protocols_found=["wallet"],
            snapshot_hash="0xtiny",
        )

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "rebalance",
            "target_allocations": {"ETH": 45.0, "STRK": 20.0, "USDC": 35.0},
            "deadline": 100500,
            "nonce": 12,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "best",
            "network_id": "starknet_mainnet",
        },
    )

    assert result["allowed"] is False
    assert "fee_inefficient" in result["reason_codes"]


@pytest.mark.asyncio
async def test_check_intent_allows_small_mainnet_rebalance_with_fee_warning(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return PortfolioSnapshot(
            wallet_address=address,
            scanned_at="2026-03-28T00:00:00+00:00",
            positions=[
                Position(protocol="wallet", position_type="token", asset_symbol="ETH", amount=0.0012, value_usd=3.84),
                Position(protocol="wallet", position_type="token", asset_symbol="STRK", amount=1.5, value_usd=1.08),
                Position(protocol="wallet", position_type="token", asset_symbol="USDC", amount=0.2, value_usd=0.2),
            ],
            total_value_usd=5.12,
            protocol_count=1,
            position_count=3,
            protocols_found=["wallet"],
            snapshot_hash="0xsmall",
        )

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "rebalance",
            "target_allocations": {"ETH": 45.0, "STRK": 20.0, "USDC": 35.0},
            "deadline": 100500,
            "nonce": 13,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "best",
            "network_id": "starknet_mainnet",
        },
    )

    fee_guard = next(item for item in result["constraint_results"] if item["name"] == "FeeEfficiencyGuard")

    assert result["allowed"] is True
    assert "fee_inefficient" not in result["reason_codes"]
    assert fee_guard["passed"] is True
    assert fee_guard["warning"] is True
    assert "single-step grace" in fee_guard["reason"]


@pytest.mark.asyncio
async def test_check_intent_allows_sub_dollar_single_step_rebalance_on_small_wallet(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return PortfolioSnapshot(
            wallet_address=address,
            scanned_at="2026-03-28T00:00:00+00:00",
            positions=[
                Position(protocol="wallet", position_type="token", asset_symbol="ETH", amount=0.00076647802782701, value_usd=1.5402682560),
                Position(protocol="wallet", position_type="token", asset_symbol="STRK", amount=69.68082469279078, value_usd=2.3924723020),
                Position(protocol="wallet", position_type="token", asset_symbol="USDC", amount=2.128029, value_usd=2.1274884806),
            ],
            total_value_usd=6.0602290386,
            protocol_count=0,
            position_count=3,
            protocols_found=["wallet"],
            snapshot_hash="0xliveish",
        )

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "rebalance",
            "target_allocations": {"ETH": 40.0, "STRK": 25.0, "USDC": 35.0},
            "deadline": 100500,
            "nonce": 14,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "best",
            "network_id": "starknet_mainnet",
        },
    )

    fee_guard = next(item for item in result["constraint_results"] if item["name"] == "FeeEfficiencyGuard")

    assert result["allowed"] is True
    assert "fee_inefficient" not in result["reason_codes"]
    assert fee_guard["passed"] is True


@pytest.mark.asyncio
async def test_cooldown_ignores_execute_receipts_without_tx_hash(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    await gate_service.receipt_service.create_receipt(
        user_address="0xabc123",
        constraints_hash="0xpolicy",
        proof_hash="0xintent",
        action_type="swap",
        metadata={"source": "execution_gate_v1", "stage": "execute", "status": "error"},
    )

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 10**15,
            "deadline": 100500,
            "nonce": 9,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "best",
        },
    )

    assert result["allowed"] is True
    assert "cooldown_active" not in result["reason_codes"]


@pytest.mark.asyncio
async def test_mainnet_best_route_prefers_avnu_before_ekubo(monkeypatch, gate_service):
    gate_service._execution_prep_cache.clear()

    async def fake_build_avnu_swap_execution(**kwargs):
        return {
            "venue": "avnu",
            "wallet_calls": [
                {
                    "contract_address": "0x123",
                    "entrypoint": "multi_route_swap",
                    "calldata": ["0x1", "0x2"],
                }
            ],
            "expected_out": 987654,
            "route": ["Ekubo"],
            "error": None,
        }

    async def fail_if_ekubo_called(*args, **kwargs):
        raise AssertionError("Ekubo should not be called when AVNU already produced a mainnet best-route result.")

    monkeypatch.setattr("app.services.portfolio_execution_gate.build_avnu_swap_execution", fake_build_avnu_swap_execution)
    monkeypatch.setattr("app.services.portfolio_execution_gate.build_swap_calldata", fail_if_ekubo_called)

    result = await gate_service._execute_swap_intent(
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 10**15,
            "max_slippage_bps": 50,
            "adapter_target": "best",
            "network_id": "starknet_mainnet",
            "owner_address": "0xabc123",
        },
        False,
    )

    assert result["status"] == "prepared"
    assert result["execution_adapter"] == "avnu"
    assert result["wallet_calls"]
    assert result["cache_hit"] is False


@pytest.mark.asyncio
async def test_execute_swap_uses_cached_prepared_execution(monkeypatch, gate_service):
    gate_service._execution_prep_cache.clear()
    calls = {"avnu": 0}

    async def fake_build_avnu_swap_execution(**kwargs):
        calls["avnu"] += 1
        return {
            "venue": "avnu",
            "wallet_calls": [
                {
                    "contract_address": "0x123",
                    "entrypoint": "multi_route_swap",
                    "calldata": ["0x1", "0x2"],
                }
            ],
            "expected_out": 555555,
            "route": ["AVNU"],
            "error": None,
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.build_avnu_swap_execution", fake_build_avnu_swap_execution)

    intent = {
        "type": "swap",
        "token_in": "ETH",
        "token_out": "USDC",
        "amount_wei": 10**15,
        "max_slippage_bps": 50,
        "adapter_target": "best",
        "network_id": "starknet_mainnet",
        "owner_address": "0xabc123",
    }

    first = await gate_service._execute_swap_intent(intent, False)
    second = await gate_service._execute_swap_intent(intent, False)

    assert first["status"] == "prepared"
    assert second["status"] == "prepared"
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    assert calls["avnu"] == 1


@pytest.mark.asyncio
async def test_execute_intent_bypasses_cached_preview_quotes(monkeypatch, gate_service):
    gate_service._execution_prep_cache.clear()
    calls = {"avnu": 0}

    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    async def fake_build_avnu_swap_execution(**kwargs):
        calls["avnu"] += 1
        return {
            "venue": "avnu",
            "wallet_calls": [
                {
                    "contract_address": "0x123",
                    "entrypoint": "multi_route_swap",
                    "calldata": ["0x1", "0x2"],
                }
            ],
            "expected_out": 555555 + calls["avnu"],
            "route": ["AVNU"],
            "error": None,
        }

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)
    monkeypatch.setattr("app.services.portfolio_execution_gate.build_avnu_swap_execution", fake_build_avnu_swap_execution)

    intent = {
        "type": "swap",
        "token_in": "ETH",
        "token_out": "USDC",
        "amount_wei": 10**15,
        "deadline": 100500,
        "nonce": 19,
        "block_number": 100000,
        "max_slippage_bps": 50,
        "adapter_target": "best",
        "network_id": "starknet_mainnet",
    }

    preview = await gate_service.check_intent("0xabc123", intent, prepare_preview=True)
    result = await gate_service.execute_intent("0xabc123", intent, execute_live=False)

    assert preview["execution_preview"]["cache_hit"] is False
    assert result["status"] == "prepared"
    assert result["wallet_calls"]
    assert result.get("cache_hit") is False
    assert result["expected_out"] == str(555555 + calls["avnu"])
    assert calls["avnu"] == 2


@pytest.mark.asyncio
async def test_min_amount_guard_blocks_too_small_swap(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.check_intent(
        "0xabc123",
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 10**12,  # below 0.00001 ETH minimum
            "deadline": 100500,
            "nonce": 10,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "best",
        },
    )

    assert result["allowed"] is False
    assert "min_amount_too_small" in result["reason_codes"]


@pytest.mark.asyncio
async def test_execute_blocks_when_session_key_invalid(monkeypatch, gate_service):
    async def fake_scan_portfolio(address: str):
        return _mock_snapshot(address)

    async def fake_run_circuit_scan(**_: object):
        return _mock_scan_result()

    monkeypatch.setattr("app.services.portfolio_execution_gate.scan_portfolio", fake_scan_portfolio)
    monkeypatch.setattr("app.services.portfolio_execution_gate.run_circuit_scan", fake_run_circuit_scan)

    result = await gate_service.execute_intent(
        "0xabc123",
        {
            "type": "swap",
            "token_in": "ETH",
            "token_out": "USDC",
            "amount_wei": 10**15,
            "deadline": 100500,
            "nonce": 11,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "best",
            "session_key_id": "0xdoesnotexist",
        },
    )

    assert result["status"] == "blocked"
    assert result.get("error")


@pytest.mark.asyncio
async def test_execute_allows_fee_only_manual_override(monkeypatch, gate_service):
    async def fake_check_intent(*args, **kwargs):
        return {
            "allowed": False,
            "policy_hash": "0xpolicy",
            "intent_hash": "0xintent",
            "route_hash": "0xroute",
            "estimated_gas": 4_500_000,
            "estimated_cost_usd": 0.54,
            "reason_codes": ["fee_inefficient"],
            "current_allocations": {"ETH": 45.0, "STRK": 20.0, "USDC": 35.0},
            "swap_steps": [
                {
                    "from_asset": "ETH",
                    "to_asset": "USDC",
                    "amount": 0.0003,
                    "amount_wei": 300000000000000,
                    "value_usd": 0.96,
                }
            ],
            "constraint_results": [
                {"name": "PauseGuard", "kind": "policy", "passed": True, "success": True, "reason": "Portfolio is active."},
                {"name": "FeeEfficiencyGuard", "kind": "policy", "passed": False, "success": True, "reason": "Estimated fee is too large for the action value.", "warning": False, "severity": "blocked", "estimated_fee_usd": 0.54, "fee_share_pct": 56.3},
            ],
        }

    async def fake_execute_rebalance_intent(*args, **kwargs):
        return {
            "status": "prepared",
            "tx_hash": None,
            "execution_chain": "starknet_mainnet",
            "live_submission_allowed": False,
            "prepared_calls": [
                {
                    "step": {
                        "from_asset": "ETH",
                        "to_asset": "USDC",
                        "amount": 0.0003,
                        "amount_wei": 300000000000000,
                        "value_usd": 0.96,
                    },
                    "status": "ready",
                    "wallet_calls": [
                        {"contract_address": "0x123", "entrypoint": "multi_route_swap", "calldata": ["0x1", "0x2"]}
                    ],
                    "execution_adapter": "avnu",
                    "route": ["AVNU"],
                }
            ],
            "warning": None,
        }

    monkeypatch.setattr(gate_service, "check_intent", fake_check_intent)
    monkeypatch.setattr(gate_service, "_execute_rebalance_intent", fake_execute_rebalance_intent)

    result = await gate_service.execute_intent(
        "0xabc123",
        {
            "type": "rebalance",
            "target_allocations": {"ETH": 45.0, "STRK": 20.0, "USDC": 35.0},
            "deadline": 100500,
            "nonce": 21,
            "block_number": 100000,
            "max_slippage_bps": 50,
            "adapter_target": "best",
            "network_id": "starknet_mainnet",
            "allow_advisory_override": True,
        },
        execute_live=False,
    )

    assert result["status"] == "prepared"
    assert result["prepared_calls"]
    assert result["gate"]["allowed"] is False


@pytest.mark.asyncio
async def test_record_policy_update_receipt_persists_diff(gate_service):
    receipt = await gate_service.record_policy_update_receipt(
        "0xabc123",
        before={
            "policy_hash": "0xbefore",
            "paused": False,
            "max_slippage_bps": 50,
            "cooldown_seconds": 300,
        },
        after={
            "policy_hash": "0xafter",
            "paused": True,
            "max_slippage_bps": 75,
            "cooldown_seconds": 120,
        },
    )

    stored = await gate_service.receipt_service.get_receipt(receipt["receipt_id"])
    assert stored is not None
    assert stored["metadata"]["stage"] == "policy"
    assert set(stored["metadata"]["policy"]["changed_fields"]) == {
        "paused",
        "max_slippage_bps",
        "cooldown_seconds",
    }


@pytest.mark.asyncio
async def test_telemetry_summary_includes_failures_and_in_flight(gate_service):
    await gate_service.receipt_service.create_receipt(
        user_address="0xabc123",
        constraints_hash="0xpolicy",
        proof_hash="0xcheck",
        action_type="swap",
        metadata={
            "source": "execution_gate_v1",
            "stage": "check",
            "status": "blocked",
            "reason_codes": ["fee_inefficient", "cooldown_active"],
        },
    )
    ready = await gate_service.receipt_service.create_receipt(
        user_address="0xabc123",
        constraints_hash="0xpolicy",
        proof_hash="0xexecute",
        action_type="rebalance",
        metadata={
            "source": "execution_gate_v1",
            "stage": "execute",
            "status": "ready_to_sign",
            "execution": {"execution_adapter": "avnu"},
        },
    )
    submitted = await gate_service.receipt_service.create_receipt(
        user_address="0xabc123",
        constraints_hash="0xpolicy",
        proof_hash="0xsubmitted",
        action_type="swap",
        metadata={
            "source": "execution_gate_v1",
            "stage": "execute",
            "status": "submitted",
            "execution": {"execution_adapter": "ekubo"},
        },
    )
    await gate_service.receipt_service.confirm_receipt(submitted["receipt_id"], "0xtx456")
    await gate_service.receipt_service.update_receipt_metadata(
        submitted["receipt_id"],
        {
            "source": "execution_gate_v1",
            "stage": "execute",
            "status": "failed",
            "reason_codes": ["execution_error:route_failed"],
            "execution": {"execution_adapter": "ekubo", "error": "Route failed", "failure_bucket": "route_unavailable"},
        },
    )

    summary = await gate_service.get_telemetry_summary("0xabc123")

    assert summary["recent_receipt_count"] >= 3
    assert any(item["bucket"] == "route_unavailable" for item in summary["top_failure_buckets"])
    assert summary["recent_failures"][0]["status"] in {"blocked", "failed"}
    assert any(item["bucket"] == "route_unavailable" for item in summary["recent_failures"])
    assert any(item["status"] == "ready_to_sign" for item in summary["in_flight"])
    assert summary["success_rate_pct"] == 0.0


def test_monitor_service_tracks_reviews_and_alerts(gate_service):
    monitor = gate_service.monitor_service
    recommendation = {
        "source": "allocator_v1",
        "recommendation_id": "rec-1",
        "drift_monitor": {
            "status": "rebalance",
            "total_turnover_pct": 22.5,
            "estimated_turnover_usd": 144.0,
            "largest_gap_asset": "ETH",
            "largest_gap_pct": 11.0,
            "drivers": [{"kind": "market_drift"}],
        },
    }

    assert monitor.should_emit_alert("0xabc123", recommendation) is True
    state = monitor.record_review("0xabc123", recommendation=recommendation, emitted_receipt=True)
    assert state["drift_status"] == "rebalance"
    assert state["driver_kinds"] == ["market_drift"]
    assert monitor.should_emit_alert("0xabc123", recommendation) is False


def test_rebalance_reserves_strk_for_mainnet_gas(gate_service):
    holdings = {
        "ETH": {"amount": 0.001, "value_usd": 3.2},
        "STRK": {"amount": 2.0, "value_usd": round(2.0 * 0.72, 4)},
        "USDC": {"amount": 0.0, "value_usd": 0.0},
    }
    target_allocations = {"ETH": 50.0, "STRK": 5.0, "USDC": 45.0}

    steps = gate_service._build_rebalance_steps(holdings, target_allocations)
    strk_sell = next((step for step in steps if step["from_asset"] == "STRK"), None)

    assert strk_sell is not None
    assert strk_sell["amount"] < holdings["STRK"]["amount"]
