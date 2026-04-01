"""
Signed Export Envelope Service — HMAC-SHA256 signed portable passport exports.

Wraps a PPP or disclosure pack in a tamper-evident envelope that a third
party can verify without trusting the holder.  The signature covers a
canonical JSON serialization of the payload + metadata.

Envelope schema:
    {
        "envelope_version": "signed_export.v1",
        "issuer": "zkde.fi",
        "payload_type": "ppp_v1" | "disclosure_pack.v1",
        "payload": { ... },
        "signed_at": ISO-8601,
        "expires_at": ISO-8601 | null,
        "signature": hex HMAC-SHA256,
    }
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_TTL_HOURS = 24 * 7  # 7 days


class PassportExportService:
    def __init__(self, signing_secret: str | None = None):
        raw = signing_secret or os.getenv("PASSPORT_SIGNING_SECRET", "")
        if not raw:
            raise RuntimeError(
                "PASSPORT_SIGNING_SECRET env var is required for signed exports"
            )
        self._key = bytes.fromhex(raw)

    # ── public API ────────────────────────────────────────────────────

    def sign_envelope(
        self,
        payload: dict[str, Any],
        *,
        payload_type: str = "ppp_v1",
        ttl_hours: int | None = _DEFAULT_TTL_HOURS,
    ) -> dict[str, Any]:
        """Wrap *payload* in a signed envelope.

        Args:
            payload: PPP dict or disclosure-pack dict.
            payload_type: "ppp_v1" or "disclosure_pack.v1".
            ttl_hours: Hours until signature expires (None = no expiry).

        Returns:
            Signed envelope dict.
        """
        now = datetime.now(timezone.utc)
        expires_at = (
            (now + timedelta(hours=ttl_hours)).isoformat()
            if ttl_hours
            else None
        )

        envelope = {
            "envelope_version": "signed_export.v1",
            "issuer": "zkde.fi",
            "payload_type": payload_type,
            "payload": payload,
            "signed_at": now.isoformat(),
            "expires_at": expires_at,
        }

        sig = self._compute_signature(envelope)
        envelope["signature"] = sig

        logger.info(
            "passport_export signed | type=%s subject=%s sig=%s…",
            payload_type,
            str(payload.get("subject", "?"))[:20],
            sig[:16],
        )
        return envelope

    def verify_envelope(
        self,
        envelope: dict[str, Any],
        *,
        check_expiry: bool = True,
    ) -> dict[str, Any]:
        """Verify a signed envelope.

        Returns:
            { "valid": bool, "reason": str | None, "payload_type": str }
        """
        sig = envelope.get("signature")
        if not sig:
            return {"valid": False, "reason": "missing_signature", "payload_type": None}

        # Recompute signature over envelope without the signature field
        env_copy = {k: v for k, v in envelope.items() if k != "signature"}
        expected = self._compute_signature(env_copy)

        if not hmac.compare_digest(sig, expected):
            return {"valid": False, "reason": "signature_mismatch", "payload_type": envelope.get("payload_type")}

        if check_expiry:
            expires_at = envelope.get("expires_at")
            if expires_at:
                exp_dt = datetime.fromisoformat(expires_at)
                if datetime.now(timezone.utc) > exp_dt:
                    return {"valid": False, "reason": "expired", "payload_type": envelope.get("payload_type")}

        return {"valid": True, "reason": None, "payload_type": envelope.get("payload_type")}

    # ── internals ─────────────────────────────────────────────────────

    def _compute_signature(self, envelope: dict[str, Any]) -> str:
        canonical = json.dumps(envelope, sort_keys=True, separators=(",", ":"))
        return hmac.new(self._key, canonical.encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: PassportExportService | None = None


def get_passport_export_service() -> PassportExportService:
    global _instance
    if _instance is None:
        _instance = PassportExportService()
    return _instance
