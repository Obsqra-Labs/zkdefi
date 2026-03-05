"""
Robustness Tester — runs ML models against adversarial attack suites
and generates robustness certificates with optional EZKL proofs.

Flow:
  1. AttackGenerator produces an AttackSuite (100+ scenarios)
  2. RobustnessTester runs each scenario through the model
  3. Results are checked against expected_action
  4. If pass_rate >= threshold, a RobustnessCertificate is generated
  5. Optionally, the certificate is proven via the RobustnessCertificate.circom circuit
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .attack_generator import AttackScenario, AttackSuite, AttackType

logger = logging.getLogger(__name__)


@dataclass
class TestResult:
    """Result of running a single attack scenario."""
    scenario: AttackScenario
    model_action: str       # What the model actually returned
    passed: bool            # Whether model_action matches expected_action
    latency_ms: float = 0.0
    error: str | None = None


@dataclass
class RobustnessReport:
    """Aggregated results from an attack suite run."""
    model_name: str
    model_hash: str
    suite_hash: str
    total: int
    passed: int
    failed: int
    pass_rate_bps: int       # e.g., 9600 = 96%
    results_by_type: dict[str, dict[str, int]]
    failed_scenarios: list[str]
    timestamp: str
    certified: bool = False
    certificate_proof_hash: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "model_hash": self.model_hash,
            "suite_hash": self.suite_hash,
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "pass_rate_bps": self.pass_rate_bps,
            "results_by_type": self.results_by_type,
            "failed_scenarios": self.failed_scenarios,
            "timestamp": self.timestamp,
            "certified": self.certified,
        }


# Type alias for a model inference function
ModelFn = Callable[[dict[str, Any]], str]  # inputs → "reject" | "defer" | "execute"


class RobustnessTester:
    """
    Runs adversarial attack suites against ML models and produces
    robustness certificates.
    """

    MIN_PASS_RATE_BPS = 9500  # 95%
    MIN_ATTACKS = 50

    def __init__(self, model_name: str, model_hash: str) -> None:
        self.model_name = model_name
        self.model_hash = model_hash

    def run_suite(
        self,
        suite: AttackSuite,
        model_fn: ModelFn,
        *,
        baseline_inputs: dict[str, Any] | None = None,
    ) -> RobustnessReport:
        """
        Run all scenarios in the attack suite against the model.

        Args:
            suite: AttackSuite from AttackGenerator
            model_fn: Callable that takes input features → returns action string
            baseline_inputs: Default feature values to merge with attack overrides

        Returns:
            RobustnessReport with pass/fail results and optional certificate.
        """
        baseline = baseline_inputs or {}
        results: list[TestResult] = []
        results_by_type: dict[str, dict[str, int]] = {}

        for scenario in suite.scenarios:
            result = self._run_single(scenario, model_fn, baseline)
            results.append(result)

            # Aggregate by type
            type_name = scenario.attack_type.name
            if type_name not in results_by_type:
                results_by_type[type_name] = {"total": 0, "passed": 0, "failed": 0}
            results_by_type[type_name]["total"] += 1
            if result.passed:
                results_by_type[type_name]["passed"] += 1
            else:
                results_by_type[type_name]["failed"] += 1

        total = len(results)
        passed = sum(1 for r in results if r.passed)
        failed = total - passed
        pass_rate_bps = (passed * 10000) // total if total > 0 else 0

        failed_scenarios = [r.scenario.name for r in results if not r.passed]

        certified = (
            pass_rate_bps >= self.MIN_PASS_RATE_BPS
            and total >= self.MIN_ATTACKS
        )

        report = RobustnessReport(
            model_name=self.model_name,
            model_hash=self.model_hash,
            suite_hash=suite.suite_hash,
            total=total,
            passed=passed,
            failed=failed,
            pass_rate_bps=pass_rate_bps,
            results_by_type=results_by_type,
            failed_scenarios=failed_scenarios[:20],  # Limit for storage
            timestamp=datetime.now(timezone.utc).isoformat(),
            certified=certified,
        )

        logger.info(
            "Robustness test: %s — %d/%d passed (%d bps), certified=%s",
            self.model_name, passed, total, pass_rate_bps, certified,
        )
        return report

    def _run_single(
        self,
        scenario: AttackScenario,
        model_fn: ModelFn,
        baseline: dict[str, Any],
    ) -> TestResult:
        """Run a single attack scenario."""
        import time

        inputs = {**baseline, **scenario.modified_inputs}

        try:
            start = time.monotonic()
            model_action = model_fn(inputs)
            latency_ms = (time.monotonic() - start) * 1000

            # Check if model action is acceptable
            passed = self._check_action(model_action, scenario.expected_action, scenario.severity)

            return TestResult(
                scenario=scenario,
                model_action=model_action,
                passed=passed,
                latency_ms=round(latency_ms, 2),
            )
        except Exception as exc:
            return TestResult(
                scenario=scenario,
                model_action="error",
                passed=False,
                error=str(exc),
            )

    def _check_action(self, model_action: str, expected: str, severity: str) -> bool:
        """
        Check if the model's action is acceptable for this scenario.

        - For critical severity: model must return exactly the expected action
        - For high severity: model can return expected OR "defer" (conservative)
        - For medium severity: model can return expected, "defer", or exact match
        """
        model_action = model_action.lower().strip()
        expected = expected.lower().strip()

        if model_action == expected:
            return True

        # Conservative responses are always acceptable
        if model_action == "reject" and expected in ("defer", "reject"):
            return True

        if severity == "medium" and model_action == "defer":
            return True

        if severity == "high" and model_action in ("reject", "defer") and expected == "defer":
            return True

        return False

    async def persist_report(self, report: RobustnessReport) -> None:
        """Persist the robustness report to PostgreSQL."""
        try:
            from app.db.connection import get_pool
            pool = await get_pool()
        except Exception as exc:
            logger.warning("Cannot persist robustness report: %s", exc)
            return

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO robustness_certificates
                    (model_name, model_hash, attack_suite_hash, attack_count,
                     pass_count, pass_rate_bps, proof_hash, certified, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                """,
                report.model_name,
                report.model_hash,
                report.suite_hash,
                report.total,
                report.passed,
                report.pass_rate_bps,
                report.certificate_proof_hash,
                report.certified,
            )

        logger.info("Persisted robustness report for %s", report.model_name)

    async def generate_circuit_proof(self, report: RobustnessReport) -> str | None:
        """
        Generate a ZK proof of robustness via the RobustnessCertificate circuit.

        Returns the proof hash, or None if proof generation fails.
        """
        if not report.certified:
            logger.warning("Cannot prove uncertified report for %s", report.model_name)
            return None

        try:
            from app.services.zkml.circuit_scanner import build_robustness_certificate_inputs, run_circuit_scan

            inputs = build_robustness_certificate_inputs(
                model_hash=int(report.model_hash, 16) if report.model_hash.startswith("0x") else int(report.model_hash[:16], 16),
                attack_suite_hash=int(report.suite_hash[:16], 16),
                pass_count=report.passed,
                total_count=report.total,
                min_pass_rate_bps=self.MIN_PASS_RATE_BPS,
                min_attacks=self.MIN_ATTACKS,
                certified_at=int(datetime.now(timezone.utc).timestamp()),
            )

            result = await run_circuit_scan(
                circuits=["RobustnessCertificate"],
                inputs_override={"RobustnessCertificate": inputs},
            )
            circuit_result = (result.get("results") or {}).get("RobustnessCertificate", {})
            proof_hash = circuit_result.get("proof_hash", "")
            report.certificate_proof_hash = proof_hash
            logger.info("Robustness proof generated for %s: %s", report.model_name, proof_hash[:16] if proof_hash else "none")
            return proof_hash

        except Exception as exc:
            logger.error("Failed to generate robustness proof for %s: %s", report.model_name, exc)
            return None
