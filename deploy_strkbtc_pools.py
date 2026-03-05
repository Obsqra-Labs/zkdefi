#!/usr/bin/env python3
"""
Deploy strkBTC pools on Ekubo Sepolia.

Initializes 2 pools (strkBTC/ETH, strkBTC/STRK) and seeds each with
single-sided LP using our deployed strkBTC token.

Usage:
    cd /opt/obsqra.starknet/zkdefi
    source backend/venv/bin/activate
    python deploy_strkbtc_pools.py
"""
import asyncio
import json
import logging
import math
import os
import sys
from pathlib import Path

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
logger = logging.getLogger("deploy_strkbtc_pools")

RPC_URL = os.getenv("STARKNET_RPC_URL_V08", "https://api.cartridge.gg/x/starknet/sepolia")
DEPLOYER_ADDR = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d"
DEPLOYER_PK = os.getenv(
    "FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY",
    "0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc",
)

EKUBO_CORE      = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_POSITIONS = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"

STRK    = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
ETH     = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
STRKBTC = os.getenv("STRKBTC_ADDRESS", "0x0714c3f541490e1847b77d799499ef01af7937ed0182f3b27a5b6226d993ab55")

_TWO128 = 1 << 128
FEE_30PCT = int(0.003 * _TWO128)

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

def _ordered(a: str, b: str):
    if _addr_int(a) < _addr_int(b):
        return a, b
    return b, a


POOLS = []

# strkBTC/ETH: pegged 1:1 on testnet, tick=0
t0, t1 = _ordered(STRKBTC, ETH)
raw_tick_eth = price_to_tick(1.0)
POOLS.append({
    "name": "strkBTC/ETH",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": raw_tick_eth,
    "deposit_token": STRKBTC,
    "deposit_symbol": "strkBTC",
    "deposit_amount": 100,
    "lower_tick": 1000,
    "upper_tick": 10000,
})

# strkBTC/STRK: ~7000 STRK per strkBTC
t0, t1 = _ordered(STRKBTC, STRK)
raw_tick_strk = price_to_tick(7000.0)
POOLS.append({
    "name": "strkBTC/STRK",
    "token0": t0, "token1": t1,
    "fee": FEE_30PCT, "tick_spacing": 1000,
    "init_tick": raw_tick_strk,
    "deposit_token": STRKBTC,
    "deposit_symbol": "strkBTC",
    "deposit_amount": 100,
    "lower_tick": raw_tick_strk + 1000,
    "upper_tick": raw_tick_strk + 20000,
})


async def get_account() -> Account:
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
    logger.info("  tx submitted: %s", tx_hash)
    await account.client.wait_for_tx(resp.transaction_hash)
    logger.info("  tx confirmed: %s", tx_hash)
    return tx_hash


async def main():
    logger.info("=" * 70)
    logger.info("   strkBTC Pool Deployment - Ekubo Sepolia")
    logger.info("=" * 70)
    logger.info("strkBTC address: %s", STRKBTC)
    logger.info("Computed ticks: ETH=%d, STRK=%d", price_to_tick(1.0), price_to_tick(7000.0))

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
        logger.info("--- Pool %d/%d: %s ---", idx, len(POOLS), pool["name"])

        pool_key = {
            "token0": int(pool["token0"], 16),
            "token1": int(pool["token1"], 16),
            "fee": pool["fee"],
            "tick_spacing": pool["tick_spacing"],
            "extension": 0,
        }

        aligned_tick = align_tick(pool["init_tick"], pool["tick_spacing"])
        try:
            result = await core_contract.functions["get_pool_price"].call(
                pool_key, block_number="latest"
            )
            price_data = result[0] if isinstance(result, (list, tuple)) else result
            sqrt_ratio = price_data.get("sqrt_ratio", 0) if isinstance(price_data, dict) else price_data
            if sqrt_ratio != 0:
                logger.info("  Pool already initialized (sqrt_ratio=%s)", sqrt_ratio)
                results.append({"pool": pool["name"], "init_tx": None, "status": "already_init"})
            else:
                raise ValueError("Not initialized")
        except Exception:
            logger.info("  Initializing pool at tick=%d (aligned=%d)", pool["init_tick"], aligned_tick)
            try:
                init_call = core_contract.functions["maybe_initialize_pool"].prepare_call(
                    pool_key, i129(aligned_tick)
                )
                tx = await execute_tx(account, [init_call], label=f"init-{pool['name']}")
                logger.info("  Pool initialized: %s", tx)
                results.append({"pool": pool["name"], "init_tx": tx, "status": "initialized"})
            except Exception as e:
                logger.error("  Init failed: %s", e)
                results.append({"pool": pool["name"], "init_tx": None, "status": f"init_error: {e}"})
                continue

        await asyncio.sleep(3)

        deposit_wei = int(pool["deposit_amount"] * 1e18)
        lower = align_tick(pool["lower_tick"], pool["tick_spacing"])
        upper = align_tick(pool["upper_tick"], pool["tick_spacing"], floor=False)
        logger.info("  Seeding LP: %s %s, ticks=[%d, %d]",
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

            calls = [
                token_contract.functions["transfer"].prepare_call(positions_int, deposit_wei),
                positions_contract.functions["mint_and_deposit_and_clear_both"].prepare_call(
                    pool_key, bounds, 0
                ),
            ]
            tx = await execute_tx(account, calls, label=f"lp-{pool['name']}")
            logger.info("  LP seeded: %s", tx)
            results[-1]["lp_tx"] = tx
            results[-1]["lp_amount"] = pool["deposit_amount"]
            results[-1]["lp_symbol"] = pool["deposit_symbol"]
        except Exception as e:
            logger.error("  LP seeding failed: %s", e)
            results[-1]["lp_tx"] = None
            results[-1]["lp_error"] = str(e)

        await asyncio.sleep(3)

    logger.info("")
    logger.info("=" * 70)
    logger.info("   DEPLOYMENT SUMMARY")
    logger.info("=" * 70)
    for r in results:
        init_ok = "OK" if r.get("init_tx") or r["status"] == "already_init" else "FAIL"
        lp_ok = "OK" if r.get("lp_tx") else "FAIL"
        lp_hash = r.get("lp_tx", "none")[:20] if r.get("lp_tx") else "failed"
        logger.info("  %s %s  init=%s  lp=%s", init_ok, r["pool"], r["status"], lp_hash)

    out_path = Path("deploy_strkbtc_pools_results.json")
    out_path.write_text(json.dumps(results, indent=2, default=str))
    logger.info("Results saved to %s", out_path)


if __name__ == "__main__":
    asyncio.run(main())
