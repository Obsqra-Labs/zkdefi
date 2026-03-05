"""Dual-wallet session binding service.

Provides a lightweight off-chain session that binds a Starknet address to a
signature-verified EVM address (for example MetaMask) without changing
transaction authorization paths.
"""

from __future__ import annotations

import hashlib
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.json_store import JsonStore
from app.services.linked_addresses_store import get_linked, set_linked
from app.services.linked_address_verification_service import (
    LinkedAddressVerificationError,
    get_linked_address_verification_service,
)
from app.services.starknet_signature_verification_service import (
    StarknetSignatureVerificationError,
    get_starknet_signature_verification_service,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class DualWalletSessionService:
    def __init__(self) -> None:
        self.ttl_sec = int(os.getenv("DUAL_WALLET_SESSION_TTL_SEC", "86400"))
        self._store = JsonStore("dual_wallet_sessions")
        self._verifier = get_linked_address_verification_service()
        self._starknet_sig_verifier = get_starknet_signature_verification_service()

    @staticmethod
    def _normalize_starknet(address: str) -> str:
        return str(address or "").strip().lower()

    def _normalize_chain(self, chain: str) -> str:
        return self._verifier.normalize_chain(chain)

    @staticmethod
    def _chain_to_short(chain: str) -> str | None:
        mapping = {
            "ethereum": "eth",
            "arbitrum": "arb",
            "base": "base",
            "optimism": "opt",
        }
        return mapping.get((chain or "").strip().lower())

    @staticmethod
    def _sanitize_auth_provider(value: str | None) -> str:
        provider = str(value or "injected").strip().lower()
        if provider in {"injected", "web3auth_siw"}:
            return provider
        return "injected"

    @staticmethod
    def _safe_string(value: Any, limit: int = 256) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        return text[:limit]

    @staticmethod
    def _signature_digest(value: Any) -> str | None:
        text = DualWalletSessionService._safe_string(value, 8192)
        if not text:
            return None
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    @classmethod
    def _credential_summary(cls, credentials: Any) -> dict[str, Any] | None:
        if not isinstance(credentials, dict):
            return None

        out: dict[str, Any] = {}
        mode = cls._safe_string(credentials.get("mode"), 64)
        if mode:
            out["mode"] = mode
        standard = cls._safe_string(credentials.get("standard"), 64)
        if standard:
            out["standard"] = standard
        generated_at = cls._safe_string(credentials.get("generated_at"), 80)
        if generated_at:
            out["generated_at"] = generated_at

        ethereum = credentials.get("ethereum")
        if isinstance(ethereum, dict):
            eth_summary: dict[str, Any] = {}
            for key in ("network", "address", "chain_id", "selected_chain"):
                val = cls._safe_string(ethereum.get(key), 80)
                if val:
                    eth_summary[key] = val
            verified = ethereum.get("verified")
            if isinstance(verified, bool):
                eth_summary["verified"] = verified
            signature = ethereum.get("signature")
            if isinstance(signature, dict):
                sig_type = cls._safe_string(signature.get("t"), 48)
                sig_value = signature.get("s")
                sig_digest = cls._signature_digest(sig_value)
                if sig_type:
                    eth_summary["signature_type"] = sig_type
                if sig_digest:
                    eth_summary["signature_digest"] = sig_digest
            if eth_summary:
                out["ethereum"] = eth_summary

        starknet = credentials.get("starknet")
        if isinstance(starknet, dict):
            stark_summary: dict[str, Any] = {}
            for key in ("address", "chain_id", "signature_type", "signed_at"):
                val = cls._safe_string(starknet.get(key), 96)
                if val:
                    stark_summary[key] = val
            present = starknet.get("present")
            if isinstance(present, bool):
                stark_summary["present"] = present
            typed_data = starknet.get("typed_data")
            if isinstance(typed_data, dict):
                primary_type = cls._safe_string(
                    typed_data.get("primary_type") or typed_data.get("primaryType"),
                    96,
                )
                if primary_type:
                    stark_summary["typed_data_primary_type"] = primary_type
            sig_digest = cls._signature_digest(starknet.get("signature"))
            if sig_digest:
                stark_summary["signature_digest"] = sig_digest
            if stark_summary:
                out["starknet"] = stark_summary

        return out or None

    @staticmethod
    def _append_history(row: dict[str, Any], event: dict[str, Any], max_items: int = 20) -> None:
        history = row.get("history")
        if not isinstance(history, list):
            history = []
        history.append(event)
        row["history"] = history[-max_items:]

    @classmethod
    def _has_nonempty_signature(cls, value: Any) -> bool:
        if isinstance(value, str):
            return bool(value.strip())
        if isinstance(value, (list, tuple)):
            return any(bool(str(part).strip()) for part in value)
        if isinstance(value, dict):
            return any(bool(str(part).strip()) for part in value.values())
        return value is not None

    def _validate_web3auth_credentials(
        self,
        *,
        starknet_address: str,
        evm_address: str,
        credentials: dict[str, Any] | None,
    ) -> None:
        if not isinstance(credentials, dict):
            raise LinkedAddressVerificationError(
                "Web3Auth SIW mode requires credentials payload"
            )

        ethereum = credentials.get("ethereum")
        if not isinstance(ethereum, dict):
            raise LinkedAddressVerificationError(
                "Web3Auth SIW credentials missing ethereum section"
            )
        eth_address = self._safe_string(ethereum.get("address"), 128)
        if not eth_address:
            raise LinkedAddressVerificationError(
                "Web3Auth SIW credentials missing ethereum address"
            )
        if eth_address.lower() != str(evm_address or "").lower():
            raise LinkedAddressVerificationError(
                "Web3Auth SIW ethereum address does not match linked EVM address"
            )
        eth_sig = ethereum.get("signature")
        if not isinstance(eth_sig, dict) or not self._has_nonempty_signature(eth_sig.get("s")):
            raise LinkedAddressVerificationError(
                "Web3Auth SIW credentials missing ethereum signature"
            )

        starknet = credentials.get("starknet")
        if not isinstance(starknet, dict):
            raise LinkedAddressVerificationError(
                "Web3Auth SIW credentials missing starknet section"
            )
        stark_address = self._safe_string(starknet.get("address"), 128)
        if not stark_address:
            raise LinkedAddressVerificationError(
                "Web3Auth SIW credentials missing starknet address"
            )
        if stark_address.lower() != str(starknet_address or "").lower():
            raise LinkedAddressVerificationError(
                "Web3Auth SIW starknet address does not match session address"
            )
        if not self._has_nonempty_signature(starknet.get("signature")):
            raise LinkedAddressVerificationError(
                "Web3Auth SIW credentials missing starknet signature"
            )
        typed_data = starknet.get("typed_data")
        if not isinstance(typed_data, dict):
            raise LinkedAddressVerificationError(
                "Web3Auth SIW credentials missing starknet typed_data payload"
            )
        try:
            self._starknet_sig_verifier.verify_dual_session_bind(
                starknet_address=starknet_address,
                evm_address=evm_address,
                signature=starknet.get("signature"),
                typed_data=typed_data,
            )
        except StarknetSignatureVerificationError as exc:
            raise LinkedAddressVerificationError(str(exc)) from exc

    def _bind_verified_address_to_identity(
        self,
        starknet_address: str,
        chain: str,
        evm_address: str,
        *,
        upsert_linked: bool,
    ) -> dict[str, Any]:
        short = self._chain_to_short(chain)
        if not short:
            return {
                "linked_chain_key": None,
                "linked_address": None,
                "bound": False,
                "reason": "unsupported_chain",
            }

        if upsert_linked:
            set_kwargs: dict[str, str | None] = {
                "eth": None,
                "arb": None,
                "base": None,
                "opt": None,
            }
            set_kwargs[short] = evm_address
            # Persist the verified EVM address into linked addresses so
            # identity/reputation/credit paths consume the same canonical mapping.
            set_linked(starknet_address, **set_kwargs)
        linked_after = get_linked(starknet_address)
        linked_value = linked_after.get(short)
        bound = isinstance(linked_value, str) and linked_value.lower() == str(evm_address).lower()
        return {
            "linked_chain_key": short,
            "linked_address": linked_value,
            "bound": bool(bound),
            "linked_updated_at": _now_iso(),
        }

    def start(
        self,
        starknet_address: str,
        chain: str,
        evm_address: str,
    ) -> dict[str, Any]:
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            raise LinkedAddressVerificationError("Missing Starknet address")
        return self._verifier.start_challenge(stark, chain, evm_address)

    def complete(
        self,
        starknet_address: str,
        chain: str,
        evm_address: str,
        nonce_id: str,
        signature: str,
        *,
        auth_provider: str | None = None,
        credentials: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            raise LinkedAddressVerificationError("Missing Starknet address")

        proof = self._verifier.complete_challenge(
            starknet_address=stark,
            chain=chain,
            address=evm_address,
            nonce_id=nonce_id,
            signature=signature,
        )
        now = int(time.time())
        expires_at = now + max(60, self.ttl_sec)
        chain_name = self._normalize_chain(chain)
        auth_provider_name = self._sanitize_auth_provider(auth_provider)
        if auth_provider_name == "web3auth_siw":
            self._validate_web3auth_credentials(
                starknet_address=stark,
                evm_address=str(proof.get("address") or ""),
                credentials=credentials,
            )
        credential_summary = self._credential_summary(credentials)

        record = {
            "active": True,
            "status": "active",
            "session_id": uuid.uuid4().hex,
            "starknet_address": stark,
            "chain": chain_name,
            "evm_address": proof.get("address"),
            "issued_at": now,
            "issued_at_iso": _now_iso(),
            "expires_at": expires_at,
            "verified_at": proof.get("verified_at"),
            "linked_proof": {
                "nonce_id": nonce_id,
            },
            "auth_provider": auth_provider_name,
        }
        if credential_summary is not None:
            record["credential_summary"] = credential_summary
        record["identity_binding"] = self._bind_verified_address_to_identity(
            starknet_address=stark,
            chain=chain_name,
            evm_address=str(proof.get("address") or ""),
            upsert_linked=True,
        )
        history_event: dict[str, Any] = {
            "at": _now_iso(),
            "action": "bind",
            "status": "active",
            "auth_provider": auth_provider_name,
            "chain": chain_name,
            "evm_address": proof.get("address"),
            "bound": bool(record.get("identity_binding", {}).get("bound", False)),
        }
        if credential_summary is not None:
            history_event["credential_mode"] = credential_summary.get("mode")
        self._append_history(record, history_event)
        self._store.set(stark, record)
        return dict(record)

    def get(self, starknet_address: str) -> dict[str, Any]:
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            return {"active": False, "status": "missing", "starknet_address": stark}
        row = self._store.get(stark)
        if not isinstance(row, dict):
            return {"active": False, "status": "missing", "starknet_address": stark}

        now = int(time.time())
        expires_at = int(row.get("expires_at", 0) or 0)
        if bool(row.get("active")) and expires_at > 0 and now >= expires_at:
            row["active"] = False
            row["status"] = "expired"
            row["expired_at"] = now
            row["expired_at_iso"] = _now_iso()
            self._append_history(
                row,
                {
                    "at": row["expired_at_iso"],
                    "action": "expired",
                    "status": "expired",
                    "auth_provider": row.get("auth_provider", "injected"),
                    "chain": row.get("chain"),
                    "evm_address": row.get("evm_address"),
                    "bound": bool(row.get("identity_binding", {}).get("bound", False))
                    if isinstance(row.get("identity_binding"), dict)
                    else False,
                },
            )
            self._store.set(stark, row)
        # Keep identity binding context current even if session expires/revokes.
        chain_name = str(row.get("chain") or "")
        evm_address = str(row.get("evm_address") or "")
        if chain_name and evm_address:
            row["identity_binding"] = self._bind_verified_address_to_identity(
                starknet_address=stark,
                chain=chain_name,
                evm_address=evm_address,
                upsert_linked=False,
            )
        if not isinstance(row.get("history"), list):
            row["history"] = []
        return dict(row)

    def revoke(self, starknet_address: str) -> dict[str, Any]:
        stark = self._normalize_starknet(starknet_address)
        if not stark:
            return {"active": False, "status": "missing", "starknet_address": stark}
        row = self._store.get(stark)
        if not isinstance(row, dict):
            return {"active": False, "status": "missing", "starknet_address": stark}
        already_revoked = row.get("status") == "revoked"
        row["active"] = False
        row["status"] = "revoked"
        row["revoked_at"] = int(time.time())
        row["revoked_at_iso"] = _now_iso()
        chain_name = str(row.get("chain") or "")
        evm_address = str(row.get("evm_address") or "")
        if chain_name and evm_address:
            row["identity_binding"] = self._bind_verified_address_to_identity(
                starknet_address=stark,
                chain=chain_name,
                evm_address=evm_address,
                upsert_linked=False,
            )
        if not already_revoked:
            self._append_history(
                row,
                {
                    "at": row["revoked_at_iso"],
                    "action": "revoke",
                    "status": "revoked",
                    "auth_provider": row.get("auth_provider", "injected"),
                    "chain": row.get("chain"),
                    "evm_address": row.get("evm_address"),
                    "bound": bool(row.get("identity_binding", {}).get("bound", False))
                    if isinstance(row.get("identity_binding"), dict)
                    else False,
                },
            )
        self._store.set(stark, row)
        return dict(row)


_dual_wallet_session_service: DualWalletSessionService | None = None


def get_dual_wallet_session_service() -> DualWalletSessionService:
    global _dual_wallet_session_service
    if _dual_wallet_session_service is None:
        _dual_wallet_session_service = DualWalletSessionService()
    return _dual_wallet_session_service
