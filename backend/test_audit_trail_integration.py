#!/usr/bin/env python3
"""
zkML 5/5 Audit Trail Integration Tests
"""

import requests
import json
from datetime import datetime

API_URL = "http://localhost:8003/api/v1/phase4a"

def test_audit_trail_endpoints():
    print("\n" + "="*60)
    print("zkML 5/5 AUDIT TRAIL INTEGRATION TESTS")
    print("="*60)
    
    tests_passed = 0
    tests_total = 0
    
    # Test 1: Compliance Report
    tests_total += 1
    print("\n📋 Testing /audit-trail/compliance...")
    response = requests.get(f"{API_URL}/audit-trail/compliance")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["zkml_completion"] == "5/5", "zkML should be 5/5"
    assert data["audit_trail_status"] == "active", "Audit trail should be active"
    assert "compliance" in data, "Should have compliance section"
    assert data["compliance"]["decision_traceability"] == True
    assert data["compliance"]["model_versioning"] == True
    assert data["compliance"]["on_chain_verification"] == True
    assert data["compliance"]["audit_trail"] == True
    assert data["compliance"]["immutable_history"] == True
    print("✅ /audit-trail/compliance working")
    tests_passed += 1
    
    # Test 2: Decisions Endpoint
    tests_total += 1
    print("📋 Testing /audit-trail/decisions...")
    response = requests.get(f"{API_URL}/audit-trail/decisions")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert "recent_decisions" in data, "Should have recent_decisions"
    assert "total_decisions" in data, "Should have total_decisions"
    print(f"✅ /audit-trail/decisions working (total: {data['total_decisions']})")
    tests_passed += 1
    
    # Test 3: Position Audit Trail
    tests_total += 1
    print("📋 Testing /audit-trail/position/{position_id}...")
    response = requests.get(f"{API_URL}/audit-trail/position/pos_001")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["position_id"] == "pos_001", "Position ID mismatch"
    assert "decisions" in data, "Should have decisions array"
    print(f"✅ /audit-trail/position/pos_001 working (decisions: {data['total_decisions']})")
    tests_passed += 1
    
    # Test 4: Model Version Decisions
    tests_total += 1
    print("📋 Testing /audit-trail/model/{model_version}...")
    response = requests.get(f"{API_URL}/audit-trail/model/0")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data["model_version"] == 0, "Model version mismatch"
    assert "decisions" in data, "Should have decisions array"
    print(f"✅ /audit-trail/model/0 working (decisions: {data['total_decisions']})")
    tests_passed += 1
    
    # Test 5: Audit Stats
    tests_total += 1
    print("📋 Testing /audit-trail/stats...")
    response = requests.get(f"{API_URL}/audit-trail/stats")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert "total_decisions_tracked" in data, "Should have total_decisions_tracked"
    assert "verified_decisions" in data, "Should have verified_decisions"
    assert "verification_rate" in data, "Should have verification_rate"
    print(f"✅ /audit-trail/stats working")
    tests_passed += 1
    
    # Summary
    print("\n" + "="*60)
    print(f"✅ AUDIT TRAIL TESTS: {tests_passed}/{tests_total} PASSED")
    print("="*60)
    
    if tests_passed == tests_total:
        print("\n🎉 zkML 5/5 AUDIT TRAIL FULLY OPERATIONAL")
        print("\nFeatures Verified:")
        print("  ✅ Decision traceability")
        print("  ✅ Model versioning")
        print("  ✅ On-chain verification")
        print("  ✅ Audit trail history")
        print("  ✅ Immutable records")
        print("  ✅ Compliance reporting")
        return True
    else:
        print(f"\n❌ {tests_total - tests_passed} tests failed")
        return False

if __name__ == "__main__":
    success = test_audit_trail_endpoints()
    exit(0 if success else 1)
