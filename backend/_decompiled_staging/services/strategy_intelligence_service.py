# Source Generated with Decompyle++
# File: strategy_intelligence_service.cpython-312.pyc (Python 3.12)

'''
Strategy Intelligence Service — compute genome factors, rank strategies, track performance.
'''
from __future__ import annotations
import logging
from datetime import datetime
from typing import List, Optional
from app.models.strategy import Strategy, GenomeFactors, PerformanceSnapshot
from app.services.strategy_repository import get_strategy_repository, _generate_strategy_id
logger = logging.getLogger(__name__)

class StrategyIntelligenceService:
    '''Compute genome factors, rank strategies, track performance.'''
    
    def __init__(self):
        self.repo = get_strategy_repository()

    
    def compute_genome(self, apy, risk_score = None, tvl_usd = None, volatility_pct = None, volume_24h_usd = ('apy', 'float', 'risk_score', 'float', 'tvl_usd', 'float', 'volatility_pct', 'float', 'volume_24h_usd', 'float', 'return', 'GenomeFactors')):
        '''Compute 0-100 genome factors from raw metrics.
        
        Args:
            apy: Annual percentage yield (0-100+)
            risk_score: zkML risk score (0-100)
            tvl_usd: Total value locked in USD
            volatility_pct: 24h price volatility percentage (0-100+)
            volume_24h_usd: 24h trading volume in USD
        
        Returns:
            GenomeFactors with normalized 0-100 scores
        '''
        yield_score = min(100, apy)
        risk_factor = risk_score
        volatility_score = max(0, 100 - volatility_pct * 2)
        if tvl_usd < 10000:
            liquidity_score = 0
        elif tvl_usd < 100000:
            liquidity_score = 20 + ((tvl_usd - 10000) / 90000) * 30
        elif tvl_usd < 1000000:
            liquidity_score = 50 + ((tvl_usd - 100000) / 900000) * 25
        else:
            liquidity_score = min(100, 75 + ((tvl_usd - 1000000) / 9000000) * 25)
        risk_penalty = risk_factor / 100
        efficiency_score = min(100, apy * (1 - risk_penalty * 0.5))
        return GenomeFactors(yield_score = yield_score, risk_score = risk_factor, volatility_score = volatility_score, liquidity_score = liquidity_score, efficiency_score = efficiency_score)

    
    def create_or_update_strategy(self, pool_id, protocol, token0, token1, fee_tier, apy, tvl_usd, volume_24h_usd = None, confidence = None, zkml_risk_score = None, zkml_flags = (None, None, 10), volatility_pct = ('pool_id', 'str', 'protocol', 'str', 'token0', 'str', 'token1', 'str', 'fee_tier', 'float', 'apy', 'float', 'tvl_usd', 'float', 'volume_24h_usd', 'float', 'confidence', 'str', 'zkml_risk_score', 'Optional[int]', 'zkml_flags', 'Optional[List[str]]', 'volatility_pct', 'float', 'return', 'Strategy')):
        '''Create new or update existing strategy with computed genome.'''
        strategy_id = _generate_strategy_id(pool_id, protocol, token0, token1, fee_tier)
    # WARNING: Decompyle incomplete

    
    def rank_strategies(self = None, user_profile = None, min_tvl = None, max_risk = ('BALANCED', 0, 100, 20), limit = ('user_profile', 'str', 'min_tvl', 'float', 'max_risk', 'float', 'limit', 'int', 'return', 'List[Strategy]')):
        '''Rank strategies by composite score with filters.'''
        profile_risk = {
            'CONSERVATIVE': 40,
            'BALANCED': 65,
            'AGGRESSIVE': 100 }
        effective_max_risk = min(max_risk, profile_risk.get(user_profile.upper(), 65))
        strategies = self.repo.list_strategies({
            'min_tvl': min_tvl,
            'max_risk': effective_max_risk })
        ranked = sorted(strategies, key = (lambda s: s.genome.composite_score), reverse = True)
        return ranked[:limit]


_service: 'StrategyIntelligenceService | None' = None

def get_strategy_intelligence_service():
    '''Singleton accessor.'''
    pass
# WARNING: Decompyle incomplete

