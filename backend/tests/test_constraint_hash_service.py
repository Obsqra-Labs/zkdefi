import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.constraint_hash_service import compute_constraint_hash


def test_deterministic_hash():
    policy = {
        "max_position_wei": 1_000_000_000_000_000_000,
        "risk_tolerance": 50,
        "approved_adapters_mask": 0b111,
        "max_single_adapter_pct": 60,
        "cooldown_seconds": 43200,
        "session_duration_hours": 24,
    }
    h1 = compute_constraint_hash(policy)
    h2 = compute_constraint_hash(policy)
    assert h1 == h2
    assert isinstance(h1, int)
    assert h1 > 0


def test_different_policies_differ():
    p1 = {
        "max_position_wei": 1_000_000_000_000_000_000,
        "risk_tolerance": 30,
        "approved_adapters_mask": 0b111,
        "max_single_adapter_pct": 60,
        "cooldown_seconds": 43200,
        "session_duration_hours": 24,
    }
    p2 = {**p1, "risk_tolerance": 70}
    assert compute_constraint_hash(p1) != compute_constraint_hash(p2)


def test_felt252_range():
    policy = {"max_position_wei": 10**18, "risk_tolerance": 50}
    h = compute_constraint_hash(policy)
    assert 0 < h < 2**251
