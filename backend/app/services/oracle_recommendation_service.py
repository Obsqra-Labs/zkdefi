"""Oracle Recommendation Service.

Generate personalized action recommendations from strategy intelligence.
Transforms passive opportunities into actionable "Approve/Modify" suggestions.
"""
from __future__ import annotations
import logging
from typing import List, Optional
from pydantic import BaseModel

from app.services.strategy_intelligence_service import get_strategy_intelligence_service

logger = logging.getLogger(__name__)


class RecommendedAction(BaseModel):
    """A recommended action for the user to take."""
    label: str  # User-facing description
    strategy_id: str
    strategy_name: str  # e.g. "ETH/USDC"
    action_type: str  # "allocate" | "rebalance" | "diversify"
    allocation_pct: float  # Suggested allocation percentage
    reasoning: str  # Why this recommendation
    confidence: str  # "high" | "medium" | "low"
    genome_composite: float  # For sorting


class OracleRecommendationService:
    """Generate personalized recommendations from strategy intelligence."""
    
    def __init__(self):
        self.intelligence_svc = get_strategy_intelligence_service()
    
    def generate_recommendations(
        self,
        user_profile: str = "BALANCED",
        current_allocation: dict[str, float] | None = None,
        limit: int = 3,
    ) -> List[RecommendedAction]:
        """Generate top N recommendations for user.
        
        Args:
            user_profile: Risk tolerance ("CONSERVATIVE" | "BALANCED" | "AGGRESSIVE")
            current_allocation: Dict of strategy_id -> allocation_pct
            limit: Max number of recommendations to return
            
        Returns:
            List of RecommendedAction sorted by genome composite score
        """
        # Get top ranked strategies
        strategies = self.intelligence_svc.rank_strategies(
            user_profile=user_profile,
            limit=10,
        )
        
        if not strategies:
            logger.warning("No strategies available for recommendations")
            return []
        
        recommendations = []
        
        # Rule 1: If no current allocation, suggest diversified start
        if not current_allocation or sum(current_allocation.values()) == 0:
            # Suggest top 3 strategies with balanced allocation
            allocation_pcts = [40, 35, 25] if len(strategies) >= 3 else [50, 50]
            for i, strategy in enumerate(strategies[:min(3, len(strategies))]):
                pct = allocation_pcts[i] if i < len(allocation_pcts) else 10
                recommendations.append(RecommendedAction(
                    label=f"Allocate {pct}% to {strategy.pool_id}",
                    strategy_id=strategy.strategy_id,
                    strategy_name=strategy.pool_id,
                    action_type="allocate",
                    allocation_pct=pct,
                    reasoning=f"High genome composite ({strategy.genome.composite_score:.1f}), {strategy.confidence} confidence",
                    confidence=strategy.confidence,
                    genome_composite=strategy.genome.composite_score,
                ))
        
        # Rule 2: If allocated, suggest rebalance to higher-scoring strategies
        else:
            allocated_strategy_ids = set(current_allocation.keys())
            # Find better strategies not currently allocated
            for strategy in strategies:
                if strategy.strategy_id not in allocated_strategy_ids:
                    recommendations.append(RecommendedAction(
                        label=f"Diversify into {strategy.pool_id} ({strategy.genome.composite_score:.1f} score)",
                        strategy_id=strategy.strategy_id,
                        strategy_name=strategy.pool_id,
                        action_type="diversify",
                        allocation_pct=10,
                        reasoning=f"Better risk-adjusted yield than current allocation",
                        confidence=strategy.confidence,
                        genome_composite=strategy.genome.composite_score,
                    ))
                    if len(recommendations) >= limit:
                        break
        
        # Sort by genome composite (descending)
        recommendations.sort(key=lambda r: r.genome_composite, reverse=True)
        
        logger.info(
            "Generated %d recommendations for user_profile=%s",
            len(recommendations[:limit]),
            user_profile,
        )
        
        return recommendations[:limit]


_service: OracleRecommendationService | None = None


def get_oracle_recommendation_service() -> OracleRecommendationService:
    """Singleton accessor."""
    global _service
    if _service is None:
        _service = OracleRecommendationService()
    return _service
