"""Ekubo Sepolia config — single source for addresses and chain id. See docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md."""
import os

# Sepolia contract addresses (from design §2.1)
EKUBO_CORE_SEPOLIA = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_ROUTER_SEPOLIA = "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763"
EKUBO_POSITIONS_SEPOLIA = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"
EKUBO_TOKEN_REGISTRY_SEPOLIA = "0x04484f91f0d2482bad844471ca8dc8e846d3a0211792322e72f21f0f44be63e5"

EKUBO_API_BASE = os.getenv("EKUBO_API_BASE", "https://prod-api.ekubo.org")


def get_ekubo_chain_id() -> str | None:
    """Starknet Sepolia chain id for API paths/queries. Set EKUBO_CHAIN_ID in env."""
    raw = os.getenv("EKUBO_CHAIN_ID")
    if not raw:
        return None
    return raw.strip()
