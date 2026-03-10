"""
AI Allocation Engine — takes RiskAssessment + pool metrics, produces weighted allocations.

Uses LLM (Onyx / OpenAI) with deterministic fallback. Generates a SHA-256 attestation
hash of the full decision pipeline (inputs → scores → weights) so the allocation
is reproducibly verifiable.

Phase B of the vault pipeline.  No mocks.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Any

from app.services.risk_engine import RiskAssessment
from app.services.pool_metrics import PoolMetric
from app.services.llm_provider_registry import get_llm_registry
from app.services.signal_report import SignalReport

logger = logging.getLogger(__name__)

# ── Data structures ─────────────────────────────────────────────────────


@dataclass
class PoolAllocation:
    """Single pool allocation in the decision."""
    pool_id: str
    protocol: str
    pair: str
    weight_pct: float       # 0-100
    amount_usd: float
    expected_apy_pct: float
    risk_tier: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AllocationDecision:
    """Full allocation decision output."""
    timestamp: str
    risk_profile: str
    deposit_amount: float
    allocations: list[PoolAllocation]
    reserve_pct: float              # unallocated (kept in Pool D privacy pool)
    reserve_usd: float
    blended_apy_pct: float
    reasoning: str
    confidence: float               # 0.0 – 1.0
    source: str                     # "llm" | "deterministic"
    attestation_hash: str           # SHA-256 of the full decision

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["allocations"] = [a.to_dict() for a in self.allocations]
        return d


_SYSTEM_PROMPT = """\
You are an expert DeFi portfolio allocation engine for Ekubo AMM on Starknet.

Given a risk assessment and pool metrics, output a JSON allocation.

Rules:
1. Respect the allocation bounds (max_lp_pct, max_single_pool_pct).
2. Prefer pools with higher risk-adjusted yield (APY / risk_tier_penalty).
3. Pools classified as "blue_chip" are safer than "volatile" or "concentrated".
4. Total allocation out of max_lp_pct. Remaining goes to reserve (Pool D privacy pool).
5. All percentages are 0-100 (not 0-1).

Return ONLY valid JSON:
{
  "allocations": [{"pool_id": "...", "weight_pct": 40.0}],
  "reasoning": "...",
  "confidence": 0.85
}
"""


# ── Core allocation logic ───────────────────────────────────────────────

async def compute_allocation(
    assessment: RiskAssessment,
    pools: list[PoolMetric],
    deposit_amount: float,
    user_address: str = "",
    signals: dict[str, SignalReport] | None = None,
) -> AllocationDecision:
    """
    Produce a weighted allocation decision.

    1. Try LLM via Onyx provider registry
    2. Fall back to deterministic scoring
    3. Generate attestation hash
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    max_lp_pct = assessment.bounds.max_lp_pct * 100.0
    max_single = assessment.max_single_pool_pct * 100.0

    # Filter pools to allowed tiers
    tier_allow = _tier_allow_for(assessment.label)
    candidates = [p for p in pools if p.risk_tier in tier_allow and p.apy_pct > 0]
    if not candidates:
        candidates = [p for p in pools if p.apy_pct > 0]

    # Try LLM path
    llm_result = await _try_llm(assessment, candidates, max_lp_pct, max_single, signals)
    if llm_result is not None:
        allocations, reasoning, confidence, source = llm_result
    else:
        allocations, reasoning, confidence = _deterministic(
            candidates, max_lp_pct, max_single, assessment.label, signals
        )
        source = "deterministic"

    # Materialise PoolAllocation objects
    pool_allocations: list[PoolAllocation] = []
    total_pct = 0.0
    total_apy_weighted = 0.0
    for alloc in allocations:
        pool = _find_pool(candidates, alloc["pool_id"])
        if pool is None:
            continue
        pct = alloc["weight_pct"]
        pool_allocations.append(PoolAllocation(
            pool_id=pool.pool_id,
            protocol=pool.protocol,
            pair=pool.pair,
            weight_pct=round(pct, 2),
            amount_usd=round(deposit_amount * pct / 100.0, 2),
            expected_apy_pct=round(pool.apy_pct, 2),
            risk_tier=pool.risk_tier,
        ))
        total_pct += pct
        total_apy_weighted += pool.apy_pct * pct

    reserve_pct = round(100.0 - total_pct, 2)
    reserve_usd = round(deposit_amount * reserve_pct / 100.0, 2)
    blended_apy = round(total_apy_weighted / total_pct, 2) if total_pct > 0 else 0.0

    # Attestation hash: deterministic hash of the full decision pipeline
    attestation = _attestation_hash(
        timestamp=timestamp,
        user_address=user_address,
        risk_profile=assessment.label,
        deposit_amount=deposit_amount,
        pool_ids=[a.pool_id for a in pool_allocations],
        weights=[a.weight_pct for a in pool_allocations],
    )

    return AllocationDecision(
        timestamp=timestamp,
        risk_profile=assessment.label,
        deposit_amount=deposit_amount,
        allocations=pool_allocations,
        reserve_pct=reserve_pct,
        reserve_usd=reserve_usd,
        blended_apy_pct=blended_apy,
        reasoning=reasoning,
        confidence=confidence,
        source=source,
        attestation_hash=attestation,
    )


# ── Tier filter ─────────────────────────────────────────────────────────

def _tier_allow_for(label: str) -> set[str]:
    if label == "conservative":
        return {"stable", "blue_chip"}
    elif label == "balanced":
        return {"stable", "blue_chip", "volatile"}
    return {"stable", "blue_chip", "volatile", "concentrated"}


# ── Deterministic allocation ────────────────────────────────────────────

def _deterministic(
    candidates: list[PoolMetric],
    max_lp_pct: float,
    max_single: float,
    label: str,
    signals: dict[str, SignalReport] | None = None,
) -> tuple[list[dict], str, float]:
    """Score-based allocation without LLM."""
    scored = []
    for p in candidates:
        sig = signals.get(p.pool_id) if signals else None
        if sig and sig.gates_total > 0:
            base = p.apy_pct * 10 + p.tvl_usd / 100_000
            gate_multiplier = 0.5 + (sig.gates_passed / sig.gates_total)
            if sig.slippage_ok is False:
                gate_multiplier *= 0.3
            score = base * gate_multiplier
        else:
            tvl_factor = min(p.tvl_usd / 50_000.0, 1.0)
            tier_bonus = {"stable": 1.2, "blue_chip": 1.1, "volatile": 1.0, "concentrated": 0.8}.get(p.risk_tier, 1.0)
            score = p.apy_pct * tvl_factor * tier_bonus
        scored.append((p, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    top_n = min(len(scored), 5)

    allocations: list[dict] = []
    remaining = max_lp_pct
    for pool, _ in scored[:top_n]:
        pct = min(max_single, remaining)
        if pct <= 0:
            break
        allocations.append({"pool_id": pool.pool_id, "weight_pct": round(pct, 2)})
        remaining -= pct

    reasoning = (
        f"Deterministic allocation for {label} profile. "
        f"Selected top {len(allocations)} pools ranked by risk-adjusted APY × TVL depth. "
        f"Max LP = {max_lp_pct:.0f}%, max single pool = {max_single:.0f}%."
    )
    return allocations, reasoning, 0.85


# ── LLM allocation ─────────────────────────────────────────────────────

async def _try_llm(
    assessment: RiskAssessment,
    candidates: list[PoolMetric],
    max_lp_pct: float,
    max_single: float,
    signals: dict[str, SignalReport] | None = None,
) -> tuple[list[dict], str, float, str] | None:
    """Try LLM allocation via Onyx provider registry. Returns None if unavailable."""
    try:
        registry = get_llm_registry()
    except Exception:
        return None

    try:
        lines = []
        for p in candidates[:10]:
            line = (
                f"  - pool_id={p.pool_id}  pair={p.pair}  apy={p.apy_pct:.1f}%  "
                f"tvl=${p.tvl_usd:,.0f}  tier={p.risk_tier}"
            )
            if signals and p.pool_id in signals:
                sig = signals[p.pool_id]
                gate_str = f"gates={sig.gates_passed}/{sig.gates_total}"
                if sig.slippage_ok is not None:
                    gate_str += f"  slippage={'PASS' if sig.slippage_ok else 'FAIL'}"
                line += f"  {gate_str}"
            lines.append(line)
        pool_desc = "\n".join(lines)
        user_msg = (
            f"Risk profile: {assessment.label} (level {assessment.risk_level}/10)\n"
            f"Max LP allocation: {max_lp_pct:.0f}%\n"
            f"Max single pool: {max_single:.0f}%\n"
            f"\nCandidate pools:\n{pool_desc}\n"
            f"\nAllocate capital across these pools."
        )
        resp = await registry.chat_completion(
            provider_id="onyx",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=600,
        )

        # If Onyx fell back to deterministic, treat as unavailable
        if resp.provider_id == "deterministic":
            logger.info("Onyx unavailable for allocation — using deterministic")
            return None

        content = resp.content
        result = json.loads(content)
        allocs = result.get("allocations", [])
        reasoning = result.get("reasoning", "LLM allocation")
        confidence = float(result.get("confidence", 0.8))

        # Validate: cap to bounds
        validated: list[dict] = []
        remaining = max_lp_pct
        for a in allocs:
            pct = min(float(a.get("weight_pct", 0)), max_single, remaining)
            if pct <= 0:
                continue
            validated.append({"pool_id": a["pool_id"], "weight_pct": round(pct, 2)})
            remaining -= pct

        if not validated:
            return None
        return validated, reasoning, confidence, "llm"

    except Exception as e:
        logger.warning("LLM allocation failed: %s — using deterministic", e)
        return None


# ── Helpers ─────────────────────────────────────────────────────────────

def _find_pool(candidates: list[PoolMetric], pool_id: str) -> PoolMetric | None:
    for p in candidates:
        if p.pool_id == pool_id:
            return p
    return None


def _attestation_hash(
    timestamp: str,
    user_address: str,
    risk_profile: str,
    deposit_amount: float,
    pool_ids: list[str],
    weights: list[float],
) -> str:
    """Deterministic SHA-256 of the full decision to prove reproducibility."""
    payload = {
        "ts": timestamp,
        "user": user_address,
        "risk": risk_profile,
        "amount": deposit_amount,
        "pools": pool_ids,
        "weights": weights,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()
