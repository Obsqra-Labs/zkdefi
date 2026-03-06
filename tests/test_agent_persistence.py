"""
Agent Persistence Tests — Verifies SQLite-backed agent store.

Tests:
  1. Save + retrieve agent
  2. List agents (with owner filter)
  3. Update agent fields
  4. Delete agent
  5. LLM binding persistence
  6. Performance period persistence
  7. Concurrent write safety
  8. Restart survival (new instance reads old data)

Run:
  cd /opt/obsqra.starknet/zkdefi
  python -m pytest tests/test_agent_persistence.py -v
"""

import hashlib
import json
import os
import sys
import threading
import time
import uuid

import pytest

# Ensure backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


@pytest.fixture(scope="module")
def store():
    """Create a temporary AgentStore using a fresh temp DB."""
    import tempfile
    from app.services.agent_store import AgentStore

    db_path = os.path.join(tempfile.mkdtemp(), "test_agents.db")
    s = AgentStore(db_path=db_path)
    yield s
    # Cleanup
    try:
        os.unlink(db_path)
    except Exception:
        pass


def _make_agent(suffix: str = "", owner: str = "0xtest") -> dict:
    aid = hashlib.sha256(f"test_agent_{suffix}_{uuid.uuid4().hex[:8]}".encode()).hexdigest()[:16]
    return {
        "agent_id": aid,
        "owner_address": owner,
        "name": f"TestAgent_{suffix}",
        "identity_commitment": f"0x{aid}",
        "reputation_tier": 0,
        "bound_skills": ["il_predictor", "yield_optimality"],
        "llm_provider_id": "onyx",
        "llm_model": "onyx-defi-v1",
        "active": True,
    }


# ── Test 1: Save + Retrieve ────────────────────────────────────────────────

class TestSaveRetrieve:
    def test_save_and_get_agent(self, store):
        agent = _make_agent("save_get")
        store.save_agent(agent)
        retrieved = store.get_agent(agent["agent_id"])
        assert retrieved is not None
        assert retrieved["name"] == agent["name"]
        assert retrieved["owner_address"] == agent["owner_address"]
        assert retrieved["agent_id"] == agent["agent_id"]
        assert retrieved["llm_model"] == "onyx-defi-v1"

    def test_get_nonexistent_returns_none(self, store):
        assert store.get_agent("nonexistent_id_12345") is None


# ── Test 2: List Agents ────────────────────────────────────────────────────

class TestListAgents:
    def test_list_all(self, store):
        a1 = _make_agent("list1", owner="0xowner_list")
        a2 = _make_agent("list2", owner="0xowner_list")
        store.save_agent(a1)
        store.save_agent(a2)
        agents = store.list_agents()
        ids = [a["agent_id"] for a in agents]
        assert a1["agent_id"] in ids
        assert a2["agent_id"] in ids

    def test_list_by_owner(self, store):
        a1 = _make_agent("owner_a", owner="0xowner_A")
        a2 = _make_agent("owner_b", owner="0xowner_B")
        store.save_agent(a1)
        store.save_agent(a2)
        filtered = store.list_agents(owner="0xowner_A")
        ids = [a["agent_id"] for a in filtered]
        assert a1["agent_id"] in ids
        assert a2["agent_id"] not in ids


# ── Test 3: Update Agent ───────────────────────────────────────────────────

class TestUpdateAgent:
    def test_update_fields(self, store):
        agent = _make_agent("update")
        store.save_agent(agent)
        # Update name and tier
        store.update_agent(agent["agent_id"], {"name": "UpdatedName", "reputation_tier": 2})
        updated = store.get_agent(agent["agent_id"])
        assert updated["name"] == "UpdatedName"
        assert updated["reputation_tier"] == 2


# ── Test 4: Delete Agent ───────────────────────────────────────────────────

class TestDeleteAgent:
    def test_delete_agent(self, store):
        agent = _make_agent("delete")
        store.save_agent(agent)
        assert store.get_agent(agent["agent_id"]) is not None
        store.delete_agent(agent["agent_id"])
        assert store.get_agent(agent["agent_id"]) is None


# ── Test 5: LLM Binding Persistence ───────────────────────────────────────

class TestLLMBindings:
    def test_save_and_list_bindings(self, store):
        agent = _make_agent("binding")
        store.save_agent(agent)
        store.save_binding(agent["agent_id"], "onyx", "hash_abc123")
        bindings = store.list_bindings()
        assert agent["agent_id"] in bindings
        assert bindings[agent["agent_id"]] == "onyx"


# ── Test 6: Performance Period Persistence ─────────────────────────────────

class TestPerformancePeriods:
    def test_save_and_get_periods(self, store):
        agent = _make_agent("perf")
        store.save_agent(agent)
        store.save_performance_period({
            "agent_id": agent["agent_id"],
            "period_id": "p1",
            "return_bps": 150,
            "success": True,
            "proof_verified": True,
            "timestamp": time.time(),
        })
        periods = store.get_performance_periods(agent["agent_id"])
        assert len(periods) >= 1
        assert periods[0]["return_bps"] == 150

    def test_get_all_performance(self, store):
        all_perf = store.get_all_performance()
        assert isinstance(all_perf, dict)


# ── Test 7: Concurrent Write Safety ───────────────────────────────────────

class TestConcurrentWrites:
    def test_concurrent_saves(self, store):
        errors = []

        def save_agent(idx):
            try:
                agent = _make_agent(f"concurrent_{idx}")
                store.save_agent(agent)
            except Exception as e:
                errors.append(str(e))

        threads = [threading.Thread(target=save_agent, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0, f"Concurrent writes failed: {errors}"


# ── Test 8: Restart Survival ──────────────────────────────────────────────

class TestRestartSurvival:
    def test_new_instance_reads_old_data(self, store):
        from app.services.agent_store import AgentStore

        agent = _make_agent("restart")
        store.save_agent(agent)

        # Create a second store instance pointing to the same DB
        store2 = AgentStore(db_path=store._db_path)
        retrieved = store2.get_agent(agent["agent_id"])
        assert retrieved is not None
        assert retrieved["name"] == agent["name"]


# ── Standalone runner ──────────────────────────────────────────────────────
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
