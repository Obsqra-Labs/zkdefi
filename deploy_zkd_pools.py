#!/usr/bin/env python3
"""
Deploy zkDeFi token pools on Ekubo Sepolia.

Initializes 5 pools (zkdAI/zkdETH, STRK/zkdETH, zkdAI/STRK, ETH/zkdETH, zkdAI/ETH)
and seeds each with single-sided LP using tokens we have plenty of (zkdAI, zkdETH).

Usage:
    cd /opt/obsqra.starknet/zkdefi
    source backend/venv/bin/activate
    python deploy_zkd_pools.py
"""
import asyncio
import json
import logging
import math
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
os.chdir(str(Path(__file__).resolve().parent))

from dotenv import load_dotenv
load_dotenv("backend/.env")

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.contract import Contract

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("deploy_zkd_pools")

# ── Constants ────────────────────────────────────────────────────────────────
RPC_URL = os.getenv("STARKNET_RPC_URL_V08", "https://api.cartridge.gg/x/starknet/sepolia")
DEPLOYER_ADDR = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
DEPLOYER_PK = os.getenv(
    "FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY",
    "",
)

EKUBO_CORE      = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_POSITIONS = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"

# Token addresses (Sepolia)
STRK   = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
ETH    = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
ZKDETH = "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121"
ZKDAI  = "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637"

# Sorting order by address: zkdETH < STRK < ETH < zkdAI
# zkdETH= 0x009b...
# STRK  = 0x0471...
# ETH   = 0x049d...
# zkdAI = 0x0509...

# Fee tier encoding: fee = fraction * 2^128
_TWO128 = 1 << 128
FEE_30PCT = int(0.003 * _TWO128)

# ── Tick math ────────────────────────────────────────────────────────────────
_LOG10001 = math.log(1.0001)

def price_to_tick(price: float) -> int:
    if price <= 0:
        return -100000
    return math.floor(math.log(price) / _LOG10001)

def align_tick(tick: int, tick_spacing: int, *, floor: bool = True) -> int:
    if floor:
        return (tick // tick_spacing) * tick_spacing
    return math.ceil(tick / tick_spacing) * tick_spacing

def i129(value: int) -> dict:
    return {"mag": abs(value), "sign": value < 0}

def _addr_int(a: str) -> int:
    return int(a, 16)

def _ordered(a: str, b: str) -> tuple[str, str]:
    if _addr_int(a) < _addr_int(b):
        return a, b
    return b, a


# ── Pool Definitions ─────────────────────────────────────────────────────────
# Price = token1_amount / token0_amount  (how much token1 for 1 token0)
# Prices: STRK=$0.50, ETH=$3500, zkdETH=$3500, zkdAI=$1.0
# Ordering: zkdETH < STRK < ETH < zkdAI

POOLS = []

# Pool 1: zkdETH/zkdAI  (token0=zkdETH, token1=zkdAI)
# Price = zkdAI_per_zkdETH = 3500/1 = 3500  → tick ≈ 81517
t0, t1 = _ordered(ZKDETH, ZKDAI)
assert t0 == ZKDETH and t1 == ZKDAI, f"Expected zkdETH<zkdAI, got {t0},{t1}"
POOLS.append({
    "name": "zkdAI/zkdETH",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": 82000,
    # Deposit token1 (zkdAI) in range BELOW current tick
    "deposit_token": ZKDAI,
    "deposit_symbol": "zkdAI",
    "deposit_amount": 50_000,
    "lower_tick": 64000,
    "upper_tick": 81000,
})

# Pool 2: zkdETH/STRK  (token0=zkdETH, token1=STRK)
# Price = STRK_per_zkdETH = 3500/0.50 = 7000  → tick ≈ 88574
t0, t1 = _ordered(ZKDETH, STRK)
assert t0 == ZKDETH and t1 == STRK, f"Expected zkdETH<STRK, got {t0},{t1}"
POOLS.append({
    "name": "STRK/zkdETH",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": 88000,
    # Deposit token0 (zkdETH) in range ABOVE current tick
    "deposit_token": ZKDETH,
    "deposit_symbol": "zkdETH",
    "deposit_amount": 10,
    "lower_tick": 89000,
    "upper_tick": 110000,
})

# Pool 3: STRK/zkdAI  (token0=STRK, token1=zkdAI)
# Price = zkdAI_per_STRK = 0.50/1 = 0.50  → tick ≈ -6931
t0, t1 = _ordered(STRK, ZKDAI)
assert t0 == STRK and t1 == ZKDAI, f"Expected STRK<zkdAI, got {t0},{t1}"
POOLS.append({
    "name": "zkdAI/STRK",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": -7000,
    # Deposit token1 (zkdAI) in range BELOW current tick
    "deposit_token": ZKDAI,
    "deposit_symbol": "zkdAI",
    "deposit_amount": 50_000,
    "lower_tick": -26000,
    "upper_tick": -8000,
})

# Pool 4: zkdETH/ETH  (token0=zkdETH, token1=ETH)
# Price = ETH_per_zkdETH = 3500/3500 = 1.0  → tick ≈ 0
t0, t1 = _ordered(ZKDETH, ETH)
assert t0 == ZKDETH and t1 == ETH, f"Expected zkdETH<ETH, got {t0},{t1}"
POOLS.append({
    "name": "ETH/zkdETH",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": 0,
    # Deposit token0 (zkdETH) in range ABOVE current tick
    "deposit_token": ZKDETH,
    "deposit_symbol": "zkdETH",
    "deposit_amount": 10,
    "lower_tick": 1000,
    "upper_tick": 10000,
})

# Pool 5: ETH/zkdAI  (token0=ETH, token1=zkdAI)
# Price = zkdAI_per_ETH = 3500/1 = 3500  → tick ≈ 81517
t0, t1 = _ordered(ETH, ZKDAI)
assert t0 == ETH and t1 == ZKDAI, f"Expected ETH<zkdAI, got {t0},{t1}"
POOLS.append({
    "name": "zkdAI/ETH",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": 82000,
    # Deposit token1 (zkdAI) in range BELOW current tick
    "deposit_token": ZKDAI,
    "deposit_symbol": "zkdAI",
    "deposit_amount": 50_000,
    "lower_tick": 64000,
    "upper_tick": 81000,
})


# ── Account setup ────────────────────────────────────────────────────────────
async def get_account() -> Account:
    if not DEPLOYER_PK:
        raise RuntimeError("Set FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY in env before deploying pools")
    client = FullNodeClient(node_url=RPC_URL)
    pk_int = int(DEPLOYER_PK, 16) if DEPLOYER_PK.startswith("0x") else int(DEPLOYER_PK)
    addr_int = int(DEPLOYER_ADDR, 16) if DEPLOYER_ADDR.startswith("0x") else int(DEPLOYER_ADDR)
    account = Account(
        address=addr_int,
        client=client,
        key_pair=KeyPair.from_private_key(pk_int),
        chain=StarknetChainId.SEPOLIA,
    )
    account._cairo_version = 1
    return account


async def execute_tx(account: Account, calls: list, label: str = "") -> str:
    """Submit multicall with v3 resource bounds."""
    from starknet_py.net.client_models import ResourceBoundsMapping as _RBM

    nonce = await account.get_nonce(block_number="latest")
    draft = await account._prepare_invoke_v3(
        calls, resource_bounds=_RBM.init_with_zeros(), nonce=nonce
    )
    estimated = await account.estimate_fee(draft, block_number="latest")
    rbm = estimated.to_resource_bounds()
    logger.info("  %s fee estimate: %s", label, rbm)
    resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
    tx_hash = hex(resp.transaction_hash)
    logger.info("  tx submitted: %s — waiting...", tx_hash)
    await account.client.wait_for_tx(resp.transaction_hash)
    logger.info("  tx confirmed: %s", tx_hash)
    return tx_hash


# ── Main ─────────────────────────────────────────────────────────────────────
async def main():
    logger.info("=" * 70)
    logger.info("   zkDeFi Pool Deployment — Ekubo Sepolia")
    logger.info("=" * 70)

    account = await get_account()
    core_contract = await Contract.from_address(
        address=int(EKUBO_CORE, 16), provider=account, proxy_config=False,
    )
    positions_contract = await Contract.from_address(
        address=int(EKUBO_POSITIONS, 16), provider=account, proxy_config=False,
    )

    results = []

    for idx, pool in enumerate(POOLS, 1):
        logger.info("")
        logger.info("─── Pool %d/%d: %s ───", idx, len(POOLS), pool["name"])

        pool_key = {
            "token0": int(pool["token0"], 16),
            "token1": int(pool["token1"], 16),
            "fee": pool["fee"],
            "tick_spacing": pool["tick_spacing"],
            "extension": 0,
        }

        # Step A: Initialize pool (skip if already done)
        logger.info("  A) Checking pool initialization...")
        aligned_tick = align_tick(pool["init_tick"], pool["tick_spacing"])
        try:
            # Check if already initialized by reading pool price
            pool_key_for_check = {
                "token0": int(pool["token0"], 16),
                "token1": int(pool["token1"], 16),
                "fee": pool["fee"],
                "tick_spacing": pool["tick_spacing"],
                "extension": 0,
            }
            result = await core_contract.functions["get_pool_price"].call(
                pool_key_for_check, block_number="latest"
            )
            price_data = result[0] if isinstance(result, (list, tuple)) else result
            sqrt_ratio = price_data.get("sqrt_ratio", 0) if isinstance(price_data, dict) else price_data
            if sqrt_ratio != 0:
                logger.info("  ✓ Pool already initialized (sqrt_ratio=%s)", sqrt_ratio)
                results.append({"pool": pool["name"], "init_tx": None, "status": "already_init"})
            else:
                raise ValueError("Not initialized")
        except Exception:
            logger.info("  A) Initializing pool at tick=%d ...", aligned_tick)
            try:
                init_call = core_contract.functions["maybe_initialize_pool"].prepare_call(
                    pool_key, i129(aligned_tick)
                )
                tx = await execute_tx(account, [init_call], label=f"init-{pool['name']}")
                logger.info("  ✓ Pool initialized: %s", tx)
                results.append({"pool": pool["name"], "init_tx": tx, "status": "initialized"})
            except Exception as e:
                logger.error("  ✗ Init failed: %s", e)
                results.append({"pool": pool["name"], "init_tx": None, "status": f"init_error: {e}"})
                continue

        await asyncio.sleep(3)

        # Step B: Seed LP
        deposit_wei = int(pool["deposit_amount"] * 1e18)
        lower = align_tick(pool["lower_tick"], pool["tick_spacing"])
        upper = align_tick(pool["upper_tick"], pool["tick_spacing"], floor=False)
        logger.info("  B) Seeding LP: %s %s, ticks=[%d, %d]",
                     pool["deposit_amount"], pool["deposit_symbol"], lower, upper)

        try:
            token_contract = await Contract.from_address(
                address=int(pool["deposit_token"], 16),
                provider=account,
                proxy_config=False,
            )

            bounds = {
                "lower": i129(lower),
                "upper": i129(upper),
            }

            positions_int = int(EKUBO_POSITIONS, 16)

            # Ekubo Positions uses a push model for deposit():
            # 1) transfer tokens to Positions
            # 2) mint_and_deposit reads Positions balances
            # 3) clear both tokens back to caller
            calls = [
                token_contract.functions["transfer"].prepare_call(positions_int, deposit_wei),
                positions_contract.functions["mint_and_deposit_and_clear_both"].prepare_call(
                    pool_key, bounds, 0  # min_liquidity=0
                ),
            ]
            tx = await execute_tx(account, calls, label=f"lp-{pool['name']}")
            logger.info("  ✓ LP seeded: %s", tx)
            results[-1]["lp_tx"] = tx
            results[-1]["lp_amount"] = pool["deposit_amount"]
            results[-1]["lp_symbol"] = pool["deposit_symbol"]
        except Exception as e:
            logger.error("  ✗ LP seeding failed: %s", e)
            results[-1]["lp_tx"] = None
            results[-1]["lp_error"] = str(e)

        await asyncio.sleep(3)

    # Summary
    logger.info("")
    logger.info("=" * 70)
    logger.info("   DEPLOYMENT SUMMARY")
    logger.info("=" * 70)
    for r in results:
        init_status = "✓" if r.get("init_tx") or r["status"] == "already_init" else "✗"
        lp_status = "✓" if r.get("lp_tx") else "✗"
        logger.info("  %s %s  init=%s  lp=%s", init_status, r["pool"],
                     r["status"], r.get("lp_tx", "none")[:20] if r.get("lp_tx") else "failed")

    # Save results
    out_path = Path("deploy_zkd_pools_results.json")
    out_path.write_text(json.dumps(results, indent=2, default=str))
    logger.info("Results saved to %s", out_path)


if __name__ == "__main__":
    asyncio.run(main())
