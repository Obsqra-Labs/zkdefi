# Source Generated with Decompyle++
# File: dual_wallet_session_service.cpython-312.pyc (Python 3.12)

'''Dual-wallet session binding service.

Provides a lightweight off-chain session that binds a Starknet address to a
signature-verified EVM address (for example MetaMask) without changing
transaction authorization paths.
'''
from __future__ import annotations
import hashlib
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from app.services.json_store import JsonStore
from app.services.linked_addresses_store import get_linked, set_linked
from app.services.linked_address_verification_service import LinkedAddressVerificationError, get_linked_address_verification_service
from app.services.starknet_signature_verification_service import StarknetSignatureVerificationError, get_starknet_signature_verification_service

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


class DualWalletSessionService:
    
    def __init__(self = None):
        self.ttl_sec = int(os.getenv('DUAL_WALLET_SESSION_TTL_SEC', '86400'))
        self._store = JsonStore('dual_wallet_sessions')
        self._verifier = get_linked_address_verification_service()
        self._starknet_sig_verifier = get_starknet_signature_verification_service()

    _normalize_starknet = (lambda address = None: if not address:
addressstr('').strip().lower())()
    
    def _normalize_chain(self = None, chain = None):
        return self._verifier.normalize_chain(chain)

    _chain_to_short = (lambda chain = None: mapping = {
'ethereum': 'eth',
'arbitrum': 'arb',
'base': 'base',
'optimism': 'opt' }if not chain:
chainmapping.get(''.strip().lower()))()
    _sanitize_auth_provider = (lambda value = None: if not value:
valueprovider = str('injected').strip().lower()if provider in frozenset({'injected', 'web3auth_siw'}):
provider)()
    _safe_string = (lambda value = None, limit = None: pass# WARNING: Decompyle incomplete
)()
    _signature_digest = (lambda value = None: text = DualWalletSessionService._safe_string(value, 8192)if not text:
Nonehashlib.sha256(text.encode('utf-8')).hexdigest())()
    _credential_summary = (lambda cls = None, credentials = None: if not isinstance(credentials, dict):
Noneout = { }mode = cls._safe_string(credentials.get('mode'), 64)if mode:
out['mode'] = modestandard = cls._safe_string(credentials.get('standard'), 64)if standard:
out['standard'] = standardgenerated_at = cls._safe_string(credentials.get('generated_at'), 80)if generated_at:
out['generated_at'] = generated_atethereum = credentials.get('ethereum')if isinstance(ethereum, dict):
eth_summary = { }for key in ('network', 'address', 'chain_id', 'selected_chain'):
val = cls._safe_string(ethereum.get(key), 80)if not val:
continueeth_summary[key] = valverified = ethereum.get('verified')if isinstance(verified, bool):
eth_summary['verified'] = verifiedsignature = ethereum.get('signature')if isinstance(signature, dict):
sig_type = cls._safe_string(signature.get('t'), 48)sig_value = signature.get('s')sig_digest = cls._signature_digest(sig_value)if sig_type:
eth_summary['signature_type'] = sig_typeif sig_digest:
eth_summary['signature_digest'] = sig_digestif eth_summary:
out['ethereum'] = eth_summarystarknet = credentials.get('starknet')if isinstance(starknet, dict):
stark_summary = { }for key in ('address', 'chain_id', 'signature_type', 'signed_at'):
val = cls._safe_string(starknet.get(key), 96)if not val:
continuestark_summary[key] = valpresent = starknet.get('present')if isinstance(present, bool):
stark_summary['present'] = presenttyped_data = starknet.get('typed_data')if isinstance(typed_data, dict):
if not typed_data.get('primary_type'):
typed_data.get('primary_type')primary_type = cls._safe_string(typed_data.get('primaryType'), 96)if primary_type:
stark_summary['typed_data_primary_type'] = primary_typesig_digest = cls._signature_digest(starknet.get('signature'))if sig_digest:
stark_summary['signature_digest'] = sig_digestif stark_summary:
out['starknet'] = stark_summaryif not out:
out)()
    _append_history = (lambda row = None, event = None, max_items = staticmethod: history = row.get('history')if not isinstance(history, list):
history = []history.append(event)row['history'] = history[-max_items:])()
    _has_nonempty_signature = (lambda cls = None, value = None: if isinstance(value, str):
bool(value.strip())if None(value, (list, tuple)):
(lambda .0: pass# WARNING: Decompyle incomplete
)(value())
        if None(value, dict):
            return (lambda .0: pass# WARNING: Decompyle incomplete
)(value.values()())
        return None is not None
)()
    
    def _validate_web3auth_credentials(self = None, *, starknet_address, evm_address, credentials):
        if not isinstance(credentials, dict):
            raise LinkedAddressVerificationError('Web3Auth SIW mode requires credentials payload')
        ethereum = credentials.get('ethereum')
        if not isinstance(ethereum, dict):
            raise LinkedAddressVerificationError('Web3Auth SIW credentials missing ethereum section')
        eth_address = self._safe_string(ethereum.get('address'), 128)
        if not eth_address:
            raise LinkedAddressVerificationError('Web3Auth SIW credentials missing ethereum address')
        if not evm_address:
            evm_address
        if eth_address.lower() != str('').lower():
            raise LinkedAddressVerificationError('Web3Auth SIW ethereum address does not match linked EVM address')
        eth_sig = ethereum.get('signature')
        if not isinstance(eth_sig, dict) or self._has_nonempty_signature(eth_sig.get('s')):
            raise LinkedAddressVerificationError('Web3Auth SIW credentials missing ethereum signature')
        starknet = credentials.get('starknet')
        if not isinstance(starknet, dict):
            raise LinkedAddressVerificationError('Web3Auth SIW credentials missing starknet section')
        stark_address = self._safe_string(starknet.get('address'), 128)
        if not stark_address:
            raise LinkedAddressVerificationError('Web3Auth SIW credentials missing starknet address')
        if not starknet_address:
            starknet_address
        if stark_address.lower() != str('').lower():
            raise LinkedAddressVerificationError('Web3Auth SIW starknet address does not match session address')
        if not self._has_nonempty_signature(starknet.get('signature')):
            raise LinkedAddressVerificationError('Web3Auth SIW credentials missing starknet signature')
        typed_data = starknet.get('typed_data')
        if not isinstance(typed_data, dict):
            raise LinkedAddressVerificationError('Web3Auth SIW credentials missing starknet typed_data payload')
        self._starknet_sig_verifier.verify_dual_session_bind(starknet_address = starknet_address, evm_address = evm_address, signature = starknet.get('signature'), typed_data = typed_data)
        return None
    # WARNING: Decompyle incomplete

    
    def _bind_verified_address_to_identity(self = None, starknet_address = None, chain = None, evm_address = ('starknet_address', 'str', 'chain', 'str', 'evm_address', 'str', 'upsert_linked', 'bool', 'return', 'dict[str, Any]'), *, upsert_linked):
        short = self._chain_to_short(chain)
        if not short:
            return {
                'linked_chain_key': None,
                'linked_address': None,
                'bound': False,
                'reason': 'unsupported_chain' }
    # WARNING: Decompyle incomplete

    
    def start(self = None, starknet_address = None, chain = None, evm_address = ('starknet_address', 'str', 'chain', 'str', 'evm_address', 'str', 'return', 'dict[str, Any]')):
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            raise LinkedAddressVerificationError('Missing Starknet address')
        return self._verifier.start_challenge(stark, chain, evm_address)

    
    def complete(self = None, starknet_address = None, chain = None, evm_address = None, nonce_id = {
        'auth_provider': None,
        'credentials': None }, signature = ('starknet_address', 'str', 'chain', 'str', 'evm_address', 'str', 'nonce_id', 'str', 'signature', 'str', 'auth_provider', 'str | None', 'credentials', 'dict[str, Any] | None', 'return', 'dict[str, Any]'), *, auth_provider, credentials):
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            raise LinkedAddressVerificationError('Missing Starknet address')
        proof = self._verifier.complete_challenge(starknet_address = stark, chain = chain, address = evm_address, nonce_id = nonce_id, signature = signature)
        now = int(time.time())
        expires_at = now + max(60, self.ttl_sec)
        chain_name = self._normalize_chain(chain)
        auth_provider_name = self._sanitize_auth_provider(auth_provider)
        if auth_provider_name == 'web3auth_siw':
            if not proof.get('address'):
                proof.get('address')
            self._validate_web3auth_credentials(starknet_address = stark, evm_address = str(''), credentials = credentials)
        credential_summary = self._credential_summary(credentials)
        record = {
            'active': True,
            'status': 'active',
            'session_id': uuid.uuid4().hex,
            'starknet_address': stark,
            'chain': chain_name,
            'evm_address': proof.get('address'),
            'issued_at': now,
            'issued_at_iso': _now_iso(),
            'expires_at': expires_at,
            'verified_at': proof.get('verified_at'),
            'linked_proof': {
                'nonce_id': nonce_id },
            'auth_provider': auth_provider_name }
    # WARNING: Decompyle incomplete

    
    def get(self = None, starknet_address = None):
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            return {
                'active': False,
                'status': 'missing',
                'starknet_address': stark }
        row = None._store.get(stark)
        if not isinstance(row, dict):
            return {
                'active': False,
                'status': 'missing',
                'starknet_address': stark }
        now = None(time.time())
        if not row.get('expires_at', 0):
            row.get('expires_at', 0)
        expires_at = int(0)
        if bool(row.get('active')) and expires_at > 0 and now >= expires_at:
            row['active'] = False
            row['status'] = 'expired'
            row['expired_at'] = now
            row['expired_at_iso'] = _now_iso()
            self._append_history(row, {
                'at': row['expired_at_iso'],
                'action': 'expired',
                'status': 'expired',
                'auth_provider': row.get('auth_provider', 'injected'),
                'chain': row.get('chain'),
                'evm_address': row.get('evm_address'),
                'bound': bool(row.get('identity_binding', { }).get('bound', False)) if isinstance(row.get('identity_binding'), dict) else False })
            self._store.set(stark, row)
        if not row.get('chain'):
            row.get('chain')
        chain_name = str('')
        if not row.get('evm_address'):
            row.get('evm_address')
        evm_address = str('')
        if chain_name and evm_address:
            row['identity_binding'] = self._bind_verified_address_to_identity(starknet_address = stark, chain = chain_name, evm_address = evm_address, upsert_linked = False)
        if not isinstance(row.get('history'), list):
            row['history'] = []
        return dict(row)

    
    def revoke(self = None, starknet_address = None):
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            return {
                'active': False,
                'status': 'missing',
                'starknet_address': stark }
        row = None._store.get(stark)
        if not isinstance(row, dict):
            return {
                'active': False,
                'status': 'missing',
                'starknet_address': stark }
        already_revoked = None.get('status') == 'revoked'
        row['active'] = False
        row['status'] = 'revoked'
        row['revoked_at'] = int(time.time())
        row['revoked_at_iso'] = _now_iso()
        if not row.get('chain'):
            row.get('chain')
        chain_name = str('')
        if not row.get('evm_address'):
            row.get('evm_address')
        evm_address = str('')
        if chain_name and evm_address:
            row['identity_binding'] = self._bind_verified_address_to_identity(starknet_address = stark, chain = chain_name, evm_address = evm_address, upsert_linked = False)
        if not already_revoked:
            self._append_history(row, {
                'at': row['revoked_at_iso'],
                'action': 'revoke',
                'status': 'revoked',
                'auth_provider': row.get('auth_provider', 'injected'),
                'chain': row.get('chain'),
                'evm_address': row.get('evm_address'),
                'bound': bool(row.get('identity_binding', { }).get('bound', False)) if isinstance(row.get('identity_binding'), dict) else False })
        self._store.set(stark, row)
        return dict(row)


_dual_wallet_session_service: 'DualWalletSessionService | None' = None

def get_dual_wallet_session_service():
    pass
# WARNING: Decompyle incomplete

