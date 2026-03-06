"""Service package exports.

Keep imports optional so lightweight modules (and tests) do not fail at import time
when heavyweight optional deps are missing.
"""

from __future__ import annotations

__all__: list[str] = []


def _optional_export(module: str, symbol: str) -> None:
    try:
        imported = __import__(module, fromlist=[symbol])
        globals()[symbol] = getattr(imported, symbol)
        __all__.append(symbol)
    except Exception:
        # Optional dependency path; callers can import concrete modules directly.
        return


_optional_export("app.services.ekubo_yield_service", "EkuboYieldService")
_optional_export("app.services.zkml_proof_service", "ZkmlProofService")
_optional_export("app.services.autonomous_rebalancer", "AutonomousRebalancer")
_optional_export("app.services.performance_tracker", "PerformanceTracker")
_optional_export("app.services.session_key_service", "SessionKeyService")
_optional_export("app.services.prover_integrations", "GaragaProverClient")
_optional_export("app.services.prover_integrations", "StoneProverClient")
_optional_export("app.services.prover_integrations", "ConfidentialAmountProver")
_optional_export("app.services.prover_integrations", "ZkMLRiskProver")
_optional_export("app.services.prover_integrations", "RebalanceDecisionProver")
