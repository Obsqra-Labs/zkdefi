"""
LLM Narration Service — generates contextual plain-language explanations
for UI surfaces throughout the Control Surface.

Context types:
  - gate_evaluation: explain what the constraint gate is checking
  - strategy_recommendation: personalized strategy reasoning
  - idle_capital: proactive suggestion for unallocated funds
  - gate_rate_explanation: explain gate pass/fail rate
  - error_decode: rewrite a raw error into actionable guidance
  - pending_claims: prioritize and explain claimable rewards
  - snapshot_forecast_explain: explain Snapshot Forecaster outputs and results

Uses Onyx LLM with deterministic fallback templates.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ── LLM client (shared with ai_allocation) ─────────────────────────────

_openai_client = None


def _get_openai():
    global _openai_client
    if _openai_client is not None:
        return _openai_client
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=api_key)
        return _openai_client
    except Exception:
        return None


# ── Prompt templates per context_type ───────────────────────────────────

_PROMPTS: dict[str, str] = {
    "gate_evaluation": (
        "You are the zkde.fi AI assistant. The constraint gate is evaluating a "
        "{action} request for a {risk_profile} profile user. "
        "Current checks: identity verification, session window ({session_hours}h), "
        "risk bounds (max position ${max_position_usd:.0f}), ZKML risk score. "
        "Write ONE sentence explaining what's being checked, addressed to the user. "
        "Be specific and reassuring. Example: 'Checking portfolio correlation risk "
        "against your Balanced constraint set — this takes ~10s.'"
    ),
    "strategy_recommendation": (
        "You are the zkde.fi AI assistant. The user has a {risk_profile} profile, "
        "tier {tier}, reputation score {passport_score}/100, with ${balance:.0f} total "
        "and ${allocated:.0f} allocated. Current best pool APY is {best_apy:.1f}%. "
        "Write 2 sentences: first explain why {risk_profile} fits their situation, "
        "then suggest a specific improvement. Be concrete with numbers."
    ),
    "idle_capital": (
        "You are the zkde.fi AI assistant. The user has ${idle_amount:.0f} unallocated. "
        "Their risk profile is {risk_profile}. Best available pool APY is {best_apy:.1f}%. "
        "Write ONE sentence suggesting deployment with an estimated monthly return. "
        "Be specific: mention the amount and estimated return."
    ),
    "gate_rate_explanation": (
        "You are the zkde.fi AI assistant. The user's gate pass rate is {pass_rate}%. "
        "Recent blocks were caused by: {block_reasons}. "
        "Write 2 sentences: first explain what the {fail_rate}% failure rate means "
        "in plain language, then give ONE actionable suggestion to improve it."
    ),
    "error_decode": (
        "You are the zkde.fi AI assistant. A transaction failed with error: '{error_msg}'. "
        "The decoded reason is: '{decoded_reason}'. "
        "Write ONE sentence explaining what happened in plain language, "
        "and ONE sentence suggesting what the user should do. Be specific."
    ),
    "pending_claims": (
        "You are the zkde.fi AI assistant. The user has {claim_count} pending claim(s) "
        "totaling {claim_amount} STRK, oldest pending for {oldest_days} days. "
        "Write ONE sentence urging them to claim, mentioning the amount and "
        "any time sensitivity (e.g., before next rebalance cycle)."
    ),
    "risk_assessment": (
        "You are the zkde.fi AI assistant. Assess the risk for a {risk_profile} profile user "
        "with ${balance:.0f} total value across {position_count} positions. "
        "Current max single-pool exposure is {max_exposure_pct:.0f}%, portfolio drift is {drift_pct:.1f}%. "
        "Write 2 sentences: first state the overall risk level (low/medium/high), "
        "then flag the biggest concern or confirm safety. Be specific with numbers."
    ),
    "rebalance_explanation": (
        "You are the zkde.fi AI assistant. A rebalance is {status} for a {risk_profile} profile. "
        "Current drift is {drift_pct:.1f}% (threshold {drift_threshold:.0f}%). "
        "The plan moves {actions_count} positions: {action_summary}. "
        "Write 2 sentences: first explain why the rebalance is needed, "
        "then summarise what will change. Use plain language with concrete numbers."
    ),
    "snapshot_forecast_explain": (
        "You are the zkde.fi AI assistant explaining a Snapshot Forecaster receipt. "
        "Window pair: {pair_id}. Prediction status: {status}. Trust mode: {trust_mode}. "
        "Predicted returns: 5m={r5_bps} bps ({r5_pct:.2f}%), "
        "30m={r30_bps} bps ({r30_pct:.2f}%), 4h={r240_bps} bps ({r240_pct:.2f}%). "
        "Predicted up-probabilities (0-100%): 5m={p5_pct:.1f}, 30m={p30_pct:.1f}, 4h={p240_pct:.1f}. "
        "If scored, actual returns were 5m={a5_bps} bps ({a5_pct:.2f}%), "
        "30m={a30_bps} bps ({a30_pct:.2f}%), 4h={a240_bps} bps ({a240_pct:.2f}%); "
        "directional accuracy={directional_pct:.1f}%, MAE={mae_bps:.1f} bps ({mae_pct:.2f}%), "
        "Brier={brier:.4f}, ECE={ece:.4f}. "
        "Write up to 3 short sentences for a non-quant user: what the model predicted, "
        "how it performed (if scored), and one caution/interpretation tip. "
        "Avoid jargon and always include percent equivalents."
    ),
}

# ── Deterministic fallbacks (no LLM needed) ────────────────────────────

_FALLBACKS: dict[str, str] = {
    "gate_evaluation": "Checking {action} constraints against your {risk_profile} profile — verifying identity, session, and risk bounds.",
    "strategy_recommendation": "Your {risk_profile} profile targets moderate risk with ~{best_apy:.0f}% APY. Consider deploying idle capital to maximize returns.",
    "idle_capital": "You have ${idle_amount:.0f} unallocated. Deploying to LP pools at {best_apy:.1f}% APY would yield ~${monthly_est:.0f}/month.",
    "gate_rate_explanation": "{fail_rate}% of recent transactions were blocked by the constraint gate. Review your exposure limits to reduce future blocks.",
    "error_decode": "{decoded_reason}. Try a smaller amount or wait for pool liquidity to improve.",
    "pending_claims": "You have {claim_amount} STRK pending for {oldest_days} days. Claim before the next rebalance cycle.",
    "risk_assessment": "Risk level: moderate. Your {risk_profile} portfolio has {drift_pct:.1f}% drift across {position_count} positions with max exposure {max_exposure_pct:.0f}%.",
    "rebalance_explanation": "Rebalance {status}: portfolio drift is {drift_pct:.1f}% (threshold {drift_threshold:.0f}%). Moving {actions_count} positions to restore target weights.",
    "snapshot_forecast_explain": (
        "The model predicted {pair_id} returns of {r5_pct:.2f}% (5m), {r30_pct:.2f}% (30m), and "
        "{r240_pct:.2f}% (4h), with up-probabilities of {p5_pct:.1f}%, {p30_pct:.1f}%, and {p240_pct:.1f}%. "
        "Status is {status} under {trust_mode} trust mode. "
        "If scored: directional accuracy {directional_pct:.1f}%, MAE {mae_pct:.2f}%, Brier {brier:.4f}, ECE {ece:.4f}."
    ),
}


async def generate_narration(
    context_type: str,
    context_data: dict[str, Any],
) -> dict[str, Any]:
    """
    Generate an LLM narration for the given context.
    Falls back to template if LLM unavailable.
    """
    if context_type not in _PROMPTS:
        return {
            "narration": f"Unknown context: {context_type}",
            "source": "error",
        }

    # Try LLM path
    llm_error: str | None = None
    client = _get_openai()
    if client is not None:
        try:
            prompt = _PROMPTS[context_type].format(**context_data)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a DeFi assistant for zkde.fi. Be concise, specific, and actionable. Never use markdown. Max 2 sentences."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=150,
                temperature=0.3,
            )
            narration = response.choices[0].message.content.strip()
            return {
                "narration": narration,
                "source": "llm",
                "context_type": context_type,
            }
        except Exception as e:
            llm_error = type(e).__name__
            logger.warning("LLM narration failed, using fallback: %s", e)

    # Deterministic fallback
    template = _FALLBACKS.get(context_type, "")
    try:
        # Add computed fields for fallback templates
        enriched = {**context_data}
        if "idle_amount" in enriched and "best_apy" in enriched:
            enriched["monthly_est"] = enriched["idle_amount"] * enriched["best_apy"] / 100.0 / 12.0
        if "pass_rate" in enriched:
            enriched["fail_rate"] = 100 - enriched["pass_rate"]
        narration = template.format(**enriched)
    except (KeyError, ValueError):
        narration = template

    return {
        "narration": narration,
        "source": "deterministic",
        "context_type": context_type,
        "fallback_reason": llm_error,
    }
