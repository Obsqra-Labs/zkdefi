#!/usr/bin/env python3
"""
Initialize Ekubo limit-order extension pools for our token pairs.

Regular pools use extension=0x0. Limit order pools use extension=LIMIT_ORDERS_CONTRACT.
Both share the same token pair, fee, and tick_spacing — they're separate pools keyed
by the extension field.

This script calls `maybe_initialize_pool(pool_key, initial_tick)` on Ekubo Core
for each pair with the limit orders extension set.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.contract import Contract

from bots.chain_reader import (
    EKUBO_CORE,
    ETH, STRK, ZKDETH, ZKDAI,
    FEE_30PCT,
    _ordered,
    get_pool_price,
    PoolKey,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

LIMIT_ORDERS_CONTRACT = "0x00c4c863f6de467b91ce974be48cc17ad7209d0d600926e82845a43a7848b822"
RPC_URL = os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia")
ACCOUNT = os.getenv("BOT_ACCOUNT_ADDRESS", "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d")
PK = os.getenv("BOT_PRIVATE_KEY", "0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc")

# Pool definitions — we'll init these with the limit orders extension
POOLS = [
    {"name": "STRK/ETH", "tokenA": STRK, "tokenB": ETH, "init_tick": -82990},
    {"name": "zkdAI/zkdETH", "tokenA": ZKDAI, "tokenB": ZKDETH, "init_tick": 82000},
    {"name": "zkdAI/STRK", "tokenA": ZKDAI, "tokenB": STRK, "init_tick": -8001},
    {"name": "zkdAI/ETH", "tokenA": ZKDAI, "tokenB": ETH, "init_tick": 80999},
]


def _i129(value: int) -> dict:
    """Encode a signed integer as Ekubo's i129 struct."""
    return {"mag": abs(value), "sign": value < 0}


def _align_tick(tick: int, tick_spacing: int) -> int:
    """Align tick to tick_spacing boundary (floor)."""
    return (tick // tick_spacing) * tick_spacing


async def main():
    logger.info("Connecting to Starknet Sepolia...")
    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        client=client,
        address=int(ACCOUNT, 16),
        key_pair=KeyPair.from_private_key(int(PK, 16)),
        chain=StarknetChainId.SEPOLIA,
    )

    core_contract = await Contract.from_address(
        address=int(EKUBO_CORE, 16),
        provider=account,
        proxy_config=False,
    )
    logger.info("Connected. Core contract loaded.")

    limit_ext_int = int(LIMIT_ORDERS_CONTRACT, 16)
    tick_spacing = 1000

    for pool_def in POOLS:
        name = pool_def["name"]
        t0, t1 = _ordered(pool_def["tokenA"], pool_def["tokenB"])
        init_tick = _align_tick(pool_def["init_tick"], tick_spacing)

        pool_key = {
            "token0": int(t0, 16),
            "token1": int(t1, 16),
            "fee": FEE_30PCT,
            "tick_spacing": tick_spacing,
            "extension": limit_ext_int,
        }

        logger.info("─── %s (limit orders extension) ───", name)
        logger.info("  token0=%s, token1=%s", t0[:14] + "...", t1[:14] + "...")
        logger.info("  init_tick=%d (aligned)", init_tick)

        # Check if already initialized
        try:
            lo_pool_key = PoolKey(
                name=name + " (LO)",
                token0=t0,
                token1=t1,
                fee=FEE_30PCT,
                tick_spacing=tick_spacing,
                extension=LIMIT_ORDERS_CONTRACT,
            )
            initialized, sqrt_r, tick, price = await get_pool_price(RPC_URL, lo_pool_key)
            if initialized and sqrt_r > 0:
                logger.info("  ✅ Already initialized (tick=%d, price=%f)", tick, price)
                continue
        except Exception:
            pass  # Not initialized yet

        logger.info("  Initializing...")
        try:
            init_call = core_contract.functions["maybe_initialize_pool"].prepare_call(
                pool_key, _i129(init_tick)
            )
            from starknet_py.net.client_models import ResourceBoundsMapping
            nonce = await account.get_nonce(block_number="latest")
            # Estimate fees via prepare + estimate
            draft = await account._prepare_invoke_v3(
                [init_call],
                resource_bounds=ResourceBoundsMapping.init_with_zeros(),
                nonce=nonce,
            )
            estimated = await account.estimate_fee(draft, block_number="latest")
            rbm = estimated.to_resource_bounds()
            tx = await account.execute_v3(calls=[init_call], resource_bounds=rbm, nonce=nonce)
            await account.client.wait_for_tx(tx.transaction_hash, check_interval=3)
            logger.info("  ✅ Initialized! tx=0x%x", tx.transaction_hash)
        except Exception as exc:
            logger.error("  ❌ Failed: %s", exc)

        await asyncio.sleep(3)

    logger.info("Done! All limit order pools checked/initialized.")


if __name__ == "__main__":
    asyncio.run(main())
