# Source Generated with Decompyle++
# File: agent_skill_service.cpython-312.pyc (Python 3.12)

__doc__ = '\nAgent Skill Service — Maps ZK circuits to LLM-callable tools.\n\nEach circuit is exposed as a "skill" that LLM agents can invoke.\nThe service handles:\n  1. Skill discovery — list available skills for an agent\n  2. Input preparation — build circuit inputs from LLM-provided parameters\n  3. Proof generation — run the circuit via circuit_scanner\n  4. Result formatting — return structured results for LLM consumption\n\nSkills are the bridge between natural-language LLM decisions\nand verifiable ZK proof generation.\n'
from __future__ import annotations
import logging
import time
from dataclasses import dataclass
from typing import Any
from zkml.circuit_scanner import CIRCUIT_REGISTRY, _generate_proof, ProofGenerationError, build_il_predictor_inputs, build_yield_optimality_inputs, build_slippage_bound_inputs, build_agent_reputation_inputs, build_cross_protocol_arb_inputs, build_liquidation_risk_inputs, build_historical_performance_inputs, build_mev_resistance_inputs, build_risk_score_inputs, build_anomaly_detector_inputs, build_correlation_risk_inputs, build_twap_position_inputs, build_safety_diversification_inputs, build_solvency_proof_inputs, build_risk_passport_tier_inputs, build_trader_performance_inputs, build_strategy_integrity_inputs, build_execution_integrity_inputs
logger = logging.getLogger(__name__)
SkillDefinition = <NODE:12>()
SKILL_DEFINITIONS: 'dict[str, SkillDefinition]' = {
    'il_predictor': SkillDefinition(skill_id = 'il_predictor', name = 'Impermanent Loss Predictor', description = 'Predict if impermanent loss on an LP position is within tolerance. Returns a ZK proof that IL is acceptable without revealing position details.', category = 'agent_skill', parameters = {
        'type': 'object',
        'properties': {
            'position_size': {
                'type': 'integer',
                'description': 'LP position size in base units' },
            'entry_price': {
                'type': 'integer',
                'description': 'Price when position was entered' },
            'current_price': {
                'type': 'integer',
                'description': 'Current market price' },
            'fee_earned_bps': {
                'type': 'integer',
                'description': 'Fees earned in bps' },
            'max_il_tolerance_bps': {
                'type': 'integer',
                'description': 'Maximum acceptable IL in bps (default 500)' } },
        'required': [
            'position_size',
            'entry_price',
            'current_price'] }, circuit_name = 'ImpermanentLossPredictor', input_builder = 'build_il_predictor_inputs', requires_reputation_tier = 0),
    'yield_optimality': SkillDefinition(skill_id = 'yield_optimality', name = 'Yield Optimality Check', description = 'Verify if the current allocation achieves near-optimal yield. Proves allocation is within threshold of best possible yield.', category = 'agent_skill', parameters = {
        'type': 'object',
        'properties': {
            'allocations': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Allocation per pool (up to 8)' },
            'predicted_yields': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Predicted yield per pool in bps' },
            'optimality_threshold_bps': {
                'type': 'integer',
                'description': 'Max gap from optimal in bps (default 200)' } },
        'required': [
            'allocations',
            'predicted_yields'] }, circuit_name = 'YieldOptimality', input_builder = 'build_yield_optimality_inputs', requires_reputation_tier = 0),
    'slippage_bound': SkillDefinition(skill_id = 'slippage_bound', name = 'Slippage Bound Check', description = "Verify trade slippage is within acceptable bounds before execution. Proves slippage won't exceed limit without revealing trade size.", category = 'agent_skill', parameters = {
        'type': 'object',
        'properties': {
            'trade_amount': {
                'type': 'integer',
                'description': 'Trade size in base units' },
            'current_liquidity': {
                'type': 'integer',
                'description': 'Pool liquidity available' },
            'price_impact_coefficient': {
                'type': 'integer',
                'description': 'Impact coefficient' },
            'max_slippage_bps': {
                'type': 'integer',
                'description': 'Max slippage in bps (default 50)' } },
        'required': [
            'trade_amount',
            'current_liquidity'] }, circuit_name = 'SlippageBound', input_builder = 'build_slippage_bound_inputs', requires_reputation_tier = 0),
    'reputation_check': SkillDefinition(skill_id = 'reputation_check', name = 'Agent Reputation Score', description = "Generate a zk proof that the agent's reputation meets a minimum threshold. Proves reputation without revealing individual performance metrics.", category = 'agent_identity', parameters = {
        'type': 'object',
        'properties': {
            'metrics': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Performance metrics [volume, success, fail, return, drawdown, tenure, proofs]' },
            'min_reputation_score': {
                'type': 'integer',
                'description': 'Minimum score 0-1000 (default 500)' } },
        'required': [] }, circuit_name = 'AgentReputationScore', input_builder = 'build_agent_reputation_inputs', requires_reputation_tier = 0),
    'arb_check': SkillDefinition(skill_id = 'arb_check', name = 'Cross-Protocol Arbitrage Check', description = 'Verify a cross-protocol arbitrage opportunity is profitable after all fees. Proves profitability without revealing trade details.', category = 'agent_skill', parameters = {
        'type': 'object',
        'properties': {
            'source_price': {
                'type': 'integer',
                'description': 'Price at source DEX' },
            'dest_price': {
                'type': 'integer',
                'description': 'Price at destination DEX' },
            'source_fee_bps': {
                'type': 'integer',
                'description': 'Source swap fee in bps' },
            'dest_fee_bps': {
                'type': 'integer',
                'description': 'Dest swap fee in bps' },
            'gas_cost': {
                'type': 'integer',
                'description': 'Gas/bridging cost' },
            'trade_amount': {
                'type': 'integer',
                'description': 'Amount to trade' },
            'min_profit_bps': {
                'type': 'integer',
                'description': 'Minimum profit in bps (default 10)' } },
        'required': [
            'source_price',
            'dest_price',
            'trade_amount'] }, circuit_name = 'CrossProtocolArbitrage', input_builder = 'build_cross_protocol_arb_inputs', requires_reputation_tier = 1),
    'liquidation_check': SkillDefinition(skill_id = 'liquidation_check', name = 'Liquidation Risk Check', description = 'Verify all leveraged positions maintain healthy collateral ratios. Proves no position is at risk of liquidation.', category = 'agent_skill', parameters = {
        'type': 'object',
        'properties': {
            'collateral_values': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Collateral value per position' },
            'debt_values': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Debt value per position' },
            'liquidation_thresholds': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'LTV thresholds in bps' },
            'num_active': {
                'type': 'integer',
                'description': 'Number of active positions' },
            'min_health_factor': {
                'type': 'integer',
                'description': 'Minimum health factor * 10000 (default 15000 = 1.5x)' } },
        'required': [
            'collateral_values',
            'debt_values'] }, circuit_name = 'LiquidationRisk', input_builder = 'build_liquidation_risk_inputs', requires_reputation_tier = 0),
    'performance_attestation': SkillDefinition(skill_id = 'performance_attestation', name = 'Historical Performance Attestation', description = 'Generate a zk proof that historical performance meets criteria. Proves mean return and drawdown bounds without revealing period details.', category = 'agent_identity', parameters = {
        'type': 'object',
        'properties': {
            'period_returns': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Return per period in bps (up to 12)' },
            'period_balances': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Balance per period' },
            'min_mean_return_bps': {
                'type': 'integer',
                'description': 'Min mean return in bps (default 100)' },
            'max_drawdown_bps': {
                'type': 'integer',
                'description': 'Max drawdown in bps (default 1000)' },
            'num_periods': {
                'type': 'integer',
                'description': 'Number of periods (default 6)' } },
        'required': [] }, circuit_name = 'HistoricalPerformanceAttestation', input_builder = 'build_historical_performance_inputs', requires_reputation_tier = 1),
    'mev_protection': SkillDefinition(skill_id = 'mev_protection', name = 'MEV Resistance Proof', description = 'Verify a transaction was not subject to significant MEV extraction. Proves transaction integrity without revealing block numbers or prices.', category = 'agent_skill', parameters = {
        'type': 'object',
        'properties': {
            'submission_block': {
                'type': 'integer',
                'description': 'Block when tx was submitted' },
            'inclusion_block': {
                'type': 'integer',
                'description': 'Block when tx was included' },
            'expected_price': {
                'type': 'integer',
                'description': 'Expected execution price' },
            'actual_price': {
                'type': 'integer',
                'description': 'Actual execution price' },
            'max_delay_blocks': {
                'type': 'integer',
                'description': 'Max acceptable block delay (default 5)' },
            'max_price_deviation_bps': {
                'type': 'integer',
                'description': 'Max price deviation in bps (default 50)' } },
        'required': [
            'submission_block',
            'inclusion_block',
            'expected_price',
            'actual_price'] }, circuit_name = 'MEVResistanceProof', input_builder = 'build_mev_resistance_inputs', requires_reputation_tier = 0),
    'risk_score': SkillDefinition(skill_id = 'risk_score', name = 'Portfolio Risk Score', description = 'Calculate and prove portfolio risk score is below threshold.', category = 'ml_scoring', parameters = {
        'type': 'object',
        'properties': {
            'portfolio_features': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': '8-element feature vector' },
            'threshold': {
                'type': 'integer',
                'description': 'Risk threshold (default 50)' } },
        'required': [] }, circuit_name = 'RiskScore', input_builder = 'build_risk_score_inputs', requires_reputation_tier = 0),
    'anomaly_detection': SkillDefinition(skill_id = 'anomaly_detection', name = 'Pool Anomaly Detection', description = 'Detect anomalies in a pool across 6 risk factors.', category = 'ml_scoring', parameters = {
        'type': 'object',
        'properties': {
            'tvl_volatility': {
                'type': 'integer' },
            'liquidity_concentration': {
                'type': 'integer' },
            'price_impact_score': {
                'type': 'integer' },
            'pool_id': {
                'type': 'integer' } },
        'required': [] }, circuit_name = 'AnomalyDetector', input_builder = 'build_anomaly_detector_inputs', requires_reputation_tier = 0),
    'solvency_proof': SkillDefinition(skill_id = 'solvency_proof', name = 'Solvency Proof', description = 'Prove total assets exceed liabilities by a minimum ratio without revealing individual position values. Returns a solvency tier bucket (0-4).', category = 'reputation', parameters = {
        'type': 'object',
        'properties': {
            'asset_positions': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Asset values (up to 8)' },
            'debt_positions': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Debt values (up to 8)' },
            'min_solvency_ratio_bps': {
                'type': 'integer',
                'description': 'Minimum asset/liability ratio in bps (default 10000 = 1:1)' } },
        'required': [] }, circuit_name = 'SolvencyProof', input_builder = 'build_solvency_proof_inputs', requires_reputation_tier = 0),
    'risk_passport': SkillDefinition(skill_id = 'risk_passport', name = 'Risk Passport Tier', description = 'Assign a 1-5 risk tier from weighted risk metrics (volatility, drawdown, concentration, leverage, liquidation history, tenure). Proves tier compliance without revealing metrics.', category = 'reputation', parameters = {
        'type': 'object',
        'properties': {
            'volatility_bps': {
                'type': 'integer',
                'description': 'Portfolio volatility in bps' },
            'max_drawdown_bps': {
                'type': 'integer',
                'description': 'Maximum drawdown in bps' },
            'concentration_bps': {
                'type': 'integer',
                'description': 'Position concentration in bps' },
            'effective_leverage_bps': {
                'type': 'integer',
                'description': 'Effective leverage in bps' },
            'liquidation_events_lookback': {
                'type': 'integer',
                'description': 'Liquidation events in lookback' },
            'tenure_days': {
                'type': 'integer',
                'description': 'Days active (max 365)' },
            'required_tier': {
                'type': 'integer',
                'description': 'Required risk tier 1-5 (default 3)' } },
        'required': [] }, circuit_name = 'RiskPassportTier', input_builder = 'build_risk_passport_tier_inputs', requires_reputation_tier = 0),
    'trader_performance': SkillDefinition(skill_id = 'trader_performance', name = 'Trader Performance Proof', description = 'Prove Sharpe ratio, max drawdown, and win-rate thresholds are met over 30 periods without revealing raw returns or equity curve.', category = 'reputation', parameters = {
        'type': 'object',
        'properties': {
            'returns_bps': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Period returns in bps (30 elements)' },
            'equity_curve': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Equity values per period (30 elements)' },
            'wins_count': {
                'type': 'integer',
                'description': 'Number of winning trades' },
            'trades_count': {
                'type': 'integer',
                'description': 'Total number of trades' },
            'min_sharpe_x100': {
                'type': 'integer',
                'description': 'Minimum Sharpe * 100 (default 50 = 0.50)' },
            'max_drawdown_bps': {
                'type': 'integer',
                'description': 'Max acceptable drawdown in bps (default 2000)' },
            'min_win_rate_bps': {
                'type': 'integer',
                'description': 'Min win rate in bps (default 5000 = 50%)' } },
        'required': [] }, circuit_name = 'TraderPerformanceProof', input_builder = 'build_trader_performance_inputs', requires_reputation_tier = 1),
    'strategy_integrity': SkillDefinition(skill_id = 'strategy_integrity', name = 'Strategy Integrity Check', description = 'Prove position concentration, leverage, slippage, and exposure all comply with strategy policy constraints. Verifies normalized weights and exposures.', category = 'strategy_integrity', parameters = {
        'type': 'object',
        'properties': {
            'position_weights_bps': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Position weights in bps (8 slots, must sum to scale)' },
            'effective_leverage_bps': {
                'type': 'integer',
                'description': 'Effective leverage in bps' },
            'observed_slippage_bps': {
                'type': 'array',
                'items': {
                    'type': 'integer' },
                'description': 'Observed slippage per route (8 slots)' },
            'max_position_weight_bps': {
                'type': 'integer',
                'description': 'Max single position weight (default 3000)' },
            'max_leverage_bps': {
                'type': 'integer',
                'description': 'Max leverage in bps (default 30000 = 3x)' },
            'max_slippage_bps': {
                'type': 'integer',
                'description': 'Max slippage per route in bps (default 100)' } },
        'required': [] }, circuit_name = 'StrategyIntegrity', input_builder = 'build_strategy_integrity_inputs', requires_reputation_tier = 0),
    'execution_integrity': SkillDefinition(skill_id = 'execution_integrity', name = 'Execution Integrity Check', description = 'Prove a trade or rebalance execution met delay, price deviation, and fair routing constraints. Verifies no sandwich or frontrunning occurred.', category = 'execution_quality', parameters = {
        'type': 'object',
        'properties': {
            'submission_block': {
                'type': 'integer',
                'description': 'Block when tx was submitted' },
            'inclusion_block': {
                'type': 'integer',
                'description': 'Block when tx was included' },
            'expected_price': {
                'type': 'integer',
                'description': 'Expected execution price' },
            'actual_price': {
                'type': 'integer',
                'description': 'Actual execution price' },
            'max_delay_blocks': {
                'type': 'integer',
                'description': 'Max acceptable block delay (default 5)' },
            'max_price_deviation_bps': {
                'type': 'integer',
                'description': 'Max price deviation in bps (default 50)' } },
        'required': [
            'submission_block',
            'inclusion_block',
            'expected_price',
            'actual_price'] }, circuit_name = 'ExecutionIntegrity', input_builder = 'build_execution_integrity_inputs', requires_reputation_tier = 0) }
# WARNING: Decompyle incomplete
