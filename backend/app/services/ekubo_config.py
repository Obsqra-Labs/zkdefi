"""Ekubo config constants (Sepolia defaults, env-overridable)."""
import os

# Sepolia core Ekubo contracts
EKUBO_CORE_SEPOLIA = os.getenv(
    "EKUBO_CORE_SEPOLIA",
    "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384",
)
EKUBO_ROUTER_SEPOLIA = os.getenv(
    "EKUBO_ROUTER_SEPOLIA",
    "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763",
)
EKUBO_POSITIONS_SEPOLIA = os.getenv(
    "EKUBO_POSITIONS_SEPOLIA",
    "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5",
)
EKUBO_TOKEN_REGISTRY_SEPOLIA = os.getenv(
    "EKUBO_TOKEN_REGISTRY_SEPOLIA",
    "0x04484f91f0d2482bad844471ca8dc8e846d3a0211792322e72f21f0f44be63e5",
)

# Optional Ekubo extension contracts (keep env-overridable; fall back to safe sentinels)
EKUBO_ORACLE_EXTENSION_SEPOLIA = os.getenv("EKUBO_ORACLE_EXTENSION_SEPOLIA", "0x0")
EKUBO_LIMIT_ORDERS_SEPOLIA = os.getenv("EKUBO_LIMIT_ORDERS_SEPOLIA", "0x0")

# Positions NFT is used by LP import/sync helpers. If not set explicitly, use positions contract.
EKUBO_POSITIONS_NFT_SEPOLIA = os.getenv(
    "EKUBO_POSITIONS_NFT_SEPOLIA",
    EKUBO_POSITIONS_SEPOLIA,
)

# Canonical Sepolia token contracts used across Ekubo routes/services
SEPOLIA_STRK = os.getenv(
    "SEPOLIA_STRK",
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
)
SEPOLIA_ETH = os.getenv(
    "SEPOLIA_ETH",
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
)
SEPOLIA_USDC = os.getenv(
    "SEPOLIA_USDC",
    "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
)
SEPOLIA_FUSDC = os.getenv(
    "SEPOLIA_FUSDC",
    "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23",
)
SEPOLIA_STRKBTC = os.getenv(
    "SEPOLIA_STRKBTC",
    os.getenv(
        "STRKBTC_ADDRESS",
        "0x0714c3f541490e1847b77d799499ef01af7937ed0182f3b27a5b6226d993ab55",
    ),
)

EKUBO_API_BASE = os.getenv("EKUBO_API_BASE", "https://prod-api.ekubo.org")


def get_ekubo_chain_id() -> str:
    """Chain id used for Ekubo API paths/queries."""
    raw = os.getenv("EKUBO_CHAIN_ID")
    if raw and raw.strip():
        return raw.strip()
    # Conservative fallback if env was accidentally dropped.
    return "0x534e5f5345504f4c4941"
