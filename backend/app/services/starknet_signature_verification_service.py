"""Starknet typed-data signature verification service.

Used by dual-wallet SIW auth to verify that the Starknet wallet actually signed
the supplied typed-data payload. Verification is performed by:
1. Recomputing the typed-data message hash.
2. Calling account `is_valid_signature` on Starknet RPC.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from starknet_py.hash.selector import get_selector_from_name
from starknet_py.utils.typed_data import TypedData

from app.config import STARKNET_RPC_URL

_VALID_MAGIC = int("0x56414c4944", 16)  # "VALID"


class StarknetSignatureVerificationError(ValueError):
    """Domain error for Starknet typed-data verification."""


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class StarknetSignatureVerificationService:
    def __init__(self) -> None:
        self.rpc_url = os.getenv("STARKNET_RPC_URL", STARKNET_RPC_URL).strip()
        self.timeout_sec = float(
            os.getenv("DUAL_WALLET_STARKNET_VERIFY_TIMEOUT_SEC", "8")
        )
        # Fail-closed by default to prevent unverified SIW binds.
        self.required = _env_bool("DUAL_WALLET_STARKNET_VERIFY_REQUIRED", True)
        self._signature_selectors = [
            hex(get_selector_from_name("is_valid_signature")),
            hex(get_selector_from_name("isValidSignature")),
        ]

    @staticmethod
    def _parse_felt(value: Any, *, field: str) -> int:
        if isinstance(value, bool):
            raise StarknetSignatureVerificationError(f"Invalid felt for {field}")
        if isinstance(value, int):
            return value
        text = str(value or "").strip()
        if not text:
            raise StarknetSignatureVerificationError(f"Missing felt for {field}")
        try:
            if text.lower().startswith("0x"):
                return int(text, 16)
            return int(text, 10)
        except Exception as exc:
            raise StarknetSignatureVerificationError(
                f"Invalid felt for {field}"
            ) from exc

    @classmethod
    def _normalize_signature(cls, signature: Any) -> list[int]:
        values: list[Any]
        if isinstance(signature, (list, tuple)):
            values = list(signature)
        elif isinstance(signature, dict):
            if "r" in signature and "s" in signature:
                values = [signature.get("r"), signature.get("s")]
            else:
                numeric_items: list[tuple[int, Any]] = []
                for key, val in signature.items():
                    if str(key).isdigit():
                        numeric_items.append((int(str(key)), val))
                if numeric_items:
                    numeric_items.sort(key=lambda item: item[0])
                    values = [val for _, val in numeric_items]
                else:
                    values = list(signature.values())
        elif isinstance(signature, str):
            text = signature.strip()
            if not text:
                values = []
            elif text.startswith("[") or text.startswith("{"):
                try:
                    return cls._normalize_signature(json.loads(text))
                except Exception as exc:
                    raise StarknetSignatureVerificationError(
                        "Invalid Starknet signature payload"
                    ) from exc
            else:
                values = [text]
        else:
            values = [signature]

        out: list[int] = []
        for idx, val in enumerate(values):
            out.append(cls._parse_felt(val, field=f"signature[{idx}]"))
        if not out:
            raise StarknetSignatureVerificationError("Missing Starknet signature")
        return out

    @classmethod
    def _normalize_typed_data(cls, typed_data: Any) -> dict[str, Any]:
        if not isinstance(typed_data, dict):
            raise StarknetSignatureVerificationError("Missing Starknet typed_data payload")

        domain = typed_data.get("domain")
        types = typed_data.get("types")
        message = typed_data.get("message")
        primary_type = typed_data.get("primaryType") or typed_data.get("primary_type")

        if not isinstance(domain, dict):
            raise StarknetSignatureVerificationError("Invalid typed_data domain")
        if not isinstance(types, dict):
            raise StarknetSignatureVerificationError("Invalid typed_data types")
        if not isinstance(message, dict):
            raise StarknetSignatureVerificationError("Invalid typed_data message")
        if not isinstance(primary_type, str) or not primary_type.strip():
            raise StarknetSignatureVerificationError("Invalid typed_data primary type")

        normalized_domain = dict(domain)
        if "chainId" not in normalized_domain and "chain_id" in normalized_domain:
            normalized_domain["chainId"] = normalized_domain["chain_id"]

        payload: dict[str, Any] = {
            "domain": normalized_domain,
            "types": types,
            "primaryType": primary_type,
            "message": message,
        }
        revision = typed_data.get("revision")
        if isinstance(revision, str) and revision.strip():
            payload["revision"] = revision
        return payload

    def _rpc_is_valid_signature(
        self, *, account_address: int, message_hash: int, signature: list[int]
    ) -> tuple[bool, str]:
        calldata = [hex(message_hash), hex(len(signature)), *[hex(part) for part in signature]]
        last_error = "Signature rejected by account contract"

        for selector in self._signature_selectors:
            payload = {
                "jsonrpc": "2.0",
                "method": "starknet_call",
                "params": {
                    "request": {
                        "contract_address": hex(account_address),
                        "entry_point_selector": selector,
                        "calldata": calldata,
                    },
                    "block_id": "latest",
                },
                "id": 1,
            }
            try:
                with httpx.Client(timeout=self.timeout_sec) as client:
                    response = client.post(self.rpc_url, json=payload)
                body = response.json()
            except Exception as exc:
                last_error = f"Starknet RPC error: {exc}"
                continue

            error = body.get("error")
            if isinstance(error, dict):
                msg = str(error.get("message") or "Unknown Starknet RPC error")
                last_error = f"Starknet RPC rejected signature: {msg}"
                continue
            result = body.get("result")
            if not isinstance(result, list):
                last_error = "Starknet RPC returned invalid signature response"
                continue
            if len(result) == 0:
                # Some account implementations validate by not reverting.
                return True, ""
            try:
                first = self._parse_felt(result[0], field="is_valid_signature")
            except StarknetSignatureVerificationError:
                last_error = "Starknet RPC returned non-felt validation result"
                continue
            if first in {_VALID_MAGIC, 1}:
                return True, ""
            last_error = "Starknet account returned invalid signature marker"

        return False, last_error

    def verify_dual_session_bind(
        self,
        *,
        starknet_address: str,
        evm_address: str,
        signature: Any,
        typed_data: Any,
    ) -> None:
        if not self.required:
            return
        if not self.rpc_url:
            raise StarknetSignatureVerificationError("Starknet RPC URL is not configured")

        account_address = self._parse_felt(starknet_address, field="starknet_address")
        evm_address_felt = self._parse_felt(evm_address, field="evm_address")
        sig_parts = self._normalize_signature(signature)
        normalized_typed_data = self._normalize_typed_data(typed_data)

        domain = normalized_typed_data.get("domain", {})
        domain_name = str(domain.get("name") or "").strip().lower()
        if domain_name != "zkde.fi":
            raise StarknetSignatureVerificationError(
                "Invalid SIW Starknet typed_data domain"
            )
        primary_type = str(normalized_typed_data.get("primaryType") or "").strip()
        if primary_type != "DualWalletSessionBind":
            raise StarknetSignatureVerificationError(
                "Invalid SIW Starknet typed_data primary type"
            )
        message = normalized_typed_data.get("message", {})
        if not isinstance(message, dict):
            raise StarknetSignatureVerificationError("Invalid SIW Starknet typed_data message")
        msg_evm_value = message.get("evmAddress") or message.get("evm_address")
        msg_evm_felt = self._parse_felt(msg_evm_value, field="typed_data.message.evmAddress")
        if msg_evm_felt != evm_address_felt:
            raise StarknetSignatureVerificationError(
                "SIW Starknet typed_data EVM address mismatch"
            )

        try:
            typed = TypedData.from_dict(normalized_typed_data)
            message_hash = typed.message_hash(account_address)
        except StarknetSignatureVerificationError:
            raise
        except Exception as exc:
            raise StarknetSignatureVerificationError(
                "Failed to compute Starknet typed_data hash"
            ) from exc

        ok, reason = self._rpc_is_valid_signature(
            account_address=account_address,
            message_hash=message_hash,
            signature=sig_parts,
        )
        if not ok:
            raise StarknetSignatureVerificationError(reason or "Invalid Starknet signature")

    def verify_message_hash(
        self,
        *,
        starknet_address: str,
        message_hash: Any,
        signature: Any,
    ) -> None:
        if not self.required:
            return
        if not self.rpc_url:
            raise StarknetSignatureVerificationError("Starknet RPC URL is not configured")

        account_address = self._parse_felt(starknet_address, field="starknet_address")
        msg_hash = self._parse_felt(message_hash, field="message_hash")
        sig_parts = self._normalize_signature(signature)

        ok, reason = self._rpc_is_valid_signature(
            account_address=account_address,
            message_hash=msg_hash,
            signature=sig_parts,
        )
        if not ok:
            raise StarknetSignatureVerificationError(reason or "Invalid Starknet signature")


_service: StarknetSignatureVerificationService | None = None


def get_starknet_signature_verification_service() -> StarknetSignatureVerificationService:
    global _service
    if _service is None:
        _service = StarknetSignatureVerificationService()
    return _service
