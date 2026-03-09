#!/usr/bin/env python3
"""
Fund agent wallets from the primary bot wallet.

Reads agent wallet addresses from env vars (AGENT_1_ADDRESS ... AGENT_10_ADDRESS)
and transfers a configurable amount of each token to them for trading.

Usage:
    python scripts/fund_agents.py [--amount-strk 50] [--amount-zkdeth 100] [--amount-zkdai 50000] [--dry-run]
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bots.chain_reader import ETH, STRK, ZKDAI, ZKDETH
from bots.wallet_manager import WalletManager
from config.agents import build_fleet_profiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
)
logger = logging.getLogger("fund_agents")

TOKENS = {
    "STRK": {"address": STRK, "decimals": 18},
    "zkdETH": {"address": ZKDETH, "decimals": 18},
    "zkdAI": {"address": ZKDAI, "decimals": 18},
}


async def fund_agent(
    source_wallet: WalletManager,
    target_address: str,
    token_name: str,
    token_address: str,
    amount_human: float,
    decimals: int,
    dry_run: bool = False,
) -> bool:
    """Transfer tokens from source to target. Returns True on success."""
    amount_wei = int(amount_human * (10 ** decimals))
    if amount_wei <= 0:
        return True

    # Check source balance
    balance = await source_wallet.get_balance(token_address)
    if balance < amount_wei:
        logger.warning(
            "  Insufficient %s balance: have %d, need %d (%.4f)",
            token_name, balance, amount_wei, amount_human,
        )
        return False

    if dry_run:
        logger.info(
            "  [dry-run] Would transfer %.4f %s to %s",
            amount_human, token_name, target_address[:20],
        )
        return True

    try:
        contract = await source_wallet.get_contract(token_address)
        target_int = int(target_address, 16) if target_address.startswith("0x") else int(target_address)
        call = contract.functions["transfer"].prepare_call(target_int, amount_wei)
        tx_hash = await source_wallet.execute([call])
        logger.info(
            "  Transferred %.4f %s to %s — tx=%s",
            amount_human, token_name, target_address[:20], tx_hash,
        )
        return True
    except Exception as exc:
        logger.error("  Transfer failed: %s", exc)
        return False


async def main() -> None:
    parser = argparse.ArgumentParser(description="Fund agent wallets")
    parser.add_argument("--amount-strk", type=float, default=50.0, help="STRK per agent")
    parser.add_argument("--amount-zkdeth", type=float, default=100.0, help="zkdETH per agent")
    parser.add_argument("--amount-zkdai", type=float, default=50000.0, help="zkdAI per agent")
    parser.add_argument("--max-agents", type=int, default=10, help="Max agents to fund")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually transfer")
    args = parser.parse_args()

    rpc_url = os.getenv(
        "STARKNET_RPC_URL_V08",
        os.getenv("STARKNET_RPC_URL", "https://api.cartridge.gg/x/starknet/sepolia"),
    )
    primary_addr = os.getenv(
        "BOT_ACCOUNT_ADDRESS",
        "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d",
    )
    primary_key = os.getenv(
        "BOT_PRIVATE_KEY",
        "0x7fd44d52324945e2d9f2e62bd2dadb794e2274dbd0955251aeca6cc96153afc",
    )

    source_wallet = WalletManager(
        rpc_url=rpc_url,
        account_address=primary_addr,
        private_key=primary_key,
    )

    profiles = build_fleet_profiles(max_agents=args.max_agents)
    primary_lower = primary_addr.lower()

    # Deduplicate: only fund wallets different from primary
    unique_targets: dict[str, str] = {}  # addr -> agent name
    for p in profiles:
        addr = p.account_address.lower()
        if addr != primary_lower and addr not in unique_targets:
            unique_targets[addr] = p.name

    if not unique_targets:
        logger.info("All agents use the primary wallet — no funding transfers needed.")
        logger.info(
            "Tip: Set AGENT_N_ADDRESS and AGENT_N_PRIVATE_KEY env vars for agent-specific wallets."
        )
        return

    logger.info("=== Agent Wallet Funding ===")
    logger.info("Source wallet: %s", primary_addr[:20])
    logger.info("Targets: %d unique agent wallets", len(unique_targets))
    logger.info("Per agent: %.1f STRK, %.1f zkdETH, %.1f zkdAI",
                args.amount_strk, args.amount_zkdeth, args.amount_zkdai)
    if args.dry_run:
        logger.info("MODE: DRY RUN")
    logger.info("")

    funded = 0
    for addr, name in unique_targets.items():
        logger.info("Funding %s (%s...):", name, addr[:20])

        amounts = {
            "STRK": args.amount_strk,
            "zkdETH": args.amount_zkdeth,
            "zkdAI": args.amount_zkdai,
        }

        all_ok = True
        for token_name, amount in amounts.items():
            if amount <= 0:
                continue
            token_info = TOKENS[token_name]
            ok = await fund_agent(
                source_wallet=source_wallet,
                target_address=addr,
                token_name=token_name,
                token_address=token_info["address"],
                amount_human=amount,
                decimals=token_info["decimals"],
                dry_run=args.dry_run,
            )
            if not ok:
                all_ok = False
        if all_ok:
            funded += 1

    logger.info("")
    logger.info("=== Funded %d / %d agent wallets ===", funded, len(unique_targets))


if __name__ == "__main__":
    asyncio.run(main())
