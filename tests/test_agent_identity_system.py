"""
Agent Identity System — End-to-End Tests

Tests the full identity-bound agent pipeline:
  1. Agent Builder API (CRUD)
  2. Skill listing and execution
  3. LLM provider listing and binding
  4. Orchestration pipeline (LLM → skill → synthesis)
  5. Performance tracking and leaderboard
  6. Witness generation (reputation + performance)

Run:
  cd /opt/obsqra.starknet/zkdefi
  python -m pytest tests/test_agent_identity_system.py -v
  # or:
  python tests/test_agent_identity_system.py
"""

import asyncio
import json
import sys
import os
import pytest
import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_BASE = os.environ.get("ZKDEFI_API_BASE", "http://localhost:8003/api/v1/zkdefi")
AGENT_BUILDER = f"{API_BASE}/agent-builder"
TEST_OWNER = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7cfb12a0399e6"
TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    """Shared httpx client."""
    with httpx.Client(timeout=TIMEOUT) as c:
        yield c


@pytest.fixture(scope="module")
def created_agent(client: httpx.Client) -> dict:
    """Create an agent once for all tests that need one."""
    resp = client.post(f"{AGENT_BUILDER}/agents/build", json={
        "name": "TestAgent_E2E",
        "owner_address": TEST_OWNER,
        "skills": ["il_predictor", "yield_optimality", "risk_score"],
        "llm_provider": "deterministic",
    })
    assert resp.status_code == 200, f"Agent build failed: {resp.text}"
    data = resp.json()
    assert "agent_id" in data
    assert data["name"] == "TestAgent_E2E"
    return data


# ---------------------------------------------------------------------------
# 1. Skills API
# ---------------------------------------------------------------------------

class TestSkillsAPI:

    def test_list_skills(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/skills")
        assert resp.status_code == 200
        data = resp.json()
        skills = data.get("skills", [])
        assert len(skills) >= 8, f"Expected >=8 skills, got {len(skills)}"
        # Check essential fields
        for s in skills:
            assert "skill_id" in s
            assert "name" in s
            assert "category" in s
            assert "parameters" in s

    def test_skill_detail(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/skills/il_predictor")
        assert resp.status_code == 200
        data = resp.json()
        assert data["skill_id"] == "il_predictor"
        assert "parameters" in data

    def test_skill_not_found(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/skills/nonexistent_skill")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 2. LLM Providers API
# ---------------------------------------------------------------------------

class TestProvidersAPI:

    def test_list_providers(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/providers")
        assert resp.status_code == 200
        data = resp.json()
        providers = data.get("providers", [])
        assert len(providers) >= 1
        # Deterministic provider should always be available
        ids = [p["provider_id"] for p in providers]
        assert "deterministic" in ids


# ---------------------------------------------------------------------------
# 3. Agent Builder API
# ---------------------------------------------------------------------------

class TestAgentBuilderAPI:

    def test_build_agent(self, created_agent: dict):
        """Already verified in fixture, just re-check shape."""
        assert created_agent["name"] == "TestAgent_E2E"
        assert "agent_id" in created_agent
        assert "skills" in created_agent

    def test_list_agents(self, client: httpx.Client, created_agent: dict):
        resp = client.get(f"{AGENT_BUILDER}/agents/list", params={"owner": TEST_OWNER})
        assert resp.status_code == 200
        data = resp.json()
        agents = data.get("agents", [])
        found = any(a["agent_id"] == created_agent["agent_id"] for a in agents)
        assert found, f"Created agent not found in list"

    def test_get_agent_detail(self, client: httpx.Client, created_agent: dict):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("agent_id") == aid or data.get("agent", {}).get("agent_id") == aid

    def test_agent_not_found(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/agents/nonexistent_agent_xyz")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 4. Orchestration (execute goal)
# ---------------------------------------------------------------------------

class TestOrchestration:

    def test_execute_goal(self, client: httpx.Client, created_agent: dict):
        """Execute a goal end-to-end via the deterministic LLM + skill pipeline."""
        aid = created_agent["agent_id"]
        resp = client.post(f"{AGENT_BUILDER}/agents/{aid}/execute", json={
            "goal": "Optimize my portfolio yield across available pools",
            "context": {"portfolio_value": 10000, "current_apy": 5.2},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "steps" in data or "result" in data or "agent_id" in data
        # Should not error
        assert data.get("error") is None or data.get("error") == "", f"Execution error: {data.get('error')}"


# ---------------------------------------------------------------------------
# 5. Performance tracking
# ---------------------------------------------------------------------------

class TestPerformance:

    def test_record_period(self, client: httpx.Client, created_agent: dict):
        aid = created_agent["agent_id"]
        resp = client.post(f"{AGENT_BUILDER}/agents/{aid}/performance/record", json={
            "agent_id": aid,
            "period_id": "period_1",
            "return_bps": 85,
            "volume": 20000,
            "successful_actions": 4,
            "failed_actions": 0,
            "proof_count": 3,
            "max_drawdown_bps": 50,
        })
        assert resp.status_code == 200

    def test_get_performance(self, client: httpx.Client, created_agent: dict):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}/performance")
        assert resp.status_code == 200

    def test_leaderboard(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/leaderboard")
        assert resp.status_code == 200
        data = resp.json()
        assert "leaderboard" in data


# ---------------------------------------------------------------------------
# 6. Witness generation
# ---------------------------------------------------------------------------

class TestWitness:

    def test_reputation_witness(self, client: httpx.Client, created_agent: dict):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}/reputation-witness")
        assert resp.status_code == 200
        data = resp.json()
        # API returns 'witness_inputs' key
        assert "witness_inputs" in data or "witness" in data or "inputs" in data

    def test_performance_witness(self, client: httpx.Client, created_agent: dict):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}/performance-witness")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
