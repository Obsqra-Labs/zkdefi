"""
Agent Skill Service — Maps ZK circuits to LLM-callable tools.

Each circuit is exposed as a "skill" that LLM agents can invoke.
The service handles:
  1. Skill discovery — list available skills for an agent
  2. Input preparation — build circuit inputs from LLM-provided parameters
  3. Proof generation — run the circuit via circuit_scanner
  4. Result formatting — return structured results for LLM consumption

Skills are the bridge between natural-language LLM decisions
and verifiable ZK proof generation.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from .zkml.circuit_scanner import (
    CIRCUIT_REGISTRY,
    _generate_proof,
    ProofGenerationError,
    build_il_predictor_inputs,
    build_yield_optimality_inputs,
    build_slippage_bound_inputs,
    build_agent_reputation_inputs,
    build_cross_protocol_arb_inputs,
    build_liquidation_risk_inputs,
    build_historical_performance_inputs,
    build_mev_resistance_inputs,
    build_risk_score_inputs,
    build_anomaly_detector_inputs,
    build_correlation_risk_inputs,
    build_twap_position_inputs,
    build_safety_diversification_inputs,
)

logger = logging.getLogger(__name__)


@dataclass
class SkillDefinition:
    """Describes a skill for LLM tool-use integration."""
    skill_id: str
    name: str
    description: str
    category: str
    parameters: dict[str, Any]          # JSON Schema for LLM function-calling
    circuit_name: str                   # Maps to CIRCUIT_REGISTRY key
    input_builder: str                  # Name of the build_*_inputs function
    requires_reputation_tier: int       # Minimum tier (0=any, 1=Standard, 2=Express)


# ── Skill Definitions ────────────────────────────────────────────────────────

SKILL_DEFINITIONS: dict[str, SkillDefinition] = {
    "il_predictor": SkillDefinition(
        skill_id="il_predictor",
        name="Impermanent Loss Predictor",
        description="Predict if impermanent loss on an LP position is within tolerance. "
                   "Returns a ZK proof that IL is acceptable without revealing position details.",
        category="agent_skill",
        parameters={
            "type": "object",
            "properties": {
                "position_size": {"type": "integer", "description": "LP position size in base units"},
                "entry_price": {"type": "integer", "description": "Price when position was entered"},
                "current_price": {"type": "integer", "description": "Current market price"},
                "fee_earned_bps": {"type": "integer", "description": "Fees earned in bps"},
                "max_il_tolerance_bps": {"type": "integer", "description": "Maximum acceptable IL in bps (default 500)"},
            },
            "required": ["position_size", "entry_price", "current_price"],
        },
        circuit_name="ImpermanentLossPredictor",
        input_builder="build_il_predictor_inputs",
        requires_reputation_tier=0,
    ),
    "yield_optimality": SkillDefinition(
        skill_id="yield_optimality",
        name="Yield Optimality Check",
        description="Verify if the current allocation achieves near-optimal yield. "
                   "Proves allocation is within threshold of best possible yield.",
        category="agent_skill",
        parameters={
            "type": "object",
            "properties": {
                "allocations": {"type": "array", "items": {"type": "integer"}, "description": "Allocation per pool (up to 8)"},
                "predicted_yields": {"type": "array", "items": {"type": "integer"}, "description": "Predicted yield per pool in bps"},
                "optimality_threshold_bps": {"type": "integer", "description": "Max gap from optimal in bps (default 200)"},
            },
            "required": ["allocations", "predicted_yields"],
        },
        circuit_name="YieldOptimality",
        input_builder="build_yield_optimality_inputs",
        requires_reputation_tier=0,
    ),
    "slippage_bound": SkillDefinition(
        skill_id="slippage_bound",
        name="Slippage Bound Check",
        description="Verify trade slippage is within acceptable bounds before execution. "
                   "Proves slippage won't exceed limit without revealing trade size.",
        category="agent_skill",
        parameters={
            "type": "object",
            "properties": {
                "trade_amount": {"type": "integer", "description": "Trade size in base units"},
                "current_liquidity": {"type": "integer", "description": "Pool liquidity available"},
                "price_impact_coefficient": {"type": "integer", "description": "Impact coefficient"},
                "max_slippage_bps": {"type": "integer", "description": "Max slippage in bps (default 50)"},
            },
            "required": ["trade_amount", "current_liquidity"],
        },
        circuit_name="SlippageBound",
        input_builder="build_slippage_bound_inputs",
        requires_reputation_tier=0,
    ),
    "reputation_check": SkillDefinition(
        skill_id="reputation_check",
        name="Agent Reputation Score",
        description="Generate a zk proof that the agent's reputation meets a minimum threshold. "
                   "Proves reputation without revealing individual performance metrics.",
        category="agent_identity",
        parameters={
            "type": "object",
            "properties": {
                "metrics": {"type": "array", "items": {"type": "integer"}, "description": "Performance metrics [volume, success, fail, return, drawdown, tenure, proofs]"},
                "min_reputation_score": {"type": "integer", "description": "Minimum score 0-1000 (default 500)"},
            },
            "required": [],
        },
        circuit_name="AgentReputationScore",
        input_builder="build_agent_reputation_inputs",
        requires_reputation_tier=0,
    ),
    "arb_check": SkillDefinition(
        skill_id="arb_check",
        name="Cross-Protocol Arbitrage Check",
        description="Verify a cross-protocol arbitrage opportunity is profitable after all fees. "
                   "Proves profitability without revealing trade details.",
        category="agent_skill",
        parameters={
            "type": "object",
            "properties": {
                "source_price": {"type": "integer", "description": "Price at source DEX"},
                "dest_price": {"type": "integer", "description": "Price at destination DEX"},
                "source_fee_bps": {"type": "integer", "description": "Source swap fee in bps"},
                "dest_fee_bps": {"type": "integer", "description": "Dest swap fee in bps"},
                "gas_cost": {"type": "integer", "description": "Gas/bridging cost"},
                "trade_amount": {"type": "integer", "description": "Amount to trade"},
                "min_profit_bps": {"type": "integer", "description": "Minimum profit in bps (default 10)"},
            },
            "required": ["source_price", "dest_price", "trade_amount"],
        },
        circuit_name="CrossProtocolArbitrage",
        input_builder="build_cross_protocol_arb_inputs",
        requires_reputation_tier=1,
    ),
    "liquidation_check": SkillDefinition(
        skill_id="liquidation_check",
        name="Liquidation Risk Check",
        description="Verify all leveraged positions maintain healthy collateral ratios. "
                   "Proves no position is at risk of liquidation.",
        category="agent_skill",
        parameters={
            "type": "object",
            "properties": {
                "collateral_values": {"type": "array", "items": {"type": "integer"}, "description": "Collateral value per position"},
                "debt_values": {"type": "array", "items": {"type": "integer"}, "description": "Debt value per position"},
                "liquidation_thresholds": {"type": "array", "items": {"type": "integer"}, "description": "LTV thresholds in bps"},
                "num_active": {"type": "integer", "description": "Number of active positions"},
                "min_health_factor": {"type": "integer", "description": "Minimum health factor * 10000 (default 15000 = 1.5x)"},
            },
            "required": ["collateral_values", "debt_values"],
        },
        circuit_name="LiquidationRisk",
        input_builder="build_liquidation_risk_inputs",
        requires_reputation_tier=0,
    ),
    "performance_attestation": SkillDefinition(
        skill_id="performance_attestation",
        name="Historical Performance Attestation",
        description="Generate a zk proof that historical performance meets criteria. "
                   "Proves mean return and drawdown bounds without revealing period details.",
        category="agent_identity",
        parameters={
            "type": "object",
            "properties": {
                "period_returns": {"type": "array", "items": {"type": "integer"}, "description": "Return per period in bps (up to 12)"},
                "period_balances": {"type": "array", "items": {"type": "integer"}, "description": "Balance per period"},
                "min_mean_return_bps": {"type": "integer", "description": "Min mean return in bps (default 100)"},
                "max_drawdown_bps": {"type": "integer", "description": "Max drawdown in bps (default 1000)"},
                "num_periods": {"type": "integer", "description": "Number of periods (default 6)"},
            },
            "required": [],
        },
        circuit_name="HistoricalPerformanceAttestation",
        input_builder="build_historical_performance_inputs",
        requires_reputation_tier=1,
    ),
    "mev_protection": SkillDefinition(
        skill_id="mev_protection",
        name="MEV Resistance Proof",
        description="Verify a transaction was not subject to significant MEV extraction. "
                   "Proves transaction integrity without revealing block numbers or prices.",
        category="agent_skill",
        parameters={
            "type": "object",
            "properties": {
                "submission_block": {"type": "integer", "description": "Block when tx was submitted"},
                "inclusion_block": {"type": "integer", "description": "Block when tx was included"},
                "expected_price": {"type": "integer", "description": "Expected execution price"},
                "actual_price": {"type": "integer", "description": "Actual execution price"},
                "max_delay_blocks": {"type": "integer", "description": "Max acceptable block delay (default 5)"},
                "max_price_deviation_bps": {"type": "integer", "description": "Max price deviation in bps (default 50)"},
            },
            "required": ["submission_block", "inclusion_block", "expected_price", "actual_price"],
        },
        circuit_name="MEVResistanceProof",
        input_builder="build_mev_resistance_inputs",
        requires_reputation_tier=0,
    ),
    # Original ML circuits as skills
    "risk_score": SkillDefinition(
        skill_id="risk_score",
        name="Portfolio Risk Score",
        description="Calculate and prove portfolio risk score is below threshold.",
        category="ml_scoring",
        parameters={
            "type": "object",
            "properties": {
                "portfolio_features": {"type": "array", "items": {"type": "integer"}, "description": "8-element feature vector"},
                "threshold": {"type": "integer", "description": "Risk threshold (default 50)"},
            },
            "required": [],
        },
        circuit_name="RiskScore",
        input_builder="build_risk_score_inputs",
        requires_reputation_tier=0,
    ),
    "anomaly_detection": SkillDefinition(
        skill_id="anomaly_detection",
        name="Pool Anomaly Detection",
        description="Detect anomalies in a pool across 6 risk factors.",
        category="ml_scoring",
        parameters={
            "type": "object",
            "properties": {
                "tvl_volatility": {"type": "integer"},
                "liquidity_concentration": {"type": "integer"},
                "price_impact_score": {"type": "integer"},
                "pool_id": {"type": "integer"},
            },
            "required": [],
        },
        circuit_name="AnomalyDetector",
        input_builder="build_anomaly_detector_inputs",
        requires_reputation_tier=0,
    ),
}

# Map input builder names to functions
INPUT_BUILDERS: dict[str, Any] = {
    "build_il_predictor_inputs": build_il_predictor_inputs,
    "build_yield_optimality_inputs": build_yield_optimality_inputs,
    "build_slippage_bound_inputs": build_slippage_bound_inputs,
    "build_agent_reputation_inputs": build_agent_reputation_inputs,
    "build_cross_protocol_arb_inputs": build_cross_protocol_arb_inputs,
    "build_liquidation_risk_inputs": build_liquidation_risk_inputs,
    "build_historical_performance_inputs": build_historical_performance_inputs,
    "build_mev_resistance_inputs": build_mev_resistance_inputs,
    "build_risk_score_inputs": build_risk_score_inputs,
    "build_anomaly_detector_inputs": build_anomaly_detector_inputs,
    "build_correlation_risk_inputs": build_correlation_risk_inputs,
    "build_twap_position_inputs": build_twap_position_inputs,
    "build_safety_diversification_inputs": build_safety_diversification_inputs,
}


class AgentSkillService:
    """Service for managing and executing agent skills (ZK circuit tools)."""

    def __init__(self):
        self._skills = SKILL_DEFINITIONS.copy()

    def list_skills(
        self,
        category: str | None = None,
        max_tier: int = 2,
    ) -> list[dict[str, Any]]:
        """List available skills, optionally filtered by category and tier."""
        result = []
        for sid, skill in self._skills.items():
            if category and skill.category != category:
                continue
            if skill.requires_reputation_tier > max_tier:
                continue

            # Check if circuit artifacts exist
            circuit_meta = CIRCUIT_REGISTRY.get(skill.circuit_name)
            ready = False
            if circuit_meta:
                ready = circuit_meta["wasm"].exists() and circuit_meta["zkey"].exists()

            result.append({
                "skill_id": sid,
                "name": skill.name,
                "description": skill.description,
                "category": skill.category,
                "parameters": skill.parameters,
                "requires_tier": skill.requires_reputation_tier,
                "circuit_ready": ready,
            })
        return result

    def get_skill_tools_for_llm(
        self,
        agent_skills: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Generate OpenAI function-calling tool definitions for agent's skills.

        Returns a list suitable for the `tools` parameter of chat completion.
        """
        tools = []
        skill_ids = agent_skills or list(self._skills.keys())

        for sid in skill_ids:
            skill = self._skills.get(sid)
            if not skill:
                continue

            tools.append({
                "type": "function",
                "function": {
                    "name": f"zk_{sid}",
                    "description": skill.description,
                    "parameters": skill.parameters,
                },
            })

        return tools

    async def execute_skill(
        self,
        skill_id: str,
        params: dict[str, Any],
        user_address: int = 0,
    ) -> dict[str, Any]:
        """Execute a skill by generating a ZK proof.

        1. Looks up the skill definition
        2. Builds circuit inputs from provided params
        3. Generates Groth16 proof via circuit_scanner
        4. Returns structured result
        """
        skill = self._skills.get(skill_id)
        if not skill:
            return {"success": False, "error": f"Unknown skill: {skill_id}"}

        t0 = time.monotonic()

        # Build circuit inputs
        builder_fn = INPUT_BUILDERS.get(skill.input_builder)
        if not builder_fn:
            return {"success": False, "error": f"No input builder for skill: {skill_id}"}

        try:
            # Merge provided params with defaults
            build_kwargs = {"user_address": user_address}
            build_kwargs.update(params)
            circuit_inputs = builder_fn(**build_kwargs)
        except Exception as exc:
            return {"success": False, "error": f"Input preparation failed: {exc}"}

        # Generate proof
        try:
            proof_result = await _generate_proof(skill.circuit_name, circuit_inputs)
        except ProofGenerationError as exc:
            return {
                "skill_id": skill_id,
                "circuit_name": skill.circuit_name,
                "success": False,
                "error": str(exc),
                "duration_ms": int((time.monotonic() - t0) * 1000),
                "production_error": True,
            }

        duration = int((time.monotonic() - t0) * 1000)

        return {
            "skill_id": skill_id,
            "circuit_name": skill.circuit_name,
            "success": proof_result.get("success", False),
            "is_compliant": proof_result.get("is_compliant"),
            "proof_hash": proof_result.get("proof_hash"),
            "public_signals": proof_result.get("public_signals"),
            "duration_ms": duration,
            "error": proof_result.get("error"),
        }


# Module-level singleton
_skill_service: AgentSkillService | None = None


def get_skill_service() -> AgentSkillService:
    """Get or create the global skill service."""
    global _skill_service
    if _skill_service is None:
        _skill_service = AgentSkillService()
    return _skill_service
