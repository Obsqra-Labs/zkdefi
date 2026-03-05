#!/usr/bin/env python3
"""Unit tests for Risk Profile v2 trust-plane services."""

import sys
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

# Ensure backend app is importable
backend = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend))

from app.services import attestation_service
from app.services.attestation_service import get_active_attestation, issue_attestation
from app.services.linked_address_verification_service import (
    LinkedAddressVerificationError,
    LinkedAddressVerificationService,
)
from app.services.profile_decision_service import ProfileDecisionService


class InMemoryStore:
    def __init__(self):
        self.data = {}

    def get(self, key):
        return self.data.get(key)

    def set(self, key, value):
        self.data[key] = value

    def values(self):
        return list(self.data.values())

    def all(self):
        return dict(self.data)


class DummyReceiptService:
    def append_proof_receipt(self, **kwargs):
        return kwargs


def _risk_bundle(
    *,
    tier: int = 0,
    composite: int = 10,
    letter: str = "D",
    has_agent: bool = False,
    active_sessions: int = 0,
):
    return {
        "address": "0xabc",
        "reputation": {
            "tier": tier,
            "tier_name": "Strict" if tier == 0 else "Standard",
            "tenure_days": 10,
            "transaction_count": 2,
            "collateral_eth": 0.0,
            "total_volume_eth": 0.0,
        },
        "risk_passport": {
            "composite_score": composite,
            "letter_rating": letter,
            "credit_tier": None,
            "credit_score": None,
        },
        "onboarding": {
            "has_agent": has_agent,
            "identity_commitment": None,
        },
        "session_summary": {
            "count": active_sessions,
            "active_count": active_sessions,
            "sessions": [],
        },
        "linked_addresses": {},
    }


def test_profile_decision_service_soft_vs_hard(monkeypatch):
    monkeypatch.setenv("RISK_GATE_MODE", "soft")
    monkeypatch.setenv("RISK_GATE_ENFORCE_RELAYER", "true")
    monkeypatch.setenv("RISK_GATE_ENFORCE_BORROW", "true")
    monkeypatch.setenv("RISK_GATE_ENFORCE_AUTONOMOUS", "true")

    soft = ProfileDecisionService()
    soft.telemetry_enabled = False
    soft_out = soft.evaluate(_risk_bundle())

    assert soft_out["decisions"]["relayer"]["mode"] == "advisory"
    assert soft_out["decisions"]["execution"]["mode"] == "advisory"
    assert soft_out["decisions"]["lending"]["mode"] == "advisory"
    assert "onboarding_incomplete" in soft_out["decisions"]["execution"]["reason_codes"]

    monkeypatch.setenv("RISK_GATE_MODE", "hard")
    hard = ProfileDecisionService()
    hard.telemetry_enabled = False
    hard_out = hard.evaluate(_risk_bundle())

    assert hard_out["decisions"]["relayer"]["mode"] == "block"
    assert hard_out["decisions"]["execution"]["mode"] == "block"
    assert hard_out["decisions"]["lending"]["mode"] == "block"


def test_linked_address_verification_valid_signature_and_replay_rejected():
    svc = LinkedAddressVerificationService()
    svc._challenge_store = InMemoryStore()  # type: ignore[attr-defined]
    svc._proof_store = InMemoryStore()  # type: ignore[attr-defined]

    stark = "0x0123"
    key = "0x59c6995e998f97a5a0044966f0945382d7c8f6f8f4ddfbd2dcef7d2d7c5ed6d5"
    address = Account.from_key(key).address

    started = svc.start_challenge(stark, "ethereum", address)
    signature = Account.sign_message(
        encode_defunct(text=started["challenge"]),
        private_key=key,
    ).signature.hex()

    completed = svc.complete_challenge(
        starknet_address=stark,
        chain="ethereum",
        address=address,
        nonce_id=started["nonce_id"],
        signature=signature,
    )
    assert completed["verified"] is True
    assert svc.is_verified(stark, "ethereum", address) is True

    with pytest.raises(LinkedAddressVerificationError):
        svc.complete_challenge(
            starknet_address=stark,
            chain="ethereum",
            address=address,
            nonce_id=started["nonce_id"],
            signature=signature,
        )


def test_attestation_issue_is_idempotent_until_inputs_change(monkeypatch):
    in_mem = InMemoryStore()
    monkeypatch.setattr(attestation_service, "_attestation_store", in_mem)
    monkeypatch.setattr(attestation_service, "get_receipt_service", lambda: DummyReceiptService())

    address = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"

    first = issue_attestation(
        address=address,
        composite_score=52,
        letter_rating="B",
        tier=1,
        credit_tier="A",
        collateral_eth=1.1,
        chain_id="0x534e5f5345504f4c4941",
        linked_address_count=1,
        cross_chain_verified=True,
    )
    second = issue_attestation(
        address=address,
        composite_score=52,
        letter_rating="B",
        tier=1,
        credit_tier="A",
        collateral_eth=1.1,
        chain_id="0x534e5f5345504f4c4941",
        linked_address_count=1,
        cross_chain_verified=True,
    )

    assert first.attestation_hash == second.attestation_hash
    assert len(in_mem.all()) == 1

    third = issue_attestation(
        address=address,
        composite_score=70,
        letter_rating="A",
        tier=2,
        credit_tier="AA",
        collateral_eth=1.1,
        chain_id="0x534e5f5345504f4c4941",
        linked_address_count=1,
        cross_chain_verified=True,
    )

    assert third.attestation_hash != first.attestation_hash
    assert len(in_mem.all()) == 2

    active = get_active_attestation(address)
    assert isinstance(active, dict)
    assert active.get("attestation_hash") == third.attestation_hash
