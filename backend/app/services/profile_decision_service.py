"""Risk Profile v2 decision engine.

Computes relayer / execution / lending decisions from an aggregated profile bundle.
Supports soft-to-hard enforcement via env flags and records lightweight telemetry.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from app.services.credit_line_service import compute_credit_line
from app.services.json_store import JsonStore

_metrics_store = JsonStore("risk_gate_metrics")


_REASON_COPY = {
    "onboarding_incomplete": "Complete onboarding to unlock full execution eligibility.",
    "tier_below_standard": "Upgrade to Standard tier to use relayer paths.",
    "passport_low_confidence": "Build proof history to improve passport confidence.",
    "no_active_session": "Create or renew a session key for autonomous execution.",
    "passport_letter_below_c": "Increase reputation letter to C or higher for unsecured credit.",
    "no_credit_line": "Add collateral or improve reputation to unlock borrowing.",
}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _norm_addr(value: str | None) -> str:
    return str(value or "").strip().lower()


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _extract_verified_linked(linked: Any) -> dict[str, str]:
    """
    Normalize verified linked addresses in eth/arb/base/opt format.

    Supported inputs:
    - linked payload with `verification` metadata (preferred)
    - already-filtered linked payload without `verification`
    """
    if not isinstance(linked, dict):
        return {}

    keys = ("eth", "arb", "base", "opt")
    verification = linked.get("verification")

    # Preferred: require explicit verification flags when metadata is present.
    if isinstance(verification, dict):
        out: dict[str, str] = {}
        for key in keys:
            addr = linked.get(key)
            meta = verification.get(key)
            if (
                isinstance(addr, str)
                and addr.strip()
                and isinstance(meta, dict)
                and bool(meta.get("verified", False))
            ):
                out[key] = addr.strip().lower()
        return out

    # Fallback: caller provided pre-filtered verified mapping.
    out: dict[str, str] = {}
    for key in keys:
        addr = linked.get(key)
        if isinstance(addr, str) and addr.strip():
            out[key] = addr.strip().lower()
    return out


class ProfileDecisionService:
    def __init__(self) -> None:
        self.mode = (os.getenv("RISK_GATE_MODE", "soft") or "soft").strip().lower()
        self.enforce_relayer = _env_bool("RISK_GATE_ENFORCE_RELAYER", False)
        self.enforce_borrow = _env_bool("RISK_GATE_ENFORCE_BORROW", False)
        self.enforce_autonomous = _env_bool("RISK_GATE_ENFORCE_AUTONOMOUS", False)
        self.telemetry_enabled = _env_bool("RISK_GATE_METRICS_ENABLED", True)

    def _resolve_mode(self, action: str, reasons: list[str]) -> str:
        if not reasons:
            return "allow"
        if self.mode != "hard":
            return "advisory"
        if action == "relayer" and self.enforce_relayer:
            return "block"
        if action == "borrow" and self.enforce_borrow:
            return "block"
        if action == "autonomous" and self.enforce_autonomous:
            return "block"
        return "advisory"

    def _reason_copy(self, reasons: list[str]) -> list[str]:
        out: list[str] = []
        for reason in reasons:
            msg = _REASON_COPY.get(reason)
            if msg:
                out.append(msg)
        return out

    def evaluate(self, bundle: dict[str, Any]) -> dict[str, Any]:
        reputation = bundle.get("reputation") or {}
        passport = bundle.get("risk_passport") or {}
        onboarding = bundle.get("onboarding") or {}
        session_summary = bundle.get("session_summary") or {}
        linked = bundle.get("linked_addresses") or {}
        verified_linked = _extract_verified_linked(linked)

        tier = _to_int(reputation.get("tier"), 0)
        tier_name = str(reputation.get("tier_name") or ("Strict" if tier <= 0 else "Standard" if tier == 1 else "Express"))
        tenure_days = _to_int(reputation.get("tenure_days"), 0)
        tx_count = _to_int(reputation.get("transaction_count"), _to_int(reputation.get("successful_txns"), 0))
        collateral_eth = _to_float(reputation.get("collateral_eth"), 0.0)
        volume_eth = _to_float(reputation.get("total_volume_eth"), 0.0)

        composite = _to_int(passport.get("composite_score"), 0)
        letter = str(passport.get("letter_rating") or "D")
        credit_tier = passport.get("credit_tier")
        credit_score = passport.get("credit_score")

        has_agent = bool(onboarding.get("has_agent"))
        identity_commitment = onboarding.get("identity_commitment")

        active_sessions = _to_int(session_summary.get("active_count"), 0)

        linked_count = len(verified_linked)
        cross_chain_verified = linked_count > 0

        credit_line = compute_credit_line(
            collateral_eth=collateral_eth,
            tier=tier,
            letter_rating=letter,
            credit_tier=credit_tier,
            linked_address_count=linked_count,
            cross_chain_verified=cross_chain_verified,
        )

        relayer_reasons: list[str] = []
        if tier < 1:
            relayer_reasons.append("tier_below_standard")
        if composite < 20:
            relayer_reasons.append("passport_low_confidence")
        if not has_agent:
            relayer_reasons.append("onboarding_incomplete")

        execution_reasons: list[str] = []
        if not has_agent:
            execution_reasons.append("onboarding_incomplete")
        if active_sessions <= 0:
            execution_reasons.append("no_active_session")
        if composite < 20:
            execution_reasons.append("passport_low_confidence")

        lending_reasons: list[str] = []
        if not has_agent:
            lending_reasons.append("onboarding_incomplete")
        if letter == "D":
            lending_reasons.append("passport_letter_below_c")
        if credit_line.total_line_eth <= 0:
            lending_reasons.append("no_credit_line")

        relayer_mode = self._resolve_mode("relayer", relayer_reasons)
        execution_mode = self._resolve_mode("autonomous", execution_reasons)
        lending_mode = self._resolve_mode("borrow", lending_reasons)

        decisions = {
            "relayer": {
                "mode": relayer_mode,
                "reason_codes": relayer_reasons,
                "reason_hints": self._reason_copy(relayer_reasons),
                "limits": {
                    "min_tier": 1,
                    "current_tier": tier,
                    "tier_name": tier_name,
                },
            },
            "execution": {
                "mode": execution_mode,
                "reason_codes": execution_reasons,
                "reason_hints": self._reason_copy(execution_reasons),
                "limits": {
                    "min_passport_score": 20,
                    "passport_score": composite,
                    "active_sessions": active_sessions,
                },
            },
            "lending": {
                "mode": lending_mode,
                "reason_codes": lending_reasons,
                "reason_hints": self._reason_copy(lending_reasons),
                "limits": {
                    "total_line_wei": str(int(credit_line.total_line_eth * 10**18)),
                    "total_line_eth": credit_line.total_line_eth,
                    "unsecured_cap_eth": credit_line.unsecured_cap_eth,
                    "collateral_line_eth": credit_line.collateral_line_eth,
                    "rate_bps": credit_line.rate_bps,
                    "letter": letter,
                    "tier": tier,
                    "credit_tier": credit_tier,
                },
            },
        }

        profile_slice = {
            "identity": {
                "has_agent": has_agent,
                "identity_commitment": identity_commitment,
                "linked_address_count": linked_count,
                "cross_chain_verified": cross_chain_verified,
                "active_sessions": active_sessions,
            },
            "reputation": {
                "tier": tier,
                "tier_name": tier_name,
                "tenure_days": tenure_days,
                "transaction_count": tx_count,
                "collateral_eth": collateral_eth,
                "total_volume_eth": volume_eth,
            },
            "passport": {
                "composite_score": composite,
                "letter_rating": letter,
                "credit_tier": credit_tier,
                "credit_score": credit_score,
            },
        }

        if self.telemetry_enabled:
            self._record_metrics(bundle.get("address"), decisions)

        # v6: Log gate decisions to PostgreSQL decision store (fire-and-forget)
        self._log_gate_decisions(bundle.get("address"), decisions)

        return {
            "profile": profile_slice,
            "decisions": decisions,
            "disclosures": {
                "risk_notice_id": "us_risk_notice_v1",
                "legal_mode": "strong",
                "disclaimer": "Eligibility signal only; not legal, tax, or financial advice.",
            },
            "feature_flags": {
                "mode": self.mode,
                "enforce_relayer": self.enforce_relayer,
                "enforce_borrow": self.enforce_borrow,
                "enforce_autonomous": self.enforce_autonomous,
            },
        }

    def _log_gate_decisions(self, address: Any, decisions: dict[str, Any]) -> None:
        """Fire-and-forget: log gate decisions to PostgreSQL decision store."""
        import asyncio

        addr = _norm_addr(str(address or ""))
        if not addr:
            return

        async def _do_log() -> None:
            try:
                from app.db.decision_store import DecisionStore
                store = DecisionStore()
                for gate in ("relayer", "execution", "lending"):
                    decision = decisions.get(gate) or {}
                    mode = str(decision.get("mode") or "allow")
                    event_type = f"gate_{mode}"
                    await store.log_event(
                        user_address=addr,
                        event_type=event_type,
                        gate=gate,
                        outcome=mode,
                        metadata={
                            "reason_codes": decision.get("reason_codes", []),
                        },
                    )
            except Exception:
                pass  # Graceful degradation

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_do_log())
        except RuntimeError:
            pass  # No event loop running; skip logging

    def _record_metrics(self, address: Any, decisions: dict[str, Any]) -> None:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        row = _metrics_store.get(today) or {
            "total": 0,
            "by_gate": {
                "relayer": {"allow": 0, "advisory": 0, "block": 0},
                "execution": {"allow": 0, "advisory": 0, "block": 0},
                "lending": {"allow": 0, "advisory": 0, "block": 0},
            },
            "reason_counts": {},
            "updated_at": None,
        }

        row["total"] = int(row.get("total", 0)) + 1
        for gate in ("relayer", "execution", "lending"):
            decision = decisions.get(gate) or {}
            mode = str(decision.get("mode") or "allow")
            counts = row["by_gate"].get(gate) or {"allow": 0, "advisory": 0, "block": 0}
            counts[mode] = int(counts.get(mode, 0)) + 1
            row["by_gate"][gate] = counts
            for reason in decision.get("reason_codes") or []:
                row["reason_counts"][reason] = int(row["reason_counts"].get(reason, 0)) + 1

        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        row["last_address"] = _norm_addr(str(address or ""))
        _metrics_store.set(today, row)


_profile_decision_service: ProfileDecisionService | None = None


def get_profile_decision_service() -> ProfileDecisionService:
    global _profile_decision_service
    if _profile_decision_service is None:
        _profile_decision_service = ProfileDecisionService()
    return _profile_decision_service
