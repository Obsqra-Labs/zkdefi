"""
LLM Agreement Checker — verifiable safety net for AI agent decisions.

Runs both the Onyx LLM AND the deterministic fallback model on every agent skill
execution. If they disagree, the action is flagged/blocked and an EZKL proof
of the fallback model's decision can be generated.

This is the "verifiable AI guardrail" — even if the LLM is compromised,
a proved-correct deterministic model must agree before funds move.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

REQUIRE_AGREEMENT = os.getenv("REQUIRE_LLM_AGREEMENT", "").lower() in ("1", "true", "yes")
LOG_DISAGREEMENTS = os.getenv("LOG_LLM_DISAGREEMENTS", "true").lower() in ("1", "true", "yes")


@dataclass
class AgreementResult:
    """Result of comparing LLM and fallback model decisions."""
    agreed: bool
    llm_decision: str           # What the LLM decided
    fallback_decision: str      # What the fallback model decided
    fallback_confidence: float
    fallback_reasoning: str
    skill_name: str
    action_blocked: bool        # Whether execution was prevented
    proof: dict[str, Any] | None = None  # EZKL proof of fallback decision (on disagreement)
    timestamp: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AgreementChecker:
    """
    Checks agreement between LLM and deterministic fallback model.

    Usage:
        checker = get_agreement_checker()
        result = await checker.check("zk_risk_score", inputs, "execute")
        if result.action_blocked:
            # Don't execute — LLM and fallback disagree
    """

    def __init__(self) -> None:
        from app.ml.llm_fallback.fallback_model import get_fallback_model
        self.fallback = get_fallback_model()
        self._disagreement_count = 0
        self._total_checks = 0

    async def check(
        self,
        skill_name: str,
        skill_inputs: dict[str, Any],
        llm_decision: str,
        *,
        generate_proof: bool = False,
    ) -> AgreementResult:
        """
        Compare LLM decision against the fallback model.

        Args:
            skill_name: Agent skill being executed.
            skill_inputs: Inputs to the skill circuit.
            llm_decision: What the Onyx LLM decided ("execute"/"reject"/"defer_to_human").
            generate_proof: If True and disagreement, generate EZKL proof of fallback.

        Returns:
            AgreementResult with agreement status and optional proof.
        """
        self._total_checks += 1

        # Normalise LLM decision
        llm_norm = self._normalize_decision(llm_decision)

        # Run fallback model
        fallback_result = self.fallback.predict(skill_name, skill_inputs, llm_norm)

        agreed = self._decisions_compatible(llm_norm, fallback_result.decision)
        action_blocked = False
        proof = None

        if not agreed:
            self._disagreement_count += 1
            logger.warning(
                "LLM DISAGREEMENT on %s: LLM=%s, Fallback=%s (confidence=%.2f). Reason: %s",
                skill_name, llm_norm, fallback_result.decision,
                fallback_result.confidence, fallback_result.reasoning,
            )

            if REQUIRE_AGREEMENT:
                action_blocked = True
                logger.warning("Action BLOCKED due to REQUIRE_LLM_AGREEMENT=true")

            # Generate EZKL proof of fallback decision on disagreement
            if generate_proof:
                proof = await self._generate_disagreement_proof(
                    skill_name, skill_inputs, fallback_result
                )

            # Log to decision store
            if LOG_DISAGREEMENTS:
                await self._log_disagreement(
                    skill_name, llm_norm, fallback_result, action_blocked
                )

        return AgreementResult(
            agreed=agreed,
            llm_decision=llm_norm,
            fallback_decision=fallback_result.decision,
            fallback_confidence=fallback_result.confidence,
            fallback_reasoning=fallback_result.reasoning,
            skill_name=skill_name,
            action_blocked=action_blocked,
            proof=proof,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "total_checks": self._total_checks,
            "disagreements": self._disagreement_count,
            "agreement_rate": (
                (self._total_checks - self._disagreement_count) / self._total_checks
                if self._total_checks > 0 else 1.0
            ),
            "require_agreement": REQUIRE_AGREEMENT,
        }

    def _normalize_decision(self, decision: str) -> str:
        """Normalize LLM output to one of: execute, reject, defer_to_human."""
        d = decision.strip().lower()
        if d in ("execute", "approve", "proceed", "allow", "yes"):
            return "execute"
        if d in ("reject", "deny", "block", "no", "stop"):
            return "reject"
        return "defer_to_human"

    def _decisions_compatible(self, llm: str, fallback: str) -> bool:
        """
        Check if two decisions are compatible.

        Compatible pairs:
          - Both execute
          - Both reject
          - Either defers to human (partial agreement, not flagged)
          - LLM rejects but fallback says execute (conservative LLM is fine)

        Incompatible:
          - LLM says execute but fallback says reject (dangerous!)
        """
        if llm == fallback:
            return True
        if fallback == "defer_to_human" or llm == "defer_to_human":
            return True  # Deferral is always safe
        if llm == "reject" and fallback == "execute":
            return True  # Conservative LLM is acceptable
        # LLM execute + fallback reject = DANGEROUS
        return False

    async def _generate_disagreement_proof(
        self,
        skill_name: str,
        skill_inputs: dict[str, Any],
        fallback_result: Any,
    ) -> dict[str, Any] | None:
        """Generate EZKL proof of the fallback model's decision."""
        try:
            from app.services.ezkl_prover_service import get_ezkl_prover
            prover = get_ezkl_prover()

            if prover.get_artifacts("llm_fallback") is None:
                logger.debug("LLM fallback EZKL model not set up; skipping proof")
                return None

            features = self.fallback.to_feature_vector(skill_name, skill_inputs)
            proof = await prover.prove_inference("llm_fallback", [features])
            return proof.to_dict()
        except Exception as e:
            logger.warning("Failed to generate disagreement proof: %s", e)
            return None

    async def _log_disagreement(
        self,
        skill_name: str,
        llm_decision: str,
        fallback_result: Any,
        blocked: bool,
    ) -> None:
        """Log disagreement to the decision event store."""
        try:
            from app.db.decision_store import get_decision_store
            store = get_decision_store()
            await store.log_event(
                user_address="system",
                event_type="llm_disagreement",
                outcome="block" if blocked else "advisory",
                metadata={
                    "skill_name": skill_name,
                    "llm_decision": llm_decision,
                    "fallback_decision": fallback_result.decision,
                    "fallback_confidence": fallback_result.confidence,
                    "fallback_reasoning": fallback_result.reasoning,
                },
            )
        except Exception as e:
            logger.debug("Failed to log disagreement: %s", e)


# ── Singleton ────────────────────────────────────────────────────────────

_checker: AgreementChecker | None = None


def get_agreement_checker() -> AgreementChecker:
    global _checker
    if _checker is None:
        _checker = AgreementChecker()
    return _checker
