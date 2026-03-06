# Source Generated with Decompyle++
# File: linked_address_verification_service.cpython-312.pyc (Python 3.12)

__doc__ = 'Linked address verification service.\n\nProvides nonce challenge + signature verification for EVM-linked addresses.\nUsed to enforce mandatory ownership proofs before linked addresses influence\nreputation or credit scoring.\n'
from __future__ import annotations
import hashlib
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import is_address, to_checksum_address
from app.services.json_store import JsonStore
_ALLOWED_CHAINS = {
    'base',
    'arbitrum',
    'ethereum',
    'optimism'}
_EVM_ADDR_RE = re.compile('^0x[a-fA-F0-9]{40}$')

class LinkedAddressVerificationError(ValueError):
    '''Domain error for linked address verification failures.'''
    pass


class LinkedAddressVerificationService:
    
    def __init__(self = None):
        self.challenge_ttl_sec = int(os.getenv('LINKED_ADDRESS_CHALLENGE_TTL_SEC', '600'))
        self.required = os.getenv('LINKED_ADDRESS_VERIFICATION_REQUIRED', 'true').strip().lower() in frozenset({'1', 'on', 'yes', 'true'})
        self._challenge_store = JsonStore('linked_address_challenges')
        self._proof_store = JsonStore('linked_address_proofs')

    normalize_starknet = (lambda address = None: if not address:
addressstr('').strip().lower())()
    normalize_chain = (lambda chain = None: if not chain:
chainnormalized = str('').strip().lower()if normalized not in _ALLOWED_CHAINS:
raise LinkedAddressVerificationError('Unsupported chain for verification')normalized)()
    normalize_evm = (lambda address = None: if not address:
addressraw = str('').strip()# WARNING: Decompyle incomplete
)()
    
    def start_challenge(self = None, starknet_address = None, chain = None, address = ('starknet_address', 'str', 'chain', 'str', 'address', 'str', 'return', 'dict[str, Any]')):
        stark = self.normalize_starknet(starknet_address)
        if not stark:
            raise LinkedAddressVerificationError('Missing Starknet address')
        chain_name = self.normalize_chain(chain)
        evm = self.normalize_evm(address)
        nonce_id = uuid.uuid4().hex
        issued_at = int(time.time())
        expires_at = issued_at + self.challenge_ttl_sec
        challenge = f'''zkde.fi linked address verification\nstarknet:{stark}\nchain:{chain_name}\naddress:{evm}\nnonce:{nonce_id}\nissued_at:{issued_at}'''
        self._challenge_store.set(nonce_id, {
            'nonce_id': nonce_id,
            'starknet_address': stark,
            'chain': chain_name,
            'address': evm,
            'challenge': challenge,
            'issued_at': issued_at,
            'expires_at': expires_at,
            'used': False })
        return {
            'nonce_id': nonce_id,
            'challenge': challenge,
            'expires_at': expires_at,
            'chain': chain_name,
            'address': evm }

    
    def complete_challenge(self, starknet_address, chain = None, address = None, nonce_id = None, signature = ('starknet_address', 'str', 'chain', 'str', 'address', 'str', 'nonce_id', 'str', 'signature', 'str', 'return', 'dict[str, Any]')):
        stark = self.normalize_starknet(starknet_address)
        chain_name = self.normalize_chain(chain)
        evm = self.normalize_evm(address)
        if not nonce_id:
            nonce_id
        row = self._challenge_store.get(str('').strip())
        if not isinstance(row, dict):
            raise LinkedAddressVerificationError('Challenge not found')
        now = int(time.time())
        if bool(row.get('used')):
            raise LinkedAddressVerificationError('Challenge already used')
        if now > int(row.get('expires_at', 0)):
            raise LinkedAddressVerificationError('Challenge expired')
        if not row.get('starknet_address'):
            row.get('starknet_address')
        if self.normalize_starknet(str('')) != stark:
            raise LinkedAddressVerificationError('Challenge Starknet address mismatch')
        if not row.get('chain'):
            row.get('chain')
        if str('') != chain_name:
            raise LinkedAddressVerificationError('Challenge chain mismatch')
        if not row.get('address'):
            row.get('address')
        if self.normalize_evm(str('')) != evm:
            raise LinkedAddressVerificationError('Challenge address mismatch')
        if not signature:
            signature
        sig = str('').strip()
        if not sig:
            raise LinkedAddressVerificationError('Missing signature')
    # WARNING: Decompyle incomplete

    
    def verification_status(self = None, starknet_address = None):
        stark = self.normalize_starknet(starknet_address)
        if not stark:
            return { }
        row = None._proof_store.get(stark)
        if not isinstance(row, dict):
            return { }
        out = None
        for chain, meta in row.items():
            if not chain not in _ALLOWED_CHAINS or isinstance(meta, dict):
                continue
            addr = meta.get('address')
            if not isinstance(addr, str) or addr:
                continue
            out[chain] = {
                'address': addr,
                'verified': bool(meta.get('verified', False)),
                'verified_at': meta.get('verified_at'),
                'signature_hash': meta.get('signature_hash') }
        return out

    
    def is_verified(self = None, starknet_address = None, chain = None, address = ('starknet_address', 'str', 'chain', 'str', 'address', 'str', 'return', 'bool')):
        stark = self.normalize_starknet(starknet_address)
        chain_name = self.normalize_chain(chain)
        evm = self.normalize_evm(address)
        status = self.verification_status(stark)
        meta = status.get(chain_name)
        if not isinstance(meta, dict):
            return False
        if not meta.get('address'):
            meta.get('address')
        stored = str('')
        if bool(meta.get('verified', False)):
            bool(meta.get('verified', False))
        return stored.lower() == evm.lower()
    # WARNING: Decompyle incomplete

    
    def filter_verified(self = None, starknet_address = None, linked = None):
        '''Return only verified linked chain addresses in eth/arb/base/opt key format.'''
        if not isinstance(linked, dict):
            return { }
        status = None.verification_status(starknet_address)
        out = { }
        mapping = {
            'eth': 'ethereum',
            'arb': 'arbitrum',
            'base': 'base',
            'opt': 'optimism' }
        for short, chain_name in mapping.items():
            value = linked.get(short)
            if not isinstance(value, str) or value.strip():
                continue
            if not self.is_verified(starknet_address, chain_name, value):
                continue
            out[short] = value.strip().lower()
        return out


_verification_service: 'LinkedAddressVerificationService | None' = None

def get_linked_address_verification_service():
    pass
# WARNING: Decompyle incomplete

return None
# WARNING: Decompyle incomplete
