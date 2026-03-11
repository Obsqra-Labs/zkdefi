"""
Credit Line Service

Computes the credit line for a user based on collateral and reputation.
Supports two modes:
  1. Formulaic (default) — deterministic rules from tier/letter/credit_tier
  2. Predictive — XGBoost creditworthiness model with optional EZKL proof

The credit line is the sum of collateral-backed and reputation-based (unsecured) capacity.

Formulaic:
  credit_line_collateral = collateral_eth * LTV_MAX
  unsecured_cap = tier_weight * letter_weight * credit_weight * BASE_UNSECURED_CAP
  total_line = min(collateral_line + unsecured_cap, GLOBAL_CAP)
  rate_bps = max(BASE_RATE - tier_discount - letter_discount, MIN_RATE)

Predictive:
  credit_class = XGBoost(features) → AAA/AA/A/B/C
  LTV, rate, unsecured_multiplier from CREDIT_TERMS[credit_class]
  collaborative_multiplier from credit graph (if available)
"""
from __future__ import annotations

import logging
import os
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Persistence ──────────────────────────────────────────────────────────────

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_CL_DB_PATH = os.path.join(_DATA_DIR, "credit_lines.db")

LTV_MAX = 0.80
BASE_UNSECURED_CAP_ETH = 5.0
GLOBAL_CAP_ETH = 50.0
BASE_RATE_BPS = 800
MIN_RATE_BPS = 100

TIER_WEIGHTS = {
    0: 0.0,   # Strict
    1: 0.5,   # Standard
    2: 1.0,   # Express
}

LETTER_WEIGHTS = {
    "A": 1.0,
    "B": 0.6,
    "C": 0.3,
    "D": 0.0,
}

CREDIT_WEIGHTS = {
    "AAA": 1.5,
    "AA": 1.2,
    "A": 1.0,
    "B": 0.5,
    "C": 0.2,
}

TIER_DISCOUNT_BPS = {0: 0, 1: 100, 2: 200}
LETTER_DISCOUNT_BPS = {"A": 150, "B": 80, "C": 30, "D": 0}


@dataclass
class CreditLine:
    collateral_eth: float
    collateral_line_eth: float
    unsecured_cap_eth: float
    total_line_eth: float
    rate_bps: int
    tier: int
    letter_rating: str
    credit_tier: Optional[str]
    cross_chain_multiplier: float = 1.0
    collaborative_multiplier: float = 1.0
    predictive_credit: Optional[dict[str, Any]] = None


def compute_credit_line(
    collateral_eth: float,
    tier: int,
    letter_rating: str,
    credit_tier: Optional[str] = None,
    linked_address_count: int = 0,
    cross_chain_verified: bool = False,
    collaborative_multiplier: float = 1.0,
) -> CreditLine:
    """Compute the total credit line from collateral + reputation."""
    collateral_line = collateral_eth * LTV_MAX

    tier_w = TIER_WEIGHTS.get(tier, 0.0)
    letter_w = LETTER_WEIGHTS.get(letter_rating, 0.0)
    credit_w = CREDIT_WEIGHTS.get(credit_tier or "", 0.0)

    unsecured_cap = tier_w * letter_w * credit_w * BASE_UNSECURED_CAP_ETH

    cross_chain_mult = 1.0
    if cross_chain_verified and linked_address_count > 0:
        cross_chain_mult = min(1.0 + 0.1 * linked_address_count, 1.5)
        unsecured_cap *= cross_chain_mult

    # Apply collaborative credit graph multiplier (1.0–2.0x)
    collab_mult = max(1.0, min(float(collaborative_multiplier), 2.0))
    if collab_mult > 1.0:
        unsecured_cap *= collab_mult

    total_line = min(collateral_line + unsecured_cap, GLOBAL_CAP_ETH)

    tier_disc = TIER_DISCOUNT_BPS.get(tier, 0)
    letter_disc = LETTER_DISCOUNT_BPS.get(letter_rating, 0)
    rate = max(BASE_RATE_BPS - tier_disc - letter_disc, MIN_RATE_BPS)

    return CreditLine(
        collateral_eth=collateral_eth,
        collateral_line_eth=round(collateral_line, 6),
        unsecured_cap_eth=round(unsecured_cap, 6),
        total_line_eth=round(total_line, 6),
        rate_bps=rate,
        tier=tier,
        letter_rating=letter_rating,
        credit_tier=credit_tier,
        cross_chain_multiplier=round(cross_chain_mult, 2),
        collaborative_multiplier=round(collab_mult, 2),
    )


async def compute_predictive_credit_line(
    user_address: str,
    collateral_eth: float,
    tier: int,
    *,
    cross_chain_data: dict[str, Any] | None = None,
    behavior_stats: dict[str, Any] | None = None,
    reputation_data: dict[str, Any] | None = None,
    linked_address_count: int = 0,
    cross_chain_verified: bool = False,
    collaborative_multiplier: float = 1.0,
    generate_proof: bool = False,
) -> CreditLine:
    """
    Compute credit line using the predictive creditworthiness model.

    Falls back to formulaic computation if the model isn't ready.
    """
    from app.ml.creditworthiness.predictor import get_creditworthiness_predictor

    predictor = get_creditworthiness_predictor()

    if not predictor.is_ready:
        logger.debug("Predictive model not ready; falling back to formulaic credit line")
        return compute_credit_line(
            collateral_eth=collateral_eth,
            tier=tier,
            letter_rating="D",
            linked_address_count=linked_address_count,
            cross_chain_verified=cross_chain_verified,
            collaborative_multiplier=collaborative_multiplier,
        )

    prediction = await predictor.predict(
        user_address,
        cross_chain_data=cross_chain_data,
        behavior_stats=behavior_stats,
        reputation_data=reputation_data,
        generate_proof=generate_proof,
    )

    credit_class = prediction.get("credit_class", "C")
    terms = prediction.get("terms", {"ltv": 0.50, "rate_bps": 1000, "unsecured_multiplier": 0.1})

    # Use predicted LTV instead of fixed 0.80
    collateral_line = collateral_eth * terms["ltv"]

    # Base unsecured from predicted multiplier
    tier_w = TIER_WEIGHTS.get(tier, 0.0)
    unsecured_cap = tier_w * terms["unsecured_multiplier"] * BASE_UNSECURED_CAP_ETH

    # Cross-chain boost
    cross_chain_mult = 1.0
    if cross_chain_verified and linked_address_count > 0:
        cross_chain_mult = min(1.0 + 0.1 * linked_address_count, 1.5)
        unsecured_cap *= cross_chain_mult

    # Collaborative boost
    collab_mult = max(1.0, min(float(collaborative_multiplier), 2.0))
    if collab_mult > 1.0:
        unsecured_cap *= collab_mult

    total_line = min(collateral_line + unsecured_cap, GLOBAL_CAP_ETH)

    # Map letter from credit class (AAA/AA → A, A → B, B → C, C → D)
    class_to_letter = {"AAA": "A", "AA": "A", "A": "B", "B": "C", "C": "D"}
    letter = class_to_letter.get(credit_class, "D")

    return CreditLine(
        collateral_eth=collateral_eth,
        collateral_line_eth=round(collateral_line, 6),
        unsecured_cap_eth=round(unsecured_cap, 6),
        total_line_eth=round(total_line, 6),
        rate_bps=terms["rate_bps"],
        tier=tier,
        letter_rating=letter,
        credit_tier=credit_class,
        cross_chain_multiplier=round(cross_chain_mult, 2),
        collaborative_multiplier=round(collab_mult, 2),
        predictive_credit={
            "credit_class": credit_class,
            "confidence": prediction.get("confidence"),
            "model_hash": prediction.get("model_hash"),
            "proof": prediction.get("proof"),
            "fallback": prediction.get("fallback", False),
        },
    )


# Execution labels for simulated/ledger-only responses (contracts not deployed on Sepolia)
_EXECUTION_SIMULATED = "simulated"
_EXECUTION_NOTE = "Credit line contracts not deployed on Sepolia — ledger-only"


def _add_execution_labels(result: dict[str, Any]) -> None:
    """Add execution and execution_note to a result dict."""
    result["execution"] = _EXECUTION_SIMULATED
    result["execution_note"] = _EXECUTION_NOTE


class CreditLineService:
    """
    Credit line operations service.

    Persists credit line state to SQLite.  On-chain tx_hash remains None
    until credit line contracts are deployed on Sepolia — the service is
    honest about this via execution="simulated" labels.
    """

    def __init__(self) -> None:
        os.makedirs(_DATA_DIR, exist_ok=True)
        self._init_db()

    # ── SQLite helpers ────────────────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(_CL_DB_PATH, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS credit_lines (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_address    TEXT NOT NULL,
                    collateral_token TEXT,
                    collateral_amount INTEGER DEFAULT 0,
                    credit_limit_usd INTEGER DEFAULT 0,
                    borrowed_usd    INTEGER DEFAULT 0,
                    status          TEXT DEFAULT 'open',
                    tx_hash         TEXT,
                    created_at      REAL NOT NULL,
                    updated_at      REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_cl_user
                ON credit_lines (user_address)
            """)

    # ── Operations ────────────────────────────────────────────────────

    async def open_credit_line(
        self,
        user_address: str,
        collateral_token: str,
        collateral_amount: int,
        desired_credit_usd: int,
    ) -> dict[str, Any]:
        """Open a credit line (persisted to SQLite, tx simulated)."""
        now = time.time()
        with self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO credit_lines
                   (user_address, collateral_token, collateral_amount,
                    credit_limit_usd, borrowed_usd, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 0, 'open', ?, ?)""",
                (user_address, collateral_token, collateral_amount,
                 desired_credit_usd, now, now),
            )
            line_id = cur.lastrowid

        result: dict[str, Any] = {
            "credit_line_id": line_id,
            "user_address": user_address,
            "collateral_token": collateral_token,
            "collateral_amount": collateral_amount,
            "credit_limit_usd": desired_credit_usd,
            "borrowed_usd": 0,
            "status": "open",
        }
        _add_execution_labels(result)
        return result

    async def borrow(
        self,
        user_address: str,
        amount_usd: int,
    ) -> dict[str, Any]:
        """Borrow against the user's most recent open credit line."""
        with self._conn() as conn:
            row = conn.execute(
                """SELECT id, credit_limit_usd, borrowed_usd FROM credit_lines
                   WHERE user_address = ? AND status = 'open'
                   ORDER BY created_at DESC LIMIT 1""",
                (user_address,),
            ).fetchone()

            if not row:
                return {"error": "no_open_credit_line", "tx_hash": None}

            line_id, limit_usd, already_borrowed = row["id"], row["credit_limit_usd"], row["borrowed_usd"]
            new_balance = already_borrowed + amount_usd
            if new_balance > limit_usd:
                return {"error": "exceeds_credit_limit", "tx_hash": None,
                        "limit_usd": limit_usd, "borrowed_usd": already_borrowed}

            conn.execute(
                """UPDATE credit_lines SET borrowed_usd = ?, updated_at = ?
                   WHERE id = ?""",
                (new_balance, time.time(), line_id),
            )

        result: dict[str, Any] = {
            "credit_line_id": line_id,
            "tx_hash": None,
            "new_balance": new_balance,
        }
        _add_execution_labels(result)
        return result

    async def repay(
        self,
        user_address: str,
        amount_usd: int,
    ) -> dict[str, Any]:
        """Repay against the user's most recent open credit line."""
        with self._conn() as conn:
            row = conn.execute(
                """SELECT id, borrowed_usd FROM credit_lines
                   WHERE user_address = ? AND status = 'open'
                   ORDER BY created_at DESC LIMIT 1""",
                (user_address,),
            ).fetchone()

            if not row:
                return {"error": "no_open_credit_line", "tx_hash": None}

            line_id, borrowed = row["id"], row["borrowed_usd"]
            new_balance = max(0, borrowed - amount_usd)
            status = "repaid" if new_balance == 0 else "open"

            conn.execute(
                """UPDATE credit_lines SET borrowed_usd = ?, status = ?, updated_at = ?
                   WHERE id = ?""",
                (new_balance, status, time.time(), line_id),
            )

        result: dict[str, Any] = {
            "credit_line_id": line_id,
            "tx_hash": None,
            "new_balance": new_balance,
            "status": status,
        }
        _add_execution_labels(result)
        return result

    async def get_user_credit_lines(self, address: str) -> list[dict[str, Any]]:
        """List all credit lines for a user."""
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM credit_lines WHERE user_address = ?
                   ORDER BY created_at DESC""",
                (address,),
            ).fetchall()
        return [dict(r) for r in rows]

    async def calculate_credit_score(self, address: str) -> dict[str, Any]:
        """
        Calculate credit score based on credit line history.
        Uses repayment behavior as a signal — better than a hardcoded 650.
        """
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT status, borrowed_usd, credit_limit_usd FROM credit_lines
                   WHERE user_address = ?""",
                (address,),
            ).fetchall()

        if not rows:
            # No history → baseline score
            result: dict[str, Any] = {"fico_score": 620, "tier": "new"}
            _add_execution_labels(result)
            return result

        total = len(rows)
        repaid = sum(1 for r in rows if r["status"] == "repaid")
        open_lines = sum(1 for r in rows if r["status"] == "open")
        total_borrowed = sum(r["borrowed_usd"] for r in rows)
        total_limit = sum(r["credit_limit_usd"] for r in rows) or 1

        utilization = total_borrowed / total_limit
        repay_ratio = repaid / total if total else 0

        # Score: base 600, +100 for good repayment, -50 for high utilization
        score = 600 + int(repay_ratio * 100) - int(utilization * 50)
        score = max(300, min(850, score))

        tier = (
            "excellent" if score >= 750
            else "good" if score >= 700
            else "fair" if score >= 650
            else "poor"
        )

        result = {
            "fico_score": score,
            "tier": tier,
            "history": {"total_lines": total, "repaid": repaid, "open": open_lines},
            "utilization": round(utilization, 4),
        }
        _add_execution_labels(result)
        return result


_credit_line_service: CreditLineService | None = None


def get_credit_line_service() -> CreditLineService:
    """Return the singleton credit line service."""
    global _credit_line_service
    if _credit_line_service is None:
        _credit_line_service = CreditLineService()
    return _credit_line_service
