#!/usr/bin/env python3
"""
Generate real swap fees on Ekubo Sepolia.

Steps:
  1. Create an in-range LP position straddling the current tick (needs STRK + ETH)
  2. Execute self-swaps through Router V3.0.13 to generate fees
  3. Verify fees accrued on our positions

Usage:
  python generate_fees.py                    # Full run (position + swaps)
  python generate_fees.py --swap-only        # Skip position creation, just swap
  python generate_fees.py --quote-only       # Only quote, don't execute
"""
import asyncio, json, math, os, sys
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
from starknet_py.hash.utils import _starknet_keccak as snk
import httpx

# ── Addresses ──────────────────────────────────────────────────────────────────
RPC        = "https://api.cartridge.gg/x/starknet/sepolia"
VAULT_ADDR = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS")
VAULT_PK   = os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY")

STRK  = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
ETH   = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
POS   = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"
CORE  = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
ROUTER = "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763"

_TWO128 = 1 << 128
FEE_30  = int(0.003 * _TWO128)   # 0.30%

# ── Selectors (verified against Router V3.0.13 entry points) ──────────────────
SEL_SWAP           = snk(b"swap")
SEL_CLEAR_MINIMUM  = snk(b"clear_minimum")
SEL_TRANSFER       = snk(b"transfer")
SEL_APPROVE        = snk(b"approve")
SEL_BALANCE_OF     = snk(b"balanceOf")


def i129(v):
    """Encode a signed int as Ekubo's i129 struct."""
    return {"mag": abs(v), "sign": v < 0}


def i129_calldata(v):
    """Encode i129 as raw calldata [mag, sign_bool]."""
    return [abs(v), 1 if v < 0 else 0]


def u256_calldata(v):
    """Encode u256 as [low, high] felt252 pair."""
    return [v & ((1 << 128) - 1), v >> 128]


async def get_balance(contract, address):
    """Get ERC20 balance, handle dict or int return."""
    bal = await contract.functions['balanceOf'].call(address, block_number="latest")
    raw = bal[0] if not isinstance(bal[0], dict) else bal[0].get("low", 0)
    return raw


async def get_pool_price(client, pool_key_tuple):
    """Get current sqrt_ratio and tick for a pool via RPC call."""
    token0, token1, fee, ts, ext = pool_key_tuple
    calldata = [hex(token0), hex(token1), hex(fee), hex(ts), hex(ext)]
    r = httpx.post(RPC, json={
        'jsonrpc': '2.0', 'id': 1,
        'method': 'starknet_call',
        'params': {
            'request': {
                'contract_address': CORE,
                'entry_point_selector': hex(snk(b"get_pool_price")),
                'calldata': calldata,
            },
            'block_id': 'latest',
        }
    }, timeout=15)
    data = r.json()
    if 'result' in data:
        res = data['result']
        sqrt_lo = int(res[0], 16)
        sqrt_hi = int(res[1], 16)
        sqrt_ratio = sqrt_lo + (sqrt_hi << 128)
        tick_mag = int(res[2], 16)
        tick_sign = int(res[3], 16)
        tick = -tick_mag if tick_sign else tick_mag
        return sqrt_ratio, tick
    raise RuntimeError(f"get_pool_price failed: {data.get('error', {})}")


async def quote_swap_rpc(token0, token1, fee, ts, sell_token, amount):
    """Quote a swap via the Router's quote_swap (read-only)."""
    # RouteNode: pool_key(5 felts) + sqrt_ratio_limit(u256=2 felts) + skip_ahead(1 felt)
    # TokenAmount: token(1 felt) + i129(mag, sign = 2 felts)
    calldata = [
        hex(token0), hex(token1), hex(fee), hex(ts), hex(0),  # pool_key
        hex(0), hex(0),   # sqrt_ratio_limit = 0 (auto)
        hex(0),           # skip_ahead
        hex(sell_token),  # token
        hex(amount),      # amount.mag
        hex(0),           # amount.sign (positive = exact input)
    ]
    r = httpx.post(RPC, json={
        'jsonrpc': '2.0', 'id': 1,
        'method': 'starknet_call',
        'params': {
            'request': {
                'contract_address': ROUTER,
                'entry_point_selector': hex(snk(b"quote_swap")),
                'calldata': calldata,
            },
            'block_id': 'latest',
        }
    }, timeout=15)
    data = r.json()
    if 'result' in data:
        res = data['result']
        a0_mag = int(res[0], 16)
        a0_sign = int(res[1], 16)
        a1_mag = int(res[2], 16)
        a1_sign = int(res[3], 16)
        return (a0_mag, a0_sign), (a1_mag, a1_sign)
    raise RuntimeError(f"quote_swap failed: {data.get('error', {})}")


# ── Step 1: Create In-Range Position ──────────────────────────────────────────

async def create_in_range_position(account, strk_c, eth_c, pos_c, current_tick):
    """Create a STRK/ETH 0.30% position that straddles the current tick."""
    ts = 1000
    # Align to tick_spacing
    lower = ((current_tick - ts) // ts) * ts  # one tick below current
    upper = lower + 2 * ts                     # two ticks above lower

    print(f"\n{'='*60}")
    print(f"STEP 1: Create in-range LP position")
    print(f"  Current tick: {current_tick}")
    print(f"  Position range: [{lower}, {upper}]")
    print(f"  Tick spacing: {ts}")

    # For an in-range position we need BOTH tokens
    # Use 50 STRK + 0.02 ETH
    strk_amount = int(50 * 1e18)
    eth_amount  = int(0.02 * 1e18)

    addr = account.address
    strk_bal = await get_balance(strk_c, addr)
    eth_bal  = await get_balance(eth_c, addr)
    print(f"  Wallet: {strk_bal/1e18:.4f} STRK, {eth_bal/1e18:.6f} ETH")

    if strk_bal < strk_amount:
        print(f"  ERROR: Not enough STRK ({strk_bal/1e18:.4f} < 50)")
        return None
    if eth_bal < eth_amount:
        print(f"  ERROR: Not enough ETH ({eth_bal/1e18:.6f} < 0.02)")
        return None

    pos_int = int(POS, 16)
    pool_key = {
        "token0": int(STRK, 16), "token1": int(ETH, 16),
        "fee": FEE_30, "tick_spacing": ts, "extension": 0
    }
    bounds = {"lower": i129(lower), "upper": i129(upper)}

    # Push model: transfer BOTH tokens to Positions, then mint
    calls = [
        strk_c.functions['transfer'].prepare_call(pos_int, strk_amount),
        eth_c.functions['transfer'].prepare_call(pos_int, eth_amount),
        pos_c.functions['mint_and_deposit_and_clear_both'].prepare_call(
            pool_key, bounds, 0
        ),
    ]

    print(f"  Transferring {strk_amount/1e18:.0f} STRK + {eth_amount/1e18:.4f} ETH to Positions...")
    nonce = await account.get_nonce(block_number="latest")
    draft = await account._prepare_invoke_v3(calls, resource_bounds=_RBM.init_with_zeros(), nonce=nonce)
    est = await account.estimate_fee(draft, block_number="latest")
    rbm = est.to_resource_bounds()
    resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
    tx_hash = hex(resp.transaction_hash)
    print(f"  tx: {tx_hash}")
    await account.client.wait_for_tx(resp.transaction_hash)

    # Extract NFT ID from events
    receipt = await account.client.get_transaction_receipt(resp.transaction_hash)
    nft_id = None
    for ev in receipt.events:
        for val in ev.data:
            if 0 < val < 100000:
                nft_id = val
                break
        if nft_id:
            break

    if nft_id:
        try:
            info = await pos_c.functions['get_token_info'].call(
                nft_id, pool_key, bounds, block_number="latest"
            )
            d = info[0]
            amt0 = d.get('amount0', 0)
            amt1 = d.get('amount1', 0)
            liq  = d.get('liquidity', 0)
            print(f"  SUCCESS! NFT={nft_id}")
            print(f"    STRK deposited: {amt0/1e18:.6f}")
            print(f"    ETH deposited:  {amt1/1e18:.10f}")
            print(f"    Liquidity:      {liq:,}")
        except Exception as e:
            print(f"  NFT={nft_id}, info error: {e}")
    else:
        print(f"  Minted (could not parse NFT ID)")

    # Update positions JSON
    pos_file = Path("backend/data/ekubo_positions.json")
    existing = []
    if pos_file.exists():
        data = json.loads(pos_file.read_text())
        if isinstance(data, dict):
            existing = data.get("positions", [])
        else:
            existing = data

    now = datetime.now(timezone.utc).isoformat()
    existing.append({
        "position_id": str(nft_id) if nft_id else "unknown",
        "nft_id": nft_id,
        "pair": "STRK/ETH",
        "token0": STRK, "token1": ETH,
        "fee_tier": 3000,
        "lower_tick": lower, "upper_tick": upper,
        "amount0": str(strk_amount), "amount1": str(eth_amount),
        "owner": VAULT_ADDR,
        "status": "active",
        "label": f"STRK/ETH_in_range_{lower}_{upper}",
        "mint_tx_hash": tx_hash,
        "created_at": now,
    })
    pos_file.write_text(json.dumps({"positions": existing}, indent=2))
    print(f"  Updated {pos_file} ({len(existing)} total positions)")

    return nft_id


# ── Step 2: Execute Self-Swaps via Router ─────────────────────────────────────

async def execute_swap(account, strk_c, eth_c, direction, amount_wei, pool_key_tuple):
    """
    Execute a swap through Router V3.0.13.

    Flow: transfer input→Router, Router.swap(), Router.clear_minimum(output_token, 0)

    direction: "strk_to_eth" or "eth_to_strk"
    """
    token0, token1, fee, ts, ext = pool_key_tuple
    router_int = int(ROUTER, 16)

    if direction == "strk_to_eth":
        input_contract = strk_c
        input_token = int(STRK, 16)
        output_token = int(ETH, 16)
        label = "STRK → ETH"
    else:
        input_contract = eth_c
        input_token = int(ETH, 16)
        output_token = int(STRK, 16)
        label = "ETH → STRK"

    print(f"\n  Swap: {label} ({amount_wei/1e18:.6f})")

    # Build multicall:
    # 1. Transfer input tokens to Router
    # 2. Router.swap(RouteNode, TokenAmount)
    # 3. Router.clear_minimum(output_token, 0)

    # Since starknet-py can't parse Ekubo's custom types, use prepare_call on
    # the transfer (ERC20 is standard), then build raw Call objects for Router.

    from starknet_py.net.client_models import Call

    # Call 1: input_token.transfer(ROUTER, amount)
    call_transfer = input_contract.functions['transfer'].prepare_call(router_int, amount_wei)

    # Call 2: Router.swap(node: RouteNode, token_amount: TokenAmount)
    # RouteNode = pool_key(token0, token1, fee, ts, extension) + sqrt_ratio_limit(u256 low, high) + skip_ahead
    # TokenAmount = token + i129(mag, sign)
    swap_calldata = [
        token0, token1, fee, ts, ext,   # pool_key (5 felts)
        0, 0,                            # sqrt_ratio_limit = 0 (auto-fill)
        0,                               # skip_ahead = 0
        input_token,                     # TokenAmount.token
        amount_wei,                      # TokenAmount.amount.mag
        0,                               # TokenAmount.amount.sign (positive = exact input)
    ]

    call_swap = Call(
        to_addr=router_int,
        selector=SEL_SWAP,
        calldata=swap_calldata,
    )

    # Call 3: Router.clear_minimum(token: IERC20Dispatcher, minimum: u256)
    # IERC20Dispatcher is just the contract address (1 felt)
    # minimum = 0 (accept any output)
    call_clear = Call(
        to_addr=router_int,
        selector=SEL_CLEAR_MINIMUM,
        calldata=[output_token, 0, 0],  # token, min_low, min_high
    )

    calls = [call_transfer, call_swap, call_clear]

    nonce = await account.get_nonce(block_number="latest")
    draft = await account._prepare_invoke_v3(calls, resource_bounds=_RBM.init_with_zeros(), nonce=nonce)
    est = await account.estimate_fee(draft, block_number="latest")
    rbm = est.to_resource_bounds()
    resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
    tx_hash = hex(resp.transaction_hash)
    print(f"    tx: {tx_hash}")
    await account.client.wait_for_tx(resp.transaction_hash)
    print(f"    CONFIRMED!")
    return tx_hash


# ── Step 3: Check Fees ────────────────────────────────────────────────────────

async def check_fees(pos_c, nft_id, pool_key_dict, bounds_dict):
    """Read accrued fees for a position."""
    try:
        info = await pos_c.functions['get_token_info'].call(
            nft_id, pool_key_dict, bounds_dict, block_number="latest"
        )
        d = info[0]
        fees0 = d.get('fees0', 0)
        fees1 = d.get('fees1', 0)
        return fees0, fees1
    except Exception as e:
        print(f"    Fee check error: {e}")
        return 0, 0


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    swap_only  = "--swap-only"  in sys.argv
    quote_only = "--quote-only" in sys.argv

    print("=" * 60)
    print("Ekubo Sepolia — Fee Generation Script")
    print("=" * 60)

    client = FullNodeClient(node_url=RPC)
    pk_int   = int(VAULT_PK, 16)
    addr_int = int(VAULT_ADDR, 16)
    account  = Account(
        address=addr_int, client=client,
        key_pair=KeyPair.from_private_key(pk_int),
        chain=StarknetChainId.SEPOLIA,
    )
    account._cairo_version = 1

    strk_c = await Contract.from_address(int(STRK, 16), provider=account, proxy_config=False)
    eth_c  = await Contract.from_address(int(ETH, 16),  provider=account, proxy_config=False)
    pos_c  = await Contract.from_address(int(POS, 16),  provider=account, proxy_config=False)

    # ── Balances ──
    strk_bal = await get_balance(strk_c, addr_int)
    eth_bal  = await get_balance(eth_c, addr_int)
    print(f"\nWallet balances:")
    print(f"  STRK: {strk_bal/1e18:.4f}")
    print(f"  ETH:  {eth_bal/1e18:.6f}")

    # ── Pool price ──
    pool_key_tuple = (int(STRK, 16), int(ETH, 16), FEE_30, 1000, 0)
    sqrt_ratio, current_tick = await get_pool_price(client, pool_key_tuple)
    print(f"\nSTRK/ETH 0.30% pool:")
    print(f"  Current tick: {current_tick}")
    print(f"  sqrt_ratio:   {sqrt_ratio}")

    # ── Quote test ──
    test_amount = int(10 * 1e18)  # 10 STRK
    print(f"\nQuoting: sell 10 STRK through 0.30% pool...")
    (a0_mag, a0_sign), (a1_mag, a1_sign) = await quote_swap_rpc(
        int(STRK, 16), int(ETH, 16), FEE_30, 1000,
        int(STRK, 16), test_amount
    )
    print(f"  Would consume: {a0_mag/1e18:.10f} STRK")
    print(f"  Would receive: {a1_mag/1e18:.10f} ETH")

    if a0_mag < test_amount * 0.01:
        print(f"  ⚠ Very low liquidity at current tick — only {a0_mag/1e18:.10f} of {test_amount/1e18:.0f} STRK usable")
        if not swap_only:
            print(f"  → Will create an in-range position first")

    if quote_only:
        print("\n[quote-only mode] Exiting without executing.")
        return

    # ── Step 1: In-range position ──
    new_nft = None
    if not swap_only:
        new_nft = await create_in_range_position(account, strk_c, eth_c, pos_c, current_tick)
        if new_nft:
            await asyncio.sleep(3)
            # Re-quote to see improved liquidity
            print(f"\nRe-quoting after position creation...")
            (a0_mag, a0_sign), (a1_mag, a1_sign) = await quote_swap_rpc(
                int(STRK, 16), int(ETH, 16), FEE_30, 1000,
                int(STRK, 16), test_amount
            )
            print(f"  Would consume: {a0_mag/1e18:.10f} STRK")
            print(f"  Would receive: {a1_mag/1e18:.10f} ETH")

    # ── Step 2: Self-swaps ──
    print(f"\n{'='*60}")
    print(f"STEP 2: Executing self-swaps to generate fees")
    print(f"{'='*60}")

    # Swap 1: STRK → ETH (5 STRK)
    swap_strk = int(5 * 1e18)
    strk_bal = await get_balance(strk_c, addr_int)
    if strk_bal >= swap_strk:
        tx1 = await execute_swap(account, strk_c, eth_c, "strk_to_eth", swap_strk, pool_key_tuple)
        await asyncio.sleep(5)
    else:
        print(f"  Skip STRK→ETH: insufficient STRK ({strk_bal/1e18:.4f})")

    # Swap 2: ETH → STRK (0.005 ETH)
    swap_eth = int(0.005 * 1e18)
    eth_bal = await get_balance(eth_c, addr_int)
    if eth_bal >= swap_eth:
        tx2 = await execute_swap(account, strk_c, eth_c, "eth_to_strk", swap_eth, pool_key_tuple)
        await asyncio.sleep(5)
    else:
        print(f"  Skip ETH→STRK: insufficient ETH ({eth_bal/1e18:.6f})")

    # Swap 3: STRK → ETH again (3 STRK) — generate more fees
    swap_strk2 = int(3 * 1e18)
    strk_bal = await get_balance(strk_c, addr_int)
    if strk_bal >= swap_strk2:
        tx3 = await execute_swap(account, strk_c, eth_c, "strk_to_eth", swap_strk2, pool_key_tuple)
        await asyncio.sleep(5)
    else:
        print(f"  Skip second STRK→ETH: insufficient STRK")

    # ── Step 3: Check fees ──
    print(f"\n{'='*60}")
    print(f"STEP 3: Checking accrued fees")
    print(f"{'='*60}")

    # Load all positions from JSON
    pos_file = Path("backend/data/ekubo_positions.json")
    if pos_file.exists():
        data = json.loads(pos_file.read_text())
        positions = data.get("positions", []) if isinstance(data, dict) else data
    else:
        positions = []

    pool_key_dict = {
        "token0": int(STRK, 16), "token1": int(ETH, 16),
        "fee": FEE_30, "tick_spacing": 1000, "extension": 0
    }

    for p in positions:
        nft = p.get("nft_id") or p.get("position_id")
        if not nft or nft == "unknown":
            continue
        nft = int(nft)
        lower = p.get("lower_tick", p.get("tick_lower", 0))
        upper = p.get("upper_tick", p.get("tick_upper", 0))
        fee_tier = p.get("fee_tier", 3000)

        # Only check 0.30% positions
        if fee_tier != 3000:
            continue

        bounds_dict = {"lower": i129(lower), "upper": i129(upper)}
        fees0, fees1 = await check_fees(pos_c, nft, pool_key_dict, bounds_dict)
        in_range = lower <= current_tick < upper
        print(f"\n  NFT {nft} [{lower}, {upper}] {'IN RANGE' if in_range else 'out of range'}")
        print(f"    Fees accrued: {fees0/1e18:.10f} STRK, {fees1/1e18:.12f} ETH")

    # ── Final balances ──
    print(f"\n{'='*60}")
    print(f"FINAL BALANCES")
    print(f"{'='*60}")
    strk_bal = await get_balance(strk_c, addr_int)
    eth_bal  = await get_balance(eth_c, addr_int)
    print(f"  STRK: {strk_bal/1e18:.4f}")
    print(f"  ETH:  {eth_bal/1e18:.6f}")
    print(f"\nDone! Fees are now accruing on in-range positions.")


if __name__ == "__main__":
    asyncio.run(main())
