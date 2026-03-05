"""
Decision Event Store — persistent per-user decision logging for ML training.

Logs every gate decision, proof generation, deposit/withdraw, and tier change.
Provides query methods for the predictive creditworthiness model and risk engine.

Usage:
    store = get_decision_store()
    await store.log_event("0x123...", "deposit", outcome="success", value_eth=1.5)
    stats = await store.get_behavior_stats("0x123...")
    df = await store.get_training_dataset(min_events=50)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


class DecisionStore:
    """Async-first decision event store backed by PostgreSQL."""

    async def log_event(
        self,
        user_address: str,
        event_type: str,
        *,
        gate: str | None = None,
        outcome: str | None = None,
        value_eth: float = 0.0,
        proof_mode: str | None = None,
        model_name: str | None = None,
        model_hash: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> int | None:
        """
        Log a decision event. Returns the event ID, or None if DB unavailable.

        Args:
            user_address: Starknet or linked address.
            event_type: One of: deposit, withdraw, rebalance, borrow, repay,
                       early_exit, proof_generated, proof_failed,
                       gate_allow, gate_block, gate_advisory,
                       tier_upgrade, tier_downgrade, collateral_slash
            gate: relayer, execution, lending (for gate events only)
            outcome: allow, block, advisory, success, failure
            value_eth: Transaction value
            proof_mode: EZKL_ONLY, EZKL_BRIDGE, FULL_DUAL_PROVER
            model_name: ML model name if relevant
            model_hash: Model weights hash
            metadata: Additional key-value data (stored as JSONB)
        """
        from app.db.connection import get_pool
        import json

        pool = await get_pool()
        if pool is None:
            logger.debug("Decision store: no DB, event not logged: %s/%s", user_address[:10], event_type)
            return None

        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    INSERT INTO decision_events
                        (user_address, event_type, gate, outcome, value_eth,
                         proof_mode, model_name, model_hash, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
                    RETURNING id
                    """,
                    user_address.lower(),
                    event_type,
                    gate,
                    outcome,
                    value_eth,
                    proof_mode,
                    model_name,
                    model_hash,
                    json.dumps(metadata or {}),
                )
                return row["id"] if row else None
        except Exception as e:
            logger.warning("Failed to log event: %s", e)
            return None

    async def get_user_history(
        self,
        user_address: str,
        limit: int = 100,
        event_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch recent events for a user."""
        from app.db.connection import get_pool

        pool = await get_pool()
        if pool is None:
            return []

        try:
            async with pool.acquire() as conn:
                if event_types:
                    rows = await conn.fetch(
                        """
                        SELECT id, event_type, gate, outcome, value_eth, proof_mode,
                               model_name, model_hash, metadata, created_at
                        FROM decision_events
                        WHERE user_address = $1 AND event_type = ANY($2)
                        ORDER BY created_at DESC
                        LIMIT $3
                        """,
                        user_address.lower(),
                        event_types,
                        limit,
                    )
                else:
                    rows = await conn.fetch(
                        """
                        SELECT id, event_type, gate, outcome, value_eth, proof_mode,
                               model_name, model_hash, metadata, created_at
                        FROM decision_events
                        WHERE user_address = $1
                        ORDER BY created_at DESC
                        LIMIT $2
                        """,
                        user_address.lower(),
                        limit,
                    )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.warning("Failed to get user history: %s", e)
            return []

    async def get_behavior_stats(self, user_address: str) -> dict[str, Any] | None:
        """
        Get pre-computed behavioral stats for a user from the materialized view.
        Returns None if user has no history or DB is unavailable.
        """
        from app.db.connection import get_pool

        pool = await get_pool()
        if pool is None:
            return None

        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT * FROM user_behavior_stats WHERE user_address = $1",
                    user_address.lower(),
                )
                return dict(row) if row else None
        except Exception as e:
            logger.warning("Failed to get behavior stats: %s", e)
            return None

    async def get_past_decisions(self, user_address: str, limit: int = 50) -> list[dict[str, Any]]:
        """
        Get past decisions in the format expected by risk_engine.score_risk().
        Returns list of dicts with at least an 'early_exit' key.
        """
        events = await self.get_user_history(
            user_address,
            limit=limit,
            event_types=["deposit", "withdraw", "rebalance", "early_exit"],
        )
        return [
            {
                "early_exit": ev["event_type"] == "early_exit",
                "event_type": ev["event_type"],
                "value_eth": ev.get("value_eth", 0),
                "timestamp": ev["created_at"].isoformat() if ev.get("created_at") else None,
            }
            for ev in events
        ]

    async def get_training_dataset(
        self,
        min_events: int = 50,
    ) -> list[dict[str, Any]]:
        """
        Fetch user behavioral stats for ML model training.
        Only includes users with >= min_events total actions.

        Returns a list of dicts (one per user) suitable for DataFrame construction.
        """
        from app.db.connection import get_pool

        pool = await get_pool()
        if pool is None:
            return []

        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT * FROM user_behavior_stats
                    WHERE total_actions >= $1
                    ORDER BY total_actions DESC
                    """,
                    min_events,
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.warning("Failed to get training dataset: %s", e)
            return []

    async def get_event_count(self, user_address: str | None = None) -> int:
        """Count total events, optionally filtered by user."""
        from app.db.connection import get_pool

        pool = await get_pool()
        if pool is None:
            return 0

        try:
            async with pool.acquire() as conn:
                if user_address:
                    row = await conn.fetchrow(
                        "SELECT COUNT(*) as cnt FROM decision_events WHERE user_address = $1",
                        user_address.lower(),
                    )
                else:
                    row = await conn.fetchrow("SELECT COUNT(*) as cnt FROM decision_events")
                return row["cnt"] if row else 0
        except Exception as e:
            logger.warning("Failed to count events: %s", e)
            return 0


# ── Singleton ────────────────────────────────────────────────────────────

_store: DecisionStore | None = None


def get_decision_store() -> DecisionStore:
    """Get or create the decision store singleton."""
    global _store
    if _store is None:
        _store = DecisionStore()
    return _store
