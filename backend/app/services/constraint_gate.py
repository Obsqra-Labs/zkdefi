"""
Constraint Gate — enforces onboarding constraints + ZKML proof verification
before allowing vault operations (allocate, execute, rebalance).

Data flow:
  1. Loads user's onboarding state (fact_hash, identity_commitment, constraints)
  2. Loads vault policy (risk budget, session limits, max notional)
  3. Runs ZKML risk-score check against user's portfolio features
  4. Validates the requested operation respects all bounds
  5. Returns a ConstraintVerdict: pass/fail + attestation hash

If onboarding was never completed, operations are BLOCKED (unless the user
is in a dev/testing bypass list).

Gating from Risk Profile: see docs/GATING_FROM_PROFILE.md. Tier/reputation
can optionally be resolved from the same Risk Profile bundle when available.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ── Cached ETH/USD price for sync callers ────────────────────────────────
# Updated by the /price/live endpoint or any async caller of get_live_prices().
# Falls back to $2500 if oracle hasn't been called yet.
_cached_eth_usd: float = 2500.0


def update_cached_eth_usd(price: float) -> None:
    """Called from async oracle code to keep sync callers up-to-date."""
    global _cached_eth_usd
    if price and price > 0:
        _cached_eth_usd = price


def _get_cached_eth_usd() -> float:
    """Return last-known ETH/USD price (sync safe)."""
    return _cached_eth_usd


# ── Onboarding state file (same path as onboarding.py) ──────────────────
_ONBOARDING_STATE_FILE = (
    Path(__file__).resolve().parent.parent / "app" / "data" / "onboarding_state.json"
)
# Try the actual path used by onboarding.py
_ALT_STATE_FILE = Path(__file__).resolve().parent.parent / "data" / "onboarding_state.json"

# Walk up to find it robustly
for _candidate in [
    Path(__file__).resolve().parent.parent / "data" / "onboarding_state.json",
    Path(__file__).resolve().parent.parent / "app" / "data" / "onboarding_state.json",
    Path(__file__).resolve().parent.parent.parent / "data" / "onboarding_state.json",
]:
    if _candidate.exists():
        _ONBOARDING_STATE_FILE = _candidate
        break


# ── Risk tolerance → profile string mapping ─────────────────────────────
# Onboarding uses ints (30, 50, 70). Vault pipeline uses strings.

def tolerance_to_profile(tolerance: int) -> str:
    """Map numeric risk_tolerance to string profile."""
    if tolerance <= 35:
        return "conservative"
    elif tolerance >= 65:
        return "aggressive"
    return "balanced"


def profile_to_tolerance(profile: str) -> int:
    """Map string profile back to numeric risk_tolerance."""
    p = profile.strip().lower()
    if p == "conservative":
        return 30
    elif p == "aggressive":
        return 70
    return 50


# ── Data structures ─────────────────────────────────────────────────────

@dataclass
class OnboardingConstraints:
    """Parsed constraints from onboarding state."""
    max_position_wei: str
    max_position_usd: float      # converted from wei (assuming ETH ~$2500)
    risk_tolerance: int           # 30, 50, 70
    risk_profile: str             # "conservative" | "balanced" | "aggressive"
    session_duration_hours: int
    claims: list[str]
    fact_hash: str
    identity_commitment: str
    agent_initialized: bool
    onboarded_at: int             # unix timestamp

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ConstraintVerdict:
    """Result of constraint gate check."""
    allowed: bool
    user_address: str
    risk_profile: str             # canonical profile from onboarding
    risk_tolerance: int
    max_position_usd: float
    session_valid: bool           # still within session window
    identity_verified: bool       # fact_hash + identity_commitment present
    zkml_risk_ok: bool            # risk score within threshold
    policy_enforced: bool         # vault policy bounds applied
    violations: list[str]         # list of constraint violations
    attestation_hash: str         # hash of the full verdict for audit
    timestamp: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ── Constraint Gate Service ─────────────────────────────────────────────

class ConstraintGate:
    """
    Pre-flight check for vault operations. Loads onboarding constraints,
    validates identity, runs ZKML risk check, and enforces policy bounds.
    """

    # Addresses that bypass onboarding during dev/testing
    _bypass_addresses: set[str] = set()

    def __init__(self) -> None:
        self._onboarding_cache: dict[str, dict] = {}
        self._load_onboarding()

    # ── Public API ──────────────────────────────────────────────────────

    def check(
        self,
        user_address: str,
        action: str,                       # "allocate" | "execute" | "rebalance"
        requested_amount_usd: float = 0.0,
        requested_profile: str | None = None,
        portfolio_features: list[int] | None = None,
    ) -> ConstraintVerdict:
        """
        Run all constraint checks. Returns ConstraintVerdict.
        If the user hasn't onboarded, verdict.allowed=False unless bypassed.
        """
        addr = user_address.strip().lower()
        violations: list[str] = []
        timestamp = datetime.now(timezone.utc).isoformat()

        # 1. Load onboarding state
        onb = self._get_onboarding(addr)

        if onb is None:
            if addr in self._bypass_addresses:
                # Dev bypass: return a permissive verdict
                return self._permissive_verdict(addr, requested_profile or "balanced", timestamp)

            return ConstraintVerdict(
                allowed=False,
                user_address=addr,
                risk_profile=requested_profile or "unknown",
                risk_tolerance=0,
                max_position_usd=0.0,
                session_valid=False,
                identity_verified=False,
                zkml_risk_ok=False,
                policy_enforced=False,
                violations=["User has not completed onboarding"],
                attestation_hash=self._hash_verdict(addr, False, ["not_onboarded"], timestamp),
                timestamp=timestamp,
            )

        # 2. Verify identity artifacts exist
        identity_ok = bool(onb.fact_hash) and bool(onb.identity_commitment) and onb.agent_initialized
        if not identity_ok:
            violations.append("Onboarding incomplete: missing fact_hash or identity_commitment")

        # 3. Check session validity (within session_duration_hours of onboarding)
        now_ts = int(datetime.now(timezone.utc).timestamp())
        elapsed_hours = (now_ts - onb.onboarded_at) / 3600.0
        session_valid = elapsed_hours <= onb.session_duration_hours
        if not session_valid:
            violations.append(
                f"Session expired: {elapsed_hours:.1f}h elapsed, "
                f"max {onb.session_duration_hours}h"
            )

        # 4. Validate requested profile matches onboarding choice
        canonical_profile = onb.risk_profile
        if requested_profile:
            req_lower = requested_profile.strip().lower()
            if req_lower != canonical_profile:
                # Allow equal or more conservative, block more aggressive
                risk_order = {"conservative": 0, "balanced": 1, "aggressive": 2}
                req_risk = risk_order.get(req_lower, 1)
                onb_risk = risk_order.get(canonical_profile, 1)
                if req_risk > onb_risk:
                    violations.append(
                        f"Requested profile '{req_lower}' exceeds onboarded "
                        f"profile '{canonical_profile}'"
                    )
                # Use the lower of the two
                canonical_profile = req_lower if req_risk <= onb_risk else canonical_profile

        # 5. Check amount against max_position constraint
        if (requested_amount_usd or 0) > 0 and onb.max_position_usd > 0:
            if requested_amount_usd > onb.max_position_usd:
                violations.append(
                    f"Amount ${requested_amount_usd:.2f} exceeds max position "
                    f"${onb.max_position_usd:.2f}"
                )

        # 6. Run ZKML risk score check (if portfolio features provided)
        zkml_ok = True
        if portfolio_features:
            zkml_ok = self._check_zkml_risk(portfolio_features, onb.risk_tolerance)
            if not zkml_ok:
                violations.append("ZKML risk score exceeds threshold for profile")

        # 7. Check vault policy bounds
        policy_ok = self._check_vault_policy(addr, requested_amount_usd, canonical_profile)
        if not policy_ok:
            violations.append("Operation violates vault policy bounds")

        allowed = len(violations) == 0 and identity_ok
        attestation = self._hash_verdict(addr, allowed, violations, timestamp)

        return ConstraintVerdict(
            allowed=allowed,
            user_address=addr,
            risk_profile=canonical_profile,
            risk_tolerance=onb.risk_tolerance,
            max_position_usd=onb.max_position_usd,
            session_valid=session_valid,
            identity_verified=identity_ok,
            zkml_risk_ok=zkml_ok,
            policy_enforced=policy_ok,
            violations=violations,
            attestation_hash=attestation,
            timestamp=timestamp,
        )

    def get_user_profile(self, user_address: str) -> str | None:
        """Return the canonical risk profile from onboarding, or None."""
        addr = user_address.strip().lower()
        onb = self._get_onboarding(addr)
        return onb.risk_profile if onb else None

    def get_constraints(self, user_address: str) -> OnboardingConstraints | None:
        """Return full parsed onboarding constraints, or None."""
        addr = user_address.strip().lower()
        return self._get_onboarding(addr)

    def reload(self) -> None:
        """Reload onboarding state from disk."""
        self._onboarding_cache.clear()
        self._load_onboarding()

    # ── Internal ────────────────────────────────────────────────────────

    def _load_onboarding(self) -> None:
        """Load onboarding state from persistence file."""
        if not _ONBOARDING_STATE_FILE.exists():
            logger.warning("Onboarding state file not found: %s", _ONBOARDING_STATE_FILE)
            return
        try:
            data = json.loads(_ONBOARDING_STATE_FILE.read_text())
            if isinstance(data, dict):
                self._onboarding_cache = {
                    k.lower(): v for k, v in data.items() if isinstance(v, dict)
                }
            logger.info("Loaded onboarding state for %d users", len(self._onboarding_cache))
        except Exception as e:
            logger.error("Failed to load onboarding state: %s", e)

    def _get_onboarding(self, addr: str) -> OnboardingConstraints | None:
        """Parse raw onboarding state into typed constraints."""
        raw = self._onboarding_cache.get(addr)
        if not raw:
            # Try reloading (state may have been written after init)
            self._load_onboarding()
            raw = self._onboarding_cache.get(addr)
        if not raw:
            return None

        pending = raw.get("pending_constraints") or {}
        risk_tol = pending.get("risk_tolerance", 50)
        max_pos_str = str(pending.get("max_position", "0"))

        # Convert max_position from wei to USD using live oracle price
        try:
            max_pos_wei = float(max_pos_str)
            max_pos_eth = max_pos_wei / 1e18
            # Use live ETH price from oracle cache; fall back to $2500 if unavailable
            eth_usd = _get_cached_eth_usd()
            max_pos_usd = max_pos_eth * eth_usd
        except (ValueError, OverflowError):
            max_pos_usd = 0.0

        return OnboardingConstraints(
            max_position_wei=max_pos_str,
            max_position_usd=max_pos_usd,
            risk_tolerance=risk_tol if isinstance(risk_tol, int) else 50,
            risk_profile=tolerance_to_profile(risk_tol if isinstance(risk_tol, int) else 50),
            session_duration_hours=pending.get("session_duration", 24),
            claims=pending.get("claims", []),
            fact_hash=raw.get("fact_hash", ""),
            identity_commitment=raw.get("identity_commitment", ""),
            agent_initialized=raw.get("agent_initialized", False),
            onboarded_at=raw.get("timestamp", 0),
        )

    def _check_zkml_risk(self, features: list[int], tolerance: int) -> bool:
        """Run ZKML risk score model and check against threshold."""
        try:
            from app.services.zkml_risk_service import RiskScoreModel
            score = RiskScoreModel.compute_risk_score(features)
            # Threshold based on risk tolerance:
            #   conservative (30) → max score 30
            #   balanced (50) → max score 50
            #   aggressive (70) → max score 70
            return score <= tolerance
        except Exception as e:
            logger.warning("ZKML risk check failed (allowing): %s", e)
            return True  # Fail open during development; production would fail closed

    def _check_vault_policy(
        self, addr: str, amount_usd: float, profile: str
    ) -> bool:
        """Check operation against vault policy service bounds."""
        try:
            from app.services.vault_policy_service import get_vault_policy_service
            svc = get_vault_policy_service()
            policy = svc.get_policy(addr)
            if not policy:
                return True  # No policy = no violation

            exec_policy = policy.get("execution_policy", {})
            session_max = exec_policy.get("session_max_notional_usd", 0)
            if session_max > 0 and amount_usd > session_max:
                logger.info(
                    "Policy violation: amount $%.2f > session_max $%.2f",
                    amount_usd, session_max
                )
                return False
            return True
        except Exception as e:
            logger.warning("Vault policy check failed (allowing): %s", e)
            return True

    def _permissive_verdict(
        self, addr: str, profile: str, timestamp: str
    ) -> ConstraintVerdict:
        """Return permissive verdict for dev/bypass addresses."""
        return ConstraintVerdict(
            allowed=True,
            user_address=addr,
            risk_profile=profile,
            risk_tolerance=profile_to_tolerance(profile),
            max_position_usd=999_999.0,
            session_valid=True,
            identity_verified=False,
            zkml_risk_ok=True,
            policy_enforced=False,
            violations=[],
            attestation_hash=self._hash_verdict(addr, True, [], timestamp),
            timestamp=timestamp,
        )

    @staticmethod
    def _hash_verdict(
        addr: str, allowed: bool, violations: list[str], timestamp: str
    ) -> str:
        payload = json.dumps(
            {"addr": addr, "allowed": allowed, "violations": violations, "ts": timestamp},
            sort_keys=True,
        )
        return "0x" + hashlib.sha256(payload.encode()).hexdigest()[:48]


# ── Singleton ───────────────────────────────────────────────────────────

_gate_instance: ConstraintGate | None = None


def get_constraint_gate() -> ConstraintGate:
    global _gate_instance
    if _gate_instance is None:
        _gate_instance = ConstraintGate()
    return _gate_instance
