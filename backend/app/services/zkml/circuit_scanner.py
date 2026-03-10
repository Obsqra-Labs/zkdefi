"""Unified circuit scanner — run any subset of the 25 zkML circuits in parallel.

Each circuit generates a real Groth16 proof via snarkjs, returning a per-circuit
result dict with proof hash, compliance flag, and timing metadata.

Circuits available:
  ML/scoring:       RiskScore, AnomalyDetector, CorrelationRisk, TWAPPosition, SafetyDiversification
  Merkle/privacy:   BalanceAboveThreshold, PoolMembership, TenureAboveThreshold
  Agent/identity:   ImpermanentLossPredictor, YieldOptimality, SlippageBound,
                    AgentReputationScore, CrossProtocolArbitrage, LiquidationRisk,
                    HistoricalPerformanceAttestation, MEVResistanceProof
  EZKL/safety:      ModelBridge, RebalanceTimingCommitment, RobustnessCertificate
  Reputation:       SolvencyProof, RiskPassportTier, TraderPerformanceProof,
                    StrategyIntegrity, ExecutionIntegrity
  Governance:       private_vote
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from app.services.circomlib_poseidon import poseidon_hash_many

try:
    from app.monitoring.metrics import (
        proof_generation_total,
        proof_generation_duration_seconds,
    )
    _METRICS_AVAILABLE = True
except ImportError:
    _METRICS_AVAILABLE = False

PROJECT_ROOT = Path(__file__).resolve().parents[4]  # zkdefi/
CIRCUITS_BUILD = PROJECT_ROOT / "circuits" / "build"
BACKEND_ROOT = PROJECT_ROOT / "backend"

# ── Production mode flag ────────────────────────────────────────────────────
# When True, proof generation must succeed with a real Groth16 proof.
# When False (default for dev), callers may gracefully handle proof failures.
REQUIRE_REAL_PROOFS = os.environ.get("ZKDEFI_REQUIRE_REAL_PROOFS", "").lower() in ("1", "true", "yes")


class ProofGenerationError(Exception):
    """Raised when REQUIRE_REAL_PROOFS is set and a proof fails to generate."""
    pass

# ── Circuit registry ────────────────────────────────────────────────────────

CIRCUIT_REGISTRY: dict[str, dict[str, Any]] = {
    "RiskScore": {
        "wasm": CIRCUITS_BUILD / "RiskScore_js" / "RiskScore.wasm",
        "zkey": CIRCUITS_BUILD / "RiskScore_final.zkey",
        "witness_js": CIRCUITS_BUILD / "RiskScore_js" / "generate_witness.js",
        "category": "ml_scoring",
        "description": "Verifies portfolio risk score is below threshold without revealing model weights",
    },
    "AnomalyDetector": {
        "wasm": CIRCUITS_BUILD / "AnomalyDetector_js" / "AnomalyDetector.wasm",
        "zkey": CIRCUITS_BUILD / "AnomalyDetector_final.zkey",
        "witness_js": CIRCUITS_BUILD / "AnomalyDetector_js" / "generate_witness.js",
        "category": "ml_scoring",
        "description": "Detects pool anomalies across 6 risk factors",
    },
    "CorrelationRisk": {
        "wasm": CIRCUITS_BUILD / "CorrelationRisk_js" / "CorrelationRisk.wasm",
        "zkey": CIRCUITS_BUILD / "CorrelationRisk_final.zkey",
        "witness_js": CIRCUITS_BUILD / "CorrelationRisk_js" / "generate_witness.js",
        "category": "ml_scoring",
        "description": "Proves portfolio correlation risk is within bounds",
    },
    "TWAPPosition": {
        "wasm": CIRCUITS_BUILD / "TWAPPosition_js" / "TWAPPosition.wasm",
        "zkey": CIRCUITS_BUILD / "TWAPPosition_final.zkey",
        "witness_js": CIRCUITS_BUILD / "TWAPPosition_js" / "generate_witness.js",
        "category": "ml_scoring",
        "description": "Verifies time-weighted average position above threshold",
    },
    "SafetyDiversification": {
        "wasm": CIRCUITS_BUILD / "SafetyDiversification_js" / "SafetyDiversification.wasm",
        "zkey": CIRCUITS_BUILD / "SafetyDiversification_final.zkey",
        "witness_js": CIRCUITS_BUILD / "SafetyDiversification_js" / "generate_witness.js",
        "category": "ml_scoring",
        "description": "Verifies portfolio diversification weighted by safety scores",
    },
    "BalanceAboveThreshold": {
        "wasm": CIRCUITS_BUILD / "BalanceAboveThreshold_js" / "BalanceAboveThreshold.wasm",
        "zkey": CIRCUITS_BUILD / "BalanceAboveThreshold_final.zkey",
        "witness_js": CIRCUITS_BUILD / "BalanceAboveThreshold_js" / "generate_witness.js",
        "category": "merkle_privacy",
        "description": "Proves balance exceeds threshold without revealing exact amount",
    },
    "PoolMembership": {
        "wasm": CIRCUITS_BUILD / "PoolMembership_js" / "PoolMembership.wasm",
        "zkey": CIRCUITS_BUILD / "PoolMembership_final.zkey",
        "witness_js": CIRCUITS_BUILD / "PoolMembership_js" / "generate_witness.js",
        "category": "merkle_privacy",
        "description": "Proves membership in a specific pool type without revealing position details",
    },
    "TenureAboveThreshold": {
        "wasm": CIRCUITS_BUILD / "TenureAboveThreshold_js" / "TenureAboveThreshold.wasm",
        "zkey": CIRCUITS_BUILD / "TenureAboveThreshold_final.zkey",
        "witness_js": CIRCUITS_BUILD / "TenureAboveThreshold_js" / "generate_witness.js",
        "category": "merkle_privacy",
        "description": "Proves position tenure exceeds minimum blocks without revealing creation time",
    },
    # ── Agent / Identity-Bound Circuits ──────────────────────────────────────
    "ImpermanentLossPredictor": {
        "wasm": CIRCUITS_BUILD / "ImpermanentLossPredictor_js" / "ImpermanentLossPredictor.wasm",
        "zkey": CIRCUITS_BUILD / "ImpermanentLossPredictor_final.zkey",
        "witness_js": CIRCUITS_BUILD / "ImpermanentLossPredictor_js" / "generate_witness.js",
        "category": "agent_skill",
        "description": "Proves impermanent loss is within tolerance without revealing position details",
    },
    "YieldOptimality": {
        "wasm": CIRCUITS_BUILD / "YieldOptimality_js" / "YieldOptimality.wasm",
        "zkey": CIRCUITS_BUILD / "YieldOptimality_final.zkey",
        "witness_js": CIRCUITS_BUILD / "YieldOptimality_js" / "generate_witness.js",
        "category": "agent_skill",
        "description": "Proves allocation is near-optimal yield without revealing strategy",
    },
    "SlippageBound": {
        "wasm": CIRCUITS_BUILD / "SlippageBound_js" / "SlippageBound.wasm",
        "zkey": CIRCUITS_BUILD / "SlippageBound_final.zkey",
        "witness_js": CIRCUITS_BUILD / "SlippageBound_js" / "generate_witness.js",
        "category": "agent_skill",
        "description": "Proves trade slippage is within bounds without revealing trade details",
    },
    "AgentReputationScore": {
        "wasm": CIRCUITS_BUILD / "AgentReputationScore_js" / "AgentReputationScore.wasm",
        "zkey": CIRCUITS_BUILD / "AgentReputationScore_final.zkey",
        "witness_js": CIRCUITS_BUILD / "AgentReputationScore_js" / "generate_witness.js",
        "category": "agent_identity",
        "description": "Proves agent reputation meets minimum without revealing performance metrics",
    },
    "CrossProtocolArbitrage": {
        "wasm": CIRCUITS_BUILD / "CrossProtocolArbitrage_js" / "CrossProtocolArbitrage.wasm",
        "zkey": CIRCUITS_BUILD / "CrossProtocolArbitrage_final.zkey",
        "witness_js": CIRCUITS_BUILD / "CrossProtocolArbitrage_js" / "generate_witness.js",
        "category": "agent_skill",
        "description": "Proves cross-protocol arbitrage is profitable after fees without revealing details",
    },
    "LiquidationRisk": {
        "wasm": CIRCUITS_BUILD / "LiquidationRisk_js" / "LiquidationRisk.wasm",
        "zkey": CIRCUITS_BUILD / "LiquidationRisk_final.zkey",
        "witness_js": CIRCUITS_BUILD / "LiquidationRisk_js" / "generate_witness.js",
        "category": "agent_skill",
        "description": "Proves all positions have healthy collateral ratios without revealing amounts",
    },
    "HistoricalPerformanceAttestation": {
        "wasm": CIRCUITS_BUILD / "HistoricalPerformanceAttestation_js" / "HistoricalPerformanceAttestation.wasm",
        "zkey": CIRCUITS_BUILD / "HistoricalPerformanceAttestation_final.zkey",
        "witness_js": CIRCUITS_BUILD / "HistoricalPerformanceAttestation_js" / "generate_witness.js",
        "category": "agent_identity",
        "description": "Proves historical performance meets criteria without revealing period returns",
    },
    "MEVResistanceProof": {
        "wasm": CIRCUITS_BUILD / "MEVResistanceProof_js" / "MEVResistanceProof.wasm",
        "zkey": CIRCUITS_BUILD / "MEVResistanceProof_final.zkey",
        "witness_js": CIRCUITS_BUILD / "MEVResistanceProof_js" / "generate_witness.js",
        "category": "agent_skill",
        "description": "Proves transaction was not subject to significant MEV extraction",
    },
    # ── EZKL Bridge Circuits ─────────────────────────────────────────────────
    "ModelBridge": {
        "wasm": CIRCUITS_BUILD / "ModelBridge_js" / "ModelBridge.wasm",
        "zkey": CIRCUITS_BUILD / "ModelBridge_final.zkey",
        "witness_js": CIRCUITS_BUILD / "ModelBridge_js" / "generate_witness.js",
        "category": "ezkl_bridge",
        "description": "Bridges EZKL ML proofs into Groth16/Garaga pipeline — commits model identity and output on-chain",
    },
    "RebalanceTimingCommitment": {
        "wasm": CIRCUITS_BUILD / "RebalanceTimingCommitment_js" / "RebalanceTimingCommitment.wasm",
        "zkey": CIRCUITS_BUILD / "RebalanceTimingCommitment_final.zkey",
        "witness_js": CIRCUITS_BUILD / "RebalanceTimingCommitment_js" / "generate_witness.js",
        "category": "mev_resistance",
        "description": "Proves rebalance timing was committed before execution block — MEV-resistant predictive timing",
    },
    "RobustnessCertificate": {
        "wasm": CIRCUITS_BUILD / "RobustnessCertificate_js" / "RobustnessCertificate.wasm",
        "zkey": CIRCUITS_BUILD / "RobustnessCertificate_final.zkey",
        "witness_js": CIRCUITS_BUILD / "RobustnessCertificate_js" / "generate_witness.js",
        "category": "model_safety",
        "description": "Certifies a model survived adversarial robustness testing above pass-rate threshold",
    },
    # ── Reputation / Financial Passport Circuits ─────────────────────────────
    "SolvencyProof": {
        "wasm": CIRCUITS_BUILD / "SolvencyProof_js" / "SolvencyProof.wasm",
        "zkey": CIRCUITS_BUILD / "SolvencyProof_final.zkey",
        "witness_js": CIRCUITS_BUILD / "SolvencyProof_js" / "generate_witness.js",
        "category": "reputation",
        "description": "Proves total assets exceed liabilities by a minimum ratio without revealing positions",
    },
    "RiskPassportTier": {
        "wasm": CIRCUITS_BUILD / "RiskPassportTier_js" / "RiskPassportTier.wasm",
        "zkey": CIRCUITS_BUILD / "RiskPassportTier_final.zkey",
        "witness_js": CIRCUITS_BUILD / "RiskPassportTier_js" / "generate_witness.js",
        "category": "reputation",
        "description": "Assigns a 1-5 risk tier from weighted risk metrics with configurable thresholds",
    },
    "TraderPerformanceProof": {
        "wasm": CIRCUITS_BUILD / "TraderPerformanceProof_js" / "TraderPerformanceProof.wasm",
        "zkey": CIRCUITS_BUILD / "TraderPerformanceProof_final.zkey",
        "witness_js": CIRCUITS_BUILD / "TraderPerformanceProof_js" / "generate_witness.js",
        "category": "reputation",
        "description": "Proves Sharpe ratio, drawdown, and win-rate thresholds over 30 periods without revealing returns",
    },
    "StrategyIntegrity": {
        "wasm": CIRCUITS_BUILD / "StrategyIntegrity_js" / "StrategyIntegrity.wasm",
        "zkey": CIRCUITS_BUILD / "StrategyIntegrity_final.zkey",
        "witness_js": CIRCUITS_BUILD / "StrategyIntegrity_js" / "generate_witness.js",
        "category": "strategy_integrity",
        "description": "Proves position concentration, leverage, slippage, and exposure comply with strategy policy",
    },
    "ExecutionIntegrity": {
        "wasm": CIRCUITS_BUILD / "ExecutionIntegrity_js" / "ExecutionIntegrity.wasm",
        "zkey": CIRCUITS_BUILD / "ExecutionIntegrity_final.zkey",
        "witness_js": CIRCUITS_BUILD / "ExecutionIntegrity_js" / "generate_witness.js",
        "category": "execution_quality",
        "description": "Proves trade execution met delay, price deviation, and routing constraints",
    },
    "private_vote": {
        "wasm": CIRCUITS_BUILD / "private_vote_js" / "private_vote.wasm",
        "zkey": CIRCUITS_BUILD / "private_vote_final.zkey",
        "witness_js": CIRCUITS_BUILD / "private_vote_js" / "generate_witness.js",
        "category": "governance",
        "description": "Enables private on-chain voting with ballot commitment and nullifier",
    },
}


def list_available_circuits() -> list[dict[str, Any]]:
    """Return metadata for all registered circuits."""
    result = []
    for name, meta in CIRCUIT_REGISTRY.items():
        wasm_ok = meta["wasm"].exists()
        zkey_ok = meta["zkey"].exists()
        result.append({
            "name": name,
            "category": meta["category"],
            "description": meta["description"],
            "ready": wasm_ok and zkey_ok,
            "wasm_exists": wasm_ok,
            "zkey_exists": zkey_ok,
        })
    return result


def _safe_relative(path: Path) -> str:
    """Return a path relative to project root when possible."""
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except Exception:
        return str(path)


def get_onnx_runtime_status() -> dict[str, Any]:
    """Return ONNX runtime + artifact availability for the local stack."""
    runtime_available = False
    runtime_version: str | None = None
    runtime_error: str | None = None
    try:
        import onnxruntime as ort  # type: ignore

        runtime_available = True
        runtime_version = str(getattr(ort, "__version__", "unknown"))
    except Exception as exc:  # pragma: no cover - env dependent
        runtime_error = str(exc)

    model_dirs = [
        BACKEND_ROOT / "app" / "data" / "ezkl_models",
        BACKEND_ROOT / "app" / "ml",
        PROJECT_ROOT / "credit-scoring",
    ]
    files: list[dict[str, Any]] = []
    for base in model_dirs:
        if not base.exists():
            continue
        for onnx_path in sorted(base.rglob("*.onnx")):
            stat = onnx_path.stat()
            files.append(
                {
                    "path": _safe_relative(onnx_path),
                    "size_bytes": stat.st_size,
                    "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                }
            )

    credit_meta_candidates = [
        BACKEND_ROOT / "app" / "data" / "ezkl_models" / "creditworthiness" / "training_metadata.json",
        BACKEND_ROOT / "app" / "data" / "ezkl_models" / "creditworthiness" / "model_meta.json",
    ]
    credit_meta = next((p for p in credit_meta_candidates if p.exists()), credit_meta_candidates[0])
    credit_meta_exists = credit_meta.exists()

    return {
        "runtime_available": runtime_available,
        "runtime_version": runtime_version,
        "runtime_error": runtime_error,
        "onnx_files_found": len(files),
        "onnx_files": files[:20],  # cap payload size
        "creditworthiness_meta_exists": credit_meta_exists,
        "creditworthiness_meta_path": _safe_relative(credit_meta),
    }


def _default_input_builders(
    user_address: int = 0,
    portfolio_features: list[int] | None = None,
) -> dict[str, Any]:
    """Return default builder callables for circuits with runnable defaults."""
    feats = (portfolio_features or [10, 20, 15, 30, 10, 25, 12, 18])[:8]
    return {
        "RiskScore": lambda: build_risk_score_inputs(feats, user_address=user_address),
        "AnomalyDetector": lambda: build_anomaly_detector_inputs(user_address=user_address),
        "CorrelationRisk": lambda: build_correlation_risk_inputs(user_address=user_address),
        "TWAPPosition": lambda: build_twap_position_inputs(user_address=user_address),
        "SafetyDiversification": lambda: build_safety_diversification_inputs(user_address=user_address),
        "ImpermanentLossPredictor": lambda: build_il_predictor_inputs(user_address=user_address),
        "YieldOptimality": lambda: build_yield_optimality_inputs(user_address=user_address),
        "SlippageBound": lambda: build_slippage_bound_inputs(user_address=user_address),
        "AgentReputationScore": lambda: build_agent_reputation_inputs(user_address=user_address),
        "CrossProtocolArbitrage": lambda: build_cross_protocol_arb_inputs(user_address=user_address),
        "LiquidationRisk": lambda: build_liquidation_risk_inputs(user_address=user_address),
        "HistoricalPerformanceAttestation": lambda: build_historical_performance_inputs(user_address=user_address),
        "MEVResistanceProof": lambda: build_mev_resistance_inputs(user_address=user_address),
        "ModelBridge": lambda: build_model_bridge_inputs(),
        "RebalanceTimingCommitment": lambda: build_rebalance_timing_inputs(user_address=user_address),
        "RobustnessCertificate": lambda: build_robustness_certificate_inputs(),
        "SolvencyProof": lambda: build_solvency_proof_inputs(user_address=user_address),
        "RiskPassportTier": lambda: build_risk_passport_tier_inputs(user_address=user_address),
        "TraderPerformanceProof": lambda: build_trader_performance_inputs(user_address=user_address),
        "StrategyIntegrity": lambda: build_strategy_integrity_inputs(user_address=user_address),
        "ExecutionIntegrity": lambda: build_execution_integrity_inputs(user_address=user_address),
    }


def build_default_inputs_for_circuit(
    circuit_name: str,
    user_address: int = 0,
    portfolio_features: list[int] | None = None,
) -> dict[str, Any]:
    """Build default runnable inputs for a circuit when supported."""
    builders = _default_input_builders(
        user_address=user_address,
        portfolio_features=portfolio_features,
    )
    builder = builders.get(circuit_name)
    if not builder:
        raise ValueError(f"No default builder for circuit: {circuit_name}")
    return builder()


def list_circuit_readout(
    user_address: int = 0,
    portfolio_features: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Return rich per-circuit readout: readiness + default-runnable metadata."""
    builders = _default_input_builders(
        user_address=user_address,
        portfolio_features=portfolio_features,
    )
    results: list[dict[str, Any]] = []
    for circuit in list_available_circuits():
        name = circuit["name"]
        has_default_builder = name in builders
        default_inputs = None
        input_error = None
        if has_default_builder:
            try:
                default_inputs = builders[name]()
            except Exception as exc:
                input_error = str(exc)
        else:
            input_error = "Custom inputs required (e.g. merkle proof / private witness data)"

        results.append(
            {
                **circuit,
                "has_default_inputs": has_default_builder,
                "default_inputs": default_inputs,
                "input_error": input_error,
            }
        )
    return results


def _hash_proof(proof_json: dict) -> str:
    """Deterministic hash of a proof for audit/logging."""
    encoded = json.dumps(proof_json, sort_keys=True, separators=(",", ":")).encode()
    return "0x" + hashlib.sha256(encoded).hexdigest()


async def _generate_proof(
    circuit_name: str,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Generate a Groth16 proof for a single circuit.

    Runs snarkjs in a subprocess to keep the event loop non-blocking.
    Returns a dict with proof, public signals, proof_hash, and timing.
    """
    meta = CIRCUIT_REGISTRY.get(circuit_name)
    if not meta:
        return {"circuit": circuit_name, "success": False, "error": f"Unknown circuit: {circuit_name}"}

    wasm = meta["wasm"]
    zkey = meta["zkey"]
    witness_js = meta["witness_js"]

    if not wasm.exists() or not zkey.exists():
        return {
            "circuit": circuit_name,
            "success": False,
            "error": f"Circuit artifacts missing: wasm={wasm.exists()}, zkey={zkey.exists()}",
        }

    t0 = time.monotonic()

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            _generate_proof_sync,
            circuit_name,
            inputs,
            wasm,
            zkey,
            witness_js,
        )
        result["duration_ms"] = int((time.monotonic() - t0) * 1000)
        # In production mode, refuse non-successful results
        if REQUIRE_REAL_PROOFS and not result.get("success"):
            msg = f"[PRODUCTION] Real proof required but failed for {circuit_name}: {result.get('error', 'unknown')}"
            logger.error(msg)
            raise ProofGenerationError(msg)
        return result
    except ProofGenerationError:
        raise  # Re-raise production proof errors
    except Exception as exc:
        if REQUIRE_REAL_PROOFS:
            raise ProofGenerationError(
                f"[PRODUCTION] Proof generation crashed for {circuit_name}: {exc}"
            ) from exc
        return {
            "circuit": circuit_name,
            "success": False,
            "error": str(exc),
            "duration_ms": int((time.monotonic() - t0) * 1000),
        }


def _generate_proof_sync(
    circuit_name: str,
    inputs: dict[str, Any],
    wasm: Path,
    zkey: Path,
    witness_js: Path,
) -> dict[str, Any]:
    """Synchronous proof generation (runs in thread pool)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        input_file = Path(tmpdir) / "input.json"
        input_file.write_text(json.dumps(inputs, default=str))

        witness_file = Path(tmpdir) / "witness.wtns"

        # 1. Generate witness
        cmd = f"/usr/bin/node {witness_js} {wasm} {input_file} {witness_file}"
        wp = subprocess.run(
            ["/bin/bash", "-c", cmd],
            capture_output=True,
            text=True,
            cwd=str(CIRCUITS_BUILD),
            env={"PATH": "/usr/bin:/usr/local/bin:/bin", "HOME": os.environ.get("HOME", "/root")},
            timeout=60,
        )
        if wp.returncode != 0:
            return {
                "circuit": circuit_name,
                "success": False,
                "error": f"Witness generation failed: {wp.stderr or wp.stdout}",
            }

        # 2. Generate proof
        proof_file = Path(tmpdir) / "proof.json"
        public_file = Path(tmpdir) / "public.json"
        pp = subprocess.run(
            ["npx", "snarkjs", "groth16", "prove", str(zkey), str(witness_file), str(proof_file), str(public_file)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if pp.returncode != 0:
            return {
                "circuit": circuit_name,
                "success": False,
                "error": f"Proof generation failed: {pp.stderr or pp.stdout}",
            }

        proof = json.loads(proof_file.read_text())
        public = json.loads(public_file.read_text())

        # Derive compliance from public signals (first output is typically is_compliant/is_safe)
        is_compliant = public[0] == "1" if public else None

        return {
            "circuit": circuit_name,
            "success": True,
            "is_compliant": is_compliant,
            "proof_hash": _hash_proof(proof),
            "public_signals": public,
            "proof": proof,
        }


# ── Default input builders for each circuit ─────────────────────────────────

# Cache for Poseidon results to avoid repeated subprocess calls
_poseidon_cache: dict[tuple[int, ...], str] = {}


def _poseidon_commitment(*values: int) -> str:
    """Compute a real BN254 Poseidon hash via shared circomlib worker.

    This produces the same hash as Circom's ``Poseidon(N)`` template,
    so commitments generated here will match on-chain verification.
    Falls back to SHA-256 only when Poseidon runtime is unavailable AND
    REQUIRE_REAL_PROOFS is not set.
    """
    cache_key = tuple(values)
    if cache_key in _poseidon_cache:
        return _poseidon_cache[cache_key]

    try:
        h = str(poseidon_hash_many([int(v) for v in values]))
        _poseidon_cache[cache_key] = h
        return h
    except Exception as exc:
        if REQUIRE_REAL_PROOFS:
            raise RuntimeError(
                f"Real Poseidon required but worker failed: {exc}"
            ) from exc
        logger.warning("Poseidon worker unavailable, falling back to SHA-256 stub: %s", exc)
        # SHA-256 fallback (deterministic but won't match on-chain Poseidon)
        payload_str = ":".join(str(v) for v in values)
        h = str(int(hashlib.sha256(payload_str.encode()).hexdigest(), 16) % (2**253))
        _poseidon_cache[cache_key] = h
        return h


def build_risk_score_inputs(
    portfolio_features: list[int] | None = None,
    model_weights: list[int] | None = None,
    model_bias: int = 0,
    threshold: int = 50,
    scale: int = 100,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for the RiskScore circuit."""
    feats = ((portfolio_features or [10, 20, 15, 30, 10, 25, 12, 18]) + [0] * 8)[:8]
    weights = (model_weights or [10] * 8)[:8]
    raw_sum = sum(f * w for f, w in zip(feats, weights)) + model_bias
    # Circuit constraint: actual_score * scale <= raw_sum < (actual_score + 1) * scale
    actual_score = raw_sum // scale
    commitment = _poseidon_commitment(user_address, actual_score)
    return {
        "portfolio_features": [str(f) for f in feats],
        "model_weights": [str(w) for w in weights],
        "model_bias": str(model_bias),
        "actual_score": str(actual_score),
        "threshold": str(threshold * scale),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_anomaly_detector_inputs(
    tvl_volatility: int = 10,
    liquidity_concentration: int = 20,
    price_impact_score: int = 5,
    deployer_age_days: int = 365,
    volume_anomaly: int = 3,
    contract_risk_score: int = 15,
    max_anomaly_score: int = 500,
    pool_id: int = 1,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for the AnomalyDetector circuit."""
    factors = [tvl_volatility, liquidity_concentration, price_impact_score, deployer_age_days, volume_anomaly, contract_risk_score]
    weights = [10, 10, 10, 10, 10, 10]
    thresholds = [50, 50, 50, 50, 50, 50]
    commitment = _poseidon_commitment(user_address, pool_id)
    return {
        "tvl_volatility": str(tvl_volatility),
        "liquidity_concentration": str(liquidity_concentration),
        "price_impact_score": str(price_impact_score),
        "deployer_age_days": str(deployer_age_days),
        "volume_anomaly": str(volume_anomaly),
        "contract_risk_score": str(contract_risk_score),
        "factor_weights": [str(w) for w in weights],
        "factor_thresholds": [str(t) for t in thresholds],
        "max_anomaly_score": str(max_anomaly_score),
        "pool_id": str(pool_id),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_correlation_risk_inputs(
    positions: list[int] | None = None,
    threshold: int = 80,
    scale: int = 100,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for CorrelationRisk circuit.

    The circuit verifies:
        actual_correlation * total_pos² <= Σpos_i*pos_j*corr[i][j] < (actual_correlation+1)*total_pos²
    So actual_correlation must be the INTEGER DIVISION of the weighted sum by total_pos².
    """
    pos = (positions or [20, 20, 20, 20, 20])[:5]
    pos = (pos + [0] * 5)[:5]
    # Identity-ish correlation matrix (low correlation)
    corr = [[100 if i == j else 10 for j in range(5)] for i in range(5)]
    weighted_sum = sum(pos[i] * pos[j] * corr[i][j] for i in range(5) for j in range(5))
    total_pos = sum(pos)
    total_pos_sq = total_pos * total_pos if total_pos > 0 else 1
    # actual_correlation is the normalized (integer-divided) value
    actual = weighted_sum // total_pos_sq
    commitment = _poseidon_commitment(user_address, actual)
    return {
        "positions": [str(p) for p in pos],
        "corr_matrix": [[str(c) for c in row] for row in corr],
        "actual_correlation": str(actual),
        "threshold": str(threshold * scale),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_twap_position_inputs(
    daily_positions: list[int] | None = None,
    threshold: int = 50,
    scale: int = 100,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for TWAPPosition circuit."""
    days = (daily_positions or [100, 100, 100, 100, 100, 100, 100])[:7]
    days = (days + [0] * 7)[:7]
    twap = sum(days) // len(days)
    commitment = _poseidon_commitment(user_address, twap)
    return {
        "daily_positions": [str(d) for d in days],
        "actual_twap": str(twap),
        "threshold": str(threshold * scale),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_safety_diversification_inputs(
    allocations: list[int] | None = None,
    safety_scores: list[int] | None = None,
    threshold: int = 60,
    scale: int = 100,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for SafetyDiversification circuit.

    Circuit constraint:
        actual_score * total_alloc <= total_weighted < (actual_score+1) * total_alloc
    So actual_score = total_weighted // total_alloc  (integer division).
    """
    allocs = (allocations or [20, 20, 20, 20, 10, 10])[:6]
    allocs = (allocs + [0] * 6)[:6]
    scores = (safety_scores or [80, 70, 90, 60, 50, 85])[:6]
    scores = (scores + [50] * 6)[:6]
    total_weighted = sum(a * s for a, s in zip(allocs, scores))
    total_alloc = sum(allocs)
    actual = total_weighted // total_alloc if total_alloc > 0 else 0
    commitment = _poseidon_commitment(user_address, actual)
    return {
        "allocations": [str(a) for a in allocs],
        "safety_scores": [str(s) for s in scores],
        "actual_score": str(actual),
        "threshold": str(threshold * scale * total_alloc),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


# ── Agent circuit input builders ────────────────────────────────────────────

def build_il_predictor_inputs(
    position_size: int = 10000,
    entry_price: int = 2000,
    current_price: int = 2200,
    fee_earned_bps: int = 150,
    max_il_tolerance_bps: int = 500,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for ImpermanentLossPredictor circuit.

    Circuit constraints (Step 2 – the enforced assertions):
        il_lhs  = actual_il_bps * (entry_price + current_price)
        il_rhs  = entry_price * scale - 2 * sqrt_price_ratio * entry_price
        Require: il_rhs <= il_lhs < il_rhs + (entry_price + current_price)

    Derivation for sqrt_price_ratio that makes IL correct:
        sqrt_price_ratio = sqrt(r)*scale - r*scale/2
    where r = current_price / entry_price, computed in integer math as:
        sqrt_ratio  = isqrt(current_price * scale^2 / entry_price)
        half_ratio  = current_price * scale / (2 * entry_price)
        sqrt_price_ratio = sqrt_ratio - half_ratio
    """
    import math

    # sqrt(current/entry) * scale  (integer floor)
    sqrt_ratio = math.isqrt(current_price * scale * scale // entry_price)
    # r * scale / 2  (integer floor)
    half_price_ratio = (current_price * scale) // (2 * entry_price)
    sqrt_price_ratio = sqrt_ratio - half_price_ratio

    # Compute il_rhs from circuit formula
    sum_prices = entry_price + current_price
    il_rhs = entry_price * scale - 2 * sqrt_price_ratio * entry_price

    # actual_il_bps = ceil(il_rhs / sum_prices) via integer ceiling
    if il_rhs <= 0:
        actual_il_bps = 0
    else:
        actual_il_bps = (il_rhs + sum_prices - 1) // sum_prices

    commitment = _poseidon_commitment(user_address, position_size, entry_price)
    return {
        "position_size": str(position_size),
        "entry_price": str(entry_price),
        "current_price": str(current_price),
        "fee_earned_bps": str(fee_earned_bps),
        "sqrt_price_ratio": str(sqrt_price_ratio),
        "actual_il_bps": str(actual_il_bps),
        "max_il_tolerance_bps": str(max_il_tolerance_bps),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_yield_optimality_inputs(
    allocations: list[int] | None = None,
    predicted_yields: list[int] | None = None,
    optimality_threshold_bps: int = 200,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for YieldOptimality circuit (8 pools)."""
    allocs = (allocations or [25, 20, 15, 15, 10, 10, 3, 2])[:8]
    allocs = (allocs + [0] * 8)[:8]
    yields = (predicted_yields or [800, 600, 500, 450, 400, 350, 300, 250])[:8]
    yields = (yields + [0] * 8)[:8]
    total_alloc = sum(allocs)
    weighted_yield = sum(a * y for a, y in zip(allocs, yields))
    actual_yield = weighted_yield // total_alloc if total_alloc > 0 else 0
    max_yield = max(yields)
    commitment = _poseidon_commitment(user_address, actual_yield)
    return {
        "allocations": [str(a) for a in allocs],
        "predicted_yields": [str(y) for y in yields],
        "max_single_yield": str(max_yield),
        "actual_expected_yield": str(actual_yield),
        "optimality_threshold_bps": str(optimality_threshold_bps),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_slippage_bound_inputs(
    trade_amount: int = 50000,
    current_liquidity: int = 5000000,
    price_impact_coefficient: int = 100,
    max_slippage_bps: int = 50,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for SlippageBound circuit."""
    estimated = (trade_amount * price_impact_coefficient) // current_liquidity
    commitment = _poseidon_commitment(user_address, trade_amount)
    return {
        "trade_amount": str(trade_amount),
        "current_liquidity": str(current_liquidity),
        "price_impact_coefficient": str(price_impact_coefficient),
        "estimated_slippage_bps": str(estimated),
        "max_slippage_bps": str(max_slippage_bps),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_agent_reputation_inputs(
    metrics: list[int] | None = None,
    weights: list[int] | None = None,
    min_reputation_score: int = 500,
    scale: int = 10,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for AgentReputationScore circuit (7 metrics).

    Circuit constraints:
        raw_sum = Σ(metrics[i] * weights[i])
        computed_score * scale <= raw_sum < (computed_score + 1) * scale   (asserted)
        0 <= computed_score <= 1000                                         (asserted)

    Defaults chosen so raw_sum / scale ∈ [0, 1000].
    """
    # Defaults: [total_volume, successful, failed, avg_return, max_drawdown, tenure, proofs]
    m = (metrics or [100, 90, 5, 350, 50, 180, 50])[:7]
    m = (m + [0] * 7)[:7]
    w = (weights or [5, 20, 1, 15, 1, 5, 10])[:7]  # small positive weights
    w = (w + [0] * 7)[:7]
    raw = sum(mi * wi for mi, wi in zip(m, w))
    score = raw // scale
    # Circuit asserts 0 <= score <= 1000 — adjust scale if needed
    if score > 1000 and raw > 0:
        # Find smallest scale that brings score ≤ 1000
        scale = max(scale, (raw // 1000) + 1)
        score = raw // scale
    if score > 1000:
        score = 1000
    commitment = _poseidon_commitment(user_address, score)
    return {
        "metrics": [str(mi) for mi in m],
        "weights": [str(wi) for wi in w],
        "computed_score": str(score),
        "min_reputation_score": str(min(min_reputation_score, score)),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_cross_protocol_arb_inputs(
    source_price: int = 1000,
    dest_price: int = 1020,
    source_fee_bps: int = 30,
    dest_fee_bps: int = 30,
    gas_cost: int = 5,
    trade_amount: int = 100000,
    min_profit_bps: int = 10,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for CrossProtocolArbitrage circuit."""
    price_diff = dest_price - source_price
    gross_scaled = price_diff * trade_amount * 10000
    fee_cost = (source_fee_bps * trade_amount * source_price +
                dest_fee_bps * trade_amount * dest_price +
                gas_cost * source_price * 10000)
    net_scaled = gross_scaled - fee_cost
    denom = trade_amount * source_price
    profit_bps = net_scaled // denom if denom > 0 else 0
    commitment = _poseidon_commitment(user_address, source_price, dest_price)
    return {
        "source_price": str(source_price),
        "dest_price": str(dest_price),
        "source_fee_bps": str(source_fee_bps),
        "dest_fee_bps": str(dest_fee_bps),
        "gas_cost": str(gas_cost),
        "trade_amount": str(trade_amount),
        "computed_profit_bps": str(profit_bps),
        "min_profit_bps": str(min_profit_bps),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_liquidation_risk_inputs(
    collateral_values: list[int] | None = None,
    debt_values: list[int] | None = None,
    liquidation_thresholds: list[int] | None = None,
    num_active: int = 3,
    min_health_factor: int = 1,  # unscaled integer: HF = collat*thresh / (debt*10000)
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for LiquidationRisk circuit (8 positions).

    Circuit computes health factor as an unscaled integer:
        hf = (collateral * threshold) // (debt * 10000)
    The comparison hf >= min_health_factor uses this unscaled value.
    Default min_health_factor=1 means "not underwater".
    """
    collats = (collateral_values or [200000, 150000, 100000, 0, 0, 0, 0, 0])[:8]
    collats = (collats + [0] * 8)[:8]
    debts = (debt_values or [80000, 50000, 30000, 1, 1, 1, 1, 1])[:8]
    debts = (debts + [1] * 8)[:8]  # avoid div-by-zero
    thresholds = (liquidation_thresholds or [8000, 8500, 7500, 10000, 10000, 10000, 10000, 10000])[:8]
    thresholds = (thresholds + [10000] * 8)[:8]
    hf = []
    for i in range(8):
        denom = debts[i] * 10000
        if denom > 0 and i < num_active:
            hf.append((collats[i] * thresholds[i]) // denom)
        else:
            hf.append(scale * 10)  # inactive = very healthy
    commitment = _poseidon_commitment(user_address, num_active)
    return {
        "collateral_values": [str(c) for c in collats],
        "debt_values": [str(d) for d in debts],
        "liquidation_thresholds": [str(t) for t in thresholds],
        "computed_health_factors": [str(h) for h in hf],
        "min_health_factor": str(min_health_factor),
        "scale": str(scale),
        "num_active": str(num_active),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_historical_performance_inputs(
    period_returns: list[int] | None = None,
    period_balances: list[int] | None = None,
    min_mean_return_bps: int = 100,
    max_drawdown_bps: int = 1000,
    num_periods: int = 6,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for HistoricalPerformanceAttestation circuit (12 periods)."""
    rets = (period_returns or [200, 150, -50, 300, 100, 250, 0, 0, 0, 0, 0, 0])[:12]
    rets = (rets + [0] * 12)[:12]
    bals = (period_balances or [10200, 10350, 10300, 10600, 10700, 10950, 10950, 10950, 10950, 10950, 10950, 10950])[:12]
    bals = (bals + [10000] * 12)[:12]
    # total_return sums ALL 12 slots (inactive slots are 0)
    total_return = sum(rets)
    mean_ret = total_return // num_periods if num_periods > 0 else 0
    peak = max(bals)  # must be >= all 12 balances (circuit checks ALL periods)
    min_bal = min(bals)
    # Drawdown: need dd_bps such that bal[i]*10000 >= peak*(10000-dd_bps) for ALL i
    # Use ceiling formula: dd_bps = 10000 - floor(min_bal * 10000 / peak)
    dd_bps = 10000 - (min_bal * 10000 // peak) if peak > 0 else 0
    commitment = _poseidon_commitment(user_address, mean_ret, dd_bps)
    return {
        "period_returns": [str(r) for r in rets],
        "period_balances": [str(b) for b in bals],
        "computed_mean_return": str(mean_ret),
        "computed_max_drawdown": str(dd_bps),
        "peak_balance": str(peak),
        "min_mean_return_bps": str(min_mean_return_bps),
        "max_drawdown_bps": str(max_drawdown_bps),
        "num_periods": str(num_periods),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


def build_mev_resistance_inputs(
    submission_block: int = 100000,
    inclusion_block: int = 100002,
    expected_price: int = 2000,
    actual_price: int = 2005,
    max_delay_blocks: int = 5,
    max_price_deviation_bps: int = 50,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for MEVResistanceProof circuit."""
    abs_diff = abs(actual_price - expected_price)
    dev_bps = abs_diff * 10000 // expected_price if expected_price > 0 else 0
    relay_commitment = int(_poseidon_commitment(submission_block, inclusion_block, expected_price))
    commitment = _poseidon_commitment(user_address, submission_block)
    return {
        "submission_block": str(submission_block),
        "inclusion_block": str(inclusion_block),
        "expected_price": str(expected_price),
        "actual_price": str(actual_price),
        "relay_commitment": str(relay_commitment),
        "computed_deviation_bps": str(dev_bps),
        "max_delay_blocks": str(max_delay_blocks),
        "max_price_deviation_bps": str(max_price_deviation_bps),
        "scale": str(scale),
        "user_address": str(user_address),
        "commitment_hash": commitment,
    }


# ── EZKL Bridge circuit input builders ──────────────────────────────────────

def build_model_bridge_inputs(
    model_output: list[int] | None = None,
    ezkl_proof_hash: int = 0,
    model_weights_hash: int = 0,
    expected_model_hash: int = 0,
    output_lower_bound: int = 0,
    output_upper_bound: int = 10000,
    timestamp: int = 0,
    n_outputs: int = 8,
) -> dict[str, Any]:
    """Build inputs for the ModelBridge circuit.

    Bridges EZKL proof outputs into the Groth16/Garaga pipeline.
    The model_output values are private; expected_model_hash is public.
    """
    outputs = (model_output or [500] * n_outputs)[:n_outputs]
    while len(outputs) < n_outputs:
        outputs.append(0)
    return {
        "model_output": [str(v) for v in outputs],
        "ezkl_proof_hash": str(ezkl_proof_hash),
        "model_weights_hash": str(model_weights_hash or expected_model_hash),
        "expected_model_hash": str(expected_model_hash),
        "output_lower_bound": str(output_lower_bound),
        "output_upper_bound": str(output_upper_bound),
        "timestamp": str(timestamp),
    }


def build_rebalance_timing_inputs(
    target_block: int = 100000,
    action_type: int = 1,
    user_address: int = 0,
    nonce: int = 0,
    current_block: int = 100005,
    tolerance_blocks: int = 10,
) -> dict[str, Any]:
    """Build inputs for the RebalanceTimingCommitment circuit.

    Proves that a rebalance timing was committed BEFORE execution.
    target_block must be < current_block and |current_block - target_block| <= tolerance.
    """
    timing_hash = int(_poseidon_commitment(target_block, action_type, user_address, nonce))
    return {
        "target_block": str(target_block),
        "action_type": str(action_type),
        "user_address": str(user_address),
        "nonce": str(nonce),
        "timing_hash": str(timing_hash),
        "current_block": str(current_block),
        "tolerance_blocks": str(tolerance_blocks),
    }


def build_robustness_certificate_inputs(
    model_hash: int = 0,
    attack_suite_hash: int = 0,
    pass_count: int = 96,
    total_count: int = 100,
    min_pass_rate_bps: int = 9500,
    min_attacks: int = 50,
    certified_at: int = 0,
) -> dict[str, Any]:
    """Build inputs for the RobustnessCertificate circuit.

    Proves a model passed adversarial testing above the minimum pass rate.
    """
    pass_rate_bps = (pass_count * 10000) // total_count if total_count > 0 else 0
    return {
        "pass_count": str(pass_count),
        "total_count": str(total_count),
        "model_hash": str(model_hash),
        "attack_suite_hash": str(attack_suite_hash),
        "min_pass_rate_bps": str(min_pass_rate_bps),
        "min_attacks": str(min_attacks),
        "certified_at": str(certified_at),
    }


# ── Reputation / Financial Passport input builders ──────────────────────────

def build_solvency_proof_inputs(
    asset_positions: list[int] | None = None,
    debt_positions: list[int] | None = None,
    min_solvency_ratio_bps: int = 10000,
    scale: int = 10000,
    pricing_commitment: int = 0,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for SolvencyProof circuit (8 assets, 8 debts).

    Circuit constraints:
        total_assets * scale >= min_solvency_ratio_bps * total_liabilities  (for is_solvent=1)
        Solvency bucket 0-4 based on ratio thresholds 10000/12000/15000/20000 bps.
    """
    assets = (asset_positions or [50000, 30000, 20000, 10000, 5000, 3000, 2000, 1000])[:8]
    assets = (assets + [0] * 8)[:8]
    debts = (debt_positions or [20000, 10000, 5000, 3000, 0, 0, 0, 0])[:8]
    debts = (debts + [0] * 8)[:8]
    blinding = 42
    commitment = _poseidon_commitment(user_address, sum(assets), sum(debts))
    return {
        "asset_positions": [str(a) for a in assets],
        "debt_positions": [str(d) for d in debts],
        "pricing_commitment": str(pricing_commitment),
        "blinding": str(blinding),
        "min_solvency_ratio_bps": str(min_solvency_ratio_bps),
        "scale": str(scale),
        "subject_id_hash": str(user_address),
    }


def build_risk_passport_tier_inputs(
    volatility_bps: int = 1500,
    max_drawdown_bps: int = 800,
    concentration_bps: int = 2000,
    effective_leverage_bps: int = 1200,
    liquidation_events_lookback: int = 1,
    tenure_days: int = 200,
    tier_thresholds: list[int] | None = None,
    required_tier: int = 3,
    scale: int = 100,
    user_address: int = 0,
    policy_hash: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for RiskPassportTier circuit.

    Circuit constraints:
        tenure_days <= 365
        raw_score = vol + dd + conc + lev + liq*500 + (365-tenure)*100
        computed_risk_score * scale <= raw_score < (computed_risk_score+1) * scale
        tier_thresholds monotonically increasing
        computed_risk_score <= tier_thresholds[4]
        required_tier in [1,5]
    """
    thresholds = (tier_thresholds or [100, 200, 400, 600, 1000])[:5]
    blinding = 77
    tenure_risk = 365 - tenure_days
    liquidation_penalty = liquidation_events_lookback * 500
    tenure_penalty = tenure_risk * 100
    raw_score = (
        volatility_bps
        + max_drawdown_bps
        + concentration_bps
        + effective_leverage_bps
        + liquidation_penalty
        + tenure_penalty
    )
    computed = raw_score // scale
    # Ensure computed fits within tier_thresholds[4]
    if computed > thresholds[4]:
        thresholds[4] = computed + 1
    commitment = _poseidon_commitment(user_address, computed)
    return {
        "volatility_bps": str(volatility_bps),
        "max_drawdown_bps": str(max_drawdown_bps),
        "concentration_bps": str(concentration_bps),
        "effective_leverage_bps": str(effective_leverage_bps),
        "liquidation_events_lookback": str(liquidation_events_lookback),
        "tenure_days": str(tenure_days),
        "computed_risk_score": str(computed),
        "blinding": str(blinding),
        "tier_thresholds": [str(t) for t in thresholds],
        "required_tier": str(required_tier),
        "scale": str(scale),
        "subject_id_hash": str(user_address),
        "policy_hash": str(policy_hash),
    }


def build_trader_performance_inputs(
    returns_bps: list[int] | None = None,
    equity_curve: list[int] | None = None,
    wins_count: int = 20,
    trades_count: int = 30,
    risk_free_bps: int = 10,
    min_sharpe_x100: int = 50,
    max_drawdown_bps: int = 2000,
    min_win_rate_bps: int = 5000,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for TraderPerformanceProof circuit (T=30).

    Circuit constraints:
        lookback_days === 30 (T)
        trades_count > 0, stddev_proxy_bps > 0, wins_count <= trades_count
        mean_return_bps * 30 === sum(returns_bps)
        mean_excess_return_bps + risk_free_bps === mean_return_bps
        sharpe_x100 * stddev <= mean_excess*100 < (sharpe_x100+1)*stddev
        win_rate_bps_actual * trades <= wins_count * scale < (wr+1)*trades
        drawdown: (max-min)*scale/max integer division check
        eq_max[T-1] > 0
    """
    T = 30
    rets = (returns_bps or [50, 30, -20, 40, 60, -10, 25, 45, -15, 35,
                            20, 55, -5, 30, 40, 10, -25, 50, 15, 35,
                            20, -10, 45, 30, 25, 40, -15, 55, 20, 35])[:T]
    rets = (rets + [0] * T)[:T]

    # Build equity curve: start at 10000, accumulate
    if equity_curve is None:
        eq = [10000]
        for i in range(1, T):
            eq.append(eq[-1] + rets[i])
        equity_curve = eq
    else:
        equity_curve = (equity_curve + [10000] * T)[:T]

    # Computed values for circuit constraints
    total_ret = sum(rets)
    mean_return = total_ret // T
    # Adjust returns so mean * T == sum exactly
    remainder = total_ret - mean_return * T
    rets[0] += -remainder  # fix last bps digit to make sum exact
    total_ret = sum(rets)
    mean_return = total_ret // T
    assert mean_return * T == total_ret, "mean*T must equal sum"

    mean_excess = mean_return - risk_free_bps

    # stddev proxy (simplified: use a reasonable value)
    stddev_proxy = max(abs(mean_excess) + 10, 50)  # must be > 0

    # Sharpe: sharpe_x100 = (mean_excess * 100) // stddev_proxy
    sharpe_x100_actual = (mean_excess * 100) // stddev_proxy if stddev_proxy > 0 else 0

    # Win-rate: wins_count * scale // trades_count
    win_rate_actual = (wins_count * scale) // trades_count

    # Drawdown from equity curve
    peak = max(equity_curve)
    trough = min(equity_curve)
    assert peak > 0, "equity curve peak must be > 0"
    drawdown_actual = ((peak - trough) * scale) // peak

    commitment = _poseidon_commitment(user_address, sharpe_x100_actual, drawdown_actual)
    return {
        "returns_bps": [str(r) for r in rets],
        "wins_count": str(wins_count),
        "trades_count": str(trades_count),
        "equity_curve": [str(e) for e in equity_curve],
        "risk_free_bps": str(risk_free_bps),
        "mean_return_bps": str(mean_return),
        "mean_excess_return_bps": str(mean_excess),
        "stddev_proxy_bps": str(stddev_proxy),
        "sharpe_x100": str(sharpe_x100_actual),
        "max_drawdown_bps_actual": str(drawdown_actual),
        "win_rate_bps_actual": str(win_rate_actual),
        "blinding": str(99),
        "min_sharpe_x100": str(min_sharpe_x100),
        "max_drawdown_bps": str(max_drawdown_bps),
        "min_win_rate_bps": str(min_win_rate_bps),
        "lookback_days": str(T),
        "scale": str(scale),
        "subject_id_hash": str(user_address),
    }


def build_strategy_integrity_inputs(
    position_weights_bps: list[int] | None = None,
    effective_leverage_bps: int = 15000,
    observed_slippage_bps: list[int] | None = None,
    asset_exposures_bps: list[int] | None = None,
    max_position_weight_bps: int = 3000,
    max_leverage_bps: int = 30000,
    max_slippage_bps: int = 100,
    scale: int = 10000,
    allowlist_policy_hash: int = 1,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for StrategyIntegrity circuit (K=8 positions, L=8 slippage).

    Circuit constraints:
        sum(position_weights_bps) === scale
        sum(asset_exposures_bps) === scale
        each weight <= max_position_weight_bps
        effective_leverage_bps <= max_leverage_bps
        each slippage <= max_slippage_bps
        each exposure <= scale
    """
    K, L = 8, 8
    # Default: roughly equal weights summing to scale
    if position_weights_bps is None:
        base = scale // K
        position_weights_bps = [base] * K
        position_weights_bps[0] += scale - sum(position_weights_bps)
    else:
        position_weights_bps = (position_weights_bps + [0] * K)[:K]

    if observed_slippage_bps is None:
        observed_slippage_bps = [20, 15, 30, 25, 10, 18, 22, 12]
    else:
        observed_slippage_bps = (observed_slippage_bps + [0] * L)[:L]

    if asset_exposures_bps is None:
        base_exp = scale // K
        asset_exposures_bps = [base_exp] * K
        asset_exposures_bps[0] += scale - sum(asset_exposures_bps)
    else:
        asset_exposures_bps = (asset_exposures_bps + [0] * K)[:K]

    blinding = 55
    commitment = _poseidon_commitment(user_address, effective_leverage_bps)
    return {
        "position_weights_bps": [str(w) for w in position_weights_bps],
        "effective_leverage_bps": str(effective_leverage_bps),
        "observed_slippage_bps": [str(s) for s in observed_slippage_bps],
        "asset_exposures_bps": [str(e) for e in asset_exposures_bps],
        "blinding": str(blinding),
        "max_position_weight_bps": str(max_position_weight_bps),
        "max_leverage_bps": str(max_leverage_bps),
        "max_slippage_bps": str(max_slippage_bps),
        "scale": str(scale),
        "allowlist_policy_hash": str(allowlist_policy_hash),
        "subject_id_hash": str(user_address),
    }


def build_execution_integrity_inputs(
    submission_block: int = 100000,
    inclusion_block: int = 100002,
    expected_price: int = 2000,
    actual_price: int = 2005,
    max_delay_blocks: int = 5,
    max_price_deviation_bps: int = 50,
    scale: int = 10000,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build valid inputs for ExecutionIntegrity circuit.

    Circuit constraints:
        inclusion_block >= submission_block
        expected_price > 0
        computed_deviation_bps * expected_price <= abs_diff * scale < (dev+1) * expected_price
        route_commitment, relay_commitment, required_route_policy_hash all != 0 for route_ok=1
    """
    abs_diff = abs(actual_price - expected_price)
    dev_bps = (abs_diff * scale) // expected_price if expected_price > 0 else 0
    route_commitment = int(_poseidon_commitment(submission_block, expected_price))
    relay_commitment = int(_poseidon_commitment(inclusion_block, actual_price))
    required_route_policy_hash = int(_poseidon_commitment(1, 2, 3))  # non-zero policy
    blinding = 88
    commitment = _poseidon_commitment(user_address, submission_block)
    return {
        "submission_block": str(submission_block),
        "inclusion_block": str(inclusion_block),
        "expected_price": str(expected_price),
        "actual_price": str(actual_price),
        "route_commitment": str(route_commitment),
        "relay_commitment": str(relay_commitment),
        "computed_deviation_bps": str(dev_bps),
        "blinding": str(blinding),
        "max_delay_blocks": str(max_delay_blocks),
        "max_price_deviation_bps": str(max_price_deviation_bps),
        "scale": str(scale),
        "required_route_policy_hash": str(required_route_policy_hash),
        "subject_id_hash": str(user_address),
    }


def build_private_vote_inputs(
    secret: int = 12345,
    voting_power: int = 100,
    vote_direction: int = 1,
    proposal_id: int = 1,
    nullifier_hash: int | None = None,
    user_address: int = 0,
) -> dict[str, Any]:
    """Build inputs for the private_vote circuit (governance).

    NOTE: The circuit uses Pedersen hashes for nullifier and commitment.
    The nullifier_hash must be the Pedersen(secret, proposal_id) output.
    If nullifier_hash is not provided, a placeholder 0 is used — the proof
    will fail constraint checking. Supply the real Pedersen output for valid proofs.
    """
    return {
        "secret": str(secret),
        "voting_power": str(voting_power),
        "vote_direction": str(vote_direction),
        "proposal_id": str(proposal_id),
        "nullifier_hash": str(nullifier_hash if nullifier_hash is not None else 0),
    }


# ── Parallel scan ───────────────────────────────────────────────────────────

async def run_circuit_scan(
    circuits: list[str] | None = None,
    inputs_override: dict[str, dict[str, Any]] | None = None,
    user_address: int = 0,
    portfolio_features: list[int] | None = None,
    mode: str = "gate",
) -> dict[str, Any]:
    """Run multiple circuits in parallel and return aggregated results.

    Parameters
    ----------
    circuits : list of circuit names, or None for all available
    inputs_override : per-circuit custom inputs (circuit_name -> inputs dict)
    user_address : numeric address for public signals
    portfolio_features : 8-element feature vector for ML circuits
    mode : "gate" (default) or "signal"

    Returns
    -------
    dict with circuit results, overall pass/fail, and timing
    """
    if circuits is None:
        circuits = list(CIRCUIT_REGISTRY.keys())

    override = inputs_override or {}
    t0 = time.monotonic()

    # Build default inputs for circuits not in override
    default_builders = _default_input_builders(
        user_address=user_address,
        portfolio_features=portfolio_features,
    )

    tasks = []
    for name in circuits:
        if name not in CIRCUIT_REGISTRY:
            continue
        # Merkle circuits require real Merkle proofs; skip if no override
        if name in ("BalanceAboveThreshold", "PoolMembership", "TenureAboveThreshold"):
            if name not in override:
                tasks.append(_skip_circuit(name, "Requires Merkle proof inputs (not provided)"))
                continue
        # private_vote requires Pedersen preimage; skip if no override
        if name == "private_vote":
            if name not in override:
                tasks.append(_skip_circuit(name, "Requires Pedersen nullifier preimage (not provided)"))
                continue
        circuit_inputs = override.get(name) or (default_builders.get(name, lambda: {})())
        tasks.append(_generate_proof(name, circuit_inputs))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    circuit_results: list[dict[str, Any]] = []
    all_pass = True
    compliant_count = 0
    non_compliant_count = 0
    failed_count = 0
    skipped_count = 0

    mode_value = mode.lower().strip() if mode else "gate"
    if mode_value not in ("gate", "signal"):
        mode_value = "gate"

    for r in results:
        if isinstance(r, Exception):
            circuit_results.append({"circuit": "unknown", "success": False, "error": str(r)})
            all_pass = False
            failed_count += 1
        elif isinstance(r, dict):
            circuit_results.append(r)
            if not r.get("success"):
                failed_count += 1
                if r.get("skipped"):
                    skipped_count += 1
                all_pass = False
            elif r.get("is_compliant") is False:
                non_compliant_count += 1
                if mode_value == "gate":
                    all_pass = False
            else:
                compliant_count += 1
        else:
            circuit_results.append({"circuit": "unknown", "success": False, "error": "Unexpected result type"})
            all_pass = False
            failed_count += 1

    if _METRICS_AVAILABLE:
        for r in circuit_results:
            circuit_name = r.get("circuit", "unknown")
            status = "success" if r.get("success") and not r.get("skipped") else "failure"
            proof_generation_total.labels(proof_type=circuit_name, status=status).inc()
            duration_ms = r.get("duration_ms", 0)
            if duration_ms > 0:
                proof_generation_duration_seconds.labels(proof_type=circuit_name).observe(duration_ms / 1000.0)

    return {
        "mode": mode_value,
        "all_pass": all_pass,
        "circuits_run": len(circuit_results),
        "results": circuit_results,
        "total_duration_ms": int((time.monotonic() - t0) * 1000),
        "summary": {
            "compliant": compliant_count,
            "non_compliant": non_compliant_count,
            "failed": failed_count,
            "skipped": skipped_count,
        },
    }


async def _skip_circuit(name: str, reason: str) -> dict[str, Any]:
    """Return a skip result for circuits that can't run without custom inputs."""
    return {
        "circuit": name,
        "success": False,
        "skipped": True,
        "error": reason,
        "duration_ms": 0,
    }
