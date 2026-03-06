"""
Strategy Repository — persistent storage for strategies and performance history.
"""
from __future__ import annotations
import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from app.models.strategy import Strategy, PerformanceSnapshot

logger = logging.getLogger(__name__)

_STRATEGIES_FILE = Path(__file__).resolve().parents[2] / "data" / "strategies.json"
_PERFORMANCE_FILE = Path(__file__).resolve().parents[2] / "data" / "strategy_performance.json"


def _generate_strategy_id(pool_id: str, protocol: str, token0: str, token1: str, fee_tier: float) -> str:
    """Generate content-addressable strategy ID from pool metadata."""
    content = f"{pool_id}|{protocol}|{token0}|{token1}|{fee_tier}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


class StrategyRepository:
    """Persistent storage for Strategy entities and performance history."""
    
    def __init__(self):
        self._ensure_files()
    
    def _ensure_files(self):
        """Create storage files if they don't exist."""
        _STRATEGIES_FILE.parent.mkdir(parents=True, exist_ok=True)
        if not _STRATEGIES_FILE.exists():
            _STRATEGIES_FILE.write_text("{}")
        if not _PERFORMANCE_FILE.exists():
            _PERFORMANCE_FILE.write_text("[]")
    
    def save_strategy(self, strategy: Strategy) -> str:
        """Save or update a strategy. Returns strategy_id."""
        try:
            strategies = json.loads(_STRATEGIES_FILE.read_text())
            strategies[strategy.strategy_id] = strategy.model_dump(mode="json")
            _STRATEGIES_FILE.write_text(json.dumps(strategies, indent=2))
            logger.info("Saved strategy %s", strategy.strategy_id)
            return strategy.strategy_id
        except Exception as exc:
            logger.error("Failed to save strategy %s: %s", strategy.strategy_id, exc)
            raise
    
    def get_strategy(self, strategy_id: str) -> Optional[Strategy]:
        """Retrieve a strategy by ID."""
        try:
            strategies = json.loads(_STRATEGIES_FILE.read_text())
            data = strategies.get(strategy_id)
            if not data:
                return None
            return Strategy.model_validate(data)
        except Exception as exc:
            logger.error("Failed to get strategy %s: %s", strategy_id, exc)
            return None
    
    def list_strategies(self, filters: dict | None = None) -> List[Strategy]:
        """List all strategies, optionally filtered."""
        try:
            strategies = json.loads(_STRATEGIES_FILE.read_text())
            results = [Strategy.model_validate(data) for data in strategies.values()]
            
            if filters:
                if "protocol" in filters:
                    results = [s for s in results if s.protocol == filters["protocol"]]
                if "min_tvl" in filters:
                    results = [s for s in results if s.tvl_usd >= filters["min_tvl"]]
                if "max_risk" in filters:
                    results = [s for s in results if s.genome.risk_score <= filters["max_risk"]]
            
            return results
        except Exception as exc:
            logger.error("Failed to list strategies: %s", exc)
            return []
    
    def record_performance(self, snapshot: PerformanceSnapshot):
        """Append a performance snapshot (append-only)."""
        try:
            history = json.loads(_PERFORMANCE_FILE.read_text())
            history.append(snapshot.model_dump(mode="json"))
            _PERFORMANCE_FILE.write_text(json.dumps(history, indent=2))
            logger.debug("Recorded performance for %s", snapshot.strategy_id)
        except Exception as exc:
            logger.error("Failed to record performance: %s", exc)
    
    def get_performance_history(self, strategy_id: str, limit: int = 100) -> List[PerformanceSnapshot]:
        """Get historical performance snapshots for a strategy."""
        try:
            history = json.loads(_PERFORMANCE_FILE.read_text())
            snapshots = [
                PerformanceSnapshot.model_validate(snap)
                for snap in history
                if snap.get("strategy_id") == strategy_id
            ]
            return snapshots[-limit:]  # Most recent N
        except Exception as exc:
            logger.error("Failed to get performance history: %s", exc)
            return []


_repo: StrategyRepository | None = None

def get_strategy_repository() -> StrategyRepository:
    """Singleton accessor."""
    global _repo
    if _repo is None:
        _repo = StrategyRepository()
    return _repo
