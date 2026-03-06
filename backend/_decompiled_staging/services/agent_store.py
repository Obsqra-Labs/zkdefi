# Source Generated with Decompyle++
# File: agent_store.cpython-312.pyc (Python 3.12)

'''
Agent Store — SQLite-backed persistence for identity-bound agents.

Replaces the in-memory dict[str, AgentConfig] with durable storage.
Follows the same WAL / RLock pattern as ledger_service.py.

Tables:
  agents              — core agent config (survives restarts)
  agent_llm_bindings  — which LLM provider each agent is bound to
  agent_performance   — period-by-period performance records
'''
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
DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / 'data' / 'agents.db'

class AgentStore:
    '''SQLite-backed agent persistence.'''
    
    def __init__(self = None, db_path = None):
        self._db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self._lock = threading.RLock()
        self._db_path.parent.mkdir(parents = True, exist_ok = True)
        self._init_db()

    
    def _connect(self = None):
        conn = sqlite3.connect(str(self._db_path))
        conn.execute('PRAGMA journal_mode=WAL;')
        conn.execute('PRAGMA synchronous=NORMAL;')
        conn.row_factory = sqlite3.Row
        return conn

    
    def _init_db(self = None):
        pass
    # WARNING: Decompyle incomplete

    
    def save_agent(self = None, agent = None):
        '''Insert or update an agent.  Accepts a dict with AgentConfig-like keys.'''
        now = time.time()
        skills_json = json.dumps(agent.get('bound_skills', []))
    # WARNING: Decompyle incomplete

    
    def get_agent(self = None, agent_id = None):
        '''Fetch a single agent by ID.  Returns dict or None.'''
        pass
    # WARNING: Decompyle incomplete

    
    def list_agents(self = None, owner = None):
        '''List all agents, optionally filtered by owner.'''
        pass
    # WARNING: Decompyle incomplete

    
    def update_agent(self = None, agent_id = None, updates = None):
        '''Partial update.  Returns True if the row existed.'''
        allowed = {
            'name',
            'active',
            'llm_model',
            'bound_skills',
            'llm_provider_id',
            'reputation_tier',
            'identity_commitment'}
        parts = []
        values = []
        for key, val in updates.items():
            if key not in allowed:
                continue
            if key == 'bound_skills':
                val = json.dumps(val) if isinstance(val, list) else val
            if key == 'active':
                val = 1 if val else 0
            parts.append(f'''{key} = ?''')
            values.append(val)
        if not parts:
            return False
        parts.append('updated_at = ?')
        values.append(time.time())
        values.append(agent_id)
    # WARNING: Decompyle incomplete

    
    def delete_agent(self = None, agent_id = None):
        '''Delete an agent and its bindings / performance data.  Returns True if existed.'''
        pass
    # WARNING: Decompyle incomplete

    
    def save_binding(self = None, agent_id = None, provider_id = None, config_hash = ('',)):
        '''Persist agent → LLM provider binding.'''
        now = time.time()
    # WARNING: Decompyle incomplete

    
    def get_binding(self = None, agent_id = None):
        '''Get the LLM provider ID bound to an agent.'''
        pass
    # WARNING: Decompyle incomplete

    
    def list_bindings(self = None):
        '''Return all agent→provider bindings.'''
        pass
    # WARNING: Decompyle incomplete

    
    def save_performance_period(self = None, period = None):
        '''Insert a performance period record.'''
        pass
    # WARNING: Decompyle incomplete

    
    def get_performance_periods(self = None, agent_id = None, limit = None):
        '''Get the most recent performance periods for an agent.'''
        pass
    # WARNING: Decompyle incomplete

    
    def get_all_performance(self = None):
        '''Load all performance data grouped by agent.  Used for summary recomputation.'''
        pass
    # WARNING: Decompyle incomplete

    _row_to_dict = (lambda row = None: d = dict(row)if 'bound_skills' in d and isinstance(d['bound_skills'], str):
d['bound_skills'] = json.loads(d['bound_skills'])if 'active' in d:
d['active'] = bool(d['active'])d# WARNING: Decompyle incomplete
)()

_store: 'AgentStore | None' = None

def get_agent_store():
    '''Get or create the global AgentStore singleton.'''
    pass
# WARNING: Decompyle incomplete

