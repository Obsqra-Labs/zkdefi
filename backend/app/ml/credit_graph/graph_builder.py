"""
Credit Graph Builder.

Constructs and updates a co-investment graph from on-chain position data.
Edges represent users who share liquidity in the same pool during overlapping
time windows. Edge weights are proportional to overlap duration × combined TVL.

Graph structure:
  - Nodes: user addresses (Starknet felt)
  - Edges: co-investment in a shared pool
  - Node features: 18-dimensional CreditFeatures vector (from creditworthiness)
  - Edge weight: overlap_hours × combined_tvl (from credit_graph_edges table)

The graph is recomputed periodically (e.g., every 4 hours) and persisted to
PostgreSQL via the credit_graph_edges table.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class GraphNode:
    """A node in the credit graph."""
    address: str
    features: list[float]           # 18-dim CreditFeatures
    credit_grade: str = "C"         # Predicted grade from creditworthiness model
    collaborative_multiplier: float = 1.0


@dataclass
class GraphEdge:
    """An edge in the credit graph."""
    user_a: str
    user_b: str
    pool_id: str
    overlap_hours: float
    combined_tvl: float
    weight: float                   # overlap_hours * combined_tvl


class CreditGraphBuilder:
    """
    Builds and maintains the collaborative credit graph.

    Data sources:
      - Active positions (from position tracker / pool state)
      - Historical co-investment windows (from PostgreSQL credit_graph_edges)
      - CreditFeatures per user (from creditworthiness pipeline)
    """

    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: list[GraphEdge] = []
        self._adjacency: dict[str, list[str]] = defaultdict(list)

    async def build_from_positions(
        self,
        active_positions: list[dict[str, Any]],
    ) -> None:
        """
        Build co-investment edges from active position data.

        Each position dict should contain:
          - user_address: str
          - pool_id: str
          - tvl_usd: float
          - entry_timestamp: str (ISO)
          - (optional) exit_timestamp: str (ISO) or None if still active
        """
        # Group positions by pool
        pool_users: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for pos in active_positions:
            pool_id = pos.get("pool_id", "")
            if pool_id:
                pool_users[pool_id].append(pos)

        new_edges: list[GraphEdge] = []
        now = datetime.now(timezone.utc)

        for pool_id, positions in pool_users.items():
            # Generate pair-wise edges
            for i in range(len(positions)):
                for j in range(i + 1, len(positions)):
                    p_a = positions[i]
                    p_b = positions[j]
                    addr_a = p_a.get("user_address", "")
                    addr_b = p_b.get("user_address", "")

                    if addr_a == addr_b:
                        continue

                    # Compute overlap window
                    entry_a = _parse_ts(p_a.get("entry_timestamp"))
                    entry_b = _parse_ts(p_b.get("entry_timestamp"))
                    exit_a = _parse_ts(p_a.get("exit_timestamp")) or now
                    exit_b = _parse_ts(p_b.get("exit_timestamp")) or now

                    overlap_start = max(entry_a, entry_b)
                    overlap_end = min(exit_a, exit_b)
                    overlap_hours = max(0.0, (overlap_end - overlap_start).total_seconds() / 3600)

                    if overlap_hours < 1.0:
                        continue  # Minimum 1 hour overlap

                    combined_tvl = float(p_a.get("tvl_usd", 0)) + float(p_b.get("tvl_usd", 0))
                    weight = overlap_hours * combined_tvl

                    # Canonical edge ordering
                    a, b = (addr_a, addr_b) if addr_a < addr_b else (addr_b, addr_a)

                    edge = GraphEdge(
                        user_a=a,
                        user_b=b,
                        pool_id=pool_id,
                        overlap_hours=round(overlap_hours, 2),
                        combined_tvl=round(combined_tvl, 2),
                        weight=round(weight, 2),
                    )
                    new_edges.append(edge)

        self.edges = new_edges
        self._rebuild_adjacency()
        logger.info("Credit graph built: %d edges across %d pools", len(self.edges), len(pool_users))

    def _rebuild_adjacency(self) -> None:
        self._adjacency.clear()
        addr_set: set[str] = set()
        for e in self.edges:
            self._adjacency[e.user_a].append(e.user_b)
            self._adjacency[e.user_b].append(e.user_a)
            addr_set.add(e.user_a)
            addr_set.add(e.user_b)

        # Ensure all addresses have nodes
        for addr in addr_set:
            if addr not in self.nodes:
                self.nodes[addr] = GraphNode(address=addr, features=[0.0] * 18)

    def set_node_features(self, address: str, features: list[float], grade: str = "C") -> None:
        """Set credit features for a node."""
        if address in self.nodes:
            self.nodes[address].features = features
            self.nodes[address].credit_grade = grade
        else:
            self.nodes[address] = GraphNode(address=address, features=features, credit_grade=grade)

    def get_neighbors(self, address: str) -> list[str]:
        return list(set(self._adjacency.get(address, [])))

    def get_neighbor_edges(self, address: str) -> list[GraphEdge]:
        return [e for e in self.edges if e.user_a == address or e.user_b == address]

    def compute_collaborative_multiplier(self, address: str) -> float:
        """
        Compute the collaborative multiplier for a user based on their
        neighbors' credit quality and edge weights.

        Formula:
          multiplier = 1.0 + sum(neighbor_grade_bonus * normalized_weight) / max_possible
          Capped at [1.0, 2.0]

        Grade bonuses: AAA=0.5, AA=0.4, A=0.3, B=0.1, C=0.0
        """
        grade_bonus = {"AAA": 0.5, "AA": 0.4, "A": 0.3, "B": 0.1, "C": 0.0}

        neighbor_edges = self.get_neighbor_edges(address)
        if not neighbor_edges:
            return 1.0

        total_weight = sum(e.weight for e in neighbor_edges)
        if total_weight <= 0:
            return 1.0

        weighted_bonus = 0.0
        for edge in neighbor_edges:
            neighbor_addr = edge.user_b if edge.user_a == address else edge.user_a
            neighbor_node = self.nodes.get(neighbor_addr)
            if neighbor_node:
                bonus = grade_bonus.get(neighbor_node.credit_grade, 0.0)
                normalized_weight = edge.weight / total_weight
                weighted_bonus += bonus * normalized_weight

        # Scale: max bonus = 0.5 (if all neighbors AAA), gives multiplier = 1.5
        # Extended up to 2.0 for large diverse networks
        network_size_bonus = min(0.5, len(neighbor_edges) * 0.05)  # 0.05 per neighbor, max 0.5
        multiplier = 1.0 + weighted_bonus + network_size_bonus

        return round(min(2.0, max(1.0, multiplier)), 3)

    async def persist_edges(self) -> int:
        """Persist current edges to PostgreSQL."""
        try:
            from app.db.connection import get_pool
            pool = await get_pool()
        except Exception as exc:
            logger.warning("Cannot persist credit graph edges: %s", exc)
            return 0

        count = 0
        async with pool.acquire() as conn:
            for edge in self.edges:
                await conn.execute(
                    """
                    INSERT INTO credit_graph_edges (user_a, user_b, pool_id, overlap_hours, combined_tvl, weight, first_overlap, last_updated)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                    ON CONFLICT (user_a, user_b, pool_id)
                    DO UPDATE SET
                        overlap_hours = GREATEST(credit_graph_edges.overlap_hours, EXCLUDED.overlap_hours),
                        combined_tvl = EXCLUDED.combined_tvl,
                        weight = EXCLUDED.weight,
                        last_updated = NOW()
                    """,
                    edge.user_a, edge.user_b, edge.pool_id,
                    edge.overlap_hours, edge.combined_tvl, edge.weight,
                )
                count += 1

        logger.info("Persisted %d credit graph edges", count)
        return count

    async def load_edges(self) -> int:
        """Load edges from PostgreSQL."""
        try:
            from app.db.connection import get_pool
            pool = await get_pool()
        except Exception as exc:
            logger.warning("Cannot load credit graph edges: %s", exc)
            return 0

        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM credit_graph_edges")

        self.edges = []
        for row in rows:
            self.edges.append(GraphEdge(
                user_a=row["user_a"],
                user_b=row["user_b"],
                pool_id=row["pool_id"],
                overlap_hours=float(row["overlap_hours"]),
                combined_tvl=float(row["combined_tvl"]),
                weight=float(row["weight"]),
            ))

        self._rebuild_adjacency()
        logger.info("Loaded %d credit graph edges from DB", len(self.edges))
        return len(self.edges)


# ── Utilities ───────────────────────────────────────────────────────────

def _parse_ts(val: Any) -> datetime | None:
    """Parse an ISO timestamp or return None."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


# ── Singleton ───────────────────────────────────────────────────────────

_builder: CreditGraphBuilder | None = None


def get_credit_graph_builder() -> CreditGraphBuilder:
    global _builder
    if _builder is None:
        _builder = CreditGraphBuilder()
    return _builder
