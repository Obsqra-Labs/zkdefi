"""
Strategy Simulator — reads user's real portfolio + live pool data,
proposes what Capital OS would do, and wires into the PaperTradeEngine.

Flow:
  1. Takes a PortfolioSnapshot from PositionScanner
  2. Fetches live pool metrics from PoolDataCollector (83 mainnet pools)
  3. Runs risk-based allocation logic (same brain as ai_allocation.py)
  4. Returns a proposed strategy: "move X from idle → Vesu ETH lending, Y → xSTRK"
  5. Optionally auto-executes on paper via PaperTradeEngine

No on-chain writes. Read-only mainnet. Paper execution only.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ─── Data types ───────────────────────────────────────────────────────────────

@dataclass
class ProposedMove:
    """Single proposed allocation change."""
    action: str             # "deposit" | "stake" | "lp" | "hold"
    protocol: str           # vesu | ekubo | nostra | endur | wallet
    pool_name: str          # e.g. "Vesu ETH Prime"
    asset_symbol: str       # ETH, USDC, xSTRK, ...
    position_type: str      # lending | staking | lp | idle
    amount_usd: float       # proposed USD amount
    source: str             # where the funds come from (e.g. "wallet/ETH")
    expected_apy: float     # expected APY (fraction, e.g. 0.08 = 8%)
    risk_score: int         # 0-100 from pool evaluator
    reasoning: str          # human-readable explanation


@dataclass
class StrategyProposal:
    """Complete strategy proposal for a wallet."""
    wallet_address: str
    proposed_at: str
    risk_profile: str       # conservative | balanced | aggressive
    portfolio_value_usd: float
    moves: List[ProposedMove] = field(default_factory=list)
    expected_blended_apy: float = 0.0
    expected_annual_yield_usd: float = 0.0
    reasoning: str = ""
    proposal_hash: str = ""
    pool_count: int = 0
    protocol_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def compute_hash(self) -> str:
        """Deterministic hash for proof binding."""
        canon = json.dumps(
            {
                "wallet": self.wallet_address,
                "proposed_at": self.proposed_at,
                "risk_profile": self.risk_profile,
                "moves": [
                    {
                        "protocol": m.protocol,
                        "pool": m.pool_name,
                        "asset": m.asset_symbol,
                        "amount_usd": round(m.amount_usd, 2),
                        "apy": round(m.expected_apy, 6),
                    }
                    for m in self.moves
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return "0x" + hashlib.sha256(canon.encode()).hexdigest()


# ─── Allocation weights by risk profile ─────────────────────────────────────

RISK_PROFILES = {
    "conservative": {
        "lending": 0.50,    # Vesu/Nostra lending
        "staking": 0.30,    # Endur xSTRK
        "lp": 0.10,         # Ekubo concentrated LP
        "idle": 0.10,       # keep in wallet
        "max_risk_score": 30,
    },
    "balanced": {
        "lending": 0.35,
        "staking": 0.25,
        "lp": 0.30,
        "idle": 0.10,
        "max_risk_score": 55,
    },
    "aggressive": {
        "lending": 0.15,
        "staking": 0.20,
        "lp": 0.55,
        "idle": 0.10,
        "max_risk_score": 80,
    },
}


# ─── Pool selection helpers ─────────────────────────────────────────────────

def _pool_type(protocol: str) -> str:
    """Map protocol to position type for allocation bucketing."""
    if protocol in ("vesu", "nostra", "hashstack"):
        return "lending"
    if protocol == "endur":
        return "staking"
    if protocol in ("ekubo", "troves"):
        return "lp"
    return "idle"


async def _get_live_pools() -> List[Dict[str, Any]]:
    """Fetch evaluated pools from the live PoolDataCollector + PoolRiskEvaluator."""
    try:
        from app.services.zkml.pool_data_collector import PoolDataCollector
        from app.services.zkml.pool_evaluator import PoolRiskEvaluator

        collector = PoolDataCollector()
        evaluator = PoolRiskEvaluator()

        lp_pools, _ = await collector.get_all_pools()
        evaluations = evaluator.evaluate_multiple(lp_pools)
        results = []
        for pool, eval_result in zip(lp_pools, evaluations):
            results.append({
                "pool_id": pool.pool_id,
                "name": pool.name,
                "protocol": pool.protocol,
                "token0": pool.token0,
                "token1": pool.token1,
                "apy": pool.current_apy,
                "liquidity_usd": pool.liquidity_usd,
                "volume_24h_usd": pool.volume_24h_usd,
                "risk_score": eval_result.risk_score,
                "safety_level": eval_result.safety_level,
                "confidence": eval_result.confidence,
                "pool_type": _pool_type(pool.protocol),
            })
        return results
    except Exception as exc:
        logger.warning("Failed to fetch live pools: %s", exc)
        return []


def _select_best_pools(
    pools: List[Dict[str, Any]],
    pool_type: str,
    max_risk: int,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    """Select the best pools for a given type, filtered by max risk score."""
    candidates = [
        p for p in pools
        if p["pool_type"] == pool_type and p["risk_score"] <= max_risk
    ]
    # Sort by risk-adjusted APY: apy × (1 - risk/100) × confidence
    candidates.sort(
        key=lambda p: p["apy"] * (1 - p["risk_score"] / 100) * p["confidence"],
        reverse=True,
    )
    return candidates[:limit]


# ─── Main simulator ─────────────────────────────────────────────────────────

async def simulate_strategy(
    portfolio_snapshot: Dict[str, Any],
    risk_profile: str = "balanced",
) -> StrategyProposal:
    """
    Given a real portfolio snapshot, propose what Capital OS would do.

    Args:
        portfolio_snapshot: Output from position_scanner.scan_portfolio().to_dict()
        risk_profile: "conservative" | "balanced" | "aggressive"

    Returns:
        StrategyProposal with concrete moves and expected returns.
    """
    t0 = time.time()
    wallet = portfolio_snapshot.get("wallet_address", "")
    total_value = portfolio_snapshot.get("total_value_usd", 0.0)
    positions = portfolio_snapshot.get("positions", [])
    profile = RISK_PROFILES.get(risk_profile, RISK_PROFILES["balanced"])
    max_risk = profile["max_risk_score"]

    now_iso = datetime.now(timezone.utc).isoformat()

    # If portfolio is empty, return minimal proposal
    if total_value <= 0.01:
        proposal = StrategyProposal(
            wallet_address=wallet,
            proposed_at=now_iso,
            risk_profile=risk_profile,
            portfolio_value_usd=total_value,
            reasoning="Portfolio value too low for meaningful allocation.",
        )
        proposal.proposal_hash = proposal.compute_hash()
        return proposal

    # Fetch live pool data
    live_pools = await _get_live_pools()

    # Build the deployable capital (wallet tokens only — DeFi positions stay)
    deployable_usd = 0.0
    deployable_assets: List[Dict[str, Any]] = []
    staying_usd = 0.0

    for pos in positions:
        if pos.get("protocol") == "wallet":
            deployable_usd += pos.get("value_usd", 0.0)
            deployable_assets.append(pos)
        else:
            staying_usd += pos.get("value_usd", 0.0)

    # If nothing deployable, still propose based on total value
    if deployable_usd < 0.01:
        deployable_usd = total_value * 0.5  # hypothetical: redeploy half

    moves: List[ProposedMove] = []

    # ── Allocate by bucket ──────────────────────────────────────────────

    for bucket, weight in [
        ("lending", profile["lending"]),
        ("staking", profile["staking"]),
        ("lp", profile["lp"]),
    ]:
        bucket_usd = deployable_usd * weight
        if bucket_usd < 0.01:
            continue

        best_pools = _select_best_pools(live_pools, bucket, max_risk, limit=3)
        if not best_pools:
            continue

        # Split evenly across top pools (or full amount if only 1)
        per_pool = bucket_usd / min(len(best_pools), 2)

        for pool in best_pools[:2]:
            asset = pool.get("token0", "")
            if pool["protocol"] == "endur":
                asset = "xSTRK"
                action = "stake"
            elif pool["pool_type"] == "lending":
                action = "deposit"
            else:
                action = "lp"

            # Find source asset from deployable
            source = "wallet"
            for da in deployable_assets:
                if da.get("asset_symbol", "").upper() == asset.upper():
                    source = f"wallet/{da['asset_symbol']}"
                    break

            moves.append(ProposedMove(
                action=action,
                protocol=pool["protocol"],
                pool_name=pool["name"],
                asset_symbol=asset or pool.get("token0", "MULTI"),
                position_type=pool["pool_type"],
                amount_usd=round(per_pool, 2),
                source=source,
                expected_apy=pool["apy"],
                risk_score=pool["risk_score"],
                reasoning=_move_reasoning(pool, bucket, weight, risk_profile),
            ))

    # ── Idle reserve ────────────────────────────────────────────────────

    idle_usd = deployable_usd * profile["idle"]
    if idle_usd > 0.01:
        moves.append(ProposedMove(
            action="hold",
            protocol="wallet",
            pool_name="Wallet Reserve",
            asset_symbol="MIXED",
            position_type="idle",
            amount_usd=round(idle_usd, 2),
            source="wallet",
            expected_apy=0.0,
            risk_score=0,
            reasoning=f"Keep {profile['idle']*100:.0f}% as reserve for "
                      f"rebalancing and gas.",
        ))

    # ── Compute blended metrics ─────────────────────────────────────────

    total_allocated = sum(m.amount_usd for m in moves)
    if total_allocated > 0:
        blended_apy = sum(m.amount_usd * m.expected_apy for m in moves) / total_allocated
    else:
        blended_apy = 0.0
    annual_yield = total_allocated * blended_apy

    protocols_involved = sorted(set(m.protocol for m in moves if m.protocol != "wallet"))

    proposal = StrategyProposal(
        wallet_address=wallet,
        proposed_at=now_iso,
        risk_profile=risk_profile,
        portfolio_value_usd=total_value,
        moves=moves,
        expected_blended_apy=round(blended_apy, 6),
        expected_annual_yield_usd=round(annual_yield, 2),
        reasoning=_overall_reasoning(
            risk_profile, total_value, deployable_usd, staying_usd,
            blended_apy, len(moves), protocols_involved,
        ),
        pool_count=len([m for m in moves if m.protocol != "wallet"]),
        protocol_count=len(protocols_involved),
    )
    proposal.proposal_hash = proposal.compute_hash()

    duration_ms = (time.time() - t0) * 1000
    logger.info(
        "Strategy simulation: wallet=%s profile=%s moves=%d apy=%.2f%% yield=$%.2f duration=%.0fms",
        wallet[:20], risk_profile, len(moves), blended_apy * 100, annual_yield, duration_ms,
    )
    return proposal


# ─── Execute on paper ────────────────────────────────────────────────────────

async def execute_on_paper(
    proposal: StrategyProposal,
    settle_to_l3: bool = True,
) -> Dict[str, Any]:
    """
    Execute a strategy proposal on the paper trade engine.

    Creates a session, opens positions for each move, takes an initial
    snapshot, and optionally settles to L3.
    """
    from app.services.paper_trade_engine import (
        create_session,
        open_position,
        take_snapshot,
        settle_snapshot_to_l3,
    )

    session = create_session(
        wallet_address=proposal.wallet_address,
        starting_value_usd=proposal.portfolio_value_usd,
    )

    opened = []
    for move in proposal.moves:
        if move.action == "hold":
            continue
        pos = open_position(
            session_id=session.session_id,
            protocol=move.protocol,
            pool_name=move.pool_name,
            asset_symbol=move.asset_symbol,
            position_type=move.position_type,
            amount_usd=move.amount_usd,
            entry_price=1.0,  # normalized to USD
            apy=move.expected_apy,
            extra={
                "risk_score": move.risk_score,
                "source": move.source,
                "proposal_hash": proposal.proposal_hash,
            },
        )
        if pos:
            opened.append(pos.position_id)

    # Take initial snapshot
    snapshot = take_snapshot(session.session_id)

    # Settle to L3
    l3_result = None
    if settle_to_l3 and snapshot:
        l3_result = await settle_snapshot_to_l3(snapshot)

    return {
        "session_id": session.session_id,
        "positions_opened": len(opened),
        "position_ids": opened,
        "snapshot": snapshot.to_dict() if snapshot else None,
        "l3_settlement": l3_result,
        "proposal_hash": proposal.proposal_hash,
    }


# ─── Reasoning generators ───────────────────────────────────────────────────

def _move_reasoning(pool: Dict, bucket: str, weight: float, profile: str) -> str:
    """Generate human-readable reasoning for a single move."""
    apy_pct = pool["apy"] * 100
    risk = pool["risk_score"]
    safety = pool["safety_level"]
    return (
        f"{profile.title()} profile allocates {weight*100:.0f}% to {bucket}. "
        f"{pool['name']} ({pool['protocol']}) offers {apy_pct:.1f}% APY "
        f"with {safety} risk (score {risk}/100)."
    )


def _overall_reasoning(
    profile: str,
    total_value: float,
    deployable: float,
    staying: float,
    blended_apy: float,
    move_count: int,
    protocols: List[str],
) -> str:
    """Generate overall strategy reasoning."""
    parts = [
        f"Based on your ${total_value:,.2f} portfolio and {profile} risk profile:",
    ]
    if staying > 0.01:
        parts.append(
            f"${staying:,.2f} stays in existing DeFi positions."
        )
    parts.append(
        f"${deployable:,.2f} deployable capital is allocated across "
        f"{move_count} positions on {', '.join(protocols)}."
    )
    parts.append(
        f"Expected blended APY: {blended_apy*100:.1f}%, "
        f"projected annual yield: ${deployable * blended_apy:,.2f}."
    )
    return " ".join(parts)
