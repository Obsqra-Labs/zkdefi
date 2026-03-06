#!/usr/bin/env python3
"""
Phase 4A Integration Test Suite
Tests all Phase 4A endpoints and services
"""

import requests
import json
import time
from datetime import datetime

API_URL = "http://localhost:8003/api/v1/phase4a"

def test_contracts_endpoint():
    """Test /contracts endpoint"""
    print("\n📋 Testing /contracts endpoint...")
    response = requests.get(f"{API_URL}/contracts")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert "contracts" in data, "Missing contracts key"
    assert len(data["contracts"]) == 2, f"Expected 2 contracts, got {len(data['contracts'])}"
    print("✅ /contracts endpoint working")
    return data["contracts"]

def test_status_endpoint():
    """Test /status endpoint"""
    print("📋 Testing /status endpoint...")
    response = requests.get(f"{API_URL}/status")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["phase"] == "4A", f"Expected phase 4A, got {data['phase']}"
    print("✅ /status endpoint working")

def test_model_registry_endpoint():
    """Test /model-registry endpoint"""
    print("📋 Testing /model-registry endpoint...")
    response = requests.get(f"{API_URL}/model-registry")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert "status" in data, "Missing status key"
    assert "current_model_hash" in data, "Missing current_model_hash"
    print(f"   Current hash: {data['current_model_hash'][:16]}...")
    print("✅ /model-registry endpoint working")

def test_rebalancer_config_endpoint():
    """Test /rebalancer-config endpoint"""
    print("📋 Testing /rebalancer-config endpoint...")
    response = requests.get(f"{API_URL}/rebalancer-config")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["apy_threshold"] == 5.0, f"Expected APY threshold 5.0, got {data['apy_threshold']}"
    assert data["fee_tier_spread_bps"] == 50, f"Expected fee spread 50, got {data['fee_tier_spread_bps']}"
    assert data["utilization_ratio_threshold"] == 0.8, f"Expected util ratio 0.8, got {data['utilization_ratio_threshold']}"
    assert data["min_rebalance_interval_hours"] == 24, f"Expected min interval 24h, got {data['min_rebalance_interval_hours']}"
    print(f"   APY Threshold: {data['apy_threshold']}%")
    print(f"   Fee Spread: {data['fee_tier_spread_bps']} bps")
    print(f"   Utilization Ratio: {data['utilization_ratio_threshold']}")
    print(f"   Min Interval: {data['min_rebalance_interval_hours']}h")
    print("✅ /rebalancer-config endpoint working")

def test_rebalancer_stats_endpoint():
    """Test /rebalancer/stats endpoint"""
    print("📋 Testing /rebalancer/stats endpoint...")
    response = requests.get(f"{API_URL}/rebalancer/stats")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert "total_rebalances_triggered" in data, "Missing total_rebalances_triggered"
    assert "config" in data, "Missing config"
    print(f"   Total triggers: {data['total_rebalances_triggered']}")
    print("✅ /rebalancer/stats endpoint working")

def test_rebalancer_check_position():
    """Test /rebalancer/check-position endpoint"""
    print("📋 Testing /rebalancer/check-position endpoint...")
    
    # Test case: Position should rebalance (APY improvement > 5%)
    payload = {
        "position_id": "test_pos_001",
        "current_apy": 5.5,
        "optimal_apy": 11.2,
        "current_fee_tier": 500,
        "optimal_fee_tier": 3000,
        "pool_utilization": 0.85,
        "last_rebalance_timestamp": 0
    }
    response = requests.post(f"{API_URL}/rebalancer/check-position", json=payload)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["should_rebalance"] == True, "Expected should_rebalance=True for 5.7% APY improvement"
    assert "reason" in data, "Missing reason"
    assert "APY improvement" in data["reason"], f"Expected APY improvement in reason, got {data['reason']}"
    print(f"   Result: {data['reason']}")
    print("✅ /rebalancer/check-position endpoint working (triggers on APY improvement)")
    
    # Test case: Position should NOT rebalance (APY improvement < 5%)
    payload2 = {
        "position_id": "test_pos_002",
        "current_apy": 10.0,
        "optimal_apy": 12.8,
        "current_fee_tier": 500,
        "optimal_fee_tier": 500,
        "pool_utilization": 0.75,
        "last_rebalance_timestamp": 0
    }
    response2 = requests.post(f"{API_URL}/rebalancer/check-position", json=payload2)
    assert response2.status_code == 200, f"Expected 200, got {response2.status_code}"
    data2 = response2.json()
    assert data2["should_rebalance"] == False, "Expected should_rebalance=False for 2.8% APY improvement (below 5% threshold)"
    print(f"   Result: {data2['reason']}")
    print("✅ /rebalancer/check-position endpoint working (does NOT trigger below threshold)")

def test_rebalancer_history():
    """Test /rebalancer/history endpoint"""
    print("📋 Testing /rebalancer/history endpoint...")
    response = requests.get(f"{API_URL}/rebalancer/history")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert "total_triggers" in data, "Missing total_triggers"
    assert "recent" in data, "Missing recent"
    assert "stats" in data, "Missing stats"
    print(f"   Total triggers: {data['total_triggers']}")
    print("✅ /rebalancer/history endpoint working")

def test_lp_position_creation():
    """Test POST /lp-position/create endpoint"""
    print("📋 Testing POST /lp-position/create endpoint...")
    payload = {
        "user_address": "0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3",
        "position_size": 100.0,
        "garaga_proof": "0x0256065bfdb2a4fa37d7ffb479aec7c7633702b48b736394169ddfff8b9f517df"
    }
    response = requests.post(f"{API_URL}/lp-position/create", json=payload)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["status"] == "ready", f"Expected status 'ready', got {data['status']}"
    assert data["contract"] == "ProofGatedLpAgent", f"Expected ProofGatedLpAgent, got {data['contract']}"
    print(f"   Ready to execute on: {data['contract_address'][:16]}...")
    print("✅ POST /lp-position/create endpoint working")

def test_confidential_transfer():
    """Test POST /transfer/confidential endpoint"""
    print("📋 Testing POST /transfer/confidential endpoint...")
    payload = {
        "from_address": "0x012ebbddae869fbcaee91ecaa936649cc0c75756583ae4ef6521742f963562b3",
        "to_address": "0x0100e1adbb92bb61bf3338a1da17a1bc31022321df2370f4f24a9120fb0e28b3",
        "commitment": "0x0256065bfdb2a4fa37d7ffb479aec7c7633702b48b736394169ddfff8b9f517df",
        "amount_hidden": True
    }
    response = requests.post(f"{API_URL}/transfer/confidential", json=payload)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["status"] == "ready", f"Expected status 'ready', got {data['status']}"
    assert data["contract"] == "ConfidentialTransfer", f"Expected ConfidentialTransfer, got {data['contract']}"
    print(f"   Privacy: {data['privacy']['amount_visibility']}")
    print("✅ POST /transfer/confidential endpoint working")

def run_all_tests():
    """Run all integration tests"""
    print("\n" + "="*60)
    print("PHASE 4A INTEGRATION TEST SUITE")
    print("="*60)
    
    try:
        test_contracts_endpoint()
        test_status_endpoint()
        test_model_registry_endpoint()
        test_rebalancer_config_endpoint()
        test_rebalancer_stats_endpoint()
        test_rebalancer_check_position()
        test_rebalancer_history()
        test_lp_position_creation()
        test_confidential_transfer()
        
        print("\n" + "="*60)
        print("✅ ALL TESTS PASSED")
        print("="*60)
        print("\n📊 Phase 4A Status:")
        print("   ✅ Contracts endpoint: Production ready")
        print("   ✅ Model registry: Active")
        print("   ✅ Autonomous rebalancer: Monitoring positions")
        print("   ✅ Proof-gated LP: Ready to receive positions")
        print("   ✅ Confidential transfer: Ready for private transfers")
        print("\n🚀 Phase 4A fully integrated and operational!\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        return False
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        return False
    
    return True

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
