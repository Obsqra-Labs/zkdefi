"""Push curated events to Obsqra Studio (`studio-api` /internal/events).

Requires ``STUDIO_NOTIFY_ENABLED=1``, ``STUDIO_EVENTS_URL``, and ``ZKDEFI_STUDIO_HMAC_SECRET``
(same secret configured on ``studio-api``).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from typing import Any, Mapping

import httpx

logger = logging.getLogger(__name__)


def _notify_enabled() -> bool:
    v = os.environ.get("STUDIO_NOTIFY_ENABLED", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _sign_body(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


async def notify_studio_event(event: Mapping[str, Any]) -> None:
    """POST JSON body to Studio; ``event`` must match Rust ``StudioEvent`` serde JSON shape."""
    if not _notify_enabled():
        return

    url = os.environ.get("STUDIO_EVENTS_URL", "").strip().rstrip("/")
    secret = os.environ.get("ZKDEFI_STUDIO_HMAC_SECRET", "").strip()
    if not url or not secret:
        logger.debug("studio_notify: STUDIO_EVENTS_URL or ZKDEFI_STUDIO_HMAC_SECRET unset")
        return

    body_obj = dict(event)
    body = json.dumps(body_obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    sig = _sign_body(body, secret)
    full_url = url if url.rstrip("/").endswith("/internal/events") else f"{url.rstrip('/')}/internal/events"

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                full_url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Zkdefi-Signature": sig,
                },
            )
            if r.status_code >= 300:
                logger.warning(
                    "studio_notify: %s %s",
                    r.status_code,
                    (r.text or "")[:300],
                )
    except Exception as exc:
        logger.warning("studio_notify: request failed: %s", exc)


async def notify_studio_personal_alert(
    *,
    wallet: str,
    kind: str,
    payload: Mapping[str, Any],
) -> None:
    """Send a ``PersonalAlert`` variant (Telegram DM if wallet is linked in Studio)."""
    await notify_studio_event(
        {
            "PersonalAlert": {
                "wallet": wallet.strip(),
                "kind": kind,
                "payload": dict(payload),
            }
        }
    )


async def notify_studio_announcement(
    *,
    title: str,
    body: str,
    source: str = "zkdefi",
) -> None:
    """Send an ``Announcement`` variant (public channel via outbox)."""
    await notify_studio_event(
        {
            "Announcement": {
                "title": title,
                "body": body,
                "source": source,
            }
        }
    )
