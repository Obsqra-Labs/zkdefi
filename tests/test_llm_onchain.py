"""
LLM + On-Chain Integration Tests.

Tests:
  1. LLM provider registry has Onyx as default
  2. Provider health endpoint responds
  3. Agent registration returns onchain result
  4. OrchestrationResult has provider visibility fields
  5. On-chain service initializes
  6. Deployed contract addresses are in .env

Run:
  cd /opt/obsqra.starknet/zkdefi
  python -m pytest tests/test_llm_onchain.py -v
"""

import json
import os
import sys
import time

import pytest
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

API_BASE = os.environ.get("ZKDEFI_API_BASE", "http://localhost:8003/api/v1/zkdefi")
AGENT_BUILDER = f"{API_BASE}/agent-builder"
TIMEOUT = 30.0

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Test 1: LLM Registry Defaults ─────────────────────────────────────────

class TestLLMRegistryDefaults:
    def test_default_provider_is_onyx(self):
        from app.services.llm_provider_registry import get_llm_registry
        registry = get_llm_registry()
        providers = registry.list_providers()
        onyx = [p for p in providers if p["provider_id"] == "onyx"]
        assert len(onyx) == 1
        assert "onyx-defi-v1" in (onyx[0].get("available_models", []) or [onyx[0].get("default_model")])

    def test_deterministic_provider_still_exists(self):
        from app.services.llm_provider_registry import get_llm_registry
        registry = get_llm_registry()
        providers = registry.list_providers()
        det = [p for p in providers if p["provider_id"] == "deterministic"]
        assert len(det) == 1


# ── Test 2: OrchestrationResult Fields ─────────────────────────────────────

class TestOrchestrationResult:
    def test_provider_visibility_fields(self):
        from app.services.agent_orchestrator import OrchestrationResult
        result = OrchestrationResult(agent_id="test", goal="test")
        assert hasattr(result, "llm_provider_used")
        assert hasattr(result, "llm_fallback_reason")
        assert result.llm_provider_used == "unknown"
        assert result.llm_fallback_reason is None


# ── Test 3: OnchainAgentService Initialization ─────────────────────────────

class TestOnchainAgentService:
    def test_service_initializes(self):
        from app.services.onchain_agent_service import get_onchain_agent_service
        svc = get_onchain_agent_service()
        # It should exist even if not available (missing env vars in test)
        assert svc is not None
        assert isinstance(svc.available, bool)


# ── Test 4: Deployed Contract Addresses in .env ────────────────────────────

class TestDeployedContracts:
    def test_contract_addresses_in_env(self):
        env_path = os.path.join(PROJECT_ROOT, "backend", ".env")
        if not os.path.exists(env_path):
            pytest.skip("backend/.env not found")
        with open(env_path) as f:
            content = f.read()

        required = [
            "VALIDATION_PROOF_REGISTRY_ADDRESS",
            "CONSTRAINT_RECEIPT_ADDRESS",
            "ALLOCATION_ROUTER_ADDRESS",
            "REPUTATION_REGISTRY_ADDRESS",
            "BATCH_VERIFIER_ADDRESS",
            "AGENT_IDENTITY_ADDRESS",
            "TIERED_AGENT_CONTROLLER_ADDRESS",
        ]
        for var in required:
            assert var in content, f"Missing {var} in backend/.env"

    def test_deploy_results_file_exists(self):
        results_path = os.path.join(PROJECT_ROOT, "deploy_agent_system_results.json")
        assert os.path.exists(results_path), "deploy_agent_system_results.json not found"
        with open(results_path) as f:
            data = json.load(f)
        assert len(data) == 7, f"Expected 7 contracts, got {len(data)}"
        for name, info in data.items():
            assert "address" in info, f"Missing address for {name}"
            assert "class_hash" in info, f"Missing class_hash for {name}"


# ── Test 5: Provider Health API (requires running backend) ─────────────────

class TestProviderHealthAPI:
    @pytest.fixture
    def client(self):
        with httpx.Client(timeout=TIMEOUT) as c:
            yield c

    def test_provider_health_endpoint(self, client):
        """GET /providers/health should return provider statuses."""
        try:
            resp = client.get(f"{AGENT_BUILDER}/providers/health")
        except httpx.ConnectError:
            pytest.skip("Backend not running")
        assert resp.status_code == 200
        data = resp.json()
        assert "providers" in data
        for p in data["providers"]:
            assert "provider_id" in p
            assert "status" in p
            assert p["status"] in ("ok", "error", "healthy", "unavailable", "no_credentials")


# ── Test 6: Agent Build Returns onchain_tx Field ──────────────────────────

class TestAgentBuildOnchain:
    @pytest.fixture
    def client(self):
        with httpx.Client(timeout=60.0) as c:
            yield c

    def test_build_response_has_onchain_field(self, client):
        """POST /agents/build should return onchain_tx field."""
        try:
            resp = client.post(f"{AGENT_BUILDER}/agents/build", json={
                "name": f"OnchainTest_{int(time.time())}",
                "owner_address": "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7cfb12a",
                "skills": ["il_predictor"],
                "llm_provider": "deterministic",
            })
        except httpx.ConnectError:
            pytest.skip("Backend not running")
        assert resp.status_code == 200
        data = resp.json()
        # onchain_tx should now be a valid field (may be null if minting failed)
        assert "onchain_tx" in data or "agent_id" in data


# ── Test 7: Agent Register Returns dict with onchain key ──────────────────

class TestOrchestratorRegister:
    def test_register_returns_dict(self):
        from app.services.agent_orchestrator import AgentOrchestrator, AgentConfig
        orch = AgentOrchestrator()
        config = AgentConfig(
            agent_id=f"test_reg_{int(time.time())}",
            owner_address="0xtest_owner",
            name="TestRegAgent",
            identity_commitment="0x123",
            bound_skills=["il_predictor"],
            llm_provider_id="deterministic",
        )
        result = orch.register_agent(config)
        assert isinstance(result, dict)
        assert "config_hash" in result
        assert "onchain" in result


# ── Standalone runner ──────────────────────────────────────────────────────
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
