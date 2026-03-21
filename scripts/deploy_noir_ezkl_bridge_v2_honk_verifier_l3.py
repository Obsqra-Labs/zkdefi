#!/usr/bin/env python3
"""
Declare + deploy the versioned Noir EZKL bridge HONK verifier on Madara L3.

Env:
  MADARA_APPCHAIN_RPC or MADARA_RPC
  MADARA_WALLET_ADDRESS
  MADARA_WALLET_PRIVATE_KEY

Writes a local `.noir_ezkl_bridge_v2_honk.deployed` file on success.
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path

from starknet_py.contract import Contract
from starknet_py.net.account.account import Account
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.signer.stark_curve_signer import KeyPair


def _int_env(name: str, default: int | None = None) -> int | None:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        return int(value, 16) if value.startswith(("0x", "0X")) else int(value)
    except ValueError:
        return default


MADARA_RPC = (
    os.environ.get("MADARA_APPCHAIN_RPC")
    or os.environ.get("MADARA_RPC")
    or "http://127.0.0.1:9944/rpc/v0.10.0"
)
WALLET_ADDR = _int_env("MADARA_WALLET_ADDRESS") or 0x055be462e718c4166d656d11f89e341115b8bc82389c3762a10eade04fcb225d
WALLET_KEY = _int_env("MADARA_WALLET_PRIVATE_KEY") or 0x077e56c6dc32d40a67f6f7e6625c8dc5e570abe49c0a24e9202e4ae906abcc07
CHAIN_ID = int.from_bytes(b"OBSQRA_PROOF_CHAIN", "big")
MADARA_UDC = 0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf

TARGET_DIR = Path(
    "/opt/obsqra.starknet/zkdefi/circuits/contracts/src/garaga_verifier_noir_ezkl_bridge_v2/target/dev"
)
DEPLOY_RECORD = Path("/opt/obsqra.starknet/zkdefi/.noir_ezkl_bridge_v2_honk.deployed")


async def declare_class(account: Account, name: str, sierra_path: Path, casm_path: Path) -> int | None:
    sierra_str = sierra_path.read_text()
    casm_str = casm_path.read_text()
    try:
        declare_result = await Contract.declare_v3(
            account=account,
            compiled_contract=sierra_str,
            compiled_contract_casm=casm_str,
            auto_estimate=True,
        )
        await declare_result.wait_for_acceptance()
        print(f"[{name}] declared: {hex(declare_result.class_hash)}")
        return declare_result.class_hash
    except Exception as exc:
        err = str(exc)
        if "already declared" in err.lower():
            match = re.search(r"Class with hash (0x[0-9a-fA-F]+)", err)
            if match:
                class_hash = int(match.group(1), 16)
                print(f"[{name}] already declared: {hex(class_hash)}")
                return class_hash
        print(f"[{name}] declare failed: {err[:300]}")
        return None


async def deploy_contract(account: Account, name: str, class_hash: int) -> int | None:
    try:
        deploy_result = await Contract.deploy_contract_v3(
            account=account,
            class_hash=class_hash,
            constructor_args=[],
            deployer_address=MADARA_UDC,
            auto_estimate=True,
        )
        await deploy_result.wait_for_acceptance()
        address = deploy_result.deployed_contract.address
        print(f"[{name}] deployed: {hex(address)}")
        return address
    except Exception as exc:
        print(f"[{name}] deploy failed: {str(exc)[:300]}")
        return None


async def main() -> int:
    sierra_files = list(TARGET_DIR.glob("*.contract_class.json"))
    casm_files = list(TARGET_DIR.glob("*.compiled_contract_class.json"))
    if not sierra_files or not casm_files:
        print("missing V2 verifier artifacts; run bash circuits/generate_noir_ezkl_bridge_v2_honk_verifier.sh first")
        return 1

    client = FullNodeClient(node_url=MADARA_RPC)
    key_pair = KeyPair.from_private_key(WALLET_KEY)
    account = Account(address=WALLET_ADDR, client=client, key_pair=key_pair, chain=CHAIN_ID)
    account._cairo_version = 1

    class_hash = await declare_class(account, "NoirEzklBridgeHONKV2", sierra_files[0], casm_files[0])
    if not class_hash:
        return 1

    address = await deploy_contract(account, "NoirEzklBridgeHONKV2", class_hash)
    if not address:
        return 1

    DEPLOY_RECORD.write_text(
        "\n".join(
            [
                f"CLASS_HASH={hex(class_hash)}",
                f"CONTRACT_ADDRESS={hex(address)}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"L3_NOIR_EZKL_BRIDGE_V2_HONK_VERIFIER_ADDRESS={hex(address)}")
    print(f"wrote {DEPLOY_RECORD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
