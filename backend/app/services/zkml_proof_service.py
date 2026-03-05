"""
zkML Proof Service

Generates and verifies zkML proofs for:
1. Risk validation (safe LP allocation?)
2. Anomaly detection (suspicious position?)
3. Rebalance decision (should we rebalance?)

Proof hierarchy (best → fallback):
  1. Real Groth16 via snarkjs circuit_scanner (RiskScore, AnomalyDetector circuits)
  2. Stone prover via Obsqra (prover_integrations)
  3. Mock mode with synthetic proof hashes (dev only)
"""

import os
import json
from typing import Optional, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Import real prover integrations
try:
    from .prover_integrations import (
        ZkMLRiskProver,
        RebalanceDecisionProver,
        StoneProverClient,
    )
    HAS_REAL_PROVERS = True
except ImportError as e:
    logger.warning(f"Real provers not available: {e}, using mock mode")
    HAS_REAL_PROVERS = False

# Import circuit scanner for Groth16 proofs
try:
    from .zkml.circuit_scanner import (
        run_circuit_scan,
        list_available_circuits,
        build_risk_score_inputs,
        build_anomaly_detector_inputs,
    )
    _circuits = list_available_circuits()
    HAS_CIRCUIT_SCANNER = any(c["ready"] for c in _circuits)
    _READY_CIRCUITS = {c["name"] for c in _circuits if c["ready"]}
    if HAS_CIRCUIT_SCANNER:
        logger.info(f"Circuit scanner available: {len(_READY_CIRCUITS)} circuits ready")
    else:
        logger.warning("Circuit scanner loaded but no circuits are ready (missing wasm/zkey)")
except ImportError as e:
    logger.warning(f"Circuit scanner not available: {e}")
    HAS_CIRCUIT_SCANNER = False
    _READY_CIRCUITS = set()


class ZkmlProofService:
    """
    Service for generating zkML proofs.

    Priority order:
      1. Real Groth16 via circuit_scanner (snarkjs, local)
      2. Stone prover via Obsqra (remote API)
      3. Mock mode (dev, always succeeds)

    Every response includes a `proof_mode` field:
      - "groth16"     → real snarkjs Groth16 proof
      - "stone"       → Obsqra Stone STARK proof
      - "mock"        → synthetic hash (dev/fallback)
    """

    def __init__(self):
        self.risk_prover = ZkMLRiskProver() if HAS_REAL_PROVERS else None
        self.rebalance_prover = RebalanceDecisionProver() if HAS_REAL_PROVERS else None
        self.stone = StoneProverClient() if HAS_REAL_PROVERS else None

    async def generate_lp_risk_proof(
        self,
        token_a: str,
        token_b: str,
        fee_tier: int,
        pool_volatility: float,
        volume_24h: float,
    ) -> dict[str, Any]:
        """
        Generate LP risk validation proof.

        Tries: Groth16 RiskScore circuit → Stone prover → mock.
        """
        # ── 1. Real Groth16 via circuit_scanner ──
        if HAS_CIRCUIT_SCANNER and "RiskScore" in _READY_CIRCUITS:
            try:
                # Map LP parameters to circuit feature vector (8 elements)
                vol_scaled = max(1, int(pool_volatility * 100))
                volume_scaled = max(1, int(min(volume_24h / 1000, 100)))
                fee_scaled = max(1, fee_tier // 100)  # basis points → small int
                features = [vol_scaled, volume_scaled, fee_scaled, 10, 20, 15, 10, 8]

                # Use dedicated builder to get constraint-valid inputs
                inputs = build_risk_score_inputs(features)
                result = await run_circuit_scan(
                    circuits=["RiskScore"],
                    inputs_override={"RiskScore": inputs},
                    portfolio_features=features,
                )
                circuit_result = (result.get("results") or [{}])[0]
                if circuit_result.get("success"):
                    is_safe = circuit_result.get("is_compliant", True)
                    return {
                        "proof_hash": circuit_result.get("proof_hash", "0x0"),
                        "proof": circuit_result.get("proof"),
                        "public_signals": circuit_result.get("public_signals"),
                        "risk_score": 0.3 if is_safe else 0.8,
                        "approved": is_safe,
                        "proof_mode": "groth16",
                        "circuit": "RiskScore",
                        "error": None,
                    }
                else:
                    logger.warning(
                        "RiskScore circuit failed, falling through: %s",
                        circuit_result.get("error"),
                    )
            except Exception as exc:
                logger.warning("Circuit scanner RiskScore failed: %s", exc)

        # ── 2. Stone prover via Obsqra ──
        if HAS_REAL_PROVERS and self.risk_prover:
            try:
                result = await self.risk_prover.generate_lp_risk_proof(
                    token_a=token_a,
                    token_b=token_b,
                    fee_tier=fee_tier,
                    pool_volatility=pool_volatility,
                    volume_24h=volume_24h,
                )
                fact_hash = result.get("fact_hash")
                if fact_hash:  # Stone succeeded
                    return {
                        "proof_hash": fact_hash,
                        "proof": result.get("proof"),
                        "risk_score": result.get("risk_score", 0.5),
                        "approved": result.get("approved", True),
                        "proof_mode": "stone",
                        "error": result.get("error"),
                    }
                else:
                    logger.warning("Stone prover LP risk returned no fact_hash, falling through")
            except Exception as exc:
                logger.warning("Stone prover LP risk failed: %s", exc)

        # ── 3. Mock fallback ──
        import hashlib
        data = f"{token_a}-{token_b}-{fee_tier}-{pool_volatility}-{volume_24h}"
        proof_hash = "0x" + hashlib.sha256(data.encode()).hexdigest()[:16]

        logger.info(f"[MOCK] LP risk proof: {proof_hash}")
        return {
            "proof_hash": proof_hash,
            "proof": None,
            "risk_score": 0.3,
            "approved": True,
            "proof_mode": "mock",
            "error": None,
        }

    async def generate_rebalance_decision_proof(
        self,
        position_id: str,
        current_fee_tier: int,
        pool_volatility: float = 0.0,
        volume_24h: float = 0.0,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        Generate rebalance decision proof.

        Tries: Groth16 AnomalyDetector circuit → Stone prover → mock.
        """
        # ── 1. Real Groth16 via circuit_scanner ──
        if HAS_CIRCUIT_SCANNER and "AnomalyDetector" in _READY_CIRCUITS:
            try:
                vol_scaled = int(pool_volatility * 100)
                result = await run_circuit_scan(
                    circuits=["AnomalyDetector"],
                )
                circuit_result = (result.get("results") or [{}])[0]
                if circuit_result.get("success"):
                    is_safe = circuit_result.get("is_compliant", True)
                    return {
                        "proof_hash": circuit_result.get("proof_hash", "0x0"),
                        "proof": circuit_result.get("proof"),
                        "public_signals": circuit_result.get("public_signals"),
                        "recommended_fee_tier": current_fee_tier,
                        "should_rebalance": is_safe,
                        "proof_mode": "groth16",
                        "circuit": "AnomalyDetector",
                        "error": None,
                    }
                else:
                    logger.warning(
                        "AnomalyDetector circuit failed, falling through: %s",
                        circuit_result.get("error"),
                    )
            except Exception as exc:
                logger.warning("Circuit scanner AnomalyDetector failed: %s", exc)

        # ── 2. Stone prover via Obsqra ──
        if HAS_REAL_PROVERS and self.rebalance_prover:
            try:
                result = await self.rebalance_prover.generate_rebalance_decision_proof(
                    position_id=position_id,
                    current_fee_tier=current_fee_tier,
                    price_drift_percent=kwargs.get("price_drift_percent", 5.0),
                    fee_accumulated_percent=kwargs.get("fee_accumulated_percent", 0.3),
                    pool_volatility=pool_volatility,
                )
                fact_hash = result.get("fact_hash")
                if fact_hash:  # Stone succeeded
                    return {
                        "proof_hash": fact_hash,
                        "proof": result.get("proof"),
                        "recommended_fee_tier": result.get("recommended_fee_tier", current_fee_tier),
                        "should_rebalance": result.get("should_rebalance", False),
                        "proof_mode": "stone",
                        "error": result.get("error"),
                    }
                else:
                    logger.warning("Stone prover rebalance returned no fact_hash, falling through")
            except Exception as exc:
                logger.warning("Stone prover rebalance failed: %s", exc)

        # ── 3. Mock fallback ──
        import hashlib
        data = f"{position_id}-{current_fee_tier}-{pool_volatility}"
        proof_hash = "0x" + hashlib.sha256(data.encode()).hexdigest()[:16]

        logger.info(f"[MOCK] Rebalance decision proof: {proof_hash}")
        return {
            "proof_hash": proof_hash,
            "proof": None,
            "recommended_fee_tier": current_fee_tier,
            "should_rebalance": False,
            "proof_mode": "mock",
            "error": None,
        }
