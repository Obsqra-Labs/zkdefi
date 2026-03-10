"""
Redis-backed nonce manager for multi-instance deployments.

Provides atomic nonce management across multiple backend instances.
"""

import logging
import asyncio
from typing import Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class RedisNonceManager:
    """Manages per-address nonce using Redis for coordination."""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        """
        Initialize Redis nonce manager.
        
        Args:
            redis_url: Redis connection URL (default: local)
        """
        self.redis_url = redis_url
        self.redis_client = None
        self._initialized = False
    
    async def initialize(self) -> bool:
        """
        Initialize Redis connection.
        
        Returns:
            True if connected, False if unavailable
        """
        try:
            import redis.asyncio as redis
            
            self.redis_client = await redis.from_url(self.redis_url, decode_responses=True)
            
            # Test connection
            await self.redis_client.ping()
            logger.info(f"Redis nonce manager initialized: {self.redis_url}")
            self._initialized = True
            return True
        
        except Exception as e:
            logger.warning(f"Failed to initialize Redis: {e}. Fallback mode enabled.")
            self._initialized = False
            return False
    
    async def get_nonce(self, address: str) -> Optional[int]:
        """
        Get current nonce for address.
        
        Args:
            address: Starknet address
            
        Returns:
            Current nonce or None if unavailable
        """
        if not self.redis_client:
            return None
        
        try:
            key = f"nonce:{address}"
            nonce = await self.redis_client.get(key)
            
            if nonce is None:
                # Initialize at 0
                await self.redis_client.set(key, "0", ex=3600)  # 1 hour TTL
                return 0
            
            return int(nonce)
        
        except Exception as e:
            logger.error(f"Failed to get nonce for {address}: {e}")
            return None
    
    async def increment_nonce(self, address: str) -> Optional[int]:
        """
        Atomically increment nonce for address.
        
        This is thread-safe and works across multiple instances.
        
        Args:
            address: Starknet address
            
        Returns:
            New nonce value or None if failed
        """
        if not self.redis_client:
            return None
        
        try:
            key = f"nonce:{address}"
            
            # Use INCR for atomic increment
            new_nonce = await self.redis_client.incr(key)
            
            # Set TTL (refresh every time it's used)
            await self.redis_client.expire(key, 3600)
            
            logger.debug(f"Nonce incremented for {address}: {new_nonce}")
            return new_nonce
        
        except Exception as e:
            logger.error(f"Failed to increment nonce for {address}: {e}")
            return None
    
    async def set_nonce(self, address: str, nonce: int) -> bool:
        """
        Set nonce for address (override).
        
        Use sparingly - only for recovery scenarios.
        
        Args:
            address: Starknet address
            nonce: Nonce value to set
            
        Returns:
            True if successful
        """
        if not self.redis_client:
            return False
        
        try:
            key = f"nonce:{address}"
            await self.redis_client.set(key, str(nonce), ex=3600)
            logger.warning(f"Nonce overridden for {address}: {nonce}")
            return True
        
        except Exception as e:
            logger.error(f"Failed to set nonce for {address}: {e}")
            return False
    
    async def reset_nonce(self, address: Optional[str] = None):
        """
        Reset nonce(s).
        
        Args:
            address: Specific address to reset, or None for all
        """
        if not self.redis_client:
            return
        
        try:
            if address:
                key = f"nonce:{address}"
                await self.redis_client.delete(key)
                logger.info(f"Nonce reset for {address}")
            else:
                # Reset all nonces
                keys = await self.redis_client.keys("nonce:*")
                if keys:
                    await self.redis_client.delete(*keys)
                    logger.info(f"Reset {len(keys)} nonce entries")
        
        except Exception as e:
            logger.error(f"Failed to reset nonce: {e}")
    
    async def get_stats(self) -> dict:
        """Get nonce manager statistics."""
        if not self.redis_client:
            return {"status": "unavailable"}
        
        try:
            keys = await self.redis_client.keys("nonce:*")
            
            stats = {
                "status": "connected",
                "active_addresses": len(keys or []),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            
            return stats
        
        except Exception as e:
            logger.error(f"Failed to get stats: {e}")
            return {"status": "error", "error": str(e)}
    
    async def close(self):
        """Close Redis connection."""
        if self.redis_client:
            await self.redis_client.close()
            logger.info("Redis nonce manager closed")


# Singleton
_nonce_manager: Optional[RedisNonceManager] = None


def get_nonce_manager(redis_url: str = "redis://localhost:6379") -> RedisNonceManager:
    """Get or create singleton nonce manager."""
    global _nonce_manager
    if _nonce_manager is None:
        _nonce_manager = RedisNonceManager(redis_url=redis_url)
    return _nonce_manager


async def initialize_nonce_manager(redis_url: str = "redis://localhost:6379") -> bool:
    """Initialize nonce manager. Must be called on app startup."""
    manager = get_nonce_manager(redis_url)
    return await manager.initialize()
