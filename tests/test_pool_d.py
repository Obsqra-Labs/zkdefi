"""
End-to-end Pool D (HashedWithdrawPool / Tier-2H) test.

Flow:
  1. Generate deposit commitment
  2. On-chain: approve + deposit_u256 into Pool D
  3. Register commitment in Merkle tree
  4. Generate Hashed-withdraw ZK proof  (FullPrivacyWithdrawHashed circuit)
     → proves knowledge of leaf; public outputs: root, nullifier, claimHash, poolType
     → claimHash = Poseidon(recipient, withdrawAmount, claimSalt)  — amount/recipient HIDDEN from contract
  5. On-chain: withdraw_claim_u256 (burns nullifier, stores claimHash — NO token transfer)
  6. Backend: POST /full_privacy/claim/pay
     → verifies is_claimed_u256 on-chain, transfers STRK from operator wallet
  7. Verify balances
"""
import asyncio
import json
import os
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
PRIVATE_KEY_HEX = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", "")
POOL_D_ADDRESS  = 0x0258703c803d133f9759e37071cf3da03670566be48e2e77b81d18439d7917fe
STRK_ADDRESS    = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
RPC_URL         = "https://api.cartridge.gg/x/starknet/sepolia"
API_BASE        = "http://localhost:8003/api/v1/zkdefi"
TEST_AMOUNT_WEI = str(1 * 10**18)  # 1 STRK
POOL_TYPE       = 1
STARK_PRIME     = 0x800000000000011000000000000000000000000000000000000000000000001
U128            = 2 ** 128
# ────────────────────────────────────────────────────────────────────────────


def lo_hi(n: int):
    return n % U128, n // U128


def sep(label):
    print(f"\n{'='*60}\n  {label}\n{'='*60}")


async def build_account():
    if not PRIVATE_KEY_HEX:
        raise RuntimeError("Set FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY in env before running this test")
    client = FullNodeClient(node_url=RPC_URL)
    key_pair = KeyPair.from_private_key(int(PRIVATE_KEY_HEX, 16))
    return Account(
        address=WALLET_ADDRESS, client=client, key_pair=key_pair,
        chain=StarknetChainId.SEPOLIA,
    ), client


async def exec_calls(account, calls):
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
    print(f"  ↳ tx: {hex(resp.transaction_hash)}")
    await account.client.wait_for_tx(resp.transaction_hash)
    print(f"  ↳ confirmed ✓")
    return resp.transaction_hash


async def main():
    acc, client = await build_account()
    strk = await Contract.from_address(STRK_ADDRESS, acc)
    pool_d = await Contract.from_address(POOL_D_ADDRESS, acc)

    # ── 0. Pre-flight balances ──────────────────────────────────────────
    sep("0. PRE-FLIGHT BALANCES")
    (wallet_bal,) = await strk.functions["balanceOf"].call(WALLET_ADDRESS)
    (pool_bal,)   = await strk.functions["balanceOf"].call(POOL_D_ADDRESS)
    print(f"  Wallet STRK : {wallet_bal / 1e18:.4f}")
    print(f"  Pool D STRK : {pool_bal   / 1e18:.4f}")

    # ── 1. Generate deposit commitment ─────────────────────────────────
    sep("1. GENERATE DEPOSIT COMMITMENT")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post(f"{API_BASE}/full_privacy/deposit/generate_commitment", json={
            "user_address": hex(WALLET_ADDRESS),
            "amount": TEST_AMOUNT_WEI,
            "pool_type": POOL_TYPE,
        })
        r.raise_for_status()
        cd = r.json()
    print(f"  commitment : {cd['commitment'][:40]}...")
    print(f"  user_secret: {cd['user_secret'][:20]}...")

    # ── 2. On-chain: approve + deposit_u256 ────────────────────────────
    sep("2. ON-CHAIN DEPOSIT INTO POOL D")
    amount_int = int(TEST_AMOUNT_WEI)
    amt_lo, amt_hi = lo_hi(amount_int)
    comm_int = int(cd["commitment"], 16) if cd["commitment"].startswith("0x") else int(cd["commitment"])
    comm_lo, comm_hi = lo_hi(comm_int)

    tx_deposit = await exec_calls(acc, [
        Call(to_addr=STRK_ADDRESS,  selector=get_selector_from_name("approve"),
             calldata=[POOL_D_ADDRESS, amt_lo, amt_hi]),
        Call(to_addr=POOL_D_ADDRESS, selector=get_selector_from_name("deposit_u256"),
             calldata=[comm_lo, comm_hi, amt_lo, amt_hi]),
    ])
    print(f"  deposit tx : {hex(tx_deposit)}")

    # ── 3. Register commitment in Merkle tree ──────────────────────────
    sep("3. REGISTER COMMITMENT IN MERKLE TREE")
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(f"{API_BASE}/full_privacy/deposit/register_commitment",
                            json={"commitment": cd["commitment"]})
        reg = r.json() if r.status_code in (200, 503) else r.raise_for_status()
    leaf_index    = reg["leaf_index"]
    merkle_root   = reg["merkle_root"]
    path_elements = reg["path_elements"]
    path_indices  = reg["path_indices"]
    print(f"  leaf_index  : {leaf_index}")
    print(f"  merkle_root : {merkle_root[:40]}...")

    # ── 4. Generate Tier-2H claim proof ────────────────────────────────
    sep("4. GENERATE HASHED-WITHDRAW ZK PROOF (FullPrivacyWithdrawHashed)")
    print("  public outputs: root, nullifier, claimHash, poolType")
    print("  private:        recipient, withdrawAmount, claimSalt  ← HIDDEN on-chain")
    t0 = time.time()
    async with httpx.AsyncClient(timeout=300) as http:
        r = await http.post(f"{API_BASE}/full_privacy/withdraw/generate_claim_proof", json={
            "user_secret":     cd["user_secret"],
            "amount":          TEST_AMOUNT_WEI,
            "pool_type":       POOL_TYPE,
            "nonce":           cd["nonce"],
            "blinding":        cd["blinding"],
            "withdraw_amount": TEST_AMOUNT_WEI,
            "recipient":       hex(WALLET_ADDRESS),
            "leaf_index":      leaf_index,
            "merkle_root":     merkle_root,
            "path_elements":   path_elements,
            "path_indices":    path_indices,
        })
        r.raise_for_status()
        proof = r.json()
    print(f"  proof generated in {time.time()-t0:.1f}s")
    print(f"  nullifier  : {proof['nullifier'][:40]}...")
    print(f"  claimHash  : {proof['claim_hash'][:40]}...")
    print(f"  claimSalt  : {proof['claim_salt'][:20]}...")
    print(f"  NOTE: on-chain sees ONLY nullifier + claimHash (amount/recipient hidden)")

    # ── 5. Ensure Merkle root on-chain ─────────────────────────────────
    sep("5. ENSURE ROOT ON-CHAIN")
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(f"{API_BASE}/full_privacy/merkle/ensure_root",
                            json={"root": proof["root"]})
        r.raise_for_status()
    print(f"  {r.json()}")

    # ── 6. On-chain: withdraw_claim_u256 ───────────────────────────────
    sep("6. ON-CHAIN withdraw_claim_u256 (burns nullifier, stores claimHash)")
    null_int = int(proof["nullifier"], 16) if proof["nullifier"].startswith("0x") else int(proof["nullifier"])
    root_int = int(proof["root"], 16)      if proof["root"].startswith("0x")       else int(proof["root"])
    null_lo, null_hi = lo_hi(null_int)
    root_lo, root_hi = lo_hi(root_int)

    def parse_felt(p):
        s = str(p).strip()
        return int(s, 16) if s.startswith("0x") else int(s)

    proof_felts = [parse_felt(p) % STARK_PRIME for p in proof["proof_calldata"]]

    # withdraw_claim_u256(null_lo, null_hi, root_lo, root_hi, pool_type, len, ...proof)
    # NO recipient/amount in calldata — Tier-2H privacy
    calldata = [null_lo, null_hi, root_lo, root_hi, POOL_TYPE, len(proof_felts), *proof_felts]

    WITHDRAW_CLAIM_SELECTOR = get_selector_from_name("withdraw_claim_u256")
    tx_claim = await exec_calls(acc, [
        Call(to_addr=POOL_D_ADDRESS, selector=WITHDRAW_CLAIM_SELECTOR, calldata=calldata)
    ])
    print(f"  claim tx   : {hex(tx_claim)}")
    print(f"  Pool D now holds claimHash on-chain — NO token transfer yet")

    # ── 7. Verify claim is stored on-chain ────────────────────────────
    sep("7. VERIFY is_claimed_u256 ON-CHAIN")
    claim_low  = int(proof["claim_low"],  16) if proof["claim_low"].startswith("0x")  else int(proof["claim_low"])
    claim_high = int(proof["claim_high"], 16) if proof["claim_high"].startswith("0x") else int(proof["claim_high"])
    (is_claimed,) = await pool_d.functions["is_claimed_u256"].call(
        claim_low=claim_low, claim_high=claim_high
    )
    print(f"  is_claimed_u256 = {bool(is_claimed)}  ✓")
    if not is_claimed:
        print("ERROR: claim not stored on-chain!")
        sys.exit(1)

    # ── 8. Backend: claim payout ──────────────────────────────────────
    sep("8. BACKEND CLAIM PAYOUT → POST /full_privacy/claim/pay")
    print(f"  claim_low  : {proof['claim_low']}")
    print(f"  claim_high : {proof['claim_high']}")
    print(f"  recipient  : {hex(WALLET_ADDRESS)}")
    print(f"  amount_wei : {TEST_AMOUNT_WEI}")
    async with httpx.AsyncClient(timeout=120) as http:
        r = await http.post(f"{API_BASE}/full_privacy/claim/pay", json={
            "claim_low":   proof["claim_low"],
            "claim_high":  proof["claim_high"],
            "recipient":   hex(WALLET_ADDRESS),
            "amount_wei":  TEST_AMOUNT_WEI,
        })
        r.raise_for_status()
        payout = r.json()
    print(f"  payout tx  : {payout['tx_hash']}")
    print(f"  message    : {payout['message']}")

    # ── 9. Post-flight balances ────────────────────────────────────────
    sep("9. POST-FLIGHT BALANCES")
    await asyncio.sleep(3)
    (wallet_bal2,) = await strk.functions["balanceOf"].call(WALLET_ADDRESS)
    (pool_bal2,)   = await strk.functions["balanceOf"].call(POOL_D_ADDRESS)
    print(f"  Wallet STRK : {wallet_bal2 / 1e18:.4f}  (Δ {(wallet_bal2 - wallet_bal) / 1e18:+.4f})")
    print(f"  Pool D STRK : {pool_bal2   / 1e18:.4f}  (Δ {(pool_bal2  - pool_bal)  / 1e18:+.4f})")

    print("\n✅ POOL D Tier-2H FULL CYCLE COMPLETE")
    print("   Deposit   →  amount/recipient hidden in claimHash")
    print("   Claim     →  ZK proof, only nullifier+claimHash public")
    print("   Payout    →  backend verified claim, transferred STRK")


if __name__ == "__main__":
    asyncio.run(main())
