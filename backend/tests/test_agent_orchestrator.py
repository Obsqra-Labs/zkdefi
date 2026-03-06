"""
Tests for AgentOrchestrator — registration, CRUD, goal execution with mocked LLM + skills.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.services.agent_orchestrator import (
    AgentConfig,
    AgentOrchestrator,
    OrchestrationResult,
    PROOF_TTL_SECONDS,
)


# ---------------------------------------------------------------------------
# Lightweight stubs — replaces external services used by the orchestrator
# ---------------------------------------------------------------------------

@dataclass
class FakeLLMResponse:
    content: str = "{}"
    model: str = "fake-v1"
    provider_id: str = "fake"
    fallback_from: str | None = None
    fallback_reason: str | None = None
    usage: dict = field(default_factory=lambda: {"total_tokens": 42})


class FakeLLMRegistry:
    """Stub for LLMProviderRegistry."""
    def __init__(self, response=None):
        self._response = response or FakeLLMResponse()
        self.chat_calls: list[dict] = []

    def bind_agent(self, agent_id, provider_id):
        return f"hash:{agent_id}:{provider_id}"

    async def agent_chat(self, agent_id, messages, model=None):
        self.chat_calls.append({"agent_id": agent_id, "messages": messages, "model": model})
        return self._response


class FakeSkillService:
    """Stub for agent_skill_service."""
    def __init__(self, result=None):
        self._result = result or {
            "success": True,
            "skill_id": "risk_score",
            "is_compliant": True,
            "proof_hash": "0xDEAD",
            "duration_ms": 50,
        }
        self.execute_calls: list[dict] = []

    def get_skill_tools_for_llm(self, skill_ids):
        return [
            {"type": "function", "function": {"name": f"zk_{sid}", "description": f"Run {sid}"}}
            for sid in (skill_ids or [])
        ]

    async def execute_skill(self, skill_id, params, user_address=0):
        self.execute_calls.append({"skill_id": skill_id, "params": params})
        return dict(self._result)


class FakeAgentStore:
    """In-memory agent store (no SQLite)."""
    def __init__(self):
        self._agents: dict[str, dict] = {}
        self._bindings: dict[str, str] = {}

    def save_agent(self, data):
        self._agents[data["agent_id"]] = data

    def get_agent(self, agent_id):
        return self._agents.get(agent_id)

    def list_agents(self, owner=None):
        rows = list(self._agents.values())
        if owner:
            rows = [r for r in rows if r.get("owner_address") == owner]
        return rows

    def update_agent(self, agent_id, updates):
        if agent_id not in self._agents:
            return False
        self._agents[agent_id].update(updates)
        return True

    def delete_agent(self, agent_id):
        if agent_id in self._agents:
            del self._agents[agent_id]
            return True
        return False

    def save_binding(self, agent_id, provider_id, config_hash):
        self._bindings[agent_id] = provider_id

    def list_bindings(self):
        return dict(self._bindings)


class FakeOnchainService:
    available = False


class FakeReceiptService:
    def __init__(self):
        self.receipts: list[dict] = []

    def append_proof_receipt(self, **kw):
        self.receipts.append(kw)
        return {"receipt_id": "0xREC"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def orch():
    """Create an orchestrator wired to fakes (no DB, no LLM, no network)."""
    o = object.__new__(AgentOrchestrator)
    o._registry = FakeLLMRegistry()
    o._skill_service = FakeSkillService()
    o._store = FakeAgentStore()
    o._onchain = FakeOnchainService()
    o._receipt_service = FakeReceiptService()
    return o


def _sample_config(**kw) -> AgentConfig:
    defaults = dict(
        agent_id="agent-1",
        owner_address="0x1234",
        name="TestBot",
        identity_commitment="0xIC",
        bound_skills=["risk_score", "pool_safety"],
        llm_provider_id="fake",
    )
    defaults.update(kw)
    return AgentConfig(**defaults)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

class TestRegisterAgent:
    def test_register_stores_and_returns_hash(self, orch: AgentOrchestrator):
        cfg = _sample_config()
        result = orch.register_agent(cfg)
        assert "config_hash" in result
        stored = orch.get_agent("agent-1")
        assert stored is not None
        assert stored.name == "TestBot"

    def test_register_binds_llm_provider(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config())
        assert orch._store._bindings["agent-1"] == "fake"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

class TestAgentCRUD:
    def test_list_agents(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config(agent_id="a1", name="Bot1"))
        orch.register_agent(_sample_config(agent_id="a2", name="Bot2", owner_address="0xOther"))
        assert len(orch.list_agents()) == 2
        assert len(orch.list_agents(owner="0x1234")) == 1

    def test_update_agent(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config())
        ok = orch.update_agent("agent-1", {"name": "RenamedBot"})
        assert ok is True
        assert orch.get_agent("agent-1").name == "RenamedBot"

    def test_update_nonexistent_returns_false(self, orch: AgentOrchestrator):
        assert orch.update_agent("no-such-agent", {}) is False

    def test_delete_agent(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config())
        assert orch.delete_agent("agent-1") is True
        assert orch.get_agent("agent-1") is None

    def test_delete_nonexistent_returns_false(self, orch: AgentOrchestrator):
        assert orch.delete_agent("nope") is False


# ---------------------------------------------------------------------------
# execute_goal — happy path
# ---------------------------------------------------------------------------

class TestExecuteGoal:
    @pytest.mark.asyncio
    async def test_happy_path_with_one_skill(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config())
        # LLM returns a skill_calls payload
        orch._registry._response = FakeLLMResponse(
            content=json.dumps({"skill_calls": [{"skill_id": "risk_score", "params": {"user": "0x1"}}]})
        )

        result = await orch.execute_goal("agent-1", "optimize yield")
        assert isinstance(result, OrchestrationResult)
        assert result.error is None
        assert result.all_proofs_pass is True
        assert len(result.steps) == 3  # reasoning + skill_exec + synthesis
        assert result.steps[1].step_type == "skill_execution"
        assert result.steps[1].success is True

    @pytest.mark.asyncio
    async def test_nonexistent_agent_returns_error(self, orch: AgentOrchestrator):
        result = await orch.execute_goal("no-such", "hi")
        assert result.error is not None
        assert "not found" in result.error.lower()

    @pytest.mark.asyncio
    async def test_deactivated_agent_returns_error(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config(active=False))
        result = await orch.execute_goal("agent-1", "hi")
        assert "deactivated" in result.error.lower()


# ---------------------------------------------------------------------------
# Skill binding enforcement
# ---------------------------------------------------------------------------

class TestSkillBinding:
    @pytest.mark.asyncio
    async def test_unbound_skill_rejected(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config(bound_skills=["pool_safety"]))
        orch._registry._response = FakeLLMResponse(
            content=json.dumps({"skill_calls": [{"skill_id": "unknown_skill", "params": {}}]})
        )
        result = await orch.execute_goal("agent-1", "x")
        # The skill_execution step should fail
        skill_steps = [s for s in result.steps if s.step_type == "skill_execution"]
        assert len(skill_steps) == 1
        assert skill_steps[0].success is False
        assert "not bound" in skill_steps[0].result.get("error", "").lower()


# ---------------------------------------------------------------------------
# _parse_skill_calls
# ---------------------------------------------------------------------------

class TestParseSkillCalls:
    def test_parses_valid_json(self, orch: AgentOrchestrator):
        result = {"content": json.dumps({"skill_calls": [{"skill_id": "risk_score", "params": {"k": 1}}]})}
        calls = orch._parse_skill_calls(result)
        assert len(calls) == 1
        assert calls[0]["skill_id"] == "risk_score"

    def test_fallback_on_bad_json(self, orch: AgentOrchestrator):
        result = {"content": "not json"}
        calls = orch._parse_skill_calls(result)
        assert len(calls) == 1
        assert calls[0]["skill_id"] == "risk_score"  # default fallback


# ---------------------------------------------------------------------------
# Receipt emission
# ---------------------------------------------------------------------------

class TestReceiptEmission:
    @pytest.mark.asyncio
    async def test_receipt_emitted_after_goal(self, orch: AgentOrchestrator):
        orch.register_agent(_sample_config())
        orch._registry._response = FakeLLMResponse(
            content=json.dumps({"skill_calls": [{"skill_id": "risk_score", "params": {}}]})
        )
        await orch.execute_goal("agent-1", "test goal")
        assert len(orch._receipt_service.receipts) == 1
        r = orch._receipt_service.receipts[0]
        assert r["proof_type"] == "agent_orchestration"
        assert "agent-1" in r["threshold_or_model"]
