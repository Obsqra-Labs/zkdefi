#!/usr/bin/env python3
"""
Full Pool D + AI gate test on Sepolia.

Complete flow:
  1. Vault deposit  (STRK transfer → /vault/deposit → ledger credit)
  2. Verify ledger balance credited
  3. Pool D deposit (generate commitment, on-chain approve+deposit_u256)
  4. Register commitment in Merkle tree
  5. Generate Tier-2H claim proof (FullPrivacyWithdrawHashed)
  6. Ensure Merkle root on-chain
  7. On-chain: withdraw_claim_u256 (burns nullifier, stores claimHash)
  8. Verify is_claimed_u256 on-chain
  9. /claim/pay → AI gate checks ledger, debits balance, transfers STRK
  10. Verify ledger balance was debited by the AI gate
  11. Post-flight balances

This proves the full vault intake → privacy settlement → AI gate debit pipeline.
"""
import asyncio
import sys
import time
import httpx

from starknet_py.contract import Contract
from starknet_py.net.account.account import Account
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.client_models import Call, ResourceBounds, ResourceBoundsMapping
from starknet_py.hash.selector import get_selector_from_name

# ── Config ──────────────────────────────────────────────────────────────────
WALLET_ADDRESS  = 0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
PRIVATE_KEY     = 0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc
POOL_D_ADDRESS  = 0x0258703c803d133f9759e37071cf3da03670566be48e2e77b81d18439d7917fe
STRK_ADDRESS    = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
RPC_URL         = "https://api.cartridge.gg/x/starknet/sepolia"
API_BASE        = "http://localhost:8003/api/v1/zkdefi"
DEPOSIT_STRK    = 1.0            # Amount deposited into vault
WITHDRAW_STRK   = 1.0            # Amount exiting via Pool D
DEPOSIT_WEI     = str(int(DEPOSIT_STRK  * 1e18))
WITHDRAW_WEI    = str(int(WITHDRAW_STRK * 1e18))
POOL_TYPE       = 1
STARK_PRIME     = 0x800000000000011000000000000000000000000000000000000000000000001
U128            = 2 ** 128
# ────────────────────────────────────────────────────────────────────────────

WALLET_HEX = hex(WALLET_ADDRESS)


def lo_hi(n: int):
    return n % U128, n // U128


def sep(step, label):
    print(f"\n{'─'*60}\n  Step {step}: {label}\n{'─'*60}")


def ok(step, msg):
    print(f"  ✅ {msg}")


def fail(step, msg):
    print(f"  ❌ {msg}")
    sys.exit(1)


async def build_account():
    client = FullNodeClient(node_url=RPC_URL)
    key_pair = KeyPair.from_private_key(PRIVATE_KEY)
    acct = Account(
        address=WALLET_ADDRESS, client=client, key_pair=key_pair,
        chain=StarknetChainId.SEPOLIA,
    )
    acct._cairo_version = 1
    return acct, client


async def exec_calls(account, calls):
    """Execute calls with nonce retry — handles Cartridge gateway stale-nonce issue."""
    from starknet_py.net.client_errors import ClientError
    max_retries = 5
    for attempt in range(max_retries):
        try:
            nonce = await account.get_nonce(block_number="latest")
            draft = await account._prepare_invoke_v3(
                calls,
                resource_bounds=ResourceBoundsMapping(
                    l1_gas=ResourceBounds(max_amount=0, max_price_per_unit=0),
                    l2_gas=ResourceBounds(max_amount=0, max_price_per_unit=0),
                    l1_data_gas=ResourceBounds(max_amount=0, max_price_per_unit=0),
                ),
                nonce=nonce,
            )
            estimated = await account.estimate_fee(draft, block_number="latest")
            resp = await account.execute_v3(calls=calls, resource_bounds=estimated.to_resource_bounds(), nonce=nonce)
            print(f"    tx: {hex(resp.transaction_hash)}")
            await account.client.wait_for_tx(resp.transaction_hash)
            print(f"    confirmed ✓")
            # Let nonce propagate for next tx
            await asyncio.sleep(8)
            return resp.transaction_hash
        except ClientError as e:
            if ("NonceTooOld" in str(e) or "Invalid transaction nonce" in str(e)) and attempt < max_retries - 1:
                wait = 15 * (attempt + 1)
                print(f"    nonce stale (attempt {attempt+1}/{max_retries}), waiting {wait}s...")
                await asyncio.sleep(wait)
                continue
            raise


async def main():
    acct, client = await build_account()
    strk = await Contract.from_address(STRK_ADDRESS, acct)

    print(f"\n{'='*60}")
    print(f"  FULL POOL D + AI GATE END-TO-END TEST")
    print(f"  Wallet   : {WALLET_HEX}")
    print(f"  Vault deposit : {DEPOSIT_STRK} STRK")
    print(f"  Pool D exit   : {WITHDRAW_STRK} STRK")
    print(f"{'='*60}")

    # ── 0. Pre-flight ──────────────────────────────────────────────────
    sep(0, "PRE-FLIGHT")
    (wallet_bal_start,) = await strk.functions["balanceOf"].call(WALLET_ADDRESS)
    print(f"  Wallet STRK: {wallet_bal_start / 1e18:.4f}")

    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.get(f"{API_BASE}/vault/status", params={"user_address": WALLET_HEX})
        r.raise_for_status()
        pre_status = r.json()
    pre_balance = int(pre_status["balance_wei"])
    print(f"  Ledger balance: {pre_balance / 1e18:.4f} STRK")

    # ── 1. Vault deposit: STRK transfer → /vault/deposit ──────────────
    sep(1, "VAULT DEPOSIT (STRK → operator → ledger credit)")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.get(f"{API_BASE}/vault/operator-address")
        r.raise_for_status()
        operator_addr = r.json()["operator_address"]
    print(f"  Operator: {operator_addr}")

    operator_int = int(operator_addr, 16)
    amt_lo, amt_hi = lo_hi(int(DEPOSIT_WEI))
    tx_vault_deposit = await exec_calls(acct, [
        Call(to_addr=STRK_ADDRESS, selector=get_selector_from_name("transfer"),
             calldata=[operator_int, amt_lo, amt_hi]),
    ])

    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(f"{API_BASE}/vault/deposit", json={
            "user_address": WALLET_HEX,
            "tx_hash": hex(tx_vault_deposit),
        })
        if r.status_code != 200:
            fail(1, f"Vault deposit failed: {r.status_code} {r.text}")
        deposit_result = r.json()
    ok(1, f"{deposit_result['message']}")

    # ── 2. Verify ledger balance credited ─────────────────────────────
    sep(2, "VERIFY LEDGER BALANCE CREDITED")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.get(f"{API_BASE}/vault/status", params={"user_address": WALLET_HEX})
        r.raise_for_status()
        post_deposit_status = r.json()
    balance_after_deposit = int(post_deposit_status["balance_wei"])
    expected = pre_balance + int(DEPOSIT_WEI)
    if balance_after_deposit != expected:
        fail(2, f"Balance mismatch: got {balance_after_deposit}, expected {expected}")
    ok(2, f"Ledger balance: {balance_after_deposit / 1e18:.4f} STRK (credited +{DEPOSIT_STRK})")

    # ── 3. Pool D deposit: generate commitment + on-chain deposit ─────
    sep(3, "POOL D DEPOSIT (generate commitment + on-chain)")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post(f"{API_BASE}/full_privacy/deposit/generate_commitment", json={
            "user_address": WALLET_HEX,
            "amount": WITHDRAW_WEI,
            "pool_type": POOL_TYPE,
        })
        r.raise_for_status()
        cd = r.json()
    print(f"  commitment: {cd['commitment'][:40]}...")

    comm_int = int(cd["commitment"], 16) if cd["commitment"].startswith("0x") else int(cd["commitment"])
    comm_lo, comm_hi = lo_hi(comm_int)
    d_amt_lo, d_amt_hi = lo_hi(int(WITHDRAW_WEI))

    tx_pool_deposit = await exec_calls(acct, [
        Call(to_addr=STRK_ADDRESS,   selector=get_selector_from_name("approve"),
             calldata=[POOL_D_ADDRESS, d_amt_lo, d_amt_hi]),
        Call(to_addr=POOL_D_ADDRESS, selector=get_selector_from_name("deposit_u256"),
             calldata=[comm_lo, comm_hi, d_amt_lo, d_amt_hi]),
    ])
    ok(3, f"Pool D deposit: {hex(tx_pool_deposit)}")

    # Wait for nonce to propagate so the backend's add_known_root sees fresh state
    print("    ⏳ Waiting 20s for nonce propagation before merkle registration...")
    await asyncio.sleep(20)

    # ── 4. Register commitment in Merkle tree ─────────────────────────
    sep(4, "REGISTER COMMITMENT IN MERKLE TREE")
    async with httpx.AsyncClient(timeout=300) as http:
        r = await http.post(f"{API_BASE}/full_privacy/deposit/register_commitment",
                            json={"commitment": cd["commitment"]})
        reg = r.json() if r.status_code in (200, 503) else r.raise_for_status()
    leaf_index    = reg["leaf_index"]
    merkle_root   = reg["merkle_root"]
    path_elements = reg["path_elements"]
    path_indices  = reg["path_indices"]
    ok(4, f"leaf_index={leaf_index}, root={merkle_root[:30]}...")

    # ── 5. Generate Tier-2H claim proof ───────────────────────────────
    sep(5, "GENERATE HASHED-WITHDRAW ZK PROOF")
    t0 = time.time()
    async with httpx.AsyncClient(timeout=300) as http:
        r = await http.post(f"{API_BASE}/full_privacy/withdraw/generate_claim_proof", json={
            "user_secret":     cd["user_secret"],
            "amount":          WITHDRAW_WEI,
            "pool_type":       POOL_TYPE,
            "nonce":           cd["nonce"],
            "blinding":        cd["blinding"],
            "withdraw_amount": WITHDRAW_WEI,
            "recipient":       WALLET_HEX,
            "leaf_index":      leaf_index,
            "merkle_root":     merkle_root,
            "path_elements":   path_elements,
            "path_indices":    path_indices,
        })
        r.raise_for_status()
        proof = r.json()
    elapsed = time.time() - t0
    ok(5, f"Proof generated in {elapsed:.1f}s — claimHash={proof['claim_hash'][:30]}...")

    # ── 6. Ensure Merkle root on-chain ────────────────────────────────
    sep(6, "ENSURE MERKLE ROOT ON-CHAIN")
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(f"{API_BASE}/full_privacy/merkle/ensure_root",
                            json={"root": proof["root"]})
        r.raise_for_status()
    ok(6, f"{r.json()}")

    # ── 7. On-chain: withdraw_claim_u256 ──────────────────────────────
    sep(7, "ON-CHAIN withdraw_claim_u256 (nullifier + claimHash only)")
    null_int = int(proof["nullifier"], 16) if proof["nullifier"].startswith("0x") else int(proof["nullifier"])
    root_int = int(proof["root"], 16) if proof["root"].startswith("0x") else int(proof["root"])
    null_lo, null_hi = lo_hi(null_int)
    root_lo, root_hi = lo_hi(root_int)

    proof_felts = [
        (int(str(p).strip(), 16) if str(p).strip().startswith("0x") else int(str(p).strip())) % STARK_PRIME
        for p in proof["proof_calldata"]
    ]
    calldata = [null_lo, null_hi, root_lo, root_hi, POOL_TYPE, len(proof_felts), *proof_felts]

    tx_claim = await exec_calls(acct, [
        Call(to_addr=POOL_D_ADDRESS,
             selector=get_selector_from_name("withdraw_claim_u256"),
             calldata=calldata)
    ])
    ok(7, f"Claim tx: {hex(tx_claim)} — no token transfer, just nullifier+claimHash stored")

    # ── 8. Verify is_claimed_u256 on-chain ────────────────────────────
    sep(8, "VERIFY is_claimed_u256 ON-CHAIN")
    pool_d = await Contract.from_address(POOL_D_ADDRESS, acct)
    claim_low  = int(proof["claim_low"],  16) if proof["claim_low"].startswith("0x") else int(proof["claim_low"])
    claim_high = int(proof["claim_high"], 16) if proof["claim_high"].startswith("0x") else int(proof["claim_high"])
    (is_claimed,) = await pool_d.functions["is_claimed_u256"].call(
        claim_low=claim_low, claim_high=claim_high,
    )
    if not is_claimed:
        fail(8, "Claim NOT stored on-chain!")
    ok(8, f"is_claimed_u256 = True ✓")

    # ── 9. /claim/pay → AI GATE debits ledger, then transfers STRK ───
    sep(9, "/claim/pay → AI GATE debit + STRK payout")
    print(f"  Ledger balance before gate: {balance_after_deposit / 1e18:.4f} STRK")
    print(f"  Claim payout amount:        {WITHDRAW_STRK} STRK")
    print(f"  AI gate should debit {WITHDRAW_STRK} STRK from ledger\n")

    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(f"{API_BASE}/full_privacy/claim/pay", json={
            "claim_low":  proof["claim_low"],
            "claim_high": proof["claim_high"],
            "recipient":  WALLET_HEX,
            "amount_wei": WITHDRAW_WEI,
        })
        if r.status_code != 200:
            fail(9, f"Claim payout failed: {r.status_code} {r.text}")
        payout = r.json()
    ok(9, f"Payout tx: {payout['tx_hash']} — {payout['message']}")

    # ── 10. VERIFY AI GATE DEBITED LEDGER ─────────────────────────────
    sep(10, "VERIFY AI GATE DEBITED LEDGER BALANCE")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.get(f"{API_BASE}/vault/status", params={"user_address": WALLET_HEX})
        r.raise_for_status()
        post_payout_status = r.json()
    balance_after_payout = int(post_payout_status["balance_wei"])
    expected_after_gate = balance_after_deposit - int(WITHDRAW_WEI)
    print(f"  Ledger before gate: {balance_after_deposit / 1e18:.4f} STRK")
    print(f"  Ledger after gate:  {balance_after_payout / 1e18:.4f} STRK")
    print(f"  Expected:           {expected_after_gate / 1e18:.4f} STRK")

    if balance_after_payout != expected_after_gate:
        fail(10, f"AI gate debit FAILED: got {balance_after_payout}, expected {expected_after_gate}")
    ok(10, f"AI gate debited {WITHDRAW_STRK} STRK ✓ — ledger balance now {balance_after_payout / 1e18:.4f}")

    # ── 11. Post-flight balances ──────────────────────────────────────
    sep(11, "POST-FLIGHT BALANCES")
    await asyncio.sleep(3)
    (wallet_bal_end,) = await strk.functions["balanceOf"].call(WALLET_ADDRESS)
    print(f"  Wallet STRK:  {wallet_bal_end / 1e18:.4f}  (Δ {(wallet_bal_end - wallet_bal_start) / 1e18:+.4f})")
    print(f"  Ledger:       {balance_after_payout / 1e18:.4f}  (deposited {DEPOSIT_STRK}, withdrew {WITHDRAW_STRK})")

    gas_cost = (wallet_bal_start - wallet_bal_end) / 1e18
    print(f"  Gas cost:     ~{gas_cost:.4f} STRK (3 on-chain txns)")

    print(f"\n{'='*60}")
    print(f"  ALL 11 STEPS PASSED ✅")
    print(f"  ✓ Vault deposit → ledger credit")
    print(f"  ✓ Pool D deposit → ZK proof → on-chain claim")
    print(f"  ✓ /claim/pay → AI gate debited ledger → STRK payout")
    print(f"  ✓ Ledger balance correctly reflects deposit - withdrawal")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
