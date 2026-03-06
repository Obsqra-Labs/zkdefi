"""
Bot wallet manager — wraps starknet-py Account for on-chain tx execution.

Provides a single shared Account that all bots use to submit transactions
on Starknet Sepolia.  Supports execute_v3 with auto fee estimation.
"""
from __future__ import annotations

import logging
from typing import Any

from starknet_py.contract import Contract
from starknet_py.net.account.account import Account
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair

logger = logging.getLogger(__name__)

# ABI cache (avoid refetching on every call)
_contract_cache: dict[str, Contract] = {}


class WalletManager:
    """Manages a single bot wallet for submitting on-chain transactions."""

    def __init__(self, rpc_url: str, account_address: str, private_key: str) -> None:
        self.rpc_url = rpc_url
        self._account_address = account_address
        self._private_key = private_key
        self._account: Account | None = None
        self._client: FullNodeClient | None = None

    @property
    def configured(self) -> bool:
        return bool(self._account_address and self._private_key)

    @property
    def address(self) -> str:
        return self._account_address

    @property
    def address_int(self) -> int:
        a = self._account_address
        return int(a, 16) if a.startswith("0x") else int(a)

    def _get_client(self) -> FullNodeClient:
        if self._client is None:
            self._client = FullNodeClient(node_url=self.rpc_url)
        return self._client

    def get_account(self) -> Account:
        """Return a cached starknet-py Account instance."""
        if self._account is not None:
            return self._account
        if not self.configured:
            raise RuntimeError("Bot wallet not configured (set BOT_ACCOUNT_ADDRESS + BOT_PRIVATE_KEY)")

        pk = self._private_key
        addr = self._account_address
        key_int = int(pk, 16) if pk.startswith("0x") else int(pk)
        addr_int = int(addr, 16) if addr.startswith("0x") else int(addr)

        self._account = Account(
            address=addr_int,
            client=self._get_client(),
            key_pair=KeyPair.from_private_key(key_int),
            chain=StarknetChainId.SEPOLIA,
        )
        self._account._cairo_version = 1  # skip pending-block class lookup
        return self._account

    async def get_contract(self, address: str | int) -> Contract:
        """Return a cached Contract instance (ABI fetched from chain)."""
        addr_int = int(address, 16) if isinstance(address, str) and str(address).startswith("0x") else int(address)
        cache_key = f"{self.rpc_url}:{hex(addr_int)}"
        if cache_key not in _contract_cache:
            _contract_cache[cache_key] = await Contract.from_address(
                address=addr_int,
                provider=self.get_account(),
                proxy_config=False,
            )
        return _contract_cache[cache_key]

    async def execute(self, calls: list) -> str:
        """
        Submit a multicall with auto fee estimation (v3 resource bounds).
        Returns the transaction hash as hex string.
        """
        from starknet_py.net.client_models import ResourceBoundsMapping

        account = self.get_account()
        nonce = await account.get_nonce(block_number="latest")

        draft = await account._prepare_invoke_v3(
            calls,
            resource_bounds=ResourceBoundsMapping.init_with_zeros(),
            nonce=nonce,
        )
        estimated = await account.estimate_fee(draft, block_number="latest")
        rbm = estimated.to_resource_bounds()

        resp = await account.execute_v3(calls=calls, resource_bounds=rbm, nonce=nonce)
        tx_hash = hex(resp.transaction_hash)
        logger.info("TX submitted: %s", tx_hash)

        await account.client.wait_for_tx(resp.transaction_hash)
        logger.info("TX confirmed: %s", tx_hash)
        return tx_hash

    async def get_balance(self, token_address: str) -> int:
        """Read ERC-20 balance_of(self) in raw wei."""
        contract = await self.get_contract(token_address)
        try:
            result = await contract.functions["balance_of"].call(
                self.address_int, block_number="latest"
            )
            # Result can be a named tuple or single int depending on starknet-py version
            if isinstance(result, (list, tuple)):
                return int(result[0])
            return int(result)
        except Exception as exc:
            logger.warning("balance_of(%s) failed: %s", token_address[:12], exc)
            return 0

    async def approve_token(self, token_address: str, spender: str | int, amount: int) -> str:
        """Approve spender to spend amount of token. Returns tx hash."""
        contract = await self.get_contract(token_address)
        spender_int = int(spender, 16) if isinstance(spender, str) and str(spender).startswith("0x") else int(spender)
        call = contract.functions["approve"].prepare_call(spender_int, amount)
        return await self.execute([call])

    async def connect_test(self) -> dict[str, Any]:
        """Smoke-test: check RPC reachable and account configured."""
        client = self._get_client()
        try:
            block = await client.get_block_number()
            return {"ok": True, "block": block, "address": self._account_address}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
