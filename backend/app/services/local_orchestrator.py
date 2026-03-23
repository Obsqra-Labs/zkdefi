"""
Local Agent Orchestrator for zkde.fi

This orchestrator owns all agent logic, models, and execution.
Only uses obsqra.fi for heavy proof computation (STONE).

Architecture:
- zkde.fi: Agents, Models, Orchestration, Decision Logic
- obsqra.fi: Cloud prover (STONE proofs only)
"""

import asyncio
import logging
import os
import time
from collections import defaultdict
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field

from app.services.zkml_risk_service import get_risk_service, RiskScoreModel
from app.services.zkml_correlation_service import get_correlation_service
from app.services.zkml_twap_service import get_twap_service
from app.services.zkml_diversification_service import get_diversification_service
from app.services.obsqra_prover_client import get_obsqra_prover
from app.services.risc_zero_credit_service import get_risc_zero_credit_service
from app.services.double_entry_ledger import DoubleEntryLedger
from app.services.zkml.circuit_scanner import (
    build_anomaly_detector_inputs,
    build_il_predictor_inputs,
    build_yield_optimality_inputs,
    build_slippage_bound_inputs,
)

logger = logging.getLogger(__name__)


@dataclass
class ProcessorResult:
    """Result from a single processor."""
    processor_id: str
    passed: bool
    score: Optional[int] = None
    threshold: Optional[int] = None
    proof_calldata: Optional[List[str]] = None
    public_signals: Optional[List[str]] = None
    error: Optional[str] = None
    execution_time_ms: int = 0


@dataclass
class OrchestratorResult:
    """Final result from orchestrator."""
    should_execute: bool
    decision_logic: str
    processor_results: List[ProcessorResult] = field(default_factory=list)
    combined_proof: Optional[str] = None
    execution_calldata: Optional[List[str]] = None
    total_time_ms: int = 0


# Built-in model registry - zkde.fi owns these (22 zkML models)
MODELS = {
    "risk_scoring": {
        "id": "risk_scoring",
        "name": "Risk Score",
        "description": "Privacy-preserving risk assessment",
        "type": "groth16",
        "service": "zkml_risk_service",
        "timeout": 30.0,
        "default_threshold": 75,
    },
    "anomaly_detection": {
        "id": "anomaly_detection",
        "name": "Anomaly Detector",
        "description": "Detects anomalous trading patterns and behaviors",
        "type": "ezkl",
        "service": "zkml_anomaly_service",
        "timeout": 45.0,
        "default_threshold": 70,
    },
    "correlation_risk": {
        "id": "correlation_risk",
        "name": "Correlation Risk",
        "description": "Portfolio correlation risk analysis",
        "type": "groth16",
        "service": "zkml_correlation_service",
        "timeout": 30.0,
        "default_threshold": 80,
    },
    "twap_position": {
        "id": "twap_position",
        "name": "TWAP Position",
        "description": "Time-weighted average position verification",
        "type": "groth16",
        "service": "zkml_twap_service",
        "timeout": 30.0,
        "default_threshold": 100000,
    },
    "safety_diversification": {
        "id": "safety_diversification",
        "name": "Safety Diversification",
        "description": "Portfolio diversification check",
        "type": "groth16",
        "service": "zkml_diversification_service",
        "timeout": 30.0,
        "default_threshold": 50,
    },
    "credit_scoring": {
        "id": "credit_scoring",
        "name": "Credit Scoring",
        "description": "Cross-chain credit assessment with neural network",
        "type": "risc_zero",
        "service": "risc_zero_credit_service",
        "timeout": 300.0,
        "default_threshold": 600,
    },
    "yield_forecast": {
        "id": "yield_forecast",
        "name": "Yield Forecast",
        "description": "ML-based yield prediction for strategies",
        "type": "ezkl",
        "service": "zkml_yield_service",
        "timeout": 60.0,
        "default_threshold": 5,
    },
    "impermanent_loss": {
        "id": "impermanent_loss",
        "name": "Impermanent Loss Predictor",
        "description": "Predicts IL within tolerance bounds",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 30.0,
        "default_threshold": 80,
    },
    "yield_optimality": {
        "id": "yield_optimality",
        "name": "Yield Optimality",
        "description": "Proves allocation is near-optimal yield",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 30.0,
        "default_threshold": 85,
    },
    "slippage_bound": {
        "id": "slippage_bound",
        "name": "Slippage Bound",
        "description": "Proves trade slippage within bounds",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 25.0,
        "default_threshold": 90,
    },
    "cross_protocol_arb": {
        "id": "cross_protocol_arb",
        "name": "Cross-Protocol Arbitrage",
        "description": "Proves cross-protocol arb is profitable after fees",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 45.0,
        "default_threshold": 75,
    },
    "liquidation_risk": {
        "id": "liquidation_risk",
        "name": "Liquidation Risk",
        "description": "Proves all positions have healthy collateral ratios",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 40.0,
        "default_threshold": 85,
    },
    "mev_resistance": {
        "id": "mev_resistance",
        "name": "MEV Resistance",
        "description": "Proves transaction was not subject to MEV",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 35.0,
        "default_threshold": 95,
    },
    "agent_reputation": {
        "id": "agent_reputation",
        "name": "Agent Reputation",
        "description": "Proves agent reputation meets minimum threshold",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 30.0,
        "default_threshold": 70,
    },
    "historical_performance": {
        "id": "historical_performance",
        "name": "Historical Performance",
        "description": "Proves historical performance attestation",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 50.0,
        "default_threshold": 60,
    },
    "model_bridge": {
        "id": "model_bridge",
        "name": "Model Bridge",
        "description": "Bridges EZKL ML proofs into Groth16 pipeline",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 60.0,
        "default_threshold": 100,
    },
    "rebalance_timing": {
        "id": "rebalance_timing",
        "name": "Rebalance Timing",
        "description": "Proves rebalance timing was committed before execution",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 35.0,
        "default_threshold": 90,
    },
    "robustness_cert": {
        "id": "robustness_cert",
        "name": "Robustness Certificate",
        "description": "Proves model passed adversarial testing above threshold",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 45.0,
        "default_threshold": 80,
    },
    "solvency_proof": {
        "id": "solvency_proof",
        "name": "Solvency Proof",
        "description": "Proves assets exceed liabilities",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 30.0,
        "default_threshold": 100,
    },
    "risk_passport": {
        "id": "risk_passport",
        "name": "Risk Passport Tier",
        "description": "Assigns risk tier 1-5 from weighted metrics",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 40.0,
        "default_threshold": 3,
    },
    "trader_performance": {
        "id": "trader_performance",
        "name": "Trader Performance",
        "description": "Proves Sharpe, drawdown, win-rate thresholds",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 50.0,
        "default_threshold": 70,
    },
    "strategy_integrity": {
        "id": "strategy_integrity",
        "name": "Strategy Integrity",
        "description": "Proves strategy constraints compliance",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 35.0,
        "default_threshold": 100,
    },
    "execution_integrity": {
        "id": "execution_integrity",
        "name": "Execution Integrity",
        "description": "Proves trade execution met constraints",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 40.0,
        "default_threshold": 100,
    },
    "private_vote": {
        "id": "private_vote",
        "name": "Private Vote",
        "description": "Enables private on-chain voting with Pedersen commitment",
        "type": "groth16",
        "service": "circuit_service",
        "timeout": 60.0,
        "default_threshold": 1,
    },
}


def _le(score, threshold):
    """score <= threshold (lower is better)."""
    return score <= threshold


def _ge(score, threshold):
    """score >= threshold (higher is better)."""
    return score >= threshold


def _anomaly_inputs(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> list[float]:
    """Build anomaly detection input vector from portfolio."""
    return [
        float(portfolio.get("tvl_volatility", 10)),
        float(portfolio.get("liquidity_concentration", 20)),
        float(portfolio.get("price_impact", 5)),
        float(portfolio.get("deployer_age_days", 365)),
        float(portfolio.get("volume_anomaly", 3)),
        float(portfolio.get("contract_risk", 15)),
    ]


def _anomaly_local(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> int:
    inputs = _anomaly_inputs(portfolio, constraints)
    weights = [10, 10, 10, 10, 10, 10]
    return sum(int(v * w) for v, w in zip(inputs, weights)) // max(1, len(inputs))


def _yield_inputs(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> list[float]:
    """Build yield-forecast input vector."""
    allocs = portfolio.get("allocations", [25, 20, 15, 15, 10, 10, 3, 2])[:8]
    yields = portfolio.get("predicted_yields", [800, 600, 500, 450, 400, 350, 300, 250])[:8]
    return [float(v) for v in allocs + yields]


def _yield_local(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> int:
    allocs = portfolio.get("allocations", [25, 20, 15, 15, 10, 10, 3, 2])[:8]
    yields = portfolio.get("predicted_yields", [800, 600, 500, 450, 400, 350, 300, 250])[:8]
    total = sum(allocs) or 1
    return sum(a * y for a, y in zip(allocs, yields)) // total


def _il_inputs(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> list[float]:
    """Build impermanent-loss input vector."""
    return [
        float(portfolio.get("position_size", 10000)),
        float(portfolio.get("entry_price", 2000)),
        float(portfolio.get("current_price", 2200)),
        float(portfolio.get("fee_earned_bps", 150)),
    ]


def _il_local(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> int:
    entry = portfolio.get("entry_price", 2000)
    current = portfolio.get("current_price", 2200)
    if entry == 0:
        return 0
    import math
    ratio = current / entry
    il = 2 * math.sqrt(ratio) / (1 + ratio) - 1
    return int(abs(il) * 10000)  # basis points


def _optimality_inputs(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> list[float]:
    """Build yield-optimality input vector."""
    allocs = portfolio.get("allocations", [25, 20, 15, 15, 10, 10, 3, 2])[:8]
    yields = portfolio.get("predicted_yields", [800, 600, 500, 450, 400, 350, 300, 250])[:8]
    return [float(v) for v in allocs + yields]


def _optimality_local(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> int:
    allocs = portfolio.get("allocations", [25, 20, 15, 15, 10, 10, 3, 2])[:8]
    yields = portfolio.get("predicted_yields", [800, 600, 500, 450, 400, 350, 300, 250])[:8]
    total = sum(allocs) or 1
    weighted = sum(a * y for a, y in zip(allocs, yields)) // total
    max_y = max(yields) if yields else 1
    return (weighted * 100) // max_y if max_y else 0


def _slippage_inputs(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> list[float]:
    """Build slippage-bound input vector."""
    return [
        float(portfolio.get("trade_amount", 50000)),
        float(portfolio.get("current_liquidity", 5000000)),
        float(portfolio.get("price_impact_coefficient", 100)),
    ]


def _slippage_local(portfolio: Dict[str, Any], constraints: Dict[str, Any]) -> int:
    amount = portfolio.get("trade_amount", 50000)
    liquidity = portfolio.get("current_liquidity", 5000000)
    coeff = portfolio.get("price_impact_coefficient", 100)
    return (amount * coeff) // max(1, liquidity)


# Map of EZKL-wired processor IDs → config dicts used by _run_ezkl_processor
_EZKL_PROCESSORS: Dict[str, Dict[str, Any]] = {
    "anomaly_detection": {
        "constraint_key": "max_anomaly",
        "input_builder": _anomaly_inputs,
        "local_scorer": _anomaly_local,
        "comparator": _le,
    },
    "yield_forecast": {
        "constraint_key": "min_yield",
        "input_builder": _yield_inputs,
        "local_scorer": _yield_local,
        "comparator": _ge,
    },
    "impermanent_loss": {
        "constraint_key": "max_il_bps",
        "input_builder": _il_inputs,
        "local_scorer": _il_local,
        "comparator": _le,
    },
    "yield_optimality": {
        "constraint_key": "min_optimality",
        "input_builder": _optimality_inputs,
        "local_scorer": _optimality_local,
        "comparator": _ge,
    },
    "slippage_bound": {
        "constraint_key": "max_slippage_bps",
        "input_builder": _slippage_inputs,
        "local_scorer": _slippage_local,
        "comparator": _le,
    },
}


_LEDGER_DB = os.path.join(
    os.path.dirname(__file__), "..", "data", "vault_v2.db"
)
_shared_ledger: Optional[DoubleEntryLedger] = None


def _get_ledger() -> DoubleEntryLedger:
    """Shared ledger instance pointing at the same DB as vault_v2."""
    global _shared_ledger
    if _shared_ledger is None:
        os.makedirs(os.path.dirname(_LEDGER_DB), exist_ok=True)
        _shared_ledger = DoubleEntryLedger(_LEDGER_DB)
    return _shared_ledger


def _daily_positions_from_ledger(
    user_address: str, vault_id: Optional[str], token: str = "ETH", days: int = 7
) -> Optional[List[int]]:
    """Read the last *days* of ledger entries and derive per-day position values.

    Returns None when the ledger has no data for this vault so callers can
    fall back gracefully.
    """
    try:
        ledger = _get_ledger()
        vid = vault_id or user_address
        account = f"VAULT_AVAILABLE:{vid}:{token}"

        entries = ledger.entries(account, limit=200)
        if not entries:
            return None

        now = time.time()
        day_secs = 86_400
        buckets: Dict[int, int] = defaultdict(int)
        for entry in entries:
            age_days = int((now - entry["created_at"]) / day_secs)
            if 0 <= age_days < days:
                buckets[age_days] += entry["amount_wei"]

        if not buckets:
            current_balance = ledger.balance(account)
            if current_balance > 0:
                return [current_balance] * days
            return None

        return [buckets.get(d, 0) for d in range(days)]
    except Exception as exc:
        logger.warning("Failed to read daily positions from ledger: %s", exc)
        return None


class LocalOrchestrator:
    """
    Local orchestrator for zkde.fi agent execution.
    
    Runs all processor logic locally, only calls obsqra for STONE proofs.
    """
    
    def __init__(self):
        self.risk_service = None
        self.correlation_service = None
        self.twap_service = None
        self.diversification_service = None
        self.obsqra_prover = None
        self.risc_zero_credit = None
        self._initialized = False
    
    def _init_services(self):
        """Lazy initialization of services."""
        if self._initialized:
            return
        
        try:
            self.risk_service = get_risk_service()
        except Exception as e:
            logger.warning(f"Risk service not available: {e}")
        
        try:
            self.correlation_service = get_correlation_service()
        except Exception as e:
            logger.warning(f"Correlation service not available: {e}")
        
        try:
            self.twap_service = get_twap_service()
        except Exception as e:
            logger.warning(f"TWAP service not available: {e}")
        
        try:
            self.diversification_service = get_diversification_service()
        except Exception as e:
            logger.warning(f"Diversification service not available: {e}")
        
        try:
            self.risc_zero_credit = get_risc_zero_credit_service()
        except Exception as e:
            logger.warning(f"RISC Zero credit service not available: {e}")
        
        self.obsqra_prover = get_obsqra_prover()

        self.proof_pipeline = None
        try:
            from app.services.proof_pipeline import ProofPipeline
            self.proof_pipeline = ProofPipeline()
        except Exception as e:
            logger.warning(f"ProofPipeline not available: {e}")

        self._initialized = True
    
    def list_models(self) -> List[Dict[str, Any]]:
        """Return all available models."""
        return [
            {
                "id": m["id"],
                "name": m["name"],
                "description": m["description"],
                "type": m["type"],
                "timeout": m["timeout"],
            }
            for m in MODELS.values()
        ]
    
    def get_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get model by ID."""
        return MODELS.get(model_id)
    
    async def execute_agent(
        self,
        processors: List[str],
        decision_logic: Dict[str, Any],
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any]
    ) -> OrchestratorResult:
        """
        Execute a composed agent with multiple processors.
        
        Args:
            processors: List of processor IDs to run
            decision_logic: {"type": "AND"} or {"type": "OR"}
            user_address: User's address
            portfolio: Portfolio data
            constraints: User constraints (thresholds, limits)
            
        Returns:
            OrchestratorResult with all processor results and decision
        """
        self._init_services()
        start_time = time.time()
        
        # Run all processors in parallel
        tasks = [
            self._run_processor(proc_id, user_address, portfolio, constraints)
            for proc_id in processors
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        processor_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                processor_results.append(ProcessorResult(
                    processor_id=processors[i],
                    passed=False,
                    error=str(result)
                ))
            else:
                processor_results.append(result)
        
        # Apply decision logic
        logic_type = decision_logic.get("type", "AND").upper()
        
        if logic_type == "AND":
            should_execute = all(r.passed for r in processor_results)
        elif logic_type == "OR":
            should_execute = any(r.passed for r in processor_results)
        else:
            should_execute = all(r.passed for r in processor_results)
        
        # Combine proofs for on-chain verification
        execution_calldata = None
        if should_execute:
            execution_calldata = self._combine_calldata(processor_results)
        
        total_time = int((time.time() - start_time) * 1000)
        
        return OrchestratorResult(
            should_execute=should_execute,
            decision_logic=logic_type,
            processor_results=processor_results,
            execution_calldata=execution_calldata,
            total_time_ms=total_time
        )
    
    async def _run_processor(
        self,
        processor_id: str,
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any]
    ) -> ProcessorResult:
        """Run a single processor."""
        start_time = time.time()
        
        model = MODELS.get(processor_id)
        if not model:
            return ProcessorResult(
                processor_id=processor_id,
                passed=False,
                error=f"Unknown processor: {processor_id}"
            )
        
        try:
            if processor_id == "risk_scoring":
                result = await self._run_risk_scoring(user_address, portfolio, constraints)
            elif processor_id == "correlation_risk":
                result = await self._run_correlation_risk(user_address, portfolio, constraints)
            elif processor_id == "twap_position":
                result = await self._run_twap_position(user_address, portfolio, constraints)
            elif processor_id == "safety_diversification":
                result = await self._run_diversification(user_address, portfolio, constraints)
            elif processor_id == "credit_scoring":
                result = await self._run_credit_scoring(user_address, portfolio, constraints)
            elif processor_id in _EZKL_PROCESSORS:
                result = await self._run_ezkl_processor(processor_id, user_address, portfolio, constraints)
            else:
                return ProcessorResult(
                    processor_id=processor_id,
                    passed=False,
                    error=f"Circuit artifacts not available for {processor_id}"
                )
            
            result.execution_time_ms = int((time.time() - start_time) * 1000)
            return result
            
        except Exception as e:
            logger.error(f"Processor {processor_id} failed: {e}")
            return ProcessorResult(
                processor_id=processor_id,
                passed=False,
                error=str(e),
                execution_time_ms=int((time.time() - start_time) * 1000)
            )
    
    async def _run_risk_scoring(
        self,
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any]
    ) -> ProcessorResult:
        """Run risk scoring processor."""
        threshold = constraints.get("max_risk", 75)
        
        # Extract portfolio features
        features = self._extract_risk_features(portfolio)
        
        # Compute score locally
        score = RiskScoreModel.compute_risk_score(features)
        passed = score <= threshold
        
        # Generate proof if service available
        proof_calldata = None
        public_signals = None
        
        if self.risk_service and self.risk_service.circuits_ready:
            try:
                proof_result = await self.risk_service.generate_risk_proof(
                    user_address=user_address,
                    portfolio_features=features,
                    threshold=threshold
                )
                proof_calldata = proof_result.get("proof_calldata")
                public_signals = proof_result.get("public_signals")
            except Exception as e:
                logger.warning(f"Proof generation failed: {e}")
        
        return ProcessorResult(
            processor_id="risk_scoring",
            passed=passed,
            score=score,
            threshold=threshold,
            proof_calldata=proof_calldata,
            public_signals=public_signals
        )
    
    async def _run_correlation_risk(
        self,
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any]
    ) -> ProcessorResult:
        """Run correlation risk processor."""
        threshold = constraints.get("max_correlation", 80)
        
        # Extract positions
        positions = self._extract_positions(portfolio)
        
        # Compute correlation locally
        if self.correlation_service:
            from app.services.zkml_correlation_service import CorrelationRiskModel
            score = CorrelationRiskModel.compute_correlation_score(positions)
        else:
            # Simple fallback
            score = 50
        
        passed = score <= threshold
        
        return ProcessorResult(
            processor_id="correlation_risk",
            passed=passed,
            score=score,
            threshold=threshold
        )
    
    async def _run_twap_position(
        self,
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any]
    ) -> ProcessorResult:
        """Run TWAP position processor."""
        threshold = constraints.get("max_twap", 100000)
        
        # Read real positions from the double-entry ledger when available
        vault_id = portfolio.get("vault_id")
        token = portfolio.get("token", "ETH")
        ledger_positions = _daily_positions_from_ledger(
            user_address, vault_id, token=token
        )
        daily_positions = (
            portfolio.get("daily_positions")
            or ledger_positions
            or [0] * 7
        )
        
        if self.twap_service:
            from app.services.zkml_twap_service import TWAPModel
            twap = TWAPModel.compute_twap(daily_positions[:7] + [0] * (7 - len(daily_positions)))
        else:
            twap = sum(daily_positions) // len(daily_positions) if daily_positions else 0
        
        passed = twap <= threshold
        
        return ProcessorResult(
            processor_id="twap_position",
            passed=passed,
            score=twap,
            threshold=threshold
        )
    
    async def _run_diversification(
        self,
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any]
    ) -> ProcessorResult:
        """Run diversification processor."""
        threshold = constraints.get("min_diversification", 50)
        
        # Simple diversification score based on asset count
        assets = portfolio.get("assets", {})
        total_value = sum(assets.values()) if assets else 1
        
        if total_value > 0 and len(assets) > 0:
            max_position = max(assets.values())
            concentration = (max_position * 100) // total_value
            diversification = 100 - concentration
        else:
            diversification = 0
        
        passed = diversification >= threshold
        
        return ProcessorResult(
            processor_id="safety_diversification",
            passed=passed,
            score=diversification,
            threshold=threshold
        )
    
    async def _run_credit_scoring(
        self,
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any]
    ) -> ProcessorResult:
        """Run credit scoring via RISC Zero zkVM with neural network."""
        threshold = constraints.get("min_credit", 600)
        
        try:
            # Extract chain history from portfolio
            eth_history = portfolio.get("eth_history", {})
            starknet_history = portfolio.get("starknet_history", {})
            
            # If no chain history provided, create from portfolio assets
            if not eth_history and not starknet_history:
                assets = portfolio.get("assets", {})
                total_value = sum(assets.values())
                
                # Create synthetic history from portfolio
                starknet_history = {
                    "transaction_count": portfolio.get("transaction_count", 50),
                    "total_volume": total_value,
                    "first_tx_timestamp": portfolio.get("first_tx_timestamp", 0),
                    "successful_txns": portfolio.get("successful_txns", 45),
                    "failed_txns": portfolio.get("failed_txns", 5),
                    "protocol_count": len(assets),
                    "avg_position_size": total_value // max(1, len(assets)),
                    "max_position_size": max(assets.values()) if assets else 0,
                    "liquidation_count": portfolio.get("liquidation_count", 0),
                    "repayment_rate": portfolio.get("repayment_rate", 95),
                    "diversity_score": min(100, len(assets) * 20),
                    "tenure_days": portfolio.get("tenure_days", 90),
                }
            
            # Use RISC Zero service if available
            if self.risc_zero_credit:
                result = await self.risc_zero_credit.generate_credit_proof(
                    user_address=user_address,
                    eth_history=eth_history,
                    starknet_history=starknet_history,
                )
                
                credit_score = result.score
                passed = credit_score >= threshold
                
                # Get yield bonus based on tier
                yield_bonus = self.risc_zero_credit.tier_to_yield_bonus(result.tier)
                
                return ProcessorResult(
                    processor_id="credit_scoring",
                    passed=passed,
                    score=credit_score,
                    threshold=threshold,
                    proof_calldata=[result.proof] if result.proof else None,
                    public_signals=[result.tier, str(yield_bonus)] + result.factors,
                )
            else:
                # Fallback: simple credit score based on portfolio value
                total_value = sum(portfolio.get("assets", {}).values())
                credit_score = min(850, 300 + (total_value // 1000))
                passed = credit_score >= threshold
                
                return ProcessorResult(
                    processor_id="credit_scoring",
                    passed=passed,
                    score=credit_score,
                    threshold=threshold,
                )
            
        except Exception as e:
            logger.error(f"Credit scoring failed: {e}")
            return ProcessorResult(
                processor_id="credit_scoring",
                passed=False,
                error=str(e)
            )
    
    def _extract_risk_features(self, portfolio: Dict[str, Any]) -> List[int]:
        """Extract 8 risk features from portfolio."""
        assets = portfolio.get("assets", {})
        total = sum(assets.values()) if assets else 0
        
        # 8 features expected by risk model
        return [
            total // 100,  # total_balance (scaled)
            max(assets.values()) * 100 // total if total > 0 and assets else 50,  # concentration
            min(100, len(assets) * 20),  # diversity score
            portfolio.get("volatility", 50),
            portfolio.get("liquidity", 50),
            portfolio.get("time_in_position", 30),
            portfolio.get("drawdown", 10),
            portfolio.get("correlation", 30),
        ]
    
    def _extract_positions(self, portfolio: Dict[str, Any]) -> List[int]:
        """Extract 5 asset positions for correlation."""
        assets = portfolio.get("assets", {})
        
        # Map to 5-asset format
        from app.services.zkml_correlation_service import ASSET_INDEX, N_ASSETS
        
        positions = [0] * N_ASSETS
        for asset, value in assets.items():
            asset_upper = asset.upper()
            if asset_upper in ASSET_INDEX:
                idx = ASSET_INDEX[asset_upper]
                positions[idx] += value
        
        return positions
    
    async def _run_ezkl_processor(
        self,
        processor_id: str,
        user_address: str,
        portfolio: Dict[str, Any],
        constraints: Dict[str, Any],
    ) -> ProcessorResult:
        """Run a processor backed by EZKL proof via proof_pipeline.generate_ml_proofs()."""
        cfg = _EZKL_PROCESSORS.get(processor_id)
        if not cfg:
            return ProcessorResult(
                processor_id=processor_id,
                passed=False,
                error=f"No EZKL config for {processor_id}",
            )

        model = MODELS.get(processor_id, {})
        threshold = constraints.get(cfg["constraint_key"], model.get("default_threshold", 50))

        # Build input features from portfolio
        input_data = cfg["input_builder"](portfolio, constraints)

        if self.proof_pipeline:
            try:
                proof_result = await self.proof_pipeline.generate_ml_proofs(
                    user_address=user_address,
                    model_name=processor_id,
                    input_data=input_data,
                )
                can_execute = proof_result.get("can_execute", False)
                ezkl_proof = proof_result.get("ezkl_proof") or {}
                public_signals = ezkl_proof.get("public_signals")
                # Extract score from first public signal when available
                score = None
                if public_signals and len(public_signals) > 0:
                    try:
                        score = int(public_signals[0])
                    except (ValueError, TypeError):
                        pass

                passed = can_execute if score is None else cfg["comparator"](score, threshold)

                return ProcessorResult(
                    processor_id=processor_id,
                    passed=passed,
                    score=score,
                    threshold=threshold,
                    proof_calldata=proof_result.get("combined_calldata"),
                    public_signals=[str(s) for s in public_signals] if public_signals else None,
                )
            except Exception as e:
                logger.warning(f"EZKL proof for {processor_id} failed, running scoreless: {e}")

        # Fallback: compute a local estimate without proof
        score = cfg["local_scorer"](portfolio, constraints)
        passed = cfg["comparator"](score, threshold)

        return ProcessorResult(
            processor_id=processor_id,
            passed=passed,
            score=score,
            threshold=threshold,
        )

    async def run_llm_decision(
        self,
        llm_config: Dict[str, Any],
        processor_results: List[ProcessorResult],
        portfolio: Dict[str, Any],
        agent_skills: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Run an LLM decision step using the agent's bound provider.

        Returns a dict with keys: llm_decision, reasoning, tool_calls, model, provider, latency_ms.
        If the provider is deterministic or unavailable, returns a deterministic decision
        based on processor results only.
        """
        import json as _json

        provider = (llm_config.get("provider") or "deterministic").lower()
        if provider == "deterministic":
            return self._deterministic_decision(processor_results)

        try:
            from app.services.llm_provider_registry import get_llm_registry
            from app.services.agent_skill_service import AgentSkillService

            registry = get_llm_registry()
            skill_svc = AgentSkillService()

            # Build a concise summary of processor results for the LLM
            summary_lines = []
            for pr in processor_results:
                status = "PASS" if pr.passed else "FAIL"
                score_str = f" score={pr.score}" if pr.score is not None else ""
                thresh_str = f" threshold={pr.threshold}" if pr.threshold is not None else ""
                err_str = f" error={pr.error}" if pr.error else ""
                summary_lines.append(f"  {pr.processor_id}: {status}{score_str}{thresh_str}{err_str}")

            # Build messages
            system_msg = (
                "You are a DeFi risk agent operating on Starknet. "
                "Given ZK-verified processor results and portfolio context, "
                "decide whether to execute, hold, or rebalance. "
                "Respond with a JSON object: "
                '{\"decision\": \"execute\"|\"hold\"|\"rebalance\", \"reasoning\": \"...\"}. '
                "Only output valid JSON."
            )
            user_msg = (
                f"Processor results:\n"
                + "\n".join(summary_lines)
                + f"\n\nPortfolio summary: {_json.dumps({k: v for k, v in portfolio.items() if k in ('assets', 'total_value', 'positions')}, default=str)}"
            )

            messages = [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ]

            # Map agent_service provider ids to llm_provider_registry ids
            provider_map = {"openai": "openai_gpt", "local": "local_llm"}
            registry_provider = provider_map.get(provider, provider)

            llm_response = await registry.chat_completion(
                provider_id=registry_provider,
                messages=messages,
                model=llm_config.get("model"),
                temperature=llm_config.get("temperature"),
                max_tokens=llm_config.get("max_tokens"),
            )

            # Parse LLM response
            try:
                parsed = _json.loads(llm_response.content)
                decision = parsed.get("decision", "hold")
                reasoning = parsed.get("reasoning", "")
            except (_json.JSONDecodeError, TypeError):
                decision = "hold"
                reasoning = llm_response.content or "LLM returned non-JSON response"

            return {
                "llm_decision": decision,
                "reasoning": reasoning,
                "model": llm_response.model,
                "provider": llm_response.provider_id,
                "latency_ms": llm_response.latency_ms,
                "fallback_from": llm_response.fallback_from,
                "tool_calls": [],
            }

        except Exception as e:
            logger.warning(f"LLM decision failed, falling back to deterministic: {e}")
            result = self._deterministic_decision(processor_results)
            result["fallback_from"] = provider
            result["fallback_reason"] = str(e)
            return result

    @staticmethod
    def _deterministic_decision(processor_results: List[ProcessorResult]) -> Dict[str, Any]:
        """Deterministic decision based purely on processor pass/fail."""
        all_passed = all(pr.passed for pr in processor_results)
        any_failed = any(not pr.passed for pr in processor_results)
        return {
            "llm_decision": "execute" if all_passed else "hold",
            "reasoning": (
                "All processors passed — safe to execute."
                if all_passed
                else f"{sum(1 for p in processor_results if not p.passed)} processor(s) failed — holding."
            ),
            "model": "deterministic-v1",
            "provider": "deterministic",
            "latency_ms": 0,
            "fallback_from": None,
            "tool_calls": [],
        }

    def _combine_calldata(self, results: List[ProcessorResult]) -> List[str]:
        """Combine all proof calldata for on-chain verification."""
        combined = []
        
        # Number of proofs
        combined.append(str(len(results)))
        
        for result in results:
            if result.proof_calldata:
                # Proof length + calldata
                combined.append(str(len(result.proof_calldata)))
                combined.extend(result.proof_calldata)
            else:
                # No proof, just pass/fail flag
                combined.append("0")
                combined.append("1" if result.passed else "0")
        
        return combined


# Singleton
_orchestrator: Optional[LocalOrchestrator] = None


def get_local_orchestrator() -> LocalOrchestrator:
    """Get or create the local orchestrator singleton."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = LocalOrchestrator()
    return _orchestrator
