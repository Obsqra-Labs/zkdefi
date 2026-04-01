"""Persist short-lived Telegram link codes (wallet ↔ 8-char code) for Obsqra Studio."""

from __future__ import annotations

import os
import secrets
import sqlite3
import string
from datetime import datetime, timedelta, timezone
from pathlib import Path

_ALPHANUM = string.ascii_uppercase + string.digits


def _db_path() -> Path:
    root = Path(__file__).resolve().parents[2]
    data = root / "data"
    data.mkdir(parents=True, exist_ok=True)
    return data / "studio_telegram_links.db"


def _conn() -> sqlite3.Connection:
    path = _db_path()
    con = sqlite3.connect(str(path))
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS telegram_link_codes (
            code TEXT PRIMARY KEY,
            wallet_address TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT
        )
        """
    )
    con.commit()
    return con


def _random_code() -> str:
    return "".join(secrets.choice(_ALPHANUM) for _ in range(8))


def mint_link_code(wallet_address: str, ttl_minutes: int = 15) -> tuple[str, str]:
    """Create a new unused code; returns (code, expires_at ISO8601)."""
    wallet_address = wallet_address.strip()
    if not wallet_address.startswith("0x") or len(wallet_address) < 4:
        raise ValueError("invalid wallet_address")

    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=ttl_minutes)
    expires_s = expires.isoformat()

    with _conn() as con:
        for _ in range(32):
            code = _random_code()
            try:
                con.execute(
                    "INSERT INTO telegram_link_codes (code, wallet_address, expires_at, used_at) VALUES (?, ?, ?, NULL)",
                    (code, wallet_address, expires_s),
                )
                con.commit()
                return code, expires_s
            except sqlite3.IntegrityError:
                continue
        raise RuntimeError("could not allocate unique code")


def redeem_code(code: str) -> str | None:
    """Return wallet_address if code is valid and unused; mark used. Otherwise None."""
    raw = code.strip().upper()
    if len(raw) != 8 or not all(c in _ALPHANUM for c in raw):
        return None

    now = datetime.now(timezone.utc)

    with _conn() as con:
        row = con.execute(
            "SELECT wallet_address, expires_at, used_at FROM telegram_link_codes WHERE code = ?",
            (raw,),
        ).fetchone()
        if row is None:
            return None
        wallet, expires_s, used_at = row
        if used_at is not None:
            return None
        try:
            expires = datetime.fromisoformat(expires_s.replace("Z", "+00:00"))
        except ValueError:
            return None
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if now > expires:
            return None

        con.execute(
            "UPDATE telegram_link_codes SET used_at = ? WHERE code = ?",
            (now.isoformat(), raw),
        )
        con.commit()
        return wallet


def verify_link_mint_key(header_value: str | None) -> bool:
    """If ``TELEGRAM_LINK_MINT_KEY`` is set, ``header_value`` must match exactly."""
    expected = os.environ.get("TELEGRAM_LINK_MINT_KEY", "").strip()
    if not expected:
        return True
    if header_value is None:
        return False
    return secrets.compare_digest(header_value.strip(), expected)


def verify_service_token(authorization: str | None) -> bool:
    expected = os.environ.get("ZKDEFI_STUDIO_SERVICE_TOKEN", "").strip()
    if not expected:
        return False
    if not authorization or not authorization.startswith("Bearer "):
        return False
    got = authorization.removeprefix("Bearer ").strip()
    return secrets.compare_digest(got, expected)
