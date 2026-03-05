"""app.services package exports.

Keep package import side effects minimal.

Historically this module eagerly imported many heavy submodules. That made
`import app.services.<light_module>` fail when optional runtime deps for
unrelated modules were missing (for example Starknet crypto bindings).
"""

from __future__ import annotations

from importlib import import_module
from typing import Any


_LAZY_EXPORTS = {
    "EkuboYieldService": "ekubo_yield_service",
    "ZkmlProofService": "zkml_proof_service",
    "AutonomousRebalancer": "autonomous_rebalancer",
    "PerformanceTracker": "performance_tracker",
    "SessionKeyService": "session_key_service",
    "GaragaProverClient": "prover_integrations",
    "StoneProverClient": "prover_integrations",
    "ConfidentialAmountProver": "prover_integrations",
    "ZkMLRiskProver": "prover_integrations",
    "RebalanceDecisionProver": "prover_integrations",
}

__all__ = list(_LAZY_EXPORTS.keys())


def __getattr__(name: str) -> Any:
    module_name = _LAZY_EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
    module = import_module(f"{__name__}.{module_name}")
    value = getattr(module, name)
    globals()[name] = value
    return value
