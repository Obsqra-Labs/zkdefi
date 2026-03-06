# Source Generated with Decompyle++
# File: strategy_repository.cpython-312.pyc (Python 3.12)

'''
Strategy Repository — persistent storage for strategies and performance history.
'''
from __future__ import annotations
import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from app.models.strategy import Strategy, PerformanceSnapshot
logger = logging.getLogger(__name__)
_STRATEGIES_FILE = Path(__file__).resolve().parents[2] / 'data' / 'strategies.json'
_PERFORMANCE_FILE = Path(__file__).resolve().parents[2] / 'data' / 'strategy_performance.json'

def _generate_strategy_id(pool_id, protocol = None, token0 = None, token1 = None, fee_tier = ('pool_id', 'str', 'protocol', 'str', 'token0', 'str', 'token1', 'str', 'fee_tier', 'float', 'return', 'str')):
    '''Generate content-addressable strategy ID from pool metadata.'''
    content = f'''{pool_id}|{protocol}|{token0}|{token1}|{fee_tier}'''
    return hashlib.sha256(content.encode()).hexdigest()[:16]


class StrategyRepository:
    '''Persistent storage for Strategy entities and performance history.'''
    
    def __init__(self):
        self._ensure_files()

    
    def _ensure_files(self):
        """Create storage files if they don't exist."""
        _STRATEGIES_FILE.parent.mkdir(parents = True, exist_ok = True)
        if not _STRATEGIES_FILE.exists():
            _STRATEGIES_FILE.write_text('{}')
        if not _PERFORMANCE_FILE.exists():
            _PERFORMANCE_FILE.write_text('[]')
            return None

    
    def save_strategy(self = None, strategy = None):
        '''Save or update a strategy. Returns strategy_id.'''
        strategies = json.loads(_STRATEGIES_FILE.read_text())
        strategies[strategy.strategy_id] = strategy.model_dump(mode = 'json')
        _STRATEGIES_FILE.write_text(json.dumps(strategies, indent = 2))
        logger.info('Saved strategy %s', strategy.strategy_id)
        return strategy.strategy_id
    # WARNING: Decompyle incomplete

    
    def get_strategy(self = None, strategy_id = None):
        '''Retrieve a strategy by ID.'''
        strategies = json.loads(_STRATEGIES_FILE.read_text())
        data = strategies.get(strategy_id)
        if not data:
            return None
        return Strategy.model_validate(data)
    # WARNING: Decompyle incomplete

    
    def list_strategies(self = None, filters = None):
        '''List all strategies, optionally filtered.'''
        strategies = json.loads(_STRATEGIES_FILE.read_text())
    # WARNING: Decompyle incomplete

    
    def record_performance(self = None, snapshot = None):
        '''Append a performance snapshot (append-only).'''
        history = json.loads(_PERFORMANCE_FILE.read_text())
        history.append(snapshot.model_dump(mode = 'json'))
        _PERFORMANCE_FILE.write_text(json.dumps(history, indent = 2))
        logger.debug('Recorded performance for %s', snapshot.strategy_id)
        return None
    # WARNING: Decompyle incomplete

    
    def get_performance_history(self = None, strategy_id = None, limit = None):
        '''Get historical performance snapshots for a strategy.'''
        history = json.loads(_PERFORMANCE_FILE.read_text())
    # WARNING: Decompyle incomplete


_repo: 'StrategyRepository | None' = None

def get_strategy_repository():
    '''Singleton accessor.'''
    pass
# WARNING: Decompyle incomplete

