"""
Agent Performance Service — Tracks and aggregates agent performance metrics.

Feeds into:
  - AgentReputationScore circuit (via performance metrics → ZK proof)
  - HistoricalPerformanceAttestation circuit (via period returns/balances)
  - On-chain AgentPerformanceStore (when submitting to contract)
  - Frontend dashboards and leaderboard

Persisted to SQLite via AgentStore (backend/data/agents.db).
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from .agent_store import get_agent_store

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@dataclass
class PeriodPerformance:
    """Performance for a single period."""
    period_id: str             # e.g., "2024-02-w3"
    agent_id: str
    return_bps: int            # Return in basis points
    volume: int                # Trade volume
    proof_count: int           # ZK proofs generated
    successful_actions: int
    failed_actions: int
    max_drawdown_bps: int
    timestamp: float = 0.0


@dataclass
class AgentPerformanceSummary:
    """Aggregate performance summary for an agent."""
    agent_id: str
    total_periods: int = 0
    total_volume: int = 0
    total_proofs: int = 0
    total_successful: int = 0
    total_failed: int = 0
    cumulative_return_bps: int = 0
    mean_return_bps: int = 0
    max_drawdown_bps: int = 0
    peak_balance: int = 10000    # Base 100.00%
    current_balance: int = 10000
    sharpe_estimate: float = 0.0
    win_rate: float = 0.0
    last_updated: float = 0.0


class AgentPerformanceService:
    """Tracks agent performance over time.  Backed by SQLite via AgentStore."""

    def __init__(self):
        self._store = get_agent_store()
        self._summaries: dict[str, AgentPerformanceSummary] = {}
        self._load()

    def _load(self):
        """Recompute summaries from persisted SQLite data."""
        try:
            all_data = self._store.get_all_performance()
            for agent_id, periods in all_data.items():
                for p in periods:
                    perf = PeriodPerformance(
                        period_id=p["period_id"],
                        agent_id=p["agent_id"],
                        return_bps=p.get("return_bps", 0),
                        volume=p.get("volume", 0),
                        proof_count=p.get("proof_count", 0),
                        successful_actions=p.get("successful_actions", 0),
                        failed_actions=p.get("failed_actions", 0),
                        max_drawdown_bps=p.get("max_drawdown_bps", 0),
                        timestamp=p.get("timestamp", 0),
                    )
                    self._update_summary(perf)
            logger.info(f"Loaded performance data for {len(self._summaries)} agents from SQLite")
        except Exception as exc:
            logger.warning(f"Could not load performance data: {exc}")

    def _save_period(self, perf: PeriodPerformance):
        """Persist a single period to SQLite."""
        self._store.save_performance_period(asdict(perf))

    def record_period(self, perf: PeriodPerformance) -> AgentPerformanceSummary:
        """Record a new period's performance and update summary."""
        perf.timestamp = time.time()
        # Persist to SQLite
        self._save_period(perf)
        # Update in-memory summary
        return self._update_summary(perf)

    def _update_summary(self, perf: PeriodPerformance) -> AgentPerformanceSummary:
        """Update the in-memory summary for an agent with a new period."""
        agent_id = perf.agent_id
        summary = self._summaries.get(agent_id, AgentPerformanceSummary(agent_id=agent_id))
        summary.total_periods += 1
        summary.total_volume += perf.volume
        summary.total_proofs += perf.proof_count
        summary.total_successful += perf.successful_actions
        summary.total_failed += perf.failed_actions
        summary.cumulative_return_bps += perf.return_bps

        # Update balance tracking
        if perf.return_bps >= 0:
            summary.current_balance += summary.current_balance * perf.return_bps // 10000
        else:
            loss = summary.current_balance * abs(perf.return_bps) // 10000
            summary.current_balance = max(0, summary.current_balance - loss)

        if summary.current_balance > summary.peak_balance:
            summary.peak_balance = summary.current_balance

        # Track drawdown
        if perf.max_drawdown_bps > summary.max_drawdown_bps:
            summary.max_drawdown_bps = perf.max_drawdown_bps

        # Compute derived metrics
        if summary.total_periods > 0:
            summary.mean_return_bps = summary.cumulative_return_bps // summary.total_periods
        total_actions = summary.total_successful + summary.total_failed
        if total_actions > 0:
            summary.win_rate = summary.total_successful / total_actions

        summary.last_updated = time.time()
        self._summaries[agent_id] = summary

        return summary

    def get_summary(self, agent_id: str) -> AgentPerformanceSummary | None:
        """Get performance summary for an agent."""
        return self._summaries.get(agent_id)

    def get_periods(self, agent_id: str, limit: int = 12) -> list[PeriodPerformance]:
        """Get recent periods for an agent from SQLite."""
        rows = self._store.get_performance_periods(agent_id, limit)
        return [
            PeriodPerformance(
                period_id=r["period_id"],
                agent_id=r["agent_id"],
                return_bps=r.get("return_bps", 0),
                volume=r.get("volume", 0),
                proof_count=r.get("proof_count", 0),
                successful_actions=r.get("successful_actions", 0),
                failed_actions=r.get("failed_actions", 0),
                max_drawdown_bps=r.get("max_drawdown_bps", 0),
                timestamp=r.get("timestamp", 0),
            )
            for r in rows
        ]

    def get_reputation_inputs(self, agent_id: str) -> dict[str, Any]:
        """Get inputs for the AgentReputationScore circuit."""
        summary = self._summaries.get(agent_id)
        if not summary:
            return {"metrics": [0, 0, 0, 0, 0, 0, 0]}

        return {
            "metrics": [
                summary.total_volume,
                summary.total_successful,
                summary.total_failed,
                max(0, summary.mean_return_bps),     # avg_return_bps
                summary.max_drawdown_bps,             # max_drawdown_bps
                summary.total_periods,                # tenure_days (approximation)
                summary.total_proofs,                 # total_proofs
            ],
        }

    def get_performance_witness(self, agent_id: str, num_periods: int = 12) -> dict[str, Any]:
        """Get inputs for the HistoricalPerformanceAttestation circuit."""
        periods = self.get_periods(agent_id, num_periods)

        returns = [p.return_bps for p in periods]
        # Reconstruct balances from returns
        balance = 10000
        balances = []
        peak = balance
        for r in returns:
            if r >= 0:
                balance += balance * r // 10000
            else:
                balance -= balance * abs(r) // 10000
            if balance > peak:
                peak = balance
            balances.append(balance)

        # Pad to circuit size
        while len(returns) < 12:
            returns.append(0)
        while len(balances) < 12:
            balances.append(balance)

        return {
            "period_returns": returns,
            "period_balances": balances,
            "num_periods": min(len(periods), 12),
        }

    def get_leaderboard(
        self,
        sort_by: str = "cumulative_return_bps",
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Get agent leaderboard sorted by the specified metric."""
        entries = []
        for aid, s in self._summaries.items():
            entries.append({
                "agent_id": aid,
                "total_periods": s.total_periods,
                "cumulative_return_bps": s.cumulative_return_bps,
                "mean_return_bps": s.mean_return_bps,
                "max_drawdown_bps": s.max_drawdown_bps,
                "total_volume": s.total_volume,
                "win_rate": round(s.win_rate, 4),
                "total_proofs": s.total_proofs,
            })

        entries.sort(key=lambda x: x.get(sort_by, 0), reverse=True)
        return entries[:limit]


# Module-level singleton
_perf_service: AgentPerformanceService | None = None


def get_performance_service() -> AgentPerformanceService:
    """Get or create the global performance service."""
    global _perf_service
    if _perf_service is None:
        _perf_service = AgentPerformanceService()
    return _perf_service
