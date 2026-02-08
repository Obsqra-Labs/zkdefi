"""
E2E Test Suite for zkML Model Marketplace

Tests the complete flow:
1. Create composed agent with multiple models
2. Execute agent via LOCAL orchestrator (parallel proof generation)
3. Verify execution results

Architecture:
- All agent/model/orchestration logic runs locally in zkde.fi
- Only STONE proofs call out to obsqra.fi (cloud prover)
"""

import asyncio
import httpx
import pytest
import json
from typing import Dict, Any

# API endpoints - all local to zkde.fi
ZKDEFI_API = "http://localhost:8003"

# Test wallet address (can be any valid Starknet address for testing)
TEST_ADDRESS = "0x04ae7e6efee4a7d5f6f8e3bc51e8ed8f41f20f23969c8e6aa74f5e55c1be8b06"


class TestModelMarketplace:
    """E2E tests for the zkML Model Marketplace."""
    
    @pytest.fixture
    async def client(self):
        async with httpx.AsyncClient(timeout=120.0) as client:
            yield client
    
    @pytest.mark.asyncio
    async def test_list_available_models(self, client):
        """Test listing available zkML models."""
        response = await client.get(f"{ZKDEFI_API}/api/v1/agents/models/list")
        
        assert response.status_code == 200
        data = response.json()
        assert "models" in data
        assert len(data["models"]) > 0
        
        # Verify expected models are present
        model_ids = [m["id"] for m in data["models"]]
        assert "risk_scoring" in model_ids
        assert "correlation_risk" in model_ids
        assert "credit_scoring" in model_ids
        
        print(f"Available models: {model_ids}")
    
    @pytest.mark.asyncio
    async def test_create_composed_agent(self, client):
        """Test creating a composed agent with multiple models."""
        payload = {
            "user_address": TEST_ADDRESS,
            "name": "Test Multi-Model Agent",
            "processors": ["risk_scoring", "correlation_risk", "twap_position"],
            "decision_logic": {"type": "AND"}
        }
        
        response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/create",
            json=payload
        )
        
        assert response.status_code == 200
        agent = response.json()
        
        assert "id" in agent
        assert agent["name"] == "Test Multi-Model Agent"
        assert len(agent["processors"]) == 3
        assert agent["active"] == True
        
        print(f"Created agent: {agent['id']}")
        return agent["id"]
    
    @pytest.mark.asyncio
    async def test_get_user_agents(self, client):
        """Test retrieving user's agents."""
        response = await client.get(f"{ZKDEFI_API}/api/v1/agents/user/{TEST_ADDRESS}")
        
        assert response.status_code == 200
        data = response.json()
        assert "agents" in data
        
        print(f"User has {len(data['agents'])} agents")
    
    @pytest.mark.asyncio
    async def test_execute_composed_agent(self, client):
        """Test executing a composed agent via LOCAL orchestrator."""
        # First create an agent
        create_payload = {
            "user_address": TEST_ADDRESS,
            "name": "Execution Test Agent",
            "processors": ["risk_scoring", "correlation_risk"],
            "decision_logic": {"type": "AND"}
        }
        
        create_response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/create",
            json=create_payload
        )
        assert create_response.status_code == 200
        agent = create_response.json()
        
        # Execute the agent via LOCAL orchestrator (path-based)
        execute_payload = {
            "user_address": TEST_ADDRESS,
            "portfolio": {
                "assets": {"eth": 50000, "usdc": 30000, "strk": 20000},
                "daily_positions": [1000, 1100, 1050, 1200, 1150, 1300, 1250],
            },
            "constraints": {
                "max_risk": 100,
                "max_correlation": 90,
            }
        }
        
        execute_response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/{agent['id']}/execute",
            json=execute_payload
        )
        
        assert execute_response.status_code == 200
        result = execute_response.json()
        
        # New response format from LocalOrchestrator
        assert "should_execute" in result
        assert "processor_results" in result
        assert len(result["processor_results"]) == 2  # Two processors
        
        print(f"Execution result: should_execute={result['should_execute']}")
        print(f"Decision logic: {result['decision_logic']}")
        print(f"Total time: {result['total_time_ms']}ms")
        
        for pr in result["processor_results"]:
            print(f"  - {pr['processor_id']}: passed={pr['passed']}, score={pr['score']}, threshold={pr['threshold']}")
        
        if result.get("execution_calldata"):
            print(f"Execution calldata: {result['execution_calldata'][:5]}...")
    
    @pytest.mark.asyncio
    async def test_execute_with_stone_model(self, client):
        """Test executing an agent with STONE credit scoring (uses obsqra prover)."""
        # Create agent with credit_scoring model (uses STONE via obsqra)
        create_payload = {
            "user_address": TEST_ADDRESS,
            "name": "Credit Scoring Agent",
            "processors": ["credit_scoring"],
            "decision_logic": {"type": "AND"}
        }
        
        create_response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/create",
            json=create_payload
        )
        assert create_response.status_code == 200
        agent = create_response.json()
        
        # Execute via LOCAL orchestrator
        execute_payload = {
            "user_address": TEST_ADDRESS,
            "portfolio": {
                "assets": {"eth": 100000, "strk": 50000}
            },
            "constraints": {
                "min_credit": 400
            }
        }
        
        execute_response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/{agent['id']}/execute",
            json=execute_payload
        )
        
        assert execute_response.status_code == 200
        result = execute_response.json()
        
        assert "processor_results" in result
        assert len(result["processor_results"]) >= 1
        
        credit_result = result["processor_results"][0]
        print(f"Credit scoring result: passed={credit_result['passed']}")
        print(f"Credit score: {credit_result['score']}, threshold: {credit_result['threshold']}")
    
    @pytest.mark.asyncio
    async def test_decision_logic_and(self, client):
        """Test AND decision logic - all processors must pass."""
        create_payload = {
            "user_address": TEST_ADDRESS,
            "name": "AND Logic Test",
            "processors": ["risk_scoring", "correlation_risk"],
            "decision_logic": {"type": "AND"}
        }
        
        create_response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/create",
            json=create_payload
        )
        agent = create_response.json()
        
        execute_payload = {
            "user_address": TEST_ADDRESS,
            "portfolio": {"assets": {"eth": 50000}},
            "constraints": {"max_risk": 100, "max_correlation": 100}
        }
        
        result = (await client.post(
            f"{ZKDEFI_API}/api/v1/agents/{agent['id']}/execute",
            json=execute_payload
        )).json()
        
        # With AND logic, should_execute is True only if all pass
        all_passed = all(p["passed"] for p in result["processor_results"])
        assert result["should_execute"] == all_passed
        print(f"AND logic: all_passed={all_passed}, should_execute={result['should_execute']}")
    
    @pytest.mark.asyncio
    async def test_decision_logic_or(self, client):
        """Test OR decision logic - any processor can pass."""
        create_payload = {
            "user_address": TEST_ADDRESS,
            "name": "OR Logic Test",
            "processors": ["risk_scoring", "correlation_risk"],
            "decision_logic": {"type": "OR"}
        }
        
        create_response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/create",
            json=create_payload
        )
        agent = create_response.json()
        
        execute_payload = {
            "user_address": TEST_ADDRESS,
            "portfolio": {"assets": {"eth": 50000}},
            "constraints": {"max_risk": 50, "max_correlation": 100}  # Risk might fail, correlation should pass
        }
        
        result = (await client.post(
            f"{ZKDEFI_API}/api/v1/agents/{agent['id']}/execute",
            json=execute_payload
        )).json()
        
        # With OR logic, should_execute is True if any pass
        any_passed = any(p["passed"] for p in result["processor_results"])
        assert result["should_execute"] == any_passed
        print(f"OR logic: any_passed={any_passed}, should_execute={result['should_execute']}")
    
    @pytest.mark.asyncio
    async def test_deactivate_agent(self, client):
        """Test deactivating an agent."""
        # Create an agent
        create_response = await client.post(
            f"{ZKDEFI_API}/api/v1/agents/create",
            json={
                "user_address": TEST_ADDRESS,
                "name": "Deactivation Test",
                "processors": ["risk_scoring"],
                "decision_logic": {"type": "AND"}
            }
        )
        agent = create_response.json()
        
        # Deactivate
        delete_response = await client.delete(
            f"{ZKDEFI_API}/api/v1/agents/{agent['id']}?user_address={TEST_ADDRESS}"
        )
        
        assert delete_response.status_code == 200
        assert delete_response.json()["status"] == "deactivated"
        print(f"Agent {agent['id']} deactivated")


async def run_tests():
    """Run all tests manually."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        tests = TestModelMarketplace()
        
        print("=" * 60)
        print("zkML Model Marketplace E2E Tests")
        print("=" * 60)
        
        try:
            print("\n1. Testing list models...")
            await tests.test_list_available_models(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        try:
            print("\n2. Testing create agent...")
            await tests.test_create_composed_agent(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        try:
            print("\n3. Testing get user agents...")
            await tests.test_get_user_agents(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        try:
            print("\n4. Testing execute composed agent...")
            await tests.test_execute_composed_agent(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        try:
            print("\n5. Testing STONE model (credit scoring)...")
            await tests.test_execute_with_stone_model(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        try:
            print("\n6. Testing AND decision logic...")
            await tests.test_decision_logic_and(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        try:
            print("\n7. Testing OR decision logic...")
            await tests.test_decision_logic_or(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        try:
            print("\n8. Testing agent deactivation...")
            await tests.test_deactivate_agent(client)
            print("   PASSED")
        except Exception as e:
            print(f"   FAILED: {e}")
        
        print("\n" + "=" * 60)
        print("Tests complete!")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_tests())
