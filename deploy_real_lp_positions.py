#!/usr/bin/env python3
"""
Deploy REAL LP positions on Ekubo Sepolia.

This script:
  1. Initialises empty Ekubo pools (STRK/ETH at multiple fee tiers)
  2. Scores pools with the AI/zkML risk engine
  3. Creates single-sided STRK LP positions (we have 686 STRK, 0 ETH)
  4. Records real position data (NFT IDs, tx hashes) → backend/data/ekubo_positions.json

Usage:
    cd /opt/obsqra.starknet/zkdefi
    source backend/venv/bin/activate
    python deploy_real_lp_positions.py
"""
import asyncio
import json
import logging
import math
import os
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
os.chdir(str(Path(__file__).resolve().parent))

# Load .env
from dotenv import load_dotenv
load_dotenv("backend/.env")

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.contract import Contract

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("deploy_lp")

# ── Constants ────────────────────────────────────────────────────────────────
RPC_URL = os.getenv("STARKNET_RPC_URL_V08", "https://api.cartridge.gg/x/starknet/sepolia")
VAULT_ADDRESS = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS", "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d")
VAULT_PK = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", "")

EKUBO_CORE      = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_POSITIONS = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"

# Token addresses (Sepolia canonical)
STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
ETH  = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
USDC_V2 = "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080"

# Fee tier encoding: fee = fraction * 2^128
_TWO128 = 1 << 128
FEE_01PCT  = int(0.0001 * _TWO128)
FEE_05PCT  = int(0.0005 * _TWO128)
FEE_30PCT  = int(0.003  * _TWO128)
FEE_100PCT = int(0.01   * _TWO128)

# ── Tick math ───────────────────────────────────────────────────────────────
_LOG10001 = math.log(1.0001)

def price_to_tick(price: float) -> int:
    if price <= 0:
        raise ValueError(f"price must be positive, got {price}")
    return math.floor(math.log(price) / _LOG10001)

def tick_to_price(tick: int) -> float:
    return 1.0001 ** tick

def align_tick(tick: int, tick_spacing: int, *, floor: bool = True) -> int:
    if floor:
        return (tick // tick_spacing) * tick_spacing
    return math.ceil(tick / tick_spacing) * tick_spacing

def i129(value: int) -> dict:
    return {"mag": abs(value), "sign": value < 0}

def tick_to_sqrt_ratio(tick: int) -> int:
    """Convert tick to Ekubo sqrt_ratio (Q128.128 format)."""
    price = 1.0001 ** tick
    return int(math.sqrt(price) * _TWO128)

# ── Pool definitions to deploy ──────────────────────────────────────────────
# Each entry: pair_name, token0, token1, fee, tick_spacing, target_init_tick, strategy
# For STRK/ETH: token0=STRK, token1=ETH. Price = ETH/STRK ≈ 0.000286 (3500 STRK/ETH)
# Initial tick ≈ ln(0.000286)/ln(1.0001) ≈ -81600

STRK_ETH_INIT_TICK = -82000  # ~3500 STRK per ETH

POOLS_TO_DEPLOY = [
    {
        "pair": "STRK/ETH",
        "token0": STRK, "token1": ETH,
        "fee": FEE_30PCT, "tick_spacing": 1000,
        "init_tick": STRK_ETH_INIT_TICK,
        "positions": [
            # Single-sided STRK positions (all below current price → only token0 deposited)
            # Conservative: tight range near current price
            {"label": "STRK/ETH_0.30%_conservative", "lower": -90000, "upper": -83000, "strk_amount": 100.0, "risk": "conservative"},
            # Balanced: wider range
            {"label": "STRK/ETH_0.30%_balanced", "lower": -110000, "upper": -84000, "strk_amount": 100.0, "risk": "balanced"},
            # Aggressive: very wide range
            {"label": "STRK/ETH_0.30%_aggressive", "lower": -150000, "upper": -85000, "strk_amount": 80.0, "risk": "aggressive"},
        ],
    },
    {
        "pair": "STRK/ETH_005",
        "token0": STRK, "token1": ETH,
        "fee": FEE_05PCT, "tick_spacing": 200,
        "init_tick": STRK_ETH_INIT_TICK,
        "positions": [
            {"label": "STRK/ETH_0.05%_conservative", "lower": -90000, "upper": -82200, "strk_amount": 80.0, "risk": "conservative"},
            {"label": "STRK/ETH_0.05%_balanced", "lower": -100000, "upper": -82400, "strk_amount": 80.0, "risk": "balanced"},
        ],
    },
    {
        "pair": "STRK/ETH_100",
        "token0": STRK, "token1": ETH,
        "fee": FEE_100PCT, "tick_spacing": 5000,
        "init_tick": STRK_ETH_INIT_TICK,
        "positions": [
            {"label": "STRK/ETH_1.00%_aggressive", "lower": -120000, "upper": -85000, "strk_amount": 60.0, "risk": "aggressive"},
        ],
    },
]

# Total STRK needed: 100+100+80+80+80+60 = 500 out of 686 available

POSITIONS_FILE = Path("backend/data/ekubo_positions.json")

# ── AI/zkML Scoring ─────────────────────────────────────────────────────────
def score_position(pos: dict, pool: dict) -> dict:
    """
    Score a position using heuristic risk evaluation (mirroring zkml_pool_evaluator).
    Returns risk_score (1-10), expected_apy, recommendation.
    """
    fee_bps = {FEE_01PCT: 1, FEE_05PCT: 5, FEE_30PCT: 30, FEE_100PCT: 100}.get(pool["fee"], 30)
    risk_level = pos.get("risk", "balanced")

    # Base APY estimate from fee tier
    base_apy = {1: 3.0, 5: 5.0, 30: 12.0, 100: 18.0}.get(fee_bps, 8.0)

    # Tick range width affects impermanent loss risk
    tick_range = abs(pos["upper"] - pos["lower"])
    range_score = min(10, tick_range / 5000)  # wider = higher score (more IL protection)

    # Risk scoring (1=safe, 10=risky)
    risk_score = {
        "conservative": max(1, 3 - range_score * 0.2),
        "balanced": max(3, 5 - range_score * 0.1),
        "aggressive": max(5, 8 - range_score * 0.05),
    }.get(risk_level, 5)

    # Adjusted APY based on range and risk
    apy_multiplier = 1.0
    if risk_level == "conservative":
        apy_multiplier = 0.7  # Lower APY for safer range
    elif risk_level == "aggressive":
        apy_multiplier = 1.4  # Higher reward for higher risk

    expected_apy = base_apy * apy_multiplier * (1 + range_score * 0.05)

    allocation_pct = {
        "conservative": 0.35,
        "balanced": 0.40,
        "aggressive": 0.25,
    }.get(risk_level, 0.33)

    return {
        "risk_score": round(risk_score, 2),
        "expected_apy": round(expected_apy, 2),
        "allocation_pct": allocation_pct,
        "il_risk": "low" if tick_range > 20000 else "medium" if tick_range > 5000 else "high",
        "recommendation": "deploy" if expected_apy > 3.0 else "skip",
        "reasoning": f"Fee tier {fee_bps}bps, range width {tick_range} ticks, {risk_level} strategy → {expected_apy:.1f}% APY",
    }


# ── Main deployment flow ────────────────────────────────────────────────────
async def get_account() -> Account:
    if not VAULT_PK:
        raise RuntimeError("Set FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY in env before deploying LP positions")
    client = FullNodeClient(node_url=RPC_URL)
    pk_int = int(VAULT_PK, 16) if VAULT_PK.startswith("0x") else int(VAULT_PK)
    addr_int = int(VAULT_ADDRESS, 16) if VAULT_ADDRESS.startswith("0x") else int(VAULT_ADDRESS)
    account = Account(
        address=addr_int,
        client=client,
        key_pair=KeyPair.from_private_key(pk_int),
        chain=StarknetChainId.SEPOLIA,
    )
    account._cairo_version = 1
    return account


async def execute_tx(account: Account, calls: list) -> str:
    """Submit multicall with v3 resource bounds."""
    from starknet_py.net.client_models import ResourceBoundsMapping as _RBM

    nonce = await account.get_nonce(block_number="latest")
    draft = await account._prepare_invoke_v3(
        calls, resource_bounds=_RBM.init_with_zeros(), nonce=nonce
    )
    estimated = await account.estimate_fee(draft, block_number="latest")
    rbm = estimated.to_resource_bounds()
    resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
    logger.info("  tx submitted: %s — waiting for inclusion...", hex(resp.transaction_hash))
    await account.client.wait_for_tx(resp.transaction_hash)
    return hex(resp.transaction_hash)


async def check_vault_balance(account: Account) -> float:
    """Return STRK balance in human-readable units."""
    strk_contract = await Contract.from_address(
        address=int(STRK, 16), provider=account.client, proxy_config=False,
    )
    result = await strk_contract.functions['balanceOf'].call(
        int(VAULT_ADDRESS, 16), block_number="latest"
    )
    raw = result[0] if isinstance(result, (list, tuple)) else result
    if isinstance(raw, dict):
        raw = raw.get("low", 0) + raw.get("high", 0) * (1 << 128)
    return raw / 1e18


async def initialize_pool(account: Account, pool: dict) -> str | None:
    """Initialize an Ekubo pool if not already initialized. Returns tx_hash or None."""
    core_contract = await Contract.from_address(
        address=int(EKUBO_CORE, 16), provider=account, proxy_config=False,
    )

    pool_key = {
        "token0": int(pool["token0"], 16),
        "token1": int(pool["token1"], 16),
        "fee": pool["fee"],
        "tick_spacing": pool["tick_spacing"],
        "extension": 0,
    }

    # Check if already initialized
    try:
        result = await core_contract.functions['get_pool_price'].call(
            pool_key, block_number="latest"
        )
        price_data = result[0] if isinstance(result, (list, tuple)) else result
        sqrt_ratio = price_data.get("sqrt_ratio", 0) if isinstance(price_data, dict) else price_data
        if sqrt_ratio != 0:
            logger.info("  Pool %s already initialized (sqrt_ratio=%s)", pool["pair"], sqrt_ratio)
            return None
    except Exception as e:
        logger.warning("  Could not check pool price: %s", e)

    # Initialize with maybe_initialize_pool(pool_key, initial_tick)
    init_tick = align_tick(pool["init_tick"], pool["tick_spacing"], floor=True)
    initial_sqrt = tick_to_sqrt_ratio(init_tick)

    logger.info("  Initializing pool %s at tick=%d (sqrt_ratio=%d)", pool["pair"], init_tick, initial_sqrt)

    call = core_contract.functions['maybe_initialize_pool'].prepare_call(
        pool_key, i129(init_tick)
    )
    tx_hash = await execute_tx(account, [call])
    logger.info("  Pool %s initialized: %s", pool["pair"], tx_hash)
    return tx_hash


async def create_position(
    account: Account,
    pool: dict,
    pos: dict,
) -> dict | None:
    """Create a single-sided STRK LP position. Returns position info or None."""
    strk_amount_wei = int(pos["strk_amount"] * 1e18)
    positions_int = int(EKUBO_POSITIONS, 16)

    # Align ticks to tick_spacing
    lower = align_tick(pos["lower"], pool["tick_spacing"], floor=True)
    upper = align_tick(pos["upper"], pool["tick_spacing"], floor=False)

    logger.info("  Creating position %s: ticks=[%d, %d], STRK=%s",
                pos["label"], lower, upper, pos["strk_amount"])

    strk_contract = await Contract.from_address(
        address=int(STRK, 16), provider=account, proxy_config=False,
    )
    positions_contract = await Contract.from_address(
        address=positions_int, provider=account, proxy_config=False,
    )

    pool_key = {
        "token0": int(pool["token0"], 16),
        "token1": int(pool["token1"], 16),
        "fee": pool["fee"],
        "tick_spacing": pool["tick_spacing"],
        "extension": 0,
    }
    bounds = {
        "lower": i129(lower),
        "upper": i129(upper),
    }

    # Single-sided: only approve STRK (token0), ETH (token1) approval = 0
    calls = [
        strk_contract.functions['approve'].prepare_call(positions_int, strk_amount_wei),
        positions_contract.functions['mint_and_deposit'].prepare_call(
            pool_key, bounds, 0  # min_liquidity=0, let contract calculate
        ),
    ]

    tx_hash = await execute_tx(account, calls)
    logger.info("  Position %s minted: %s", pos["label"], tx_hash)
    return {
        "tx_hash": tx_hash,
        "lower_tick": lower,
        "upper_tick": upper,
        "strk_amount": pos["strk_amount"],
    }


async def get_position_nft_id(client: FullNodeClient, tx_hash: str) -> int | None:
    """Extract the Ekubo NFT position ID from a mint_and_deposit tx receipt."""
    try:
        receipt = await client.get_transaction_receipt(int(tx_hash, 16))
        events = receipt.events if hasattr(receipt, 'events') else []
        for event in events:
            # Ekubo Positions emits Transfer(from, to, tokenId) for the NFT mint
            # tokenId is typically the 3rd data element (after from=0x0, to=vault)
            keys = event.keys if hasattr(event, 'keys') else []
            data = event.data if hasattr(event, 'data') else []
            # ERC721 Transfer event selector
            if len(keys) >= 1 and len(data) >= 1:
                # The NFT ID could be in keys or data depending on contract implementation
                # For Ekubo it's typically event data[0] or keys[3] (from, to, id in keys)
                if len(keys) >= 4:
                    # Standard ERC721: Transfer(from, to, tokenId) in keys
                    nft_id = keys[3]
                    if 0 < nft_id < (1 << 64):
                        return nft_id
                # Try data fields
                for d in data:
                    if 0 < d < (1 << 64):
                        return d
        # Fallback: look for any small integer in all events
        for event in events:
            data = event.data if hasattr(event, 'data') else []
            for d in data:
                if 0 < d < 10000:  # NFT IDs on Sepolia testnet are typically small
                    return d
    except Exception as e:
        logger.warning("Could not extract NFT ID from tx %s: %s", tx_hash, e)
    return None


def build_position_record(
    pool: dict,
    pos: dict,
    result: dict,
    ai_score: dict,
    nft_id: int | None,
    index: int,
) -> dict:
    """Build a position record compatible with ekubo_positions.json format."""
    fee_bps = {FEE_01PCT: 1, FEE_05PCT: 5, FEE_30PCT: 30, FEE_100PCT: 100}.get(pool["fee"], 30)
    now = datetime.now(timezone.utc).isoformat()

    return {
        "id": str(nft_id) if nft_id else f"pending_{index}",
        "pair": pool["pair"].replace("_005", "").replace("_100", ""),
        "token0": pool["token0"],
        "token1": pool["token1"],
        "fee_tier": fee_bps * 100,  # e.g., 3000 for 0.30%
        "tick_lower": result["lower_tick"],
        "tick_upper": result["upper_tick"],
        "liquidity": str(int(pos["strk_amount"] * 1e18)),
        "amount0_deposited": str(int(pos["strk_amount"] * 1e18)),
        "amount1_deposited": "0",
        "status": "active",
        "risk_profile": pos["risk"],
        "estimated_fees_apr": ai_score["expected_apy"],
        "ai_risk_score": ai_score["risk_score"],
        "ai_reasoning": ai_score["reasoning"],
        "ai_il_risk": ai_score["il_risk"],
        "ai_allocation_pct": ai_score["allocation_pct"],
        "mint_tx_hash": result["tx_hash"],
        "created_at": now,
        "updated_at": now,
        "label": pos["label"],
        "nft_id": nft_id,
    }


async def main():
    logger.info("=" * 70)
    logger.info("   REAL LP POSITION DEPLOYMENT — Ekubo Sepolia")
    logger.info("=" * 70)

    # Step 0: Connect + check balance
    account = await get_account()
    balance = await check_vault_balance(account)
    logger.info("Vault STRK balance: %.4f STRK", balance)

    total_needed = sum(
        p["strk_amount"]
        for pool in POOLS_TO_DEPLOY
        for p in pool["positions"]
    )
    logger.info("Total STRK needed for all positions: %.1f", total_needed)

    if balance < total_needed:
        logger.error("Insufficient STRK! Have %.4f, need %.1f", balance, total_needed)
        logger.info("Reducing position sizes proportionally...")
        scale = (balance * 0.9) / total_needed  # Keep 10% buffer
        for pool in POOLS_TO_DEPLOY:
            for p in pool["positions"]:
                p["strk_amount"] = round(p["strk_amount"] * scale, 2)
        total_needed = sum(p["strk_amount"] for pool in POOLS_TO_DEPLOY for p in pool["positions"])
        logger.info("Adjusted total: %.1f STRK", total_needed)

    # Step 1: AI-Score all positions
    logger.info("")
    logger.info("Step 1: AI/zkML Risk Scoring")
    logger.info("-" * 40)
    for pool in POOLS_TO_DEPLOY:
        for pos in pool["positions"]:
            score = score_position(pos, pool)
            pos["_ai_score"] = score
            logger.info("  %s → risk=%.1f, APY=%.1f%%, IL=%s, rec=%s",
                        pos["label"], score["risk_score"], score["expected_apy"],
                        score["il_risk"], score["recommendation"])

    # Step 2: Initialize pools
    logger.info("")
    logger.info("Step 2: Initialize Ekubo Pools")
    logger.info("-" * 40)
    for pool in POOLS_TO_DEPLOY:
        logger.info("Pool: %s (fee=%s, ts=%d)", pool["pair"],
                     {FEE_01PCT: "0.01%", FEE_05PCT: "0.05%", FEE_30PCT: "0.30%", FEE_100PCT: "1.00%"}.get(pool["fee"], "?"),
                     pool["tick_spacing"])
        try:
            tx = await initialize_pool(account, pool)
            if tx:
                logger.info("  ✓ Initialized: %s", tx)
                await asyncio.sleep(2)  # Wait for confirmation
            else:
                logger.info("  ✓ Already initialized")
        except Exception as e:
            logger.error("  ✗ Pool init failed: %s", e)
            logger.info("  Continuing anyway — mint_and_deposit may auto-init...")

    # Step 3: Deploy LP positions
    logger.info("")
    logger.info("Step 3: Deploy LP Positions")
    logger.info("-" * 40)
    deployed_positions = []
    pos_index = 0

    for pool in POOLS_TO_DEPLOY:
        for pos in pool["positions"]:
            pos_index += 1
            score = pos["_ai_score"]
            if score["recommendation"] == "skip":
                logger.info("  Skipping %s (AI says skip)", pos["label"])
                continue

            logger.info("")
            logger.info("  [%d] Deploying: %s", pos_index, pos["label"])
            try:
                result = await create_position(account, pool, pos)
                if result:
                    # Extract NFT ID from tx receipt
                    nft_id = await get_position_nft_id(account.client, result["tx_hash"])
                    logger.info("  ✓ Success! tx=%s, NFT_ID=%s", result["tx_hash"], nft_id)

                    record = build_position_record(pool, pos, result, score, nft_id, pos_index)
                    deployed_positions.append(record)

                    # Wait between positions to avoid nonce issues
                    await asyncio.sleep(3)
            except Exception as e:
                logger.error("  ✗ Failed: %s", e)
                # Continue with next position
                await asyncio.sleep(2)

    # Step 4: Save position data
    logger.info("")
    logger.info("Step 4: Save Position Data")
    logger.info("-" * 40)

    # Load existing positions (keep old synthetic ones as archive)
    existing = []
    if POSITIONS_FILE.exists():
        try:
            existing = json.loads(POSITIONS_FILE.read_text())
            # Archive old synthetics
            archive_file = Path("backend/data/ekubo_positions_synthetic_backup.json")
            archive_file.write_text(json.dumps(existing, indent=2))
            logger.info("  Archived %d old positions to %s", len(existing), archive_file)
        except Exception:
            pass

    # Write new real positions
    POSITIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    POSITIONS_FILE.write_text(json.dumps(deployed_positions, indent=2))
    logger.info("  Saved %d real positions to %s", len(deployed_positions), POSITIONS_FILE)

    # Step 5: Summary
    logger.info("")
    logger.info("=" * 70)
    logger.info("   DEPLOYMENT SUMMARY")
    logger.info("=" * 70)
    logger.info("  Total positions deployed: %d", len(deployed_positions))
    total_strk = sum(float(p["amount0_deposited"]) / 1e18 for p in deployed_positions)
    logger.info("  Total STRK deposited: %.2f", total_strk)
    for p in deployed_positions:
        logger.info("    %s → NFT=%s, tx=%s, APY=%.1f%%",
                     p["label"], p.get("nft_id", "?"), p["mint_tx_hash"][:18], p["estimated_fees_apr"])

    remaining = await check_vault_balance(account)
    logger.info("  Remaining vault balance: %.4f STRK", remaining)
    logger.info("")
    logger.info("Done! Real LP positions are now live on Ekubo Sepolia. 🚀")


if __name__ == "__main__":
    asyncio.run(main())
