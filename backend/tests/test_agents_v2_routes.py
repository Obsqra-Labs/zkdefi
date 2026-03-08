from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
import app.services.agent_service as agent_service_mod


@pytest.fixture
def configured_agent_service(monkeypatch, tmp_path):
    db_path = tmp_path / "agents-v2-test.db"
    monkeypatch.setenv("AGENT_BUILDER_V2_ENABLED", "true")
    monkeypatch.setenv("AGENT_BUILDER_V2_ROLLOUT_PERCENT", "100")
    monkeypatch.setenv("AGENT_BUILDER_V2_INTERNAL_ALLOWLIST", "")
    monkeypatch.setenv("AGENT_BUILDER_DB_PATH", str(db_path))
    agent_service_mod._IN_MEMORY_AGENTS.clear()
    agent_service_mod._IN_MEMORY_USER_AGENTS.clear()
    agent_service_mod._service = None
    service = agent_service_mod.get_agent_service()
    yield service
    agent_service_mod._IN_MEMORY_AGENTS.clear()
    agent_service_mod._IN_MEMORY_USER_AGENTS.clear()
    agent_service_mod._service = None


@pytest.mark.asyncio
async def test_agents_persist_across_service_restart(configured_agent_service):
    service = configured_agent_service
    created = await service.create_agent(
        user_address="0xabc",
        name="Persistence Agent",
        processors=["risk_scoring", "correlation_risk"],
        decision_logic={"type": "AND"},
        llm_config={"provider": "openai", "model": "gpt-4o-mini", "api_key_env": "OPENAI_API_KEY"},
    )

    assert created["id"]
    assert created["active"] is True

    before_restart = await service.get_agent(created["id"])
    assert before_restart is not None
    assert before_restart["name"] == "Persistence Agent"

    deactivated = await service.deactivate_agent(created["id"], "0xabc")
    assert deactivated is True

    # Simulate restart by resetting singleton and re-instantiating.
    agent_service_mod._service = None
    restarted = agent_service_mod.get_agent_service()

    fetched = await restarted.get_agent(created["id"])
    assert fetched is not None
    assert fetched["name"] == "Persistence Agent"
    assert fetched["active"] is False

    user_agents = await restarted.get_user_agents("0xabc")
    assert len(user_agents) == 1
    assert user_agents[0]["id"] == created["id"]


@pytest.mark.asyncio
async def test_provider_alias_normalization(configured_agent_service):
    service = configured_agent_service

    created = await service.create_agent(
        user_address="0xabc",
        name="Alias Agent",
        processors=["risk_scoring"],
        decision_logic={"type": "AND"},
        llm_config={
            "provider": "clawed",
            "model": "claude-3-7-sonnet-latest",
            "api_key_env": "ANTHROPIC_API_KEY",
        },
    )

    assert created["llm"]["provider"] == "anthropic"
    assert created["llm"]["family"] == "anthropic"

    with pytest.raises(ValueError):
        await service.create_agent(
            user_address="0xabc",
            name="Bad Provider Agent",
            processors=["risk_scoring"],
            decision_logic={"type": "AND"},
            llm_config={"provider": "unknown-provider"},
        )


@pytest.mark.asyncio
async def test_rollout_allowlist_and_percent_gating(monkeypatch, tmp_path):
    db_path = tmp_path / "agents-v2-rollout-test.db"
    monkeypatch.setenv("AGENT_BUILDER_V2_ENABLED", "true")
    monkeypatch.setenv("AGENT_BUILDER_V2_ROLLOUT_PERCENT", "0")
    monkeypatch.setenv("AGENT_BUILDER_V2_INTERNAL_ALLOWLIST", "0xallow")
    monkeypatch.setenv("AGENT_BUILDER_DB_PATH", str(db_path))
    agent_service_mod._IN_MEMORY_AGENTS.clear()
    agent_service_mod._IN_MEMORY_USER_AGENTS.clear()
    agent_service_mod._service = None
    service = agent_service_mod.get_agent_service()

    non_cohort = await service.create_agent(
        user_address="0xskip",
        name="Memory Agent",
        processors=["risk_scoring"],
        decision_logic={"type": "AND"},
        llm_config={"provider": "deterministic"},
    )
    allowlisted = await service.create_agent(
        user_address="0xallow",
        name="Persisted Agent",
        processors=["risk_scoring"],
        decision_logic={"type": "AND"},
        llm_config={"provider": "deterministic"},
    )

    assert service.repo is not None
    assert service.repo.get_agent(non_cohort["id"]) is None
    assert service.repo.get_agent(allowlisted["id"]) is not None

    # Restart simulation: in-memory agent is gone, allowlisted persisted one remains.
    agent_service_mod._IN_MEMORY_AGENTS.clear()
    agent_service_mod._IN_MEMORY_USER_AGENTS.clear()
    agent_service_mod._service = None
    restarted = agent_service_mod.get_agent_service()
    assert await restarted.get_agent(non_cohort["id"]) is None
    assert await restarted.get_agent(allowlisted["id"]) is not None
    agent_service_mod._IN_MEMORY_AGENTS.clear()
    agent_service_mod._IN_MEMORY_USER_AGENTS.clear()
    agent_service_mod._service = None


def test_agents_api_compatibility(configured_agent_service):
    # Ensure the configured singleton is the one routes use.
    agent_service_mod._service = configured_agent_service
    client = TestClient(app)

    models_resp = client.get("/api/v1/agents/models/list")
    assert models_resp.status_code == 200
    assert isinstance(models_resp.json().get("models"), list)

    providers_resp = client.get("/api/v1/agents/providers")
    assert providers_resp.status_code == 200
    providers = providers_resp.json().get("providers", [])
    provider_ids = {provider.get("provider_id") for provider in providers}
    assert {"openai", "anthropic", "local", "deterministic", "clawbot", "onyx"}.issubset(provider_ids)

    anthropic = next(provider for provider in providers if provider.get("provider_id") == "anthropic")
    assert "claude" in anthropic.get("aliases", [])
    assert "clawed" in anthropic.get("aliases", [])
    assert anthropic.get("family") == "anthropic"
    assert isinstance(anthropic.get("config_requirements"), dict)

    create_resp = client.post(
        "/api/v1/agents/create",
        json={
            "user_address": "0x1234",
            "name": "Compat Agent",
            "processors": ["risk_scoring"],
            "decision_logic": {"type": "AND"},
            "llm": {"provider": "deterministic"},
        },
    )
    assert create_resp.status_code == 200
    created = create_resp.json()

    expected_keys = {"id", "owner", "name", "processors", "decision_logic", "llm", "active", "created_at"}
    assert expected_keys.issubset(set(created.keys()))

    get_resp = client.get(f"/api/v1/agents/{created['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == created["id"]

    list_resp = client.get("/api/v1/agents/user/0x1234")
    assert list_resp.status_code == 200
    listed = list_resp.json().get("agents", [])
    assert isinstance(listed, list)
    assert any(agent.get("id") == created["id"] for agent in listed)

    deactivate_resp = client.delete(f"/api/v1/agents/{created['id']}?user_address=0x1234")
    assert deactivate_resp.status_code == 200
    assert deactivate_resp.json().get("status") == "deactivated"

    get_after_deactivate = client.get(f"/api/v1/agents/{created['id']}")
    assert get_after_deactivate.status_code == 200
    assert get_after_deactivate.json().get("active") is False
