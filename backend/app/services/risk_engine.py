"""
Risk Profile Engine — scores user risk tolerance and returns allocation bounds.

Inputs:  risk_level (1-10), optional time_horizon, optional behavior history
Outputs: risk_score, allocation bounds (% deposit-like vs % LP), safe protocols list

No mocks. Deterministic scoring logic. Used by ai_allocation.py to drive decisions.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AllocationBounds:
    """Min/max percentages for deposit-style vs LP-style strategies."""
    min_deposit_pct: float   # e.g. 0.70 → at least 70 % in low-risk deposit strategies
    max_deposit_pct: float
    min_lp_pct: float
    max_lp_pct: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class RiskAssessment:
    """Full assessment returned by the engine."""
    risk_level: int          # user-supplied 1-10
    risk_score: float        # computed 0.0 – 1.0 (higher = riskier)
    label: str               # "conservative" | "balanced" | "aggressive"
    bounds: AllocationBounds
    safe_protocols: list[str]
    max_single_pool_pct: float   # concentration cap
    reasoning: str

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["bounds"] = self.bounds.to_dict()
        return d


# ── Tier definitions ─────────────────────────────────────────────────────

_TIERS: list[dict[str, Any]] = [
    # risk_level 1-3: conservative
    {
        "label": "conservative",
        "max_level": 3,
        "bounds": AllocationBounds(
            min_deposit_pct=0.70, max_deposit_pct=1.00,
            min_lp_pct=0.00,     max_lp_pct=0.30,
        ),
        "safe_protocols": ["ekubo_stable_lp"],
        "max_single_pool_pct": 0.80,
    },
    # risk_level 4-6: balanced
    {
        "label": "balanced",
        "max_level": 6,
        "bounds": AllocationBounds(
            min_deposit_pct=0.30, max_deposit_pct=0.70,
            min_lp_pct=0.30,     max_lp_pct=0.70,
        ),
        "safe_protocols": ["ekubo_stable_lp", "ekubo_volatile_lp"],
        "max_single_pool_pct": 0.60,
    },
    # risk_level 7-10: aggressive
    {
        "label": "aggressive",
        "max_level": 10,
        "bounds": AllocationBounds(
            min_deposit_pct=0.00, max_deposit_pct=0.40,
            min_lp_pct=0.60,     max_lp_pct=1.00,
        ),
        "safe_protocols": ["ekubo_stable_lp", "ekubo_volatile_lp", "ekubo_concentrated_lp"],
        "max_single_pool_pct": 0.50,
    },
]


def _tier_for_level(level: int) -> dict[str, Any]:
    for tier in _TIERS:
        if level <= tier["max_level"]:
            return tier
    return _TIERS[-1]


# ── Public API ───────────────────────────────────────────────────────────

def score_risk(
    risk_level: int,
    time_horizon_days: int = 90,
    past_decisions: list[dict[str, Any]] | None = None,
) -> RiskAssessment:
    """
    Score a user's risk tolerance and return allocation constraints.

    Args:
        risk_level:        User-selected 1-10.
        time_horizon_days: Planned holding period in days.
        past_decisions:    Optional list of previous allocation records
                           (for behaviour-adjusted scoring — future).

    Returns:
        RiskAssessment with bounds, safe protocols, concentration cap.
    """
    level = max(1, min(10, int(risk_level)))
    tier = _tier_for_level(level)

    # Base score: linear map 1→0.05 .. 10→1.0
    base_score = level / 10.0

    # Time-horizon adjustment: shorter horizon → slightly more conservative
    if time_horizon_days < 30:
        base_score = max(0.05, base_score - 0.10)
    elif time_horizon_days > 180:
        base_score = min(1.0, base_score + 0.05)

    # Behaviour adjustment — now uses real behavioral data from decision store
    behaviour_adj = 0.0
    if past_decisions:
        total = len(past_decisions)
        # Early exits: user withdrew before expected holding period
        early_exits = sum(1 for d in past_decisions if d.get("early_exit") or d.get("event_type") == "early_exit")
        # Proof failures: user's proofs failed verification
        proof_failures = sum(1 for d in past_decisions if d.get("event_type") == "proof_failed")
        # Gate blocks: user was blocked by risk gates
        gate_blocks = sum(1 for d in past_decisions if d.get("outcome") == "block")
        # Slashes: user had collateral slashed
        slashes = sum(1 for d in past_decisions if d.get("event_type") == "collateral_slash")

        # Apply adjustments
        if total > 0:
            early_exit_rate = early_exits / total
            if early_exit_rate > 0.3:
                behaviour_adj -= 0.05
            elif early_exit_rate > 0.5:
                behaviour_adj -= 0.10

            if proof_failures > 0:
                behaviour_adj -= min(0.05, proof_failures * 0.01)

            if slashes > 0:
                behaviour_adj -= min(0.15, slashes * 0.05)

            if gate_blocks > total * 0.2:
                behaviour_adj -= 0.03

        # Positive signals
        successful_proofs = sum(1 for d in past_decisions if d.get("event_type") == "proof_generated")
        if successful_proofs > 10:
            behaviour_adj += 0.02  # Reward consistent proof generation

    score = max(0.0, min(1.0, round(base_score + behaviour_adj, 4)))

    reasoning_parts = [
        f"Risk level {level}/10 → base score {base_score:.2f}.",
        f"Time horizon {time_horizon_days}d.",
    ]
    if behaviour_adj:
        reasoning_parts.append(f"Behaviour adjustment: {behaviour_adj:+.2f}.")
    reasoning_parts.append(
        f"Tier: {tier['label']}. LP range [{tier['bounds'].min_lp_pct*100:.0f}%-{tier['bounds'].max_lp_pct*100:.0f}%]."
    )

    return RiskAssessment(
        risk_level=level,
        risk_score=score,
        label=tier["label"],
        bounds=tier["bounds"],
        safe_protocols=list(tier["safe_protocols"]),
        max_single_pool_pct=tier["max_single_pool_pct"],
        reasoning=" ".join(reasoning_parts),
    )


def label_from_string(profile: str) -> int:
    """Map 'conservative'/'balanced'/'aggressive' to a representative risk_level."""
    p = (profile or "").strip().lower()
    if p in ("conservative", "low"):
        return 2
    if p in ("aggressive", "high"):
        return 8
    return 5  # balanced / default


async def score_risk_with_history(
    user_address: str,
    risk_level: int,
    time_horizon_days: int = 90,
) -> RiskAssessment:
    """
    Enhanced risk scoring that fetches real behavioral history from the decision store.

    Falls back to basic score_risk() if the database is unavailable.
    """
    past_decisions: list[dict[str, Any]] | None = None
    try:
        from app.db.decision_store import DecisionStore
        store = DecisionStore()
        past_decisions = await store.get_past_decisions(user_address, limit=200)
    except Exception:
        pass  # Graceful fallback

    return score_risk(
        risk_level=risk_level,
        time_horizon_days=time_horizon_days,
        past_decisions=past_decisions,
    )
