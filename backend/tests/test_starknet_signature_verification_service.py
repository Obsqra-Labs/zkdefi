from __future__ import annotations

import pytest

from app.services.starknet_signature_verification_service import (
    StarknetSignatureVerificationError,
    StarknetSignatureVerificationService,
)


def _typed_data(evm_address: str) -> dict:
    return {
        "domain": {
            "name": "zkde.fi",
            "version": "1",
            "chainId": "0x534e5f5345504f4c4941",
        },
        "types": {
            "StarkNetDomain": [
                {"name": "name", "type": "string"},
                {"name": "chainId", "type": "felt"},
                {"name": "version", "type": "string"},
            ],
            "DualWalletSessionBind": [
                {"name": "statement", "type": "felt"},
                {"name": "evmAddress", "type": "felt"},
                {"name": "evmChain", "type": "felt"},
                {"name": "nonceRef", "type": "felt"},
                {"name": "timestamp", "type": "felt"},
            ],
        },
        "primaryType": "DualWalletSessionBind",
        "message": {
            "statement": "0x7a6b6465206475616c2062696e64",
            "evmAddress": evm_address,
            "evmChain": "0x657468657265756d",
            "nonceRef": "0x6e6f6e6365",
            "timestamp": "1730000000",
        },
    }


def test_verify_dual_session_bind_accepts_valid_payload(monkeypatch):
    service = StarknetSignatureVerificationService()
    monkeypatch.setattr(
        service,
        "_rpc_is_valid_signature",
        lambda **_: (True, ""),
    )

    service.verify_dual_session_bind(
        starknet_address="0x1234",
        evm_address="0xabc123",
        signature=["0x1", "0x2"],
        typed_data=_typed_data("0xabc123"),
    )


def test_verify_dual_session_bind_rejects_domain_mismatch(monkeypatch):
    service = StarknetSignatureVerificationService()
    monkeypatch.setattr(service, "_rpc_is_valid_signature", lambda **_: (True, ""))
    payload = _typed_data("0xabc123")
    payload["domain"]["name"] = "evil.example"

    with pytest.raises(StarknetSignatureVerificationError, match="domain"):
        service.verify_dual_session_bind(
            starknet_address="0x1234",
            evm_address="0xabc123",
            signature=["0x1", "0x2"],
            typed_data=payload,
        )


def test_verify_dual_session_bind_rejects_evm_mismatch(monkeypatch):
    service = StarknetSignatureVerificationService()
    monkeypatch.setattr(service, "_rpc_is_valid_signature", lambda **_: (True, ""))
    payload = _typed_data("0x999")

    with pytest.raises(StarknetSignatureVerificationError, match="EVM address mismatch"):
        service.verify_dual_session_bind(
            starknet_address="0x1234",
            evm_address="0xabc123",
            signature=["0x1", "0x2"],
            typed_data=payload,
        )


def test_verify_dual_session_bind_rejects_invalid_signature(monkeypatch):
    service = StarknetSignatureVerificationService()
    monkeypatch.setattr(
        service,
        "_rpc_is_valid_signature",
        lambda **_: (False, "signature rejected"),
    )

    with pytest.raises(StarknetSignatureVerificationError, match="signature rejected"):
        service.verify_dual_session_bind(
            starknet_address="0x1234",
            evm_address="0xabc123",
            signature=["0x1", "0x2"],
            typed_data=_typed_data("0xabc123"),
        )
