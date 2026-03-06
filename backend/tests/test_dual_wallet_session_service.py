from __future__ import annotations

import pytest

from app.services.dual_wallet_session_service import DualWalletSessionService
from app.services.linked_address_verification_service import LinkedAddressVerificationError
from app.services.starknet_signature_verification_service import (
    StarknetSignatureVerificationError,
)


class _PassVerifier:
    def verify_dual_session_bind(self, **_: object) -> None:
        return None


class _FailVerifier:
    def verify_dual_session_bind(self, **_: object) -> None:
        raise StarknetSignatureVerificationError("starknet signature invalid")


def _service(verifier: object) -> DualWalletSessionService:
    svc = DualWalletSessionService()
    svc._starknet_sig_verifier = verifier
    return svc


def test_validate_web3auth_credentials_accepts_dual_signatures():
    svc = _service(_PassVerifier())
    credentials = {
        "mode": "web3auth_siw",
        "ethereum": {
            "address": "0xabc123",
            "signature": {"t": "eip191", "s": "0xevmsig"},
        },
        "starknet": {
            "address": "0xstark123",
            "signature": ["0x1", "0x2"],
            "typed_data": {"primaryType": "DualWalletSessionBind"},
        },
    }

    svc._validate_web3auth_credentials(
        starknet_address="0xstark123",
        evm_address="0xabc123",
        credentials=credentials,
    )


def test_validate_web3auth_credentials_rejects_missing_starknet_signature():
    svc = _service(_PassVerifier())
    credentials = {
        "mode": "web3auth_siw",
        "ethereum": {
            "address": "0xabc123",
            "signature": {"t": "eip191", "s": "0xevmsig"},
        },
        "starknet": {
            "address": "0xstark123",
        },
    }

    with pytest.raises(LinkedAddressVerificationError, match="missing starknet signature"):
        svc._validate_web3auth_credentials(
            starknet_address="0xstark123",
            evm_address="0xabc123",
            credentials=credentials,
        )


def test_validate_web3auth_credentials_rejects_ethereum_address_mismatch():
    svc = _service(_PassVerifier())
    credentials = {
        "mode": "web3auth_siw",
        "ethereum": {
            "address": "0xdeadbeef",
            "signature": {"t": "eip191", "s": "0xevmsig"},
        },
        "starknet": {
            "address": "0xstark123",
            "signature": {"r": "0x1", "s": "0x2"},
            "typed_data": {"primaryType": "DualWalletSessionBind"},
        },
    }

    with pytest.raises(LinkedAddressVerificationError, match="does not match linked EVM address"):
        svc._validate_web3auth_credentials(
            starknet_address="0xstark123",
            evm_address="0xabc123",
            credentials=credentials,
        )


def test_validate_web3auth_credentials_rejects_missing_typed_data():
    svc = _service(_PassVerifier())
    credentials = {
        "mode": "web3auth_siw",
        "ethereum": {
            "address": "0xabc123",
            "signature": {"t": "eip191", "s": "0xevmsig"},
        },
        "starknet": {
            "address": "0xstark123",
            "signature": {"r": "0x1", "s": "0x2"},
        },
    }

    with pytest.raises(LinkedAddressVerificationError, match="missing starknet typed_data"):
        svc._validate_web3auth_credentials(
            starknet_address="0xstark123",
            evm_address="0xabc123",
            credentials=credentials,
        )


def test_validate_web3auth_credentials_maps_verifier_failure():
    svc = _service(_FailVerifier())
    credentials = {
        "mode": "web3auth_siw",
        "ethereum": {
            "address": "0xabc123",
            "signature": {"t": "eip191", "s": "0xevmsig"},
        },
        "starknet": {
            "address": "0xstark123",
            "signature": {"r": "0x1", "s": "0x2"},
            "typed_data": {"primaryType": "DualWalletSessionBind"},
        },
    }

    with pytest.raises(LinkedAddressVerificationError, match="starknet signature invalid"):
        svc._validate_web3auth_credentials(
            starknet_address="0xstark123",
            evm_address="0xabc123",
            credentials=credentials,
        )
