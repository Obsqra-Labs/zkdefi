# Source Generated with Decompyle++
# File: llm_narration.cpython-312.pyc (Python 3.12)

'''
LLM Narration Service — generates contextual plain-language explanations
for UI surfaces throughout the Control Surface.

Context types:
  - gate_evaluation: explain what the constraint gate is checking
  - strategy_recommendation: personalized strategy reasoning
  - idle_capital: proactive suggestion for unallocated funds
  - gate_rate_explanation: explain gate pass/fail rate
  - error_decode: rewrite a raw error into actionable guidance
  - pending_claims: prioritize and explain claimable rewards

Uses Onyx LLM with deterministic fallback templates.
'''
from __future__ import annotations
import logging
import os
from typing import Any, Optional
from datetime import datetime
logger = logging.getLogger(__name__)
_openai_client = None

def _get_openai():
    pass
# WARNING: Decompyle incomplete

_PROMPTS: 'dict[str, str]' = {
    'gate_evaluation': "You are the zkde.fi AI assistant. The constraint gate is evaluating a {action} request for a {risk_profile} profile user. Current checks: identity verification, session window ({session_hours}h), risk bounds (max position ${max_position_usd:.0f}), ZKML risk score. Write ONE sentence explaining what's being checked, addressed to the user. Be specific and reassuring. Example: 'Checking portfolio correlation risk against your Balanced constraint set — this takes ~10s.'",
    'strategy_recommendation': 'You are the zkde.fi AI assistant. The user has a {risk_profile} profile, tier {tier}, reputation score {passport_score}/100, with ${balance:.0f} total and ${allocated:.0f} allocated. Current best pool APY is {best_apy:.1f}%. Write 2 sentences: first explain why {risk_profile} fits their situation, then suggest a specific improvement. Be concrete with numbers.',
    'idle_capital': 'You are the zkde.fi AI assistant. The user has ${idle_amount:.0f} unallocated. Their risk profile is {risk_profile}. Best available pool APY is {best_apy:.1f}%. Write ONE sentence suggesting deployment with an estimated monthly return. Be specific: mention the amount and estimated return.',
    'gate_rate_explanation': "You are the zkde.fi AI assistant. The user's gate pass rate is {pass_rate}%. Recent blocks were caused by: {block_reasons}. Write 2 sentences: first explain what the {fail_rate}% failure rate means in plain language, then give ONE actionable suggestion to improve it.",
    'error_decode': "You are the zkde.fi AI assistant. A transaction failed with error: '{error_msg}'. The decoded reason is: '{decoded_reason}'. Write ONE sentence explaining what happened in plain language, and ONE sentence suggesting what the user should do. Be specific.",
    'pending_claims': 'You are the zkde.fi AI assistant. The user has {claim_count} pending claim(s) totaling {claim_amount} STRK, oldest pending for {oldest_days} days. Write ONE sentence urging them to claim, mentioning the amount and any time sensitivity (e.g., before next rebalance cycle).',
    'risk_assessment': 'You are the zkde.fi AI assistant. Assess the risk for a {risk_profile} profile user with ${balance:.0f} total value across {position_count} positions. Current max single-pool exposure is {max_exposure_pct:.0f}%, portfolio drift is {drift_pct:.1f}%. Write 2 sentences: first state the overall risk level (low/medium/high), then flag the biggest concern or confirm safety. Be specific with numbers.',
    'rebalance_explanation': 'You are the zkde.fi AI assistant. A rebalance is {status} for a {risk_profile} profile. Current drift is {drift_pct:.1f}% (threshold {drift_threshold:.0f}%). The plan moves {actions_count} positions: {action_summary}. Write 2 sentences: first explain why the rebalance is needed, then summarise what will change. Use plain language with concrete numbers.' }
_FALLBACKS: 'dict[str, str]' = {
    'gate_evaluation': 'Checking {action} constraints against your {risk_profile} profile — verifying identity, session, and risk bounds.',
    'strategy_recommendation': 'Your {risk_profile} profile targets moderate risk with ~{best_apy:.0f}% APY. Consider deploying idle capital to maximize returns.',
    'idle_capital': 'You have ${idle_amount:.0f} unallocated. Deploying to LP pools at {best_apy:.1f}% APY would yield ~${monthly_est:.0f}/month.',
    'gate_rate_explanation': '{fail_rate}% of recent transactions were blocked by the constraint gate. Review your exposure limits to reduce future blocks.',
    'error_decode': '{decoded_reason}. Try a smaller amount or wait for pool liquidity to improve.',
    'pending_claims': 'You have {claim_amount} STRK pending for {oldest_days} days. Claim before the next rebalance cycle.',
    'risk_assessment': 'Risk level: moderate. Your {risk_profile} portfolio has {drift_pct:.1f}% drift across {position_count} positions with max exposure {max_exposure_pct:.0f}%.',
    'rebalance_explanation': 'Rebalance {status}: portfolio drift is {drift_pct:.1f}% (threshold {drift_threshold:.0f}%). Moving {actions_count} positions to restore target weights.' }

async def generate_narration(context_type = None, context_data = None):
    '''
    Generate an LLM narration for the given context.
    Falls back to template if LLM unavailable.
    '''
    pass
# WARNING: Decompyle incomplete

