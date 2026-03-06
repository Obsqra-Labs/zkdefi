"""
Tests for Deployments API - Execute strategies to on-chain pools
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


class TestDeploymentExecution:
    """Test deployment execution endpoint"""

    def test_execute_deployment_basic(self):
        """Test basic deployment execution"""
        response = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0x1234567890abcdef",
                "risk_profile": "balanced",
                "total_amount": 5000.0,
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "deployment_id" in data
        assert data["user_address"] == "0x1234567890abcdef"
        assert data["risk_profile"] == "balanced"
        assert data["total_amount"] == 5000.0

        # Validate pool deployments
        assert "pool_deployments" in data
        assert len(data["pool_deployments"]) > 0

        # Validate on-chain calls
        assert "on_chain_calls" in data
        assert len(data["on_chain_calls"]) > 0
        assert len(data["on_chain_calls"]) == len(data["pool_deployments"])

        # Validate proofs
        assert "allocation_proof" in data
        assert data["allocation_proof"].startswith("0x")
        assert "circuit_type" in data

        print(f"Deployment ID: {data['deployment_id']}")
        print(f"Pools: {len(data['pool_deployments'])}")
        print(f"Proof: {data['allocation_proof'][:16]}...")

    def test_execute_conservative_profile(self):
        """Test conservative profile allocation"""
        response = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xconservative",
                "risk_profile": "conservative",
                "total_amount": 1000.0,
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Conservative should have Vesu lending
        protocols = [p["protocol"] for p in data["pool_deployments"]]
        assert "Vesu" in protocols

        # Should have lending allocation
        vesu_allocation = sum(
            p["amount_usdc"]
            for p in data["pool_deployments"]
            if p["protocol"] == "Vesu"
        )
        assert vesu_allocation > 0

        print(f"Conservative allocation: {[(p['pool_id'], p['amount_usdc']) for p in data['pool_deployments']]}")

    def test_execute_aggressive_profile(self):
        """Test aggressive profile allocation"""
        response = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xaggressive",
                "risk_profile": "aggressive",
                "total_amount": 10000.0,
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Aggressive should focus on LPs
        protocols = [p["protocol"] for p in data["pool_deployments"]]
        assert "Ekubo" in protocols

        # Should have LP allocation
        ekubo_allocation = sum(
            p["amount_usdc"]
            for p in data["pool_deployments"]
            if p["protocol"] == "Ekubo"
        )
        assert ekubo_allocation > 0

        print(f"Aggressive allocation: {[(p['pool_id'], p['amount_usdc']) for p in data['pool_deployments']]}")

    def test_execute_with_explicit_allocation(self):
        """Test deployment with explicit allocation"""
        response = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xexplicit",
                "risk_profile": "balanced",
                "total_amount": 2000.0,
                "allocation": {
                    "ekubo_eth_usdc": 0.5,
                    "vesu_usdc": 0.5,
                },
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Should match provided allocation
        assert len(data["pool_deployments"]) <= 2

    def test_execute_invalid_allocation_sum(self):
        """Reject invalid allocation"""
        response = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xinvalid",
                "risk_profile": "balanced",
                "total_amount": 1000.0,
                "allocation": {
                    "pool_a": 0.4,
                    "pool_b": 0.4,  # Sum = 80%
                },
            },
        )

        assert response.status_code == 400
        data = response.json()
        assert "sum to 100%" in data["detail"]

    def test_on_chain_calls_structure(self):
        """Validate on-chain calls structure"""
        response = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xtest_structure",
                "risk_profile": "balanced",
                "total_amount": 1000.0,
            },
        )

        assert response.status_code == 200
        data = response.json()

        for call in data["on_chain_calls"]:
            # Validate structure
            assert "contract_address" in call
            assert "entrypoint" in call
            assert "calldata" in call

            # Validate contract address format (Starknet felt)
            addr = call["contract_address"]
            assert addr.startswith("0x")

            # Validate calldata is list of strings
            assert isinstance(call["calldata"], list)
            for item in call["calldata"]:
                assert isinstance(item, str)

            print(
                f"Call: {call['entrypoint']} @ {call['contract_address'][:10]}... "
                f"({len(call['calldata'])} params)"
            )

    def test_pool_deployment_amounts(self):
        """Validate pool deployment amounts"""
        total = 5000.0
        response = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xtest_amounts",
                "risk_profile": "balanced",
                "total_amount": total,
            },
        )

        assert response.status_code == 200
        data = response.json()

        # Sum of amounts should equal total
        allocated_sum = sum(p["amount_usdc"] for p in data["pool_deployments"])
        assert allocated_sum == pytest.approx(total, rel=0.01)

    def test_proof_includes_allocation(self):
        """Proof hash should change with allocation"""
        response1 = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xprooftest1",
                "risk_profile": "conservative",
                "total_amount": 1000.0,
            },
        )

        response2 = client.post(
            "/api/v1/deployments/execute",
            json={
                "user_address": "0xprooftest2",  # Different user
                "risk_profile": "conservative",
                "total_amount": 1000.0,
            },
        )

        data1 = response1.json()
        data2 = response2.json()

        # Different users should have different proofs
        assert data1["allocation_proof"] != data2["allocation_proof"]

    def test_deployment_id_unique(self):
        """Each deployment should have unique ID"""
        ids = []

        for i in range(3):
            response = client.post(
                "/api/v1/deployments/execute",
                json={
                    "user_address": f"0xuserdeployid{i}",
                    "risk_profile": "balanced",
                    "total_amount": 1000.0,
                },
            )

            data = response.json()
            ids.append(data["deployment_id"])

        # All should be unique
        assert len(set(ids)) == 3


class TestDeploymentHealth:
    """Test health check"""

    def test_health_check(self):
        """Test deployment health endpoint"""
        response = client.get("/api/v1/deployments/health")
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "healthy"
        assert "circuit_type" in data
        assert "proofs_cached" in data
