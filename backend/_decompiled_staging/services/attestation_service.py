# Source Generated with Decompyle++
# File: attestation_service.cpython-312.pyc (Python 3.12)

'''
Attestation Service

Issues verifiable credit attestations from the Risk Profile so contracts and
third parties can verify "this user qualifies for X" without seeing the full passport.

An attestation captures: subject, letter_min, composite_min, credit_tier,
collateral_wei, unsecured_cap_wei, total_line_wei, sources, chain_id,
issued_at, expires_at, and an attestation_hash.
'''
from __future__ import annotations
import hashlib
import logging
import time
from dataclasses import dataclass, asdict, fields
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from app.services.credit_line_service import compute_credit_line, CreditLine
from app.services.json_store import JsonStore
from app.services.receipt_service import get_receipt_service
logger = logging.getLogger(__name__)
WEI_PER_ETH = 0xDE0B6B3A7640000
ATTESTATION_VALIDITY_DAYS = 7
_attestation_store = JsonStore('attestations')
CreditAttestation = <NODE:12>()

def _sha256_hex(data = None):
    return '0x' + hashlib.sha256(data.encode()).hexdigest()


def _compute_attestation_hash(att = None):
    '''Deterministic hash of attestation fields (excluding the hash itself).'''
    canonical = '|'.join([
        str(att.get('subject', '')),
        str(att.get('letter_min', '')),
        str(att.get('composite_min', 0)),
        str(att.get('credit_tier', '')),
        str(att.get('collateral_wei', 0)),
        str(att.get('unsecured_cap_wei', 0)),
        str(att.get('total_line_wei', 0)),
        str(att.get('rate_bps', 0)),
        str(att.get('chain_id', '')),
        str(att.get('issued_at', '')),
        str(att.get('expires_at', ''))])
    return _sha256_hex(canonical)


def _compute_input_fingerprint(*, composite_score, letter_rating, tier, credit_tier, collateral_eth, linked_address_count, cross_chain_verified):
    if not credit_tier:
        credit_tier
    raw = '|'.join([
        str(int(composite_score)),
        str(letter_rating),
        str(int(tier)),
        str(''),
        f'''{float(collateral_eth):.12f}''',
        str(int(linked_address_count)),
        '1' if cross_chain_verified else '0'])
    return _sha256_hex(raw)


def _is_unexpired(att = None):
    expires_at = att.get('expires_at')
    if not isinstance(expires_at, str) or expires_at:
        return False
    expiry = datetime.fromisoformat(expires_at)
# WARNING: Decompyle incomplete


def _to_attestation(row = None):
    pass
# WARNING: Decompyle incomplete


def issue_attestation(address, composite_score, letter_rating, tier, credit_tier, collateral_eth, chain_id = None, linked_address_count = None, cross_chain_verified = None, stark_id = (0, False, None, False), force_issue = ('address', 'str', 'composite_score', 'int', 'letter_rating', 'str', 'tier', 'int', 'credit_tier', 'Optional[str]', 'collateral_eth', 'float', 'chain_id', 'str', 'linked_address_count', 'int', 'cross_chain_verified', 'bool', 'stark_id', 'Optional[str]', 'force_issue', 'bool', 'return', 'CreditAttestation')):
    '''Issue a credit attestation from profile data.'''
    fingerprint = _compute_input_fingerprint(composite_score = composite_score, letter_rating = letter_rating, tier = tier, credit_tier = credit_tier, collateral_eth = collateral_eth, linked_address_count = linked_address_count, cross_chain_verified = cross_chain_verified)
# WARNING: Decompyle incomplete


def get_attestation(attestation_hash = None):
    return _attestation_store.get(attestation_hash)


def get_user_attestations(address = None):
    '''Return all attestations for a given address, newest first.'''
    all_atts = _attestation_store.values()
# WARNING: Decompyle incomplete


def get_active_attestation(address = None):
    '''Return newest unexpired attestation for a user, if present.'''
    for row in get_user_attestations(address):
        if not _is_unexpired(row):
            continue
        
        return get_user_attestations(address), row


def build_register_proof_calldata(attestation_hash = None, agent_id = None):
    '''
    Build calldata for ValidationProofRegistry.register_proof to register
    an attestation on-chain. Returns the calldata array and contract address
    for frontend wallet signing.
    '''
    import os
    contract = os.getenv('VALIDATION_PROOF_REGISTRY_ADDRESS', '0x02e2faab2cad8ecdde5e991798673ddcc08983b872304a66e5f99fbd3aface23')
    fact_hash_int = int(attestation_hash, 16) if attestation_hash.startswith('0x') else int(attestation_hash)
    fact_hash_felt = hex(fact_hash_int % 2 ** 251)
    agent_id_int = int.from_bytes(agent_id.encode()[:31], 'big')
    agent_id_felt = hex(agent_id_int % 2 ** 251)
    proof_type_int = int.from_bytes(b'credit_attestation'[:31], 'big')
    proof_type_felt = hex(proof_type_int % 2 ** 251)
    action_type_int = int.from_bytes(b'lending_eligibility'[:31], 'big')
    action_type_felt = hex(action_type_int % 2 ** 251)
    verifier_address = os.getenv('GARAGA_VERIFIER_ADDRESS', '0x0')
    return {
        'contract': contract,
        'entrypoint': 'register_proof',
        'calldata': [
            fact_hash_felt,
            agent_id_felt,
            proof_type_felt,
            action_type_felt,
            verifier_address] }


def to_vc_format(att = None):
    '''Convert an attestation to W3C Verifiable Credential JSON-LD shape.'''
    if not att.get('stark_id'):
        att.get('stark_id')
    subject_id = att.get('subject', '')
    return {
        '@context': [
            'https://www.w3.org/2018/credentials/v1',
            'https://obsqra.xyz/credentials/v1'],
        'type': [
            'VerifiableCredential',
            'CreditAttestation'],
        'issuer': 'did:starknet:obsqra',
        'credentialSubject': {
            'id': f'''did:starknet:{subject_id}''',
            'creditLine': {
                'total_wei': str(att.get('total_line_wei', 0)),
                'unsecured_wei': str(att.get('unsecured_cap_wei', 0)),
                'collateral_wei': str(att.get('collateral_wei', 0)),
                'rate_bps': str(att.get('rate_bps', 0)) },
            'letter_rating': att.get('letter_min', 'D'),
            'credit_tier': att.get('credit_tier'),
            'sources': att.get('sources', []),
            'chain_id': att.get('chain_id', ''),
            'cross_chain_verified': att.get('cross_chain_verified', False),
            'chains': att.get('chains', []) },
        'proof': {
            'type': 'SHA256',
            'verificationMethod': 'ValidationProofRegistry',
            'proofValue': att.get('attestation_hash', '') },
        'issuanceDate': att.get('issued_at', ''),
        'expirationDate': att.get('expires_at', '') }

