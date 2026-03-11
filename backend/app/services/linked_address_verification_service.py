"""Linked address verification service.

Provides nonce challenge + signature verification for EVM-linked addresses.
Used to enforce mandatory ownership proofs before linked addresses influence
reputation or credit scoring.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

try:
    from eth_account import Account
    from eth_account.messages import encode_defunct
except Exception:  # pragma: no cover - env dependent
    Account = None  # type: ignore[assignment]
    encode_defunct = None  # type: ignore[assignment]

try:
    from eth_utils import is_address, to_checksum_address
except Exception:  # pragma: no cover - env dependent
    is_address = None  # type: ignore[assignment]
    to_checksum_address = None  # type: ignore[assignment]

from app.services.json_store import JsonStore

_ALLOWED_CHAINS = {"ethereum", "arbitrum", "base", "optimism"}
_EVM_ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")


class LinkedAddressVerificationError(ValueError):
    """Domain error for linked address verification failures."""


class LinkedAddressVerificationService:
    def __init__(self) -> None:
        self.challenge_ttl_sec = int(os.getenv("LINKED_ADDRESS_CHALLENGE_TTL_SEC", "600"))
        self.required = (os.getenv("LINKED_ADDRESS_VERIFICATION_REQUIRED", "true").strip().lower() in {"1", "true", "yes", "on"})
        self._challenge_store = JsonStore("linked_address_challenges")
        self._proof_store = JsonStore("linked_address_proofs")

    @staticmethod
    def normalize_starknet(address: str) -> str:
        return str(address or "").strip().lower()

    @staticmethod
    def normalize_chain(chain: str) -> str:
        normalized = str(chain or "").strip().lower()
        if normalized not in _ALLOWED_CHAINS:
            raise LinkedAddressVerificationError("Unsupported chain for verification")
        return normalized

    @staticmethod
    def normalize_evm(address: str) -> str:
        raw = str(address or "").strip()
        if is_address is not None:
            if not is_address(raw):
                raise LinkedAddressVerificationError("Invalid EVM address")
            return to_checksum_address(raw) if to_checksum_address is not None else raw.lower()
        if not _EVM_ADDR_RE.match(raw):
            raise LinkedAddressVerificationError("Invalid EVM address")
        return raw.lower()

    def start_challenge(self, starknet_address: str, chain: str, address: str) -> dict[str, Any]:
        stark = self.normalize_starknet(starknet_address)
        if not stark:
            raise LinkedAddressVerificationError("Missing Starknet address")
        chain_name = self.normalize_chain(chain)
        evm = self.normalize_evm(address)

        nonce_id = uuid.uuid4().hex
        issued_at = int(time.time())
        expires_at = issued_at + self.challenge_ttl_sec
        challenge = (
            "zkde.fi linked address verification\n"
            f"starknet:{stark}\n"
            f"chain:{chain_name}\n"
            f"address:{evm}\n"
            f"nonce:{nonce_id}\n"
            f"issued_at:{issued_at}"
        )
        self._challenge_store.set(
            nonce_id,
            {
                "nonce_id": nonce_id,
                "starknet_address": stark,
                "chain": chain_name,
                "address": evm,
                "challenge": challenge,
                "issued_at": issued_at,
                "expires_at": expires_at,
                "used": False,
            },
        )
        return {
            "nonce_id": nonce_id,
            "challenge": challenge,
            "expires_at": expires_at,
            "chain": chain_name,
            "address": evm,
        }

    def complete_challenge(
        self,
        starknet_address: str,
        chain: str,
        address: str,
        nonce_id: str,
        signature: str,
    ) -> dict[str, Any]:
        stark = self.normalize_starknet(starknet_address)
        chain_name = self.normalize_chain(chain)
        evm = self.normalize_evm(address)

        row = self._challenge_store.get(str(nonce_id or "").strip())
        if not isinstance(row, dict):
            raise LinkedAddressVerificationError("Challenge not found")

        now = int(time.time())
        if bool(row.get("used")):
            raise LinkedAddressVerificationError("Challenge already used")
        if now > int(row.get("expires_at", 0)):
            raise LinkedAddressVerificationError("Challenge expired")

        if self.normalize_starknet(str(row.get("starknet_address") or "")) != stark:
            raise LinkedAddressVerificationError("Challenge Starknet address mismatch")
        if str(row.get("chain") or "") != chain_name:
            raise LinkedAddressVerificationError("Challenge chain mismatch")
        if self.normalize_evm(str(row.get("address") or "")) != evm:
            raise LinkedAddressVerificationError("Challenge address mismatch")

        sig = str(signature or "").strip()
        if not sig:
            raise LinkedAddressVerificationError("Missing signature")
        if Account is None or encode_defunct is None:
            raise LinkedAddressVerificationError(
                "Signature verification dependencies unavailable (missing eth-account)"
            )

        message = encode_defunct(text=str(row.get("challenge") or ""))
        try:
            recovered = Account.recover_message(message, signature=sig)
        except Exception as exc:
            raise LinkedAddressVerificationError("Invalid signature") from exc

        if self.normalize_evm(recovered).lower() != evm.lower():
            raise LinkedAddressVerificationError("Signature does not match address")

        existing = self._proof_store.get(stark)
        proofs = existing if isinstance(existing, dict) else {}
        verified_at = datetime.now(timezone.utc).isoformat()
        proofs[chain_name] = {
            "address": evm,
            "verified": True,
            "verified_at": verified_at,
            "signature_hash": "0x" + hashlib.sha256(sig.encode("utf-8")).hexdigest(),
            "nonce_id": row.get("nonce_id"),
        }
        self._proof_store.set(stark, proofs)

        row["used"] = True
        row["used_at"] = now
        self._challenge_store.set(str(nonce_id), row)

        return {
            "starknet_address": stark,
            "chain": chain_name,
            "address": evm,
            "verified": True,
            "verified_at": verified_at,
        }

    def verification_status(self, starknet_address: str) -> dict[str, dict[str, Any]]:
        stark = self.normalize_starknet(starknet_address)
        if not stark:
            return {}
        row = self._proof_store.get(stark)
        if not isinstance(row, dict):
            return {}
        out: dict[str, dict[str, Any]] = {}
        for chain, meta in row.items():
            if chain not in _ALLOWED_CHAINS and chain != "starknet":
                continue
            if not isinstance(meta, dict):
                continue
            if chain == "starknet":
                out["starknet"] = {
                    "address": stark,
                    "verified": bool(meta.get("verified", False)),
                    "verified_at": meta.get("verified_at"),
                }
                continue
            addr = meta.get("address")
            if not isinstance(addr, str) or not addr:
                continue
            out[chain] = {
                "address": addr,
                "verified": bool(meta.get("verified", False)),
                "verified_at": meta.get("verified_at"),
                "signature_hash": meta.get("signature_hash"),
            }
        return out

    def is_verified(self, starknet_address: str, chain: str, address: str) -> bool:
        try:
            stark = self.normalize_starknet(starknet_address)
            chain_name = self.normalize_chain(chain)
            evm = self.normalize_evm(address)
        except LinkedAddressVerificationError:
            return False

        status = self.verification_status(stark)
        meta = status.get(chain_name)
        if not isinstance(meta, dict):
            return False
        stored = str(meta.get("address") or "")
        return bool(meta.get("verified", False)) and stored.lower() == evm.lower()

    def filter_verified(self, starknet_address: str, linked: dict[str, Any]) -> dict[str, str]:
        """Return only verified linked chain addresses in eth/arb/base/opt key format."""
        if not isinstance(linked, dict):
            return {}
        status = self.verification_status(starknet_address)
        out: dict[str, str] = {}
        mapping = {
            "eth": "ethereum",
            "arb": "arbitrum",
            "base": "base",
            "opt": "optimism",
        }
        for short, chain_name in mapping.items():
            value = linked.get(short)
            if not isinstance(value, str) or not value.strip():
                continue
            if self.is_verified(starknet_address, chain_name, value):
                out[short] = value.strip().lower()
        return out


_verification_service: LinkedAddressVerificationService | None = None


def get_linked_address_verification_service() -> LinkedAddressVerificationService:
    global _verification_service
    if _verification_service is None:
        _verification_service = LinkedAddressVerificationService()
    return _verification_service
