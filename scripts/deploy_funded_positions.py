#!/usr/bin/env python3
"""Deploy FUNDED LP positions on Ekubo Sepolia using push-model."""
import asyncio, json, math, os
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv("backend/.env")

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.net.models import StarknetChainId
from starknet_py.contract import Contract
from starknet_py.net.client_models import ResourceBoundsMapping as _RBM

RPC = "https://api.cartridge.gg/x/starknet/sepolia"
VAULT_ADDR = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS")
VAULT_PK = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY")

STRK_ADDR = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
ETH_ADDR  = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
POS_ADDR = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"

_TWO128 = 1 << 128
FEE_05  = int(0.0005 * _TWO128)
FEE_30  = int(0.003  * _TWO128)
FEE_100 = int(0.01   * _TWO128)

def i129(v): return {"mag": abs(v), "sign": v < 0}

# Current tick = -82000
# STRK = token0, ETH = token1
# current_tick < lower_tick → range above current → position holds ONLY token0 (STRK)
POSITIONS_TO_FUND = [
    {"label": "STRK/ETH_0.30%_tight", "fee": FEE_30, "ts": 1000,
     "lower": -81000, "upper": -78000, "strk": 50.0},
    {"label": "STRK/ETH_0.30%_medium", "fee": FEE_30, "ts": 1000,
     "lower": -80000, "upper": -70000, "strk": 60.0},
    {"label": "STRK/ETH_0.30%_wide", "fee": FEE_30, "ts": 1000,
     "lower": -79000, "upper": -60000, "strk": 50.0},
    {"label": "STRK/ETH_0.05%_tight", "fee": FEE_05, "ts": 200,
     "lower": -81800, "upper": -79000, "strk": 50.0},
    {"label": "STRK/ETH_0.05%_medium", "fee": FEE_05, "ts": 200,
     "lower": -81200, "upper": -72000, "strk": 50.0},
    {"label": "STRK/ETH_1.00%_wide", "fee": FEE_100, "ts": 5000,
     "lower": -80000, "upper": -55000, "strk": 40.0},
]

async def main():
    client = FullNodeClient(node_url=RPC)
    pk_int = int(VAULT_PK, 16)
    addr_int = int(VAULT_ADDR, 16)
    pos_int = int(POS_ADDR, 16)
    account = Account(address=addr_int, client=client,
                      key_pair=KeyPair.from_private_key(pk_int), chain=StarknetChainId.SEPOLIA)
    account._cairo_version = 1

    strk_c = await Contract.from_address(int(STRK_ADDR, 16), provider=account, proxy_config=False)
    pos_c = await Contract.from_address(pos_int, provider=account, proxy_config=False)

    bal = await strk_c.functions['balanceOf'].call(addr_int, block_number="latest")
    raw_bal = bal[0] if not isinstance(bal[0], dict) else bal[0].get("low", 0)
    print(f"STRK balance: {raw_bal/1e18:.4f}")

    results = []

    for p in POSITIONS_TO_FUND:
        lower = (p["lower"] // p["ts"]) * p["ts"]
        upper = math.ceil(p["upper"] / p["ts"]) * p["ts"]
        strk_wei = int(p["strk"] * 1e18)

        pool_key = {"token0": int(STRK_ADDR, 16), "token1": int(ETH_ADDR, 16),
                     "fee": p["fee"], "tick_spacing": p["ts"], "extension": 0}
        bounds = {"lower": i129(lower), "upper": i129(upper)}

        print(f"\nDeploying {p['label']}: [{lower}, {upper}], {p['strk']} STRK")

        # Push model: transfer STRK TO Positions contract, then mint_and_deposit_and_clear_both
        calls = [
            strk_c.functions['transfer'].prepare_call(pos_int, strk_wei),
            pos_c.functions['mint_and_deposit_and_clear_both'].prepare_call(
                pool_key, bounds, 0
            ),
        ]

        try:
            nonce = await account.get_nonce(block_number="latest")
            draft = await account._prepare_invoke_v3(calls, resource_bounds=_RBM.init_with_zeros(), nonce=nonce)
            est = await account.estimate_fee(draft, block_number="latest")
            rbm = est.to_resource_bounds()
            resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
            tx = hex(resp.transaction_hash)
            print(f"  tx: {tx} — waiting...")
            await account.client.wait_for_tx(resp.transaction_hash)

            receipt = await client.get_transaction_receipt(resp.transaction_hash)
            nft_id = None
            for ev in receipt.events:
                for val in ev.data:
                    if 0 < val < 100000:
                        nft_id = val
                        break
                if nft_id:
                    break

            liq, amt0, amt1 = 0, 0, 0
            if nft_id:
                try:
                    info = await pos_c.functions['get_token_info'].call(nft_id, pool_key, bounds, block_number="latest")
                    d = info[0]
                    amt0 = d.get('amount0', 0)
                    amt1 = d.get('amount1', 0)
                    liq = d.get('liquidity', 0)
                    print(f"  OK NFT={nft_id}, STRK={amt0/1e18:.4f}, liq={liq:,}")
                except Exception as e:
                    print(f"  NFT={nft_id}, verify err: {e}")
            else:
                print(f"  OK tx={tx}")

            fee_bps = {FEE_05: 500, FEE_30: 3000, FEE_100: 10000}[p["fee"]]
            now = datetime.now(timezone.utc).isoformat()
            risk = "conservative" if "tight" in p["label"] else "balanced" if "medium" in p["label"] else "aggressive"
            results.append({
                "id": str(nft_id) if nft_id else "unknown",
                "pair": "STRK/ETH", "token0": STRK_ADDR, "token1": ETH_ADDR,
                "fee_tier": fee_bps,
                "tick_lower": lower, "tick_upper": upper,
                "liquidity": str(liq), "amount0_deposited": str(amt0), "amount1_deposited": str(amt1),
                "status": "active", "risk_profile": risk,
                "estimated_fees_apr": {"conservative": 8.0, "balanced": 12.0, "aggressive": 20.0}[risk],
                "ai_risk_score": {"conservative": 2.5, "balanced": 5.0, "aggressive": 7.5}[risk],
                "ai_reasoning": f"STRK/ETH {fee_bps/100:.2f}% pool, {risk} range [{lower},{upper}]",
                "mint_tx_hash": tx, "created_at": now, "updated_at": now,
                "label": p["label"], "nft_id": nft_id,
            })

            await asyncio.sleep(3)
        except Exception as e:
            print(f"  FAILED: {e}")
            await asyncio.sleep(2)

    pos_file = Path("backend/data/ekubo_positions.json")
    pos_file.write_text(json.dumps(results, indent=2))
    print(f"\nSaved {len(results)} positions to {pos_file}")

    bal2 = await strk_c.functions['balanceOf'].call(addr_int, block_number="latest")
    raw2 = bal2[0] if not isinstance(bal2[0], dict) else bal2[0].get("low", 0)
    print(f"Remaining STRK: {raw2/1e18:.4f}")

asyncio.run(main())
