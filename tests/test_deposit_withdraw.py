"""
End-to-end test: deposit 1 STRK into Full Privacy Pool, then withdraw it.
Uses the backend API for commitment + proof generation and starknet-py for on-chain calls.
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

# ── Config ──────────────────────────────────────────────────────────────────
WALLET_ADDRESS = 0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
PRIVATE_KEY_HEX = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", "")
POOL_ADDRESS   = 0x03dde5617d362a6f9202cd3955b4508e2bd6b1c5d35250153beeb6237c811559
STRK_ADDRESS   = 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
RPC_URL        = "https://api.cartridge.gg/x/starknet/sepolia"
API_BASE       = "http://localhost:8003/api/v1/zkdefi/full_privacy"
TEST_AMOUNT_WEI = str(1 * 10**18)   # 1 STRK
POOL_TYPE       = 1                  # Neutral
# ────────────────────────────────────────────────────────────────────────────

STRK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001
U128 = 2**128


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
        address=WALLET_ADDRESS,
        client=client,
        key_pair=key_pair,
        chain=StarknetChainId.SEPOLIA,
    ), client


async def execute_calls(account, calls):
    """Submit multicall and wait for confirmation."""
    nonce = await account.get_nonce(block_number="latest")
    from starknet_py.net.client_models import ResourceBounds, ResourceBoundsMapping
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
    rbm = estimated.to_resource_bounds()
    resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
    print(f"  ↳ tx hash: {hex(resp.transaction_hash)}")
    print(f"  ↳ waiting for receipt...")
    await account.client.wait_for_tx(resp.transaction_hash)
    print(f"  ↳ confirmed ✓")
    return resp.transaction_hash


async def main():
    acc, client = await build_account()

    # ── 0. Check balances ──────────────────────────────────────────────────
    sep("0. PRE-FLIGHT BALANCES")
    strk = await Contract.from_address(STRK_ADDRESS, acc)
    (strk_bal,) = await strk.functions["balanceOf"].call(WALLET_ADDRESS)
    print(f"  Wallet STRK: {strk_bal / 1e18:.4f}")
    pool_contract = await Contract.from_address(POOL_ADDRESS, acc)
    (pool_bal,) = await strk.functions["balanceOf"].call(POOL_ADDRESS)
    print(f"  Pool STRK  : {pool_bal / 1e18:.4f}")

    # ── 1. Generate commitment ─────────────────────────────────────────────
    sep("1. GENERATE DEPOSIT COMMITMENT")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post(f"{API_BASE}/deposit/generate_commitment", json={
            "user_address": hex(WALLET_ADDRESS),
            "amount": TEST_AMOUNT_WEI,
            "pool_type": POOL_TYPE,
        })
        r.raise_for_status()
        commitment_data = r.json()

    commitment_hex = commitment_data["commitment"]
    user_secret    = commitment_data["user_secret"]
    nonce_hex      = commitment_data["nonce"]
    blinding_hex   = commitment_data["blinding"]
    print(f"  commitment : {commitment_hex[:40]}...")
    print(f"  user_secret: {user_secret[:20]}...")

    # ── 2. On-chain: approve + deposit ────────────────────────────────────
    sep("2. ON-CHAIN DEPOSIT (approve + deposit_u256)")
    amount_int = int(TEST_AMOUNT_WEI)
    amount_lo, amount_hi = lo_hi(amount_int)

    # commitment as u256 low/high
    comm_int = int(commitment_hex, 16) if commitment_hex.startswith("0x") else int(commitment_hex)
    comm_lo, comm_hi = lo_hi(comm_int)

    from starknet_py.net.client_models import Call
    from starknet_py.hash.selector import get_selector_from_name

    approve_call = Call(
        to_addr=STRK_ADDRESS,
        selector=get_selector_from_name("approve"),
        calldata=[POOL_ADDRESS, amount_lo, amount_hi],  # spender, amount.low, amount.high
    )
    # deposit_u256(commitment_low: u128, commitment_high: u128, amount: u256)
    deposit_call = Call(
        to_addr=POOL_ADDRESS,
        selector=get_selector_from_name("deposit_u256"),
        calldata=[comm_lo, comm_hi, amount_lo, amount_hi],
    )

    tx_hash = await execute_calls(acc, [approve_call, deposit_call])
    print(f"  deposit tx: {hex(tx_hash)}")

    # ── 3. Register commitment in Merkle tree ─────────────────────────────
    sep("3. REGISTER COMMITMENT IN MERKLE TREE")
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(f"{API_BASE}/deposit/register_commitment", json={
            "commitment": commitment_hex,
        })
        if r.status_code == 503:
            print("  WARN: root registration pending (advisory) — continuing")
            reg = r.json()
        else:
            r.raise_for_status()
            reg = r.json()

    leaf_index = reg["leaf_index"]
    merkle_root = reg["merkle_root"]
    path_elements = reg["path_elements"]
    path_indices = reg["path_indices"]
    print(f"  leaf_index : {leaf_index}")
    print(f"  merkle_root: {merkle_root[:40]}...")

    # ── 4. Generate withdrawal ZK proof ──────────────────────────────────
    sep("4. GENERATE WITHDRAWAL PROOF (snarkjs)")
    print("  (this can take 30-120s, please wait)")
    t0 = time.time()
    async with httpx.AsyncClient(timeout=300) as http:
        r = await http.post(f"{API_BASE}/withdraw/generate_proof", json={
            "user_secret": user_secret,
            "amount": TEST_AMOUNT_WEI,
            "pool_type": POOL_TYPE,
            "nonce": nonce_hex,
            "blinding": blinding_hex,
            "withdraw_amount": TEST_AMOUNT_WEI,
            "recipient": hex(WALLET_ADDRESS),
            "leaf_index": leaf_index,
            "merkle_root": merkle_root,
            "path_elements": path_elements,
            "path_indices": path_indices,
        })
        r.raise_for_status()
        proof_data = r.json()

    print(f"  proof generated in {time.time()-t0:.1f}s")
    print(f"  nullifier  : {proof_data['nullifier'][:40]}...")
    print(f"  root       : {proof_data['root'][:40]}...")

    # ── 5. Ensure Merkle root is on-chain ────────────────────────────────
    sep("5. ENSURE ROOT ON-CHAIN")
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(f"{API_BASE}/merkle/ensure_root", json={"root": proof_data["root"]})
        r.raise_for_status()
        ensure = r.json()
    print(f"  ok={ensure['ok']} was_already_known={ensure.get('was_already_known')}")

    # ── 6. On-chain withdrawal ────────────────────────────────────────────
    sep("6. ON-CHAIN WITHDRAWAL (withdraw_u256)")

    # Parse proof public outputs
    null_int = int(proof_data["nullifier"], 16) if proof_data["nullifier"].startswith("0x") else int(proof_data["nullifier"])
    root_int = int(proof_data["root"], 16)      if proof_data["root"].startswith("0x")       else int(proof_data["root"])
    null_lo, null_hi = lo_hi(null_int)
    root_lo, root_hi = lo_hi(root_int)

    # amount split
    amt_lo, amt_hi = lo_hi(amount_int)
    assert amt_hi == 0, f"amount_high should be 0 for amounts < 2^128 wei, got {amt_hi}"

    # proof calldata: reduce each element mod STARK_PRIME
    def parse_felt(p):
        s = str(p).strip()
        return int(s, 16) if s.startswith("0x") else int(s)
    proof_felts = [str(parse_felt(p) % STRK_PRIME) for p in proof_data["proof_calldata"]]

    # Calldata matches Cairo signature exactly:
    # withdraw_u256(null_lo, null_hi, root_lo, root_hi, recipient, amount: u256, pool_type, zk_proof)
    # u256 on-chain = two consecutive felts: low then high
    calldata = [
        str(null_lo),
        str(null_hi),
        str(root_lo),
        str(root_hi),
        hex(WALLET_ADDRESS),   # recipient ContractAddress
        str(amt_lo),           # amount.low
        str(amt_hi),           # amount.high
        str(POOL_TYPE),        # pool_type u8
        str(len(proof_felts)), # zk_proof span len
        *proof_felts,
    ]

    print(f"  calldata length: {len(calldata)}")
    print(f"  param#0 null_lo : {calldata[0]}")
    print(f"  param#5 amt_lo  : {calldata[5]}  (should be {amt_lo})")
    print(f"  param#6 amt_hi  : {calldata[6]}  (should be 0)")
    print(f"  param#7 pool_typ: {calldata[7]}  (should be {POOL_TYPE})")

    from starknet_py.net.client_models import Call
    withdraw_call = Call(
        to_addr=POOL_ADDRESS,
        selector=0x01e2100936b704f07c814b5fa83a19bcfa007fe179ec6e547a8db758b67066fc,
        calldata=[int(x, 16) if str(x).startswith("0x") else int(x) for x in calldata],
    )

    tx_hash = await execute_calls(acc, [withdraw_call])
    print(f"\n✅ WITHDRAW TX: {hex(tx_hash)}")

    # ── 7. Confirm balances ───────────────────────────────────────────────
    sep("7. POST-FLIGHT BALANCES")
    await asyncio.sleep(3)
    (strk_bal2,) = await strk.functions["balanceOf"].call(WALLET_ADDRESS)
    (pool_bal2,) = await strk.functions["balanceOf"].call(POOL_ADDRESS)
    print(f"  Wallet STRK: {strk_bal2 / 1e18:.4f}  (Δ {(strk_bal2-strk_bal)/1e18:+.4f})")
    print(f"  Pool STRK  : {pool_bal2 / 1e18:.4f}  (Δ {(pool_bal2-pool_bal)/1e18:+.4f})")
    print("\n✅ ALL DONE")


if __name__ == "__main__":
    asyncio.run(main())
