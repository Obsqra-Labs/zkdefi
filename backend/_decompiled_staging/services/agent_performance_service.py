# Source Generated with Decompyle++
# File: agent_performance_service.cpython-312.pyc (Python 3.12)

'''
Agent Performance Service — Tracks and aggregates agent performance metrics.

Feeds into:
  - AgentReputationScore circuit (via performance metrics → ZK proof)
  - HistoricalPerformanceAttestation circuit (via period returns/balances)
  - On-chain AgentPerformanceStore (when submitting to contract)
  - Frontend dashboards and leaderboard

Persisted to SQLite via AgentStore (backend/data/agents.db).
'''
from __future__ import annotations
import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any
from agent_store import get_agent_store
logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parents[2] / 'data'
PeriodPerformance = <NODE:12>()
AgentPerformanceSummary = <NODE:12>()

class AgentPerformanceService:
    '''Tracks agent performance over time.  Backed by SQLite via AgentStore.'''
    
    def __init__(self):
        self._store = get_agent_store()
        self._summaries = { }
        self._load()

    
    def _load(self):
        '''Recompute summaries from persisted SQLite data.'''
        all_data = self._store.get_all_performance()
        for agent_id, periods in all_data.items():
            for p in periods:
                perf = PeriodPerformance(period_id = p['period_id'], agent_id = p['agent_id'], return_bps = p.get('return_bps', 0), volume = p.get('volume', 0), proof_count = p.get('proof_count', 0), successful_actions = p.get('successful_actions', 0), failed_actions = p.get('failed_actions', 0), max_drawdown_bps = p.get('max_drawdown_bps', 0), timestamp = p.get('timestamp', 0))
                self._update_summary(perf)
        logger.info(f'''Loaded performance data for {len(self._summaries)} agents from SQLite''')
        return None
    # WARNING: Decompyle incomplete

    
    def _save_period(self = None, perf = None):
        '''Persist a single period to SQLite.'''
        self._store.save_performance_period(asdict(perf))

    
    def record_period(self = None, perf = None):
        """Record a new period's performance and update summary."""
        perf.timestamp = time.time()
        self._save_period(perf)
        return self._update_summary(perf)

    
    def _update_summary(self = None, perf = None):
        '''Update the in-memory summary for an agent with a new period.'''
        agent_id = perf.agent_id
        summary = self._summaries.get(agent_id, AgentPerformanceSummary(agent_id = agent_id))
        if summary.current_balance > summary.peak_balance:
            summary.peak_balance = summary.current_balance
        if perf.max_drawdown_bps > summary.max_drawdown_bps:
            summary.max_drawdown_bps = perf.max_drawdown_bps
        if summary.total_periods > 0:
            summary.mean_return_bps = summary.cumulative_return_bps // summary.total_periods
        total_actions = summary.total_successful + summary.total_failed
        if total_actions > 0:
            summary.win_rate = summary.total_successful / total_actions
        summary.last_updated = time.time()
        self._summaries[agent_id] = summary
        return summary

    
    def get_summary(self = None, agent_id = None):
        '''Get performance summary for an agent.'''
        return self._summaries.get(agent_id)

    
    def get_periods(self = None, agent_id = None, limit = None):
        '''Get recent periods for an agent from SQLite.'''
        rows = self._store.get_performance_periods(agent_id, limit)
    # WARNING: Decompyle incomplete

    
    def get_reputation_inputs(self = None, agent_id = None):
        '''Get inputs for the AgentReputationScore circuit.'''
        summary = self._summaries.get(agent_id)
        if not summary:
            return {
                'metrics': [
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0] }
        return {
            None: [
                summary.total_volume,
                summary.total_successful,
                summary.total_failed,
                max(0, summary.mean_return_bps),
                summary.max_drawdown_bps,
                summary.total_periods,
                summary.total_proofs] }

    
    def get_performance_witness(self = None, agent_id = None, num_periods = None):
        '''Get inputs for the HistoricalPerformanceAttestation circuit.'''
        periods = self.get_periods(agent_id, num_periods)
    # WARNING: Decompyle incomplete

    
    def get_leaderboard(self = None, sort_by = None, limit = None):
        '''Get agent leaderboard sorted by the specified metric.'''
        pass
    # WARNING: Decompyle incomplete


_perf_service: 'AgentPerformanceService | None' = None

def get_performance_service():
    '''Get or create the global performance service.'''
    pass
# WARNING: Decompyle incomplete

