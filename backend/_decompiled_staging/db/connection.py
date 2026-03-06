# Source Generated with Decompyle++
# File: connection.cpython-312.pyc (Python 3.12)

'''
PostgreSQL connection pool for the decision event store.

Uses asyncpg for async access from FastAPI.
Falls back gracefully if PostgreSQL is unavailable (logs warning, returns None).

Config via environment:
  DATABASE_URL  — full connection string (default: postgresql://zkdefi:zkdefi@localhost:5432/zkdefi)
'''
from __future__ import annotations
import asyncio
import logging
import os
from pathlib import Path
logger = logging.getLogger(__name__)
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://zkdefi:zkdefi@localhost:5432/zkdefi')
_pool = None
_pool_lock = asyncio.Lock()
SCHEMA_PATH = Path(__file__).parent / 'schema.sql'

async def get_pool():
    '''Get or create the asyncpg connection pool. Returns None if unavailable.'''
    pass
# WARNING: Decompyle incomplete


async def close_pool():
    '''Close the connection pool.'''
    pass
# WARNING: Decompyle incomplete


async def init_schema():
    """Run the schema SQL to create tables/views if they don't exist."""
    pass
# WARNING: Decompyle incomplete


async def refresh_behavior_stats():
    '''Refresh the user_behavior_stats materialized view.'''
    pass
# WARNING: Decompyle incomplete

