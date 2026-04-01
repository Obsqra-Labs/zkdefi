"""Ekubo config constants (Sepolia + mainnet, env-overridable)."""
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

# Starknet mainnet Ekubo contracts
EKUBO_CORE_MAINNET = os.getenv(
    "EKUBO_CORE_MAINNET",
    "0x00000005dd3d2f4429af886cd1a3b08228e5c6d1564b37e8c46e0000a0516413",
)
EKUBO_ROUTER_MAINNET = os.getenv(
    "EKUBO_ROUTER_MAINNET",
    "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4c8393c3",
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
STARKNET_MAINNET_RPC_URL = os.getenv("STARKNET_MAINNET_RPC_URL", "https://rpc.starknet.lava.build:443")
EKUBO_MAINNET_CHAIN_ID = os.getenv("EKUBO_MAINNET_CHAIN_ID", "0x534e5f4d41494e")
_EKUBO_SEPOLIA_CHAIN_IDS = {"0x534e5f5345504f4c4941", "0x534e5f4d41494f", "23448594291968335"}


def get_ekubo_chain_id() -> str:
    """Chain id used for Ekubo API paths/queries."""
    raw = os.getenv("EKUBO_CHAIN_ID")
    if raw and raw.strip():
        return raw.strip()
    # Conservative fallback if env was accidentally dropped.
    return "0x534e5f5345504f4c4941"


def is_ekubo_mainnet_chain(chain_id: str | None) -> bool:
    value = str(chain_id or "").strip().lower()
    return value == EKUBO_MAINNET_CHAIN_ID.strip().lower()


def get_ekubo_core_address(chain_id: str | None) -> str:
    return EKUBO_CORE_MAINNET if is_ekubo_mainnet_chain(chain_id) else EKUBO_CORE_SEPOLIA


def get_ekubo_router_address(chain_id: str | None) -> str:
    return EKUBO_ROUTER_MAINNET if is_ekubo_mainnet_chain(chain_id) else EKUBO_ROUTER_SEPOLIA


def get_starknet_rpc_for_chain(chain_id: str | None) -> str:
    return STARKNET_MAINNET_RPC_URL if is_ekubo_mainnet_chain(chain_id) else os.getenv(
        "STARKNET_RPC_URL",
        "https://starknet-sepolia-rpc.publicnode.com",
    )
