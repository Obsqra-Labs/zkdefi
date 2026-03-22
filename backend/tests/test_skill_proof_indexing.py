from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.api.routes.proofs as proofs_routes
import app.services.agent_skill_service as skill_service_mod
from app.services.agent_skill_service import AgentSkillService


@pytest.mark.asyncio
async def test_execute_skill_registers_successful_proof(monkeypatch):
    stored: list[dict] = []

    class FakeRegistry:
        def store_proof(self, **kwargs):
            stored.append(kwargs)

    async def fake_generate_proof(circuit_name: str, circuit_inputs: dict):
        return {
            "success": True,
            "is_compliant": True,
            "proof_hash": "0xskillproof",
            "public_signals": ["1", "250", "999"],
            "proof": {"pi_a": ["1", "2"]},
        }

    monkeypatch.setattr(skill_service_mod, "_generate_proof", fake_generate_proof)
    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())

    svc = AgentSkillService()
    result = await svc.execute_skill("risk_score", params={}, user_address=0x1234)

    assert result["success"] is True
    assert result["proof_hash"] == "0xskillproof"
    assert len(stored) == 1
    assert stored[0]["proof_hash"] == "0xskillproof"
    assert stored[0]["model_name"] == "RiskScore"
    assert stored[0]["action_type"] == "risk_score"
    assert stored[0]["user_address"] == hex(0x1234)
    assert stored[0]["proof_type"] == "groth16"
    assert stored[0]["verified_locally"] is True
    assert stored[0]["inference_output"] == [1.0, 250.0, 999.0]


@pytest.mark.asyncio
async def test_get_proof_falls_back_to_registry_when_pipeline_misses(monkeypatch):
    monkeypatch.setattr(
        "app.services.proof_pipeline.get_proof_pipeline",
        lambda: SimpleNamespace(_cache={}),
    )

    fake_record = SimpleNamespace(
        proof_hash="0xregistryproof",
        model_name="StrategyIntegrity",
        user_address="0xabc",
        proof_type="groth16",
        action_type="strategy_integrity",
        verified_locally=True,
        created_at=123.0,
        tx_hash=None,
        metadata_json='{"bridge_statement":{"lane":"modelbridge"}}',
        to_dict=lambda: {
            "proof_hash": "0xregistryproof",
            "model_name": "StrategyIntegrity",
            "user_address": "0xabc",
            "metadata": {"bridge_statement": {"lane": "modelbridge"}},
        },
    )

    class FakeRegistry:
        def get_proof(self, proof_hash: str):
            return fake_record if proof_hash == "0xregistryproof" else None

    monkeypatch.setattr("app.services.proof_registry.get_proof_registry", lambda: FakeRegistry())

    payload = await proofs_routes.get_proof("0xregistryproof")

    assert payload["proof_hash"] == "0xregistryproof"
    assert payload["status"] == "indexed"
    assert payload["source"] == "proof_registry"
    assert payload["model_name"] == "StrategyIntegrity"
    assert payload["action_type"] == "strategy_integrity"
    assert payload["bridge_statement"]["lane"] == "modelbridge"
