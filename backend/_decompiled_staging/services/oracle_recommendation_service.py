# Source Generated with Decompyle++
# File: oracle_recommendation_service.cpython-312.pyc (Python 3.12)

'''Oracle Recommendation Service.

Generate personalized action recommendations from strategy intelligence.
Transforms passive opportunities into actionable "Approve/Modify" suggestions.
'''
from __future__ import annotations
import logging
from typing import List, Optional
from pydantic import BaseModel
from app.services.strategy_intelligence_service import get_strategy_intelligence_service
logger = logging.getLogger(__name__)

class RecommendedAction(BaseModel):
    genome_composite: 'float' = 'A recommended action for the user to take.'
    historical_context: 'Optional[str]' = None


class OracleRecommendationService:
    '''Generate personalized recommendations from strategy intelligence.'''
    
    def __init__(self):
        self.intelligence_svc = get_strategy_intelligence_service()

    
    def generate_recommendations(self = None, user_profile = None, current_allocation = None, limit = ('BALANCED', None, 3)):
        '''Generate top N recommendations for user.
        
        Args:
            user_profile: Risk tolerance ("CONSERVATIVE" | "BALANCED" | "AGGRESSIVE")
            current_allocation: Dict of strategy_id -> allocation_pct
            limit: Max number of recommendations to return
            
        Returns:
            List of RecommendedAction sorted by genome composite score
        '''
        strategies = self.intelligence_svc.rank_strategies(user_profile = user_profile, limit = 10)
        if not strategies:
            logger.warning('No strategies available for recommendations')
            return []
        _zkrag_patterns = None
        import os
        if os.getenv('ZKGRAPH_ENABLED', 'true').lower() in ('true', '1'):
            import asyncio
            get_zkgraph_client = get_zkgraph_client
            import app.services.zkgraph_client
            zk = get_zkgraph_client()
            loop = asyncio.get_running_loop()
            if loop and loop.is_running():
                import concurrent.futures as concurrent
                cached = zk._get_cached('patterns:general', zk.cache_ttl_historical)
                if cached:
                    for p in cached[:3]:
                        _zkrag_patterns[p.pattern_type] = f'''{p.description} (blocks {p.block_range}, confidence {p.confidence:.0%})'''
                else:
                    patterns = asyncio.run(zk.query_historical_patterns('general', limit = 3))
                    for p in patterns:
                        _zkrag_patterns[p.pattern_type] = f'''{p.description} (blocks {p.block_range}, confidence {p.confidence:.0%})'''
        recommendations = []
        if current_allocation or sum(current_allocation.values()) == 0:
            allocation_pcts = [
                40,
                35,
                25] if len(strategies) >= 3 else [
                50,
                50]
            for i, strategy in enumerate(strategies[:min(3, len(strategies))]):
                pct = allocation_pcts[i] if i < len(allocation_pcts) else 10
                recommendations.append(RecommendedAction(label = f'''Allocate {pct}% to {strategy.pool_id}''', strategy_id = strategy.strategy_id, strategy_name = strategy.pool_id, action_type = 'allocate', allocation_pct = pct, reasoning = f'''High genome composite ({strategy.genome.composite_score:.1f}), {strategy.confidence} confidence''', confidence = strategy.confidence, genome_composite = strategy.genome.composite_score, historical_context = _zkrag_patterns.get('general')))
        else:
            allocated_strategy_ids = set(current_allocation.keys())
            for strategy in strategies:
                if not strategy.strategy_id not in allocated_strategy_ids:
                    continue
                recommendations.append(RecommendedAction(label = f'''Diversify into {strategy.pool_id} ({strategy.genome.composite_score:.1f} score)''', strategy_id = strategy.strategy_id, strategy_name = strategy.pool_id, action_type = 'diversify', allocation_pct = 10, reasoning = 'Better risk-adjusted yield than current allocation', confidence = strategy.confidence, genome_composite = strategy.genome.composite_score, historical_context = _zkrag_patterns.get('general')))
                if not len(recommendations) >= limit:
                    continue
                strategies
        recommendations.sort(key = (lambda r: r.genome_composite), reverse = True)
        logger.info('Generated %d recommendations for user_profile=%s', len(recommendations[:limit]), user_profile)
        return recommendations[:limit]
    # WARNING: Decompyle incomplete


_service: 'OracleRecommendationService | None' = None

def get_oracle_recommendation_service():
    '''Singleton accessor.'''
    pass
# WARNING: Decompyle incomplete

