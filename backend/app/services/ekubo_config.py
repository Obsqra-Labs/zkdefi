"""Ekubo Sepolia config — single source for addresses and chain id. See docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md."""
import os

# Sepolia contract addresses (from design §2.1); Core used for on-chain get_pool_price discovery
EKUBO_CORE_SEPOLIA = "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384"
EKUBO_ROUTER_SEPOLIA = "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763"
EKUBO_POSITIONS_SEPOLIA = "0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5"
EKUBO_TOKEN_REGISTRY_SEPOLIA = "0x04484f91f0d2482bad844471ca8dc8e846d3a0211792322e72f21f0f44be63e5"

# Extension contracts (Sepolia)
EKUBO_ORACLE_EXTENSION_SEPOLIA = "0x003ccf3ee24638dd5f1a51ceb783e120695f53893f6fd947cc2dcabb3f86dc65"
EKUBO_LIMIT_ORDERS_SEPOLIA = "0x00c4c863f6de467b91ce974be48cc17ad7209d0d600926e82845a43a7848b822"
EKUBO_TWAMM_SEPOLIA = "0x073ec792c33b52d5f96940c2860d512b3884f2127d25e023eb9d44a678e4b971"
EKUBO_PRICE_FETCHER_SEPOLIA = "0x04613bee55d8a37adfa249b24c6b13451dedf7cf4f02d01de859579119de3add"
EKUBO_POSITIONS_NFT_SEPOLIA = "0x04afc78d6fec3b122fc1f60276f074e557749df1a77a93416451be72c435120f"

EKUBO_API_BASE = os.getenv("EKUBO_API_BASE", "https://prod-api.ekubo.org")

# Starknet Sepolia token addresses (Router.swap calldata must use tokens deployed on Sepolia)
# USDC: Circle testnet USDC on Starknet Sepolia (mainnet 0x053c... is not deployed on Sepolia)
# ETH/STRK: native tokens, same on Sepolia as in docs
SEPOLIA_USDC = "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080"
# Fake USDC used across many Sepolia pools with deeper test liquidity.
SEPOLIA_FUSDC = "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23"
# Starknet ETH token address on Sepolia/Mainnet.
SEPOLIA_ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
SEPOLIA_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
SEPOLIA_STRKBTC = os.getenv("STRKBTC_ADDRESS", "0x0714c3f541490e1847b77d799499ef01af7937ed0182f3b27a5b6226d993ab55")


def get_ekubo_chain_id() -> str | None:
    """
    Chain id used for Ekubo API paths/queries.
    Defaults to Ekubo's current Starknet testnet alias when env is unset.
    """
    raw = os.getenv("EKUBO_CHAIN_ID")
    if raw and raw.strip():
        return raw.strip()
    return "0x534e5f4d41494f"
