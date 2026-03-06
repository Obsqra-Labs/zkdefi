# Source Generated with Decompyle++
# File: onchain_agent_service.cpython-312.pyc (Python 3.12)

"""
On-chain Agent Service — Calls AgentIdentity contract on Starknet Sepolia.

Provides mint_agent, record_execution, and get_agent_metadata through
starknet-py's Contract interface.
"""
from __future__ import annotations
import asyncio
import json
import logging
import os
import threading
from pathlib import Path
logger = logging.getLogger(__name__)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_ABI_PATH = _PROJECT_ROOT / 'contracts' / 'target' / 'dev' / 'zkdefi_contracts_AgentIdentity.contract_class.json'
_RPC_URL = os.getenv('STARKNET_RPC_URL_V08', 'https://api.cartridge.gg/x/starknet/sepolia')
_DEPLOYER_ADDRESS = os.getenv('FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS', '0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d')
_DEPLOYER_PRIVATE_KEY = os.getenv('FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY', '')
_AGENT_IDENTITY_ADDRESS = os.getenv('AGENT_IDENTITY_ADDRESS', '')

def _felt_from_str(s = None, max_bytes = None):
    '''Convert a string to a felt252 (max 31 bytes).'''
    encoded = s.encode('utf-8')[:max_bytes]
    return int.from_bytes(encoded, 'big')


class OnchainAgentService:
    '''Thin wrapper around the AgentIdentity contract.'''
    
    def __init__(self):
        self._lock = threading.Lock()
        self._contract = None
        self._account = None
        self._available = False
        self._init_error = None
        self._init()

    
    def _init(self):
        '''Lazy initialisation — silently disables if deps missing.'''
        if not _AGENT_IDENTITY_ADDRESS or _DEPLOYER_PRIVATE_KEY:
            self._init_error = 'Missing AGENT_IDENTITY_ADDRESS or deployer key'
            logger.warning(f'''OnchainAgentService disabled: {self._init_error}''')
            return None
        FullNodeClient = FullNodeClient
        import starknet_py.net.full_node_client
        Account = Account
        import starknet_py.net.account.account
        StarknetChainId = StarknetChainId
        import starknet_py.net.models
        Contract = Contract
        import starknet_py.contract
        KeyPair = KeyPair
        import starknet_py.net.signer.stark_curve_signer
        client = FullNodeClient(node_url = _RPC_URL)
        key_pair = KeyPair.from_private_key(int(_DEPLOYER_PRIVATE_KEY, 16))
        self._account = Account(address = int(_DEPLOYER_ADDRESS, 16), client = client, key_pair = key_pair, chain = StarknetChainId.SEPOLIA)
        abi = json.loads(_ABI_PATH.read_text())['abi']
        self._contract = Contract(address = int(_AGENT_IDENTITY_ADDRESS, 16), abi = abi, provider = self._account)
        self._available = True
        logger.info(f'''OnchainAgentService ready — contract {_AGENT_IDENTITY_ADDRESS}''')
        return None
    # WARNING: Decompyle incomplete

    available = (lambda self = None: self._available)()
    
    async def mint_agent(self = None, name = None, identity_commitment = None, model_ids = (None,)):
        '''
        Mint an agent NFT on-chain.

        Returns dict with token_id and tx_hash on success,
        or error info on failure.
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def record_execution(self = None, token_id = None):
        '''Record an execution on-chain for an agent token.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def get_agent_metadata(self = None, token_id = None):
        '''Read agent metadata from on-chain (view call).'''
        pass
    # WARNING: Decompyle incomplete


_instance: 'OnchainAgentService | None' = None
_instance_lock = threading.Lock()

def get_onchain_agent_service():
    pass
# WARNING: Decompyle incomplete

