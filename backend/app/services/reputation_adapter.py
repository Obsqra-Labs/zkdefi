"""
Reputation Adapter for Signals Integration.

Wraps the reputation service to provide protocol/entity trustworthiness
scores in the format expected by signals endpoints.
"""

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


class ReputationAdapter:
    """
    Adapter that exposes reputation service outputs as signal reputation scores.
    
    Maps reputation metrics to signal format:
    - Trust score (0-100)
    - Trustworthiness tier ("high", "moderate", "low")
    - Reputation model metadata
    """
    
    def __init__(self):
        self._protocol_reputation_cache: dict[str, dict[str, Any]] = {}
        self._cache_ttl = 3600  # 1 hour for reputation
        self._last_cache_time: dict[str, float] = {}
    
    def get_protocol_reputation(self, entity: str) -> dict[str, Any]:
        """
        Get reputation score for a protocol/entity.
        
        Args:
            entity: Protocol/entity name (e.g., "zkdefi-lending", "ekubo", "starknet")
            
        Returns:
            dict with reputation score and trustworthiness tier
        """
        try:
            # Check cache
            cached = self._get_cached_reputation(entity)
            if cached:
                logger.debug(f"Reputation cache hit for {entity}")
                return cached
            
            # Map entity to reputation scoring logic
            reputation = self._compute_reputation(entity)
            
            # Cache result
            self._cache_reputation(entity, reputation)
            
            return reputation
            
        except Exception as e:
            logger.error(f"Reputation adapter error for {entity}: {e}")
            return self._fallback_reputation(entity)
    
    def _compute_reputation(self, entity: str) -> dict[str, Any]:
        """
        Compute reputation for an entity based on known factors.
        
        In the future, this will integrate with the real reputation service.
        For now, use deterministic heuristics based on entity type.
        """
        entity_lower = entity.lower().strip()
        
        # Define base scores per entity type
        entity_scores = {
            # zkdefi protocols (highest trust - our own)
            "zkdefi-lending": 90,
            "zkdefi-staking": 92,
            "zkdefi-dca": 88,
            "zkdefi-limits": 87,
            "zkdefi": 89,
            
            # Known protocols (high trust)
            "ekubo": 85,
            "starknet": 88,
            "ethereum": 90,
            
            # DEX/trading (moderate-high)
            "uniswap": 82,
            "curve": 83,
            "balancer": 80,
            
            # Emerging (moderate)
            "aggregation": 75,
        }
        
        # Find best match
        score = 75  # Default moderate trust
        for key, value in entity_scores.items():
            if key in entity_lower:
                score = value
                break
        
        # Add slight reputation boost for age/stability
        if entity_lower in ["zkdefi", "starknet", "ethereum", "ekubo"]:
            score = min(100, score + 5)
        
        return {
            "entity": entity,
            "score": min(100, max(0, score)),
            "trustworthiness": self._score_to_tier(score),
            "model": "reputation-v1",
            "basis": "entity_type_and_history",
        }
    
    def _score_to_tier(self, score: int) -> str:
        """Convert reputation score (0-100) to trustworthiness tier."""
        if score >= 85:
            return "high"
        elif score >= 60:
            return "moderate"
        else:
            return "low"
    
    def _fallback_reputation(self, entity: str) -> dict[str, Any]:
        """Return neutral reputation on error."""
        return {
            "entity": entity,
            "score": 50,
            "trustworthiness": "moderate",
            "model": "reputation-v1",
            "error": f"Reputation unavailable for {entity}",
        }
    
    def _get_cached_reputation(self, entity: str) -> Optional[dict[str, Any]]:
        """Get reputation from cache if fresh."""
        import time
        now = time.time()
        last_time = self._last_cache_time.get(entity, 0)
        
        if (now - last_time) < self._cache_ttl and entity in self._protocol_reputation_cache:
            return self._protocol_reputation_cache[entity]
        
        return None
    
    def _cache_reputation(self, entity: str, reputation: dict[str, Any]) -> None:
        """Cache reputation with timestamp."""
        import time
        self._protocol_reputation_cache[entity] = reputation
        self._last_cache_time[entity] = time.time()
