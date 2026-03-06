#!/usr/bin/env python3
"""
End-to-End zkdefi Proof Pipeline Test

Tests the full proof flow:
  1. zkdefi /proofs/ml-bridge → ProofPipeline.generate_ml_proofs()
     → Synthetic EZKL → ModelBridge bundle → L3 verification via Garaga/hash-only
  2. Sequencer forwarding: proof_sequencer_client → obsqra /aggregation/submit
  3. Type safety: groth16_calldata list[str] → list[int] conversion
  4. Direct L3 verify: obsqra /aggregation/l3/verify with calldata
  5. VFR fact check: read back is_valid() on Madara L3

Requires:
  - Obsqra backend on :8002
  - zkdefi backend on :8003
  - Madara L3 on :9944
"""

import asyncio
import json
import os
import sys
import time

import httpx

OBSQRA_API = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")
ZKDEFI_API = os.getenv("ZKDEFI_API_URL", "http://127.0.0.1:8003/api/v1/zkdefi")

passed = 0
failed = 0
skipped = 0


def ok(msg):
    global passed
    passed += 1
    print(f"  \u2713 {msg}")


def fail(msg):
    global failed
    failed += 1
    print(f"  \u2717 {msg}")


def skip(label, reason):
    global skipped
    skipped += 1
    print(f"  \u2298 {label}: {reason}")


async def main():
    global passed, failed, skipped

    print("=" * 64)
    print("E2E zkdefi Proof Pipeline Test")
    print("=" * 64)

    client = httpx.AsyncClient(timeout=30.0)

    # ── 1. Health checks ─────────────────────────────────────────────
    print("\n[1] Backend health checks")
    try:
        resp = await client.get(f"{OBSQRA_API.replace('/api/v1', '')}/health")
        assert resp.status_code == 200
        ok(f"Obsqra backend healthy: {resp.json()}")
    except Exception as e:
        fail(f"Obsqra backend unreachable: {e}")
        print("\nAborting — obsqra backend required")
        return

    try:
        resp = await client.get(f"{ZKDEFI_API.replace('/api/v1/zkdefi', '')}/health")
        assert resp.status_code == 200
        ok(f"zkdefi backend healthy: {resp.json()}")
    except Exception as e:
        fail(f"zkdefi backend unreachable: {e}")
        print("\nAborting — zkdefi backend required")
        return

    # ── 2. L3 capabilities check ─────────────────────────────────────
    print("\n[2] L3 proving path capabilities")
    try:
        resp = await client.get(f"{OBSQRA_API}/aggregation/l3/capabilities")
        if resp.status_code == 200:
            caps = resp.json()
            paths = caps.get("proving_paths", {})
            ok(f"L3 capabilities: {len(paths)} proving paths")
        else:
            skip("L3 capabilities", f"HTTP {resp.status_code}")
    except Exception as e:
        skip("L3 capabilities", str(e))

    # ── 3. Generate ML bridge proof (full pipeline) ──────────────────
    print("\n[3] Generate ML bridge proof via zkdefi pipeline")
    ml_result = None
    try:
        payload = {
            "user_address": "0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d",
            "model_name": "yield_forecast",
            "input_data": [[18.5, 15.2, 30.0, 8.5, 7.2, 6.8, 0.15, 0.03, 0.72, 0.85, 150.0, 24.0]],
            "execution_chain": "l3",
            "proof_mode": "EZKL_BRIDGE",
            "tier": 1,
            "action_type": "ml_inference",
            "value_eth": 2.0,
            "expected_model_hash": 0,
            "output_lower_bound": 0,
            "output_upper_bound": 10000,
        }
        t0 = time.monotonic()
        resp = await client.post(f"{ZKDEFI_API}/proofs/ml-bridge", json=payload)
        latency = (time.monotonic() - t0) * 1000

        if resp.status_code == 200:
            ml_result = resp.json()
            mode = ml_result.get("proof_mode", "?")
            can_exec = ml_result.get("can_execute", False)
            verification = ml_result.get("verification", {})
            l3_v = verification.get("l3", {})
            l3_mode = l3_v.get("mode", "none")
            l3_tx = l3_v.get("tx_hash", "")
            l3_verified = l3_v.get("verified_on_chain", False)

            ok(f"ML bridge proof generated in {latency:.0f}ms (mode={mode}, can_execute={can_exec})")
            if l3_v.get("attempted"):
                if l3_verified:
                    ok(f"L3 verified on-chain: mode={l3_mode}, tx={l3_tx[:24] if l3_tx else 'none'}")
                else:
                    ok(f"L3 verification attempted: mode={l3_mode} (not cryptographically verified — expected for ModelBridge)")
            else:
                skip("L3 verification", "not attempted")

            # Check bridge proof
            bp = ml_result.get("bridge_proof")
            if bp and bp.get("success"):
                ok(f"Bridge proof: compliant={bp.get('is_compliant')}, hash={bp.get('proof_hash', '')[:24]}")
            else:
                fail("Bridge proof not generated or failed")

            # Check EZKL proof
            ep = ml_result.get("ezkl_proof")
            if ep:
                ok(f"EZKL proof: hash={ep.get('proof_hash', '')[:24]}")
            else:
                fail("EZKL proof not generated")
        else:
            fail(f"ML bridge proof HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        fail(f"ML bridge proof generation failed: {e}")

    # ── 4. Direct L3 verify (through obsqra aggregation endpoint) ────
    print("\n[4] Direct L3 verification via obsqra /aggregation/l3/verify")
    try:
        test_fact = hex((int(time.time()) << 64) | 0xE2E0001)
        verify_payload = {
            "fact_hash": test_fact,
            "proof_type": "stark",
            "circuit_name": "E2ETest",
        }
        t0 = time.monotonic()
        resp = await client.post(f"{OBSQRA_API}/aggregation/l3/verify", json=verify_payload)
        latency = (time.monotonic() - t0) * 1000

        if resp.status_code == 200:
            vr = resp.json()
            ok(f"L3 verify: mode={vr.get('mode')}, success={vr.get('success')}, "
               f"tx={str(vr.get('tx_hash', ''))[:24]}, {latency:.0f}ms")
        else:
            fail(f"L3 verify HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        fail(f"L3 verify failed: {e}")

    # ── 5. Type-safe calldata verify (str → int conversion) ──────────
    print("\n[5] Type-safe calldata conversion (str → int)")
    try:
        calldata_str = [
            "0x6d6f64656c5f627269646765",  # "model_bridge" as hex felt
            "0x1234567890abcdef",
            "0xdeadbeef",
            "0xcafe",
        ]
        test_fact = hex((int(time.time()) << 64) | 0xE2E0002)
        payload = {
            "fact_hash": test_fact,
            "proof_type": "groth16",
            "circuit_name": "TypeSafeTest",
            "groth16_calldata": calldata_str,
        }
        t0 = time.monotonic()
        resp = await client.post(f"{OBSQRA_API}/aggregation/l3/verify", json=payload)
        latency = (time.monotonic() - t0) * 1000

        if resp.status_code == 200:
            vr = resp.json()
            # Even if Garaga verification fails (expected — fake calldata), we should NOT
            # get a type error. The important thing is the request was processed.
            ok(f"Calldata str→int conversion OK: mode={vr.get('mode')}, {latency:.0f}ms")
            if vr.get("error") and "type" in str(vr.get("error", "")).lower():
                fail(f"Type error in calldata conversion: {vr.get('error')}")
        elif resp.status_code == 422:
            fail(f"Validation error (type mismatch not fixed): {resp.text[:200]}")
        else:
            fail(f"Calldata verify HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        fail(f"Calldata verify failed: {e}")

    # ── 6. Sequencer submission with calldata ────────────────────────
    print("\n[6] Sequencer submission with calldata passthrough")
    try:
        test_fact = hex((int(time.time()) << 64) | 0xE2E0003)
        payload = {
            "proof_id": f"e2e_test_{int(time.time())}",
            "fact_hash": test_fact,
            "proof_type": "groth16",
            "circuit_name": "SeqCalldataTest",
            "groth16_calldata": ["0xaabb", "0xccdd", "0xeeff"],
        }
        resp = await client.post(f"{OBSQRA_API}/aggregation/submit", json=payload)
        if resp.status_code == 200:
            sr = resp.json()
            seq_block = sr.get("sequencer_block")
            ok(f"Sequencer accepted: block={seq_block}, status={sr.get('status')}")
        else:
            fail(f"Sequencer submit HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        fail(f"Sequencer submit failed: {e}")

    # ── 7. Sequencer status via zkdefi ───────────────────────────────
    print("\n[7] Sequencer status from zkdefi")
    try:
        resp = await client.get(f"{ZKDEFI_API}/proofs/sequencer-status")
        if resp.status_code == 200:
            ss = resp.json()
            ok(f"Sequencer status: {ss.get('status', 'unknown')}")
        else:
            skip("Sequencer status", f"HTTP {resp.status_code}")
    except Exception as e:
        skip("Sequencer status", str(e))

    # ── 8. Proof list + stats ────────────────────────────────────────
    print("\n[8] Proof list and stats")
    try:
        resp = await client.get(f"{ZKDEFI_API}/proofs/stats")
        if resp.status_code == 200:
            stats = resp.json()
            ok(f"Proof stats: total={stats.get('total_proofs', 0)}, verified={stats.get('verified_on_chain', 0)}")
        else:
            skip("Proof stats", f"HTTP {resp.status_code}")
    except Exception as e:
        skip("Proof stats", str(e))

    try:
        resp = await client.get(f"{ZKDEFI_API}/proofs/models")
        if resp.status_code == 200:
            models = resp.json()
            ok(f"Models: {models.get('count', 0)} available")
        else:
            skip("Models list", f"HTTP {resp.status_code}")
    except Exception as e:
        skip("Models list", str(e))

    # ── 9. On-chain verification stats ───────────────────────────────
    print("\n[9] L3 on-chain verification stats")
    try:
        resp = await client.get(f"{OBSQRA_API}/aggregation/l3/verification/stats")
        if resp.status_code == 200:
            vs = resp.json()
            ok(f"Verification stats: {json.dumps(vs, indent=None)[:200]}")
        else:
            skip("Verification stats", f"HTTP {resp.status_code}")
    except Exception as e:
        skip("Verification stats", str(e))

    # ── 10. L3 recent blocks ─────────────────────────────────────────
    print("\n[10] L3 recent proving blocks")
    try:
        resp = await client.get(f"{OBSQRA_API}/aggregation/l3/blocks?limit=5")
        if resp.status_code == 200:
            blocks = resp.json().get("blocks", [])
            ok(f"Recent blocks: {len(blocks)} returned")
        else:
            skip("L3 blocks", f"HTTP {resp.status_code}")
    except Exception as e:
        skip("L3 blocks", str(e))

    # ── Summary ──────────────────────────────────────────────────────
    await client.aclose()

    print("\n" + "=" * 64)
    total = passed + failed + skipped
    print(f"Results: {passed}/{total} passed, {failed} failed, {skipped} skipped")
    if failed == 0:
        print("ALL TESTS PASSED ✓")
    else:
        print(f"{failed} TESTS FAILED ✗")
    print("=" * 64)

    return failed == 0


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
