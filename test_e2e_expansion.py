#!/usr/bin/env python3
"""
E2E Test — Ekubo Multi-Strategy Expansion
==========================================
Tests the full pipeline: models → guard → oracle → adapters → workers → API

Steps:
  1.  ActionIntent + GuardResult models (unit)
  2.  VaultPolicy expansion fields (unit)
  3.  Execution guard — all 8 checks (unit)
  4.  Oracle adapter — real Ekubo API spot price (live)
  5.  LP recenter adapter — should_recenter logic vs. live positions (live)
  6.  LP recenter calldata builder (unit)
  7.  Limit orders adapter — build + record (unit)
  8.  Guard wired into vault_execute_service (integration)
  9.  LP Recenter Worker — single live cycle (live, shadow=off prints intent)
  10. Limit Grid Worker — single live cycle (live, shadow=off prints intent)
  11. API: GET /guard-status (HTTP)
  12. API: POST /guard-check (HTTP)
  13. API: GET /limit-orders/active (HTTP)

Usage:
  cd /opt/obsqra.starknet/zkdefi
  source backend/venv/bin/activate
  python test_e2e_expansion.py
"""
import asyncio
import json
import math
import os
import sys
import time
import traceback

# Ensure imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import httpx

# ── Styling ───────────────────────────────────────────────────────────────────
PASS  = "\033[92m✓ PASS\033[0m"
FAIL  = "\033[91m✗ FAIL\033[0m"
SKIP  = "\033[93m⊘ SKIP\033[0m"
INFO  = "\033[94mℹ\033[0m"

results: list[tuple[str, bool, str]] = []

def step(num: int, title: str):
    print(f"\n{'═'*70}")
    print(f"  Step {num}: {title}")
    print(f"{'═'*70}")

def record(name: str, ok: bool, detail: str = ""):
    tag = PASS if ok else FAIL
    print(f"  {tag}  {name}  {detail}")
    results.append((name, ok, detail))


# ── Backend URL ───────────────────────────────────────────────────────────────
API = "http://localhost:8003/api/v1/strategies"
VAULT = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"


# ═══════════════════════════════════════════════════════════════════════════════
async def main():
    print("\n🚀  E2E Test — Ekubo Multi-Strategy Expansion")
    print(f"    {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n")

    # ──────────────────────────────────────────────────────────────────────
    # 1. ActionIntent + GuardResult models
    # ──────────────────────────────────────────────────────────────────────
    step(1, "ActionIntent + GuardResult dataclasses")
    try:
        from app.models.action_intent import ActionIntent, GuardResult

        intent = ActionIntent(
            user_address="0xABC",
            strategy="lp_recenter",
            calldata_bundle=[{"contract": "0x1", "entrypoint": "mint", "calldata": []}],
            expected_edge_bps=15,
            notional_wei=50 * 10**18,
            metadata={"test": True},
        )
        h = intent.intent_hash()
        d = intent.to_dict()
        assert h.startswith("0x") and len(h) == 66, f"bad hash: {h}"
        assert d["strategy"] == "lp_recenter"
        assert d["expected_edge_bps"] == 15
        record("ActionIntent create + hash", True, f"hash={h[:18]}…")

        gr = GuardResult(allowed=True, reason="ok", policy_hash="0x1", checks={"a": True})
        assert gr.to_dict()["allowed"] is True
        record("GuardResult create + to_dict", True)
    except Exception as e:
        record("ActionIntent / GuardResult", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 2. VaultPolicy expansion fields
    # ──────────────────────────────────────────────────────────────────────
    step(2, "VaultPolicy expansion fields in defaults")
    try:
        from app.services.vault_policy_service import get_vault_policy_service, VaultPolicyService

        svc = get_vault_policy_service()
        policy = svc.get_policy(VAULT, create_if_missing=True)
        ep = policy.get("execution_policy", {})

        new_fields = ["allowed_strategies", "min_expected_edge_bps", "max_oracle_age_sec",
                       "max_daily_notional_wei", "max_trade_notional_wei"]
        for f in new_fields:
            val = ep.get(f)
            record(f"  policy.execution_policy.{f}", val is not None, f"= {val}")

        p_hash = VaultPolicyService.policy_hash(policy)
        record("policy_hash()", p_hash.startswith("0x"), p_hash[:24] + "…")
    except Exception as e:
        record("VaultPolicy expansion", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 3. Execution guard — all 8 checks
    # ──────────────────────────────────────────────────────────────────────
    step(3, "Execution guard — 8 deterministic checks")
    try:
        from app.services import execution_guard
        from app.models.action_intent import ActionIntent

        # Normal intent → should pass
        intent = ActionIntent(user_address=VAULT, strategy="lp_recenter", notional_wei=1_000_000)
        g = execution_guard.check(intent)
        record("Guard ALLOW (normal intent)", g.allowed, f"checks={list(g.checks.keys())}")
        expected_checks = ["emergency_pause", "strategy_allowed", "strategy_in_allowlist",
                           "cooldown", "daily_notional", "trade_notional", "min_edge", "policy_hash_match"]
        for c in expected_checks:
            record(f"  check.{c}", c in g.checks, f"= {g.checks.get(c)}")

        # Wrong policy hash → should block
        intent2 = ActionIntent(user_address=VAULT, strategy="lp_recenter", policy_hash="0xDEAD")
        g2 = execution_guard.check(intent2)
        record("Guard BLOCK (wrong policy_hash)", not g2.allowed, g2.reason)

        # Unknown strategy → should pass (default allow for unknown)
        intent3 = ActionIntent(user_address=VAULT, strategy="manual")
        g3 = execution_guard.check(intent3)
        record("Guard ALLOW (manual strategy)", g3.allowed, g3.reason)

        # Record execution + verify cooldown
        execution_guard.record_execution(intent)
        intent4 = ActionIntent(user_address=VAULT, strategy="lp_recenter")
        g4 = execution_guard.check(intent4)
        record("Guard BLOCK (cooldown)", not g4.allowed and "cooldown" in g4.reason, g4.reason)

        # Status query
        status = execution_guard.get_guard_status(VAULT)
        record("get_guard_status()", "daily_notional_spent_wei" in status, f"spent={status.get('daily_notional_spent_wei')}")

    except Exception as e:
        record("Execution guard", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 4. Oracle adapter — real Ekubo spot price
    # ──────────────────────────────────────────────────────────────────────
    step(4, "Oracle adapter — live Ekubo API price fetch")
    spot_price = None
    current_tick = None
    try:
        from app.services.ekubo.oracle_adapter import (
            get_spot_price, get_twap, is_oracle_fresh, get_spot_oracle_divergence,
        )
        from app.services.ekubo_executor import price_to_tick

        spot_price = await get_spot_price()
        record("get_spot_price()", spot_price is not None and spot_price > 0, f"STRK/ETH = {spot_price}")

        if spot_price:
            current_tick = price_to_tick(spot_price)
            record("price_to_tick()", True, f"tick = {current_tick}")

        twap = await get_twap()
        record("get_twap()", twap is not None, f"twap = {twap}")

        fresh = await is_oracle_fresh(max_age_sec=30)
        record("is_oracle_fresh(30s)", fresh, "")

        div = await get_spot_oracle_divergence()
        record("get_spot_oracle_divergence()", div is not None, f"divergence = {div:.6f}" if div else "N/A")

    except Exception as e:
        record("Oracle adapter", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 5. LP recenter adapter — should_recenter vs. live positions
    # ──────────────────────────────────────────────────────────────────────
    step(5, "LP recenter adapter — decision logic on real positions")
    try:
        from app.services.ekubo.lp_recenter_adapter import (
            should_recenter, get_recenterable_positions, compute_new_bounds,
        )

        if current_tick is None:
            record("LP recenter decision", False, "No current tick (oracle failed)")
        else:
            # Load all positions and test each
            positions = json.loads(open("backend/data/ekubo_positions.json").read()).get("positions", [])
            print(f"  {INFO}  {len(positions)} positions loaded, current_tick={current_tick}")
            for pos in positions:
                nft = pos.get("nft_id", "?")
                lt, ut = pos.get("lower_tick", 0), pos.get("upper_tick", 0)
                need, reason = should_recenter(pos, current_tick)
                tag = "⚠️ RECENTER" if need else "✅ OK"
                print(f"    NFT {nft}  [{lt}, {ut}]  tick={current_tick}  → {tag}  {reason}")
                record(f"  NFT {nft} should_recenter", True, f"need={need} — {reason}")

            # Recenterable summary
            candidates = get_recenterable_positions(current_tick)
            record("get_recenterable_positions()", True, f"{len(candidates)} need recentering")

            # Compute new bounds for reference
            new_lower, new_upper = compute_new_bounds(current_tick, half_width_ticks=1000, tick_spacing=1000)
            record("compute_new_bounds()", new_upper > new_lower, f"[{new_lower}, {new_upper}]")

    except Exception as e:
        record("LP recenter adapter", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 6. LP recenter calldata builder
    # ──────────────────────────────────────────────────────────────────────
    step(6, "LP recenter calldata builder")
    try:
        from app.services.ekubo.lp_recenter_adapter import build_recenter_calldata

        # Use NFT 3795 as the test position (in-range)
        test_pos = {"nft_id": 3795, "lower_tick": -83000, "upper_tick": -81000, "liquidity": 100}
        recenter = build_recenter_calldata(
            position=test_pos, current_tick=current_tick or -82000,
            half_width_ticks=1000,
        )
        calls = recenter["calls"]
        record("build_recenter_calldata()", len(calls) == 3, f"{len(calls)} calls: {[c['entrypoint'] for c in calls]}")
        record("  old_bounds", True, str(recenter["old_bounds"]))
        record("  new_bounds", True, str(recenter["new_bounds"]))
        print(f"  {INFO}  Full calldata structure:")
        for i, c in enumerate(calls):
            print(f"    [{i}] {c['entrypoint']}  →  {c['contract'][:14]}…")

    except Exception as e:
        record("LP recenter calldata", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 7. Limit orders adapter — build, record, query
    # ──────────────────────────────────────────────────────────────────────
    step(7, "Limit orders adapter — build + record + query")
    try:
        from app.services.ekubo.limit_orders_adapter import (
            build_place_limit_order_calldata,
            record_order,
            get_active_orders,
            mark_order_filled,
        )
        from app.services.ekubo_config import SEPOLIA_STRK, SEPOLIA_ETH

        # Build calldata for a limit order
        calls = build_place_limit_order_calldata(
            sell_token=SEPOLIA_STRK,
            buy_token=SEPOLIA_ETH,
            amount_wei=5 * 10**18,  # 5 STRK
            limit_tick=(current_tick or -82000) - 2000,  # 2000 ticks below
        )
        record("build_place_limit_order_calldata()", len(calls) == 2,
               f"{len(calls)} calls: [approve, place_order]")
        for i, c in enumerate(calls):
            print(f"    [{i}] {c['entrypoint']}  →  {str(c['contract'])[:14]}…")

        # Record a test order
        order = record_order(
            sell_token=SEPOLIA_STRK,
            buy_token=SEPOLIA_ETH,
            amount_wei=5 * 10**18,
            limit_tick=(current_tick or -82000) - 2000,
            tx_hash="0xe2e_test_order",
        )
        record("record_order()", order["status"] == "open", f"status={order['status']}")

        active = get_active_orders()
        record("get_active_orders()", len(active) > 0, f"{len(active)} active orders")

    except Exception as e:
        record("Limit orders adapter", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 8. Guard wired into vault_execute_service
    # ──────────────────────────────────────────────────────────────────────
    step(8, "Guard wired into vault_execute_service")
    try:
        from app.services.vault_execute_service import execute_strategy_impl

        # Test that guard doesn't block a normal request (need to clear cooldown first)
        # We'll reset the cooldown tracker to avoid the cooldown from step 3
        from app.services import execution_guard
        execution_guard._last_exec_ts.clear()

        result = await execute_strategy_impl({
            "user_address": VAULT,
            "risk_profile": "balanced",
            "deposit_amount": 10.0,
        })
        blocked = result.get("guard_blocked", False)
        record("vault_execute normal request", not blocked,
               f"deployment_id={result.get('deployment_id', '?')[:20]}")

        # Test emergency pause → should block
        svc = get_vault_policy_service()
        svc.put_policy(VAULT, {"execution_policy": {"emergency_pause": True}})
        result2 = await execute_strategy_impl({
            "user_address": VAULT,
            "risk_profile": "balanced",
            "deposit_amount": 10.0,
        })
        blocked2 = result2.get("guard_blocked", False)
        record("vault_execute emergency_pause", blocked2,
               f"reason={result2.get('guard_reason', '?')}")

        # Restore emergency_pause=False
        svc.put_policy(VAULT, {"execution_policy": {"emergency_pause": False}})

    except Exception as e:
        record("Guard wiring", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 9. LP Recenter Worker — single cycle (NO shadow)
    # ──────────────────────────────────────────────────────────────────────
    step(9, "LP Recenter Worker — single live cycle")
    try:
        # Import worker internals and run one cycle
        os.environ["RECENTER_LIVE"] = "0"  # keep shadow for safety on test
        from app.workers.lp_recenter_worker import _run_cycle as recenter_cycle

        # Clear cooldown from step 3 so guard passes
        execution_guard._last_exec_ts.clear()

        print(f"  {INFO}  Running single LP recenter cycle...")
        await recenter_cycle()
        record("LP recenter worker cycle", True, "completed (check logs above)")

    except Exception as e:
        record("LP recenter worker", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 10. Limit Grid Worker — single cycle (NO shadow)
    # ──────────────────────────────────────────────────────────────────────
    step(10, "Limit Grid Worker — single live cycle")
    try:
        os.environ["GRID_LIVE"] = "0"  # keep shadow for safety on test
        from app.workers.limit_grid_worker import _run_cycle as grid_cycle

        # Clear cooldown
        execution_guard._last_exec_ts.clear()

        print(f"  {INFO}  Running single limit grid cycle...")
        await grid_cycle()
        record("Limit grid worker cycle", True, "completed (check logs above)")

    except Exception as e:
        record("Limit grid worker", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 11. API: GET /guard-status
    # ──────────────────────────────────────────────────────────────────────
    step(11, "API: GET /guard-status/{addr}")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{API}/guard-status/{VAULT}")
            r.raise_for_status()
            data = r.json()
        record("GET /guard-status", r.status_code == 200, f"pause={data.get('emergency_pause')}, hash={data.get('policy_hash','?')[:20]}…")
        print(f"  {INFO}  {json.dumps(data, indent=2)}")

    except Exception as e:
        record("GET /guard-status", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 12. API: POST /guard-check
    # ──────────────────────────────────────────────────────────────────────
    step(12, "API: POST /guard-check (dry-run)")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{API}/guard-check", json={
                "user_address": VAULT,
                "strategy": "lp_recenter",
                "notional_wei": 50 * 10**18,
            })
            r.raise_for_status()
            data = r.json()
        record("POST /guard-check", data["allowed"] is True, f"checks={data.get('checks')}")
        print(f"  {INFO}  {json.dumps(data, indent=2)}")

    except Exception as e:
        record("POST /guard-check", False, str(e))
        traceback.print_exc()

    # ──────────────────────────────────────────────────────────────────────
    # 13. API: GET /limit-orders/active
    # ──────────────────────────────────────────────────────────────────────
    step(13, "API: GET /limit-orders/active")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{API}/limit-orders/active")
            r.raise_for_status()
            data = r.json()
        count = data.get("total_count", 0)
        record("GET /limit-orders/active", r.status_code == 200, f"{count} active orders")
        if data.get("active_orders"):
            print(f"  {INFO}  First order: {json.dumps(data['active_orders'][0], indent=2)}")

    except Exception as e:
        record("GET /limit-orders/active", False, str(e))
        traceback.print_exc()

    # ══════════════════════════════════════════════════════════════════════
    # Summary
    # ══════════════════════════════════════════════════════════════════════
    print(f"\n{'═'*70}")
    print(f"  SUMMARY")
    print(f"{'═'*70}")
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    total = len(results)

    for name, ok, detail in results:
        tag = PASS if ok else FAIL
        short = (detail[:60] + "…") if len(detail) > 60 else detail
        print(f"  {tag}  {name}  {short}")

    print(f"\n  Total: {total}   Passed: {passed}   Failed: {failed}")
    color = "\033[92m" if failed == 0 else "\033[91m"
    print(f"  {color}{'ALL PASSED' if failed == 0 else f'{failed} FAILED'}\033[0m\n")

    return failed == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
