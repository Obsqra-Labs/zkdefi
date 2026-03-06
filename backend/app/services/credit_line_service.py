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
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

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
