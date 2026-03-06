"""
PostgreSQL connection pool for the decision event store.

Uses asyncpg for async access from FastAPI.
Falls back gracefully if PostgreSQL is unavailable (logs warning, returns None).

Config via environment:
  DATABASE_URL  — full connection string (default: postgresql://zkdefi:zkdefi@localhost:5432/zkdefi)
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://zkdefi:zkdefi@localhost:5432/zkdefi",
)

_pool = None
_pool_lock = asyncio.Lock()

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


async def get_pool():
    """Get or create the asyncpg connection pool. Returns None if unavailable."""
    global _pool
    if _pool is not None:
        return _pool

    async with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            import asyncpg
            _pool = await asyncpg.create_pool(
                DATABASE_URL,
                min_size=2,
                max_size=10,
                command_timeout=30,
            )
            logger.info("PostgreSQL pool created: %s", DATABASE_URL.split("@")[-1])
            return _pool
        except ImportError:
            logger.warning("asyncpg not installed. Decision store disabled. pip install asyncpg")
            return None
        except Exception as e:
            logger.warning("PostgreSQL connection failed: %s. Decision store disabled.", e)
            return None


async def close_pool():
    """Close the connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("PostgreSQL pool closed")


async def init_schema():
    """Run the schema SQL to create tables/views if they don't exist."""
    pool = await get_pool()
    if pool is None:
        logger.warning("Cannot init schema: no database connection")
        return False

    try:
        schema_sql = SCHEMA_PATH.read_text()
        async with pool.acquire() as conn:
            await conn.execute(schema_sql)
        logger.info("Database schema initialized")
        return True
    except Exception as e:
        logger.error("Schema initialization failed: %s", e)
        return False


async def refresh_behavior_stats():
    """Refresh the user_behavior_stats materialized view."""
    pool = await get_pool()
    if pool is None:
        return False
    try:
        async with pool.acquire() as conn:
            await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY user_behavior_stats")
        logger.debug("user_behavior_stats refreshed")
        return True
    except Exception as e:
        logger.warning("Failed to refresh behavior stats: %s", e)
        return False
