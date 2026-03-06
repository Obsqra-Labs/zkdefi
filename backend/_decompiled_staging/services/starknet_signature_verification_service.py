# Source Generated with Decompyle++
# File: starknet_signature_verification_service.cpython-312.pyc (Python 3.12)

'''Starknet typed-data signature verification service.

Used by dual-wallet SIW auth to verify that the Starknet wallet actually signed
the supplied typed-data payload. Verification is performed by:
1. Recomputing the typed-data message hash.
2. Calling account `is_valid_signature` on Starknet RPC.
'''
from __future__ import annotations
import json
import os
from typing import Any
import httpx
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.utils.typed_data import TypedData
from app.config import STARKNET_RPC_URL
_VALID_MAGIC = int('0x56414c4944', 16)

class StarknetSignatureVerificationError(ValueError):
    '''Domain error for Starknet typed-data verification.'''
    pass


def _env_bool(name = None, default = None):
    value = os.getenv(name)
# WARNING: Decompyle incomplete


class StarknetSignatureVerificationService:
    
    def __init__(self = None):
        self.rpc_url = os.getenv('STARKNET_RPC_URL', STARKNET_RPC_URL).strip()
        self.timeout_sec = float(os.getenv('DUAL_WALLET_STARKNET_VERIFY_TIMEOUT_SEC', '8'))
        self.required = _env_bool('DUAL_WALLET_STARKNET_VERIFY_REQUIRED', True)
        self._signature_selectors = [
            hex(get_selector_from_name('is_valid_signature')),
            hex(get_selector_from_name('isValidSignature'))]

    _parse_felt = (lambda value = None, *, field: if isinstance(value, bool):
raise StarknetSignatureVerificationError(f'''Invalid felt for {field}''')if isinstance(value, int):
valueif not value:
valuetext = None('').strip()if not text:
raise StarknetSignatureVerificationError(f'''Missing felt for {field}''')if text.lower().startswith('0x'):
int(text, 16)None(text, 10)# WARNING: Decompyle incomplete
)()
    _normalize_signature = (lambda cls = None, signature = None: if isinstance(signature, (list, tuple)):
values = list(signature)# WARNING: Decompyle incomplete
)()
    _normalize_typed_data = (lambda cls = None, typed_data = None: if not isinstance(typed_data, dict):
raise StarknetSignatureVerificationError('Missing Starknet typed_data payload')domain = typed_data.get('domain')types = typed_data.get('types')message = typed_data.get('message')if not typed_data.get('primaryType'):
typed_data.get('primaryType')primary_type = typed_data.get('primary_type')if not isinstance(domain, dict):
raise StarknetSignatureVerificationError('Invalid typed_data domain')if not isinstance(types, dict):
raise StarknetSignatureVerificationError('Invalid typed_data types')if not isinstance(message, dict):
raise StarknetSignatureVerificationError('Invalid typed_data message')if not isinstance(primary_type, str) or primary_type.strip():
raise StarknetSignatureVerificationError('Invalid typed_data primary type')normalized_domain = dict(domain)if 'chainId' not in normalized_domain and 'chain_id' in normalized_domain:
normalized_domain['chainId'] = normalized_domain['chain_id']payload = {
'domain': normalized_domain,
'types': types,
'primaryType': primary_type,
'message': message }revision = typed_data.get('revision')if isinstance(revision, str) and revision.strip():
payload['revision'] = revisionpayload)()
    
    def _rpc_is_valid_signature(self = None, *, account_address, message_hash, signature):
        pass
    # WARNING: Decompyle incomplete

    
    def verify_dual_session_bind(self = None, *, starknet_address, evm_address, signature, typed_data):
        if not self.required:
            return None
        if not self.rpc_url:
            raise StarknetSignatureVerificationError('Starknet RPC URL is not configured')
        account_address = self._parse_felt(starknet_address, field = 'starknet_address')
        evm_address_felt = self._parse_felt(evm_address, field = 'evm_address')
        sig_parts = self._normalize_signature(signature)
        normalized_typed_data = self._normalize_typed_data(typed_data)
        domain = normalized_typed_data.get('domain', { })
        if not domain.get('name'):
            domain.get('name')
        domain_name = str('').strip().lower()
        if domain_name != 'zkde.fi':
            raise StarknetSignatureVerificationError('Invalid SIW Starknet typed_data domain')
        if not normalized_typed_data.get('primaryType'):
            normalized_typed_data.get('primaryType')
        primary_type = str('').strip()
        if primary_type != 'DualWalletSessionBind':
            raise StarknetSignatureVerificationError('Invalid SIW Starknet typed_data primary type')
        message = normalized_typed_data.get('message', { })
        if not isinstance(message, dict):
            raise StarknetSignatureVerificationError('Invalid SIW Starknet typed_data message')
        if not message.get('evmAddress'):
            message.get('evmAddress')
        msg_evm_value = message.get('evm_address')
        msg_evm_felt = self._parse_felt(msg_evm_value, field = 'typed_data.message.evmAddress')
        if msg_evm_felt != evm_address_felt:
            raise StarknetSignatureVerificationError('SIW Starknet typed_data EVM address mismatch')
        typed = TypedData.from_dict(normalized_typed_data)
        message_hash = typed.message_hash(account_address)
        (ok, reason) = self._rpc_is_valid_signature(account_address = account_address, message_hash = message_hash, signature = sig_parts)
        if not ok:
            if not reason:
                reason
            raise StarknetSignatureVerificationError('Invalid Starknet signature')
        return None
    # WARNING: Decompyle incomplete


_service: 'StarknetSignatureVerificationService | None' = None

def get_starknet_signature_verification_service():
    pass
# WARNING: Decompyle incomplete

