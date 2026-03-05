"""
Agent Store — SQLite-backed persistence for identity-bound agents.

Replaces the in-memory dict[str, AgentConfig] with durable storage.
Follows the same WAL / RLock pattern as ledger_service.py.

Tables:
  agents              — core agent config (survives restarts)
  agent_llm_bindings  — which LLM provider each agent is bound to
  agent_performance   — period-by-period performance records
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "agents.db"


class AgentStore:
    """SQLite-backed agent persistence."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self._db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self._lock = threading.RLock()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    # ── Connection helpers ────────────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS agents (
                        agent_id        TEXT PRIMARY KEY,
                        owner_address   TEXT NOT NULL,
                        name            TEXT NOT NULL,
                        identity_commitment TEXT NOT NULL DEFAULT '0',
                        reputation_tier INTEGER NOT NULL DEFAULT 0,
                        bound_skills    TEXT NOT NULL DEFAULT '[]',
                        llm_provider_id TEXT NOT NULL DEFAULT 'deterministic',
                        llm_model       TEXT,
                        active          INTEGER NOT NULL DEFAULT 1,
                        created_at      REAL NOT NULL,
                        updated_at      REAL NOT NULL
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS agent_llm_bindings (
                        agent_id    TEXT PRIMARY KEY,
                        provider_id TEXT NOT NULL,
                        config_hash TEXT,
                        bound_at    REAL NOT NULL
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS agent_performance (
                        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                        period_id           TEXT NOT NULL,
                        agent_id            TEXT NOT NULL,
                        return_bps          INTEGER NOT NULL DEFAULT 0,
                        volume              INTEGER NOT NULL DEFAULT 0,
                        proof_count         INTEGER NOT NULL DEFAULT 0,
                        successful_actions  INTEGER NOT NULL DEFAULT 0,
                        failed_actions      INTEGER NOT NULL DEFAULT 0,
                        max_drawdown_bps    INTEGER NOT NULL DEFAULT 0,
                        timestamp           REAL NOT NULL,
                        UNIQUE(agent_id, period_id)
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_agent_performance_agent
                    ON agent_performance(agent_id)
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_agents_owner
                    ON agents(owner_address)
                """)
                conn.commit()
            finally:
                conn.close()

    # ── Agent CRUD ────────────────────────────────────────────────────────

    def save_agent(self, agent: dict[str, Any]) -> None:
        """Insert or update an agent.  Accepts a dict with AgentConfig-like keys."""
        now = time.time()
        skills_json = json.dumps(agent.get("bound_skills", []))
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("""
                    INSERT INTO agents
                        (agent_id, owner_address, name, identity_commitment,
                         reputation_tier, bound_skills, llm_provider_id,
                         llm_model, active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(agent_id) DO UPDATE SET
                        name = excluded.name,
                        identity_commitment = excluded.identity_commitment,
                        reputation_tier = excluded.reputation_tier,
                        bound_skills = excluded.bound_skills,
                        llm_provider_id = excluded.llm_provider_id,
                        llm_model = excluded.llm_model,
                        active = excluded.active,
                        updated_at = excluded.updated_at
                """, (
                    agent["agent_id"],
                    agent["owner_address"],
                    agent["name"],
                    agent.get("identity_commitment", "0"),
                    agent.get("reputation_tier", 0),
                    skills_json,
                    agent.get("llm_provider_id", "onyx"),
                    agent.get("llm_model"),
                    1 if agent.get("active", True) else 0,
                    now,
                    now,
                ))
                conn.commit()
            finally:
                conn.close()

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        """Fetch a single agent by ID.  Returns dict or None."""
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM agents WHERE agent_id = ?", (agent_id,)
                ).fetchone()
                return self._row_to_dict(row) if row else None
            finally:
                conn.close()

    def list_agents(self, owner: str | None = None) -> list[dict[str, Any]]:
        """List all agents, optionally filtered by owner."""
        with self._lock:
            conn = self._connect()
            try:
                if owner:
                    rows = conn.execute(
                        "SELECT * FROM agents WHERE owner_address = ? ORDER BY created_at DESC",
                        (owner,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM agents ORDER BY created_at DESC"
                    ).fetchall()
                return [self._row_to_dict(r) for r in rows]
            finally:
                conn.close()

    def update_agent(self, agent_id: str, updates: dict[str, Any]) -> bool:
        """Partial update.  Returns True if the row existed."""
        allowed = {
            "name", "identity_commitment", "reputation_tier",
            "bound_skills", "llm_provider_id", "llm_model", "active",
        }
        parts: list[str] = []
        values: list[Any] = []
        for key, val in updates.items():
            if key not in allowed:
                continue
            if key == "bound_skills":
                val = json.dumps(val) if isinstance(val, list) else val
            if key == "active":
                val = 1 if val else 0
            parts.append(f"{key} = ?")
            values.append(val)
        if not parts:
            return False
        parts.append("updated_at = ?")
        values.append(time.time())
        values.append(agent_id)

        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(
                    f"UPDATE agents SET {', '.join(parts)} WHERE agent_id = ?",
                    values,
                )
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()

    def delete_agent(self, agent_id: str) -> bool:
        """Delete an agent and its bindings / performance data.  Returns True if existed."""
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute("DELETE FROM agents WHERE agent_id = ?", (agent_id,))
                conn.execute("DELETE FROM agent_llm_bindings WHERE agent_id = ?", (agent_id,))
                conn.execute("DELETE FROM agent_performance WHERE agent_id = ?", (agent_id,))
                conn.commit()
                return cur.rowcount > 0
            finally:
                conn.close()

    # ── LLM Bindings ─────────────────────────────────────────────────────

    def save_binding(self, agent_id: str, provider_id: str, config_hash: str = "") -> None:
        """Persist agent → LLM provider binding."""
        now = time.time()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("""
                    INSERT INTO agent_llm_bindings (agent_id, provider_id, config_hash, bound_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(agent_id) DO UPDATE SET
                        provider_id = excluded.provider_id,
                        config_hash = excluded.config_hash,
                        bound_at    = excluded.bound_at
                """, (agent_id, provider_id, config_hash, now))
                conn.commit()
            finally:
                conn.close()

    def get_binding(self, agent_id: str) -> str | None:
        """Get the LLM provider ID bound to an agent."""
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT provider_id FROM agent_llm_bindings WHERE agent_id = ?",
                    (agent_id,),
                ).fetchone()
                return row["provider_id"] if row else None
            finally:
                conn.close()

    def list_bindings(self) -> dict[str, str]:
        """Return all agent→provider bindings."""
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute("SELECT agent_id, provider_id FROM agent_llm_bindings").fetchall()
                return {r["agent_id"]: r["provider_id"] for r in rows}
            finally:
                conn.close()

    # ── Performance ──────────────────────────────────────────────────────

    def save_performance_period(self, period: dict[str, Any]) -> None:
        """Insert a performance period record."""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("""
                    INSERT INTO agent_performance
                        (period_id, agent_id, return_bps, volume, proof_count,
                         successful_actions, failed_actions, max_drawdown_bps, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(agent_id, period_id) DO UPDATE SET
                        return_bps          = excluded.return_bps,
                        volume              = excluded.volume,
                        proof_count         = excluded.proof_count,
                        successful_actions  = excluded.successful_actions,
                        failed_actions      = excluded.failed_actions,
                        max_drawdown_bps    = excluded.max_drawdown_bps,
                        timestamp           = excluded.timestamp
                """, (
                    period["period_id"],
                    period["agent_id"],
                    period.get("return_bps", 0),
                    period.get("volume", 0),
                    period.get("proof_count", 0),
                    period.get("successful_actions", 0),
                    period.get("failed_actions", 0),
                    period.get("max_drawdown_bps", 0),
                    period.get("timestamp", time.time()),
                ))
                conn.commit()
            finally:
                conn.close()

    def get_performance_periods(
        self, agent_id: str, limit: int = 12
    ) -> list[dict[str, Any]]:
        """Get the most recent performance periods for an agent."""
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute("""
                    SELECT * FROM agent_performance
                    WHERE agent_id = ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                """, (agent_id, limit)).fetchall()
                return [dict(r) for r in reversed(rows)]
            finally:
                conn.close()

    def get_all_performance(self) -> dict[str, list[dict[str, Any]]]:
        """Load all performance data grouped by agent.  Used for summary recomputation."""
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT * FROM agent_performance ORDER BY timestamp ASC"
                ).fetchall()
                result: dict[str, list[dict[str, Any]]] = {}
                for r in rows:
                    d = dict(r)
                    aid = d["agent_id"]
                    result.setdefault(aid, []).append(d)
                return result
            finally:
                conn.close()

    # ── Helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        # Deserialize JSON columns
        if "bound_skills" in d and isinstance(d["bound_skills"], str):
            try:
                d["bound_skills"] = json.loads(d["bound_skills"])
            except (json.JSONDecodeError, TypeError):
                d["bound_skills"] = []
        if "active" in d:
            d["active"] = bool(d["active"])
        return d


# ── Module-level singleton ─────────────────────────────────────────────────

_store: AgentStore | None = None


def get_agent_store() -> AgentStore:
    """Get or create the global AgentStore singleton."""
    global _store
    if _store is None:
        _store = AgentStore()
    return _store
