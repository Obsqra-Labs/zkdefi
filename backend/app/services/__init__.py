# zkdefi services - Core MVP Services

# MVP Core Services
from .ekubo_yield_service import EkuboYieldService
from .zkml_proof_service import ZkmlProofService
from .autonomous_rebalancer import AutonomousRebalancer
from .performance_tracker import PerformanceTracker

# Prover Integrations (Real provers: Garaga, Stone, Obsqra)
from .prover_integrations import (
    GaragaProverClient,
    StoneProverClient,
    ConfidentialAmountProver,
    ZkMLRiskProver,
    RebalanceDecisionProver,
)

# Existing Services (reused)
from .session_key_service import SessionKeyService

__all__ = [
    "EkuboYieldService",
    "ZkmlProofService",
    "AutonomousRebalancer",
    "PerformanceTracker",
    "SessionKeyService",
    # Real Provers
    "GaragaProverClient",
    "StoneProverClient",
    "ConfidentialAmountProver",
    "ZkMLRiskProver",
    "RebalanceDecisionProver",
]
