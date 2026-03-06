#!/usr/bin/env python3
"""
Seed the decision_events table with realistic synthetic data for cold-start.

This script inserts ~200 events across 5 demo addresses to bootstrap the
creditworthiness model, credit graph, and risk passport analytics.

Usage:
    cd /opt/obsqra.starknet/zkdefi/backend
    python -m scripts.seed_decision_events
"""

import asyncio
import argparse
import hashlib
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Ensure backend is on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg

DATABASE_URL = "postgresql://zkdefi:zkdefi@localhost:5432/zkdefi"

# 5 demo addresses — mix of active and cold
DEMO_ADDRESSES = [
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",  # ETH whale
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",  # STRK holder
    "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",  # USDC user
    "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",  # Active DeFi
    "0x0000000000000000000000000000000000000000000000000000000000000000",  # Demo/zero addr
]

EVENT_TYPES = [
    "deposit", "withdraw", "rebalance", "borrow", "repay",
    "early_exit", "proof_generated", "proof_failed",
    "gate_allow", "gate_block", "gate_advisory",
    "tier_upgrade", "tier_downgrade", "collateral_slash",
]

GATES = ["relayer", "execution", "lending"]
OUTCOMES = ["allow", "block", "advisory", "success", "failure"]
PROOF_MODES = ["EZKL_ONLY", "EZKL_BRIDGE", "FULL_DUAL_PROVER"]
MODEL_NAMES = ["yield_forecaster_v1", "risk_classifier_v1", "timing_predictor_v1", "credit_scorer_v1"]

# Weight event types by realism (deposits more frequent than slashes)
EVENT_WEIGHTS_DEFAULT = {
    "deposit": 25, "withdraw": 15, "rebalance": 12, "borrow": 8,
    "repay": 8, "proof_generated": 10, "gate_allow": 8,
    "gate_advisory": 4, "tier_upgrade": 3, "early_exit": 2,
    "proof_failed": 2, "gate_block": 1, "tier_downgrade": 1,
    "collateral_slash": 1,
}

EVENT_WEIGHTS_BY_PROFILE = {
    "prime": {
        "deposit": 35, "withdraw": 10, "rebalance": 12, "borrow": 6,
        "repay": 12, "proof_generated": 14, "gate_allow": 10,
        "gate_advisory": 4, "tier_upgrade": 6, "early_exit": 1,
        "proof_failed": 1, "gate_block": 1, "tier_downgrade": 0, "collateral_slash": 0,
    },
    "standard": EVENT_WEIGHTS_DEFAULT,
    "risky": {
        "deposit": 10, "withdraw": 18, "rebalance": 8, "borrow": 12,
        "repay": 5, "proof_generated": 5, "gate_allow": 2,
        "gate_advisory": 8, "tier_upgrade": 0, "early_exit": 16,
        "proof_failed": 10, "gate_block": 9, "tier_downgrade": 5, "collateral_slash": 4,
    },
}


def _generated_address(idx: int) -> str:
    """Generate a deterministic synthetic Starknet-like hex address."""
    seed = hashlib.sha256(f"seeded_user_{idx}".encode()).hexdigest()
    return "0x" + seed.rjust(64, "0")


def build_address_set(address_count: int) -> list[str]:
    """Build an address set with at least `address_count` entries."""
    if address_count <= len(DEMO_ADDRESSES):
        return DEMO_ADDRESSES[:address_count]
    out = list(DEMO_ADDRESSES)
    i = 0
    while len(out) < address_count:
        addr = _generated_address(i)
        if addr not in out:
            out.append(addr)
        i += 1
    return out


def weighted_event_type(profile: str = "standard") -> str:
    profile_weights = EVENT_WEIGHTS_BY_PROFILE.get(profile, EVENT_WEIGHTS_DEFAULT)
    population = list(profile_weights.keys())
    weights = list(profile_weights.values())
    return random.choices(population, weights=weights, k=1)[0]


def generate_event(addr: str, base_time: datetime, offset_hours: int, profile: str = "standard") -> dict:
    etype = weighted_event_type(profile)
    ts = base_time + timedelta(hours=offset_hours, minutes=random.randint(0, 59))

    gate = None
    outcome = "success"
    value_eth = 0.0
    proof_mode = None
    model_name = None
    model_hash = None
    metadata: dict = {}

    if profile == "prime":
        volume_min, volume_max = 0.2, 20.0
    elif profile == "risky":
        volume_min, volume_max = 0.001, 3.0
    else:
        volume_min, volume_max = 0.01, 10.0

    if etype.startswith("gate_"):
        gate = random.choice(GATES)
        outcome = etype.replace("gate_", "")  # allow, block, advisory
        value_eth = round(random.uniform(volume_min, max(5.0, volume_max)), 4)
        model_name = random.choice(MODEL_NAMES)
        model_hash = f"0x{random.getrandbits(128):032x}"
        proof_mode = random.choice(PROOF_MODES)
        metadata = {"risk_score": round(random.uniform(20, 95), 1), "tier": random.randint(1, 5)}
    elif etype in ("deposit", "withdraw", "borrow", "repay", "early_exit"):
        value_eth = round(random.uniform(volume_min, volume_max), 4)
        outcome = "success"
        if etype == "withdraw" and random.random() < (0.02 if profile == "prime" else 0.08 if profile == "risky" else 0.05):
            outcome = "failure"
        metadata = {"pool": random.choice(["ETH/USDC", "STRK/ETH", "USDC/USDT", "ETH/STRK"])}
    elif etype == "rebalance":
        value_eth = round(random.uniform(max(0.05, volume_min), min(8.0, volume_max)), 4)
        success_prob = 0.97 if profile == "prime" else 0.8 if profile == "risky" else 0.92
        outcome = "success" if random.random() < success_prob else "failure"
        model_name = random.choice(["timing_predictor_v1", "yield_forecaster_v1"])
        proof_mode = random.choice(PROOF_MODES)
        metadata = {"from_tick": random.randint(-100, 100), "to_tick": random.randint(-100, 100)}
    elif etype == "proof_generated":
        outcome = "success"
        proof_mode = random.choice(PROOF_MODES)
        model_name = random.choice(MODEL_NAMES)
        model_hash = f"0x{random.getrandbits(128):032x}"
        metadata = {"circuit": random.choice(["ModelBridge", "RobustnessCertificate", "RebalanceTimingCommitment"])}
    elif etype == "proof_failed":
        outcome = "failure"
        proof_mode = random.choice(PROOF_MODES)
        model_name = random.choice(MODEL_NAMES)
        metadata = {"error": random.choice(["timeout", "constraint_unsatisfied", "witness_gen_failed"])}
    elif etype == "tier_upgrade":
        outcome = "success"
        metadata = {"from_tier": random.randint(1, 4), "to_tier": random.randint(2, 5)}
    elif etype == "tier_downgrade":
        outcome = "advisory"
        metadata = {"from_tier": random.randint(2, 5), "to_tier": random.randint(1, 4)}
    elif etype == "collateral_slash":
        value_eth = round(random.uniform(0.01, 2.0 if profile != "prime" else 0.5), 4)
        outcome = "block"
        metadata = {"reason": "liquidation_threshold_breached"}

    metadata["profile"] = profile

    return {
        "user_address": addr.lower(),
        "event_type": etype,
        "gate": gate,
        "outcome": outcome,
        "value_eth": value_eth,
        "proof_mode": proof_mode,
        "model_name": model_name,
        "model_hash": model_hash,
        "metadata": json.dumps(metadata),
        "created_at": ts,
    }


async def seed(count_per_address: int = 40, address_count: int = 5, seed_value: int = 42):
    random.seed(seed_value)
    addresses = build_address_set(max(1, address_count))

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Clear existing seed data (idempotent)
        await conn.execute("DELETE FROM decision_events WHERE metadata::text LIKE '%seeded%' OR metadata::text LIKE '%\"seeded\": true%'")

        base_time = datetime.now(timezone.utc) - timedelta(days=30)
        inserted = 0

        profile_cycle = ["prime", "standard", "risky"]
        for idx, addr in enumerate(addresses):
            profile = profile_cycle[idx % len(profile_cycle)]
            for i in range(count_per_address):
                if profile == "prime":
                    offset = i * 18 + random.randint(0, 6)
                elif profile == "standard":
                    offset = i * 10 + random.randint(0, 4)
                else:
                    offset = i * 2 + random.randint(0, 1)
                ev = generate_event(addr, base_time, offset_hours=offset, profile=profile)
                # Mark as seeded for easy cleanup
                meta = json.loads(ev["metadata"])
                meta["seeded"] = True
                ev["metadata"] = json.dumps(meta)

                await conn.execute(
                    """
                    INSERT INTO decision_events
                        (user_address, event_type, gate, outcome, value_eth,
                         proof_mode, model_name, model_hash, metadata, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
                    """,
                    ev["user_address"], ev["event_type"], ev["gate"], ev["outcome"],
                    ev["value_eth"], ev["proof_mode"], ev["model_name"], ev["model_hash"],
                    ev["metadata"], ev["created_at"],
                )
                inserted += 1

        # Also seed a couple of credit_graph_edges
        await conn.execute("DELETE FROM credit_graph_edges WHERE last_updated < NOW() - INTERVAL '29 days'")
        pools = ["ETH/USDC", "STRK/ETH", "USDC/USDT"]
        for i in range(len(addresses) - 1):
            a, b = addresses[i], addresses[i + 1]
            pool = pools[i % len(pools)]
            overlap = round(random.uniform(24, 720), 1)
            tvl = round(random.uniform(0.5, 20.0), 4)
            await conn.execute(
                """
                INSERT INTO credit_graph_edges (user_a, user_b, pool_id, overlap_hours, combined_tvl, weight, first_overlap)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_a, user_b, pool_id) DO UPDATE SET
                    weight = EXCLUDED.weight, overlap_hours = EXCLUDED.overlap_hours,
                    combined_tvl = EXCLUDED.combined_tvl, last_updated = NOW()
                """,
                a.lower(), b.lower(), pool, overlap, tvl,
                round(overlap * tvl, 2),
                base_time + timedelta(days=random.randint(0, 10)),
            )
            inserted += 1

        # Refresh materialized view
        await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY user_behavior_stats")

        print(f"✓ Seeded {inserted} records across {len(addresses)} addresses")

        # Show summary
        row = await conn.fetchrow("SELECT COUNT(*) as cnt FROM decision_events")
        print(f"  Total decision_events: {row['cnt']}")
        row = await conn.fetchrow("SELECT COUNT(*) as cnt FROM credit_graph_edges")
        print(f"  Total credit_graph_edges: {row['cnt']}")
        row = await conn.fetchrow("SELECT COUNT(*) as cnt FROM user_behavior_stats")
        print(f"  Total user_behavior_stats: {row['cnt']}")

    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed decision_events for ML cold-start.")
    parser.add_argument("--count-per-address", type=int, default=40, help="Events to generate per address (default: 40)")
    parser.add_argument("--address-count", type=int, default=5, help="How many addresses to seed (default: 5)")
    parser.add_argument("--seed", type=int, default=42, help="PRNG seed for deterministic output (default: 42)")
    args = parser.parse_args()
    asyncio.run(
        seed(
            count_per_address=max(1, args.count_per_address),
            address_count=max(1, args.address_count),
            seed_value=args.seed,
        )
    )
