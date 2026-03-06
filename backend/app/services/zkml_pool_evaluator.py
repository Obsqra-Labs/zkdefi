"""
zkML Pool Evaluation Service

Evaluates pool risk using zkML circuit evaluation.
In MVP: Uses heuristics to calculate risk scores.
In production: Generates actual STARK proofs.
"""

from dataclasses import dataclass
from typing import List, Optional, Dict
from datetime import datetime, timedelta
import hashlib
import math
from enum import Enum


class RiskFlagType(str, Enum):
    LOW_LIQUIDITY = "low_liquidity"
    HIGH_VOLATILITY = "high_volatility"
    HIGH_SLIPPAGE = "high_slippage"
    NEW_POOL = "new_pool"
    LOW_VOLUME = "low_volume"


@dataclass
class PoolMetrics:
    """Raw pool data from DEX"""
    pool_id: str
    dex: str  # "EKUBO", "JEDISWAP", "VESU"
    pair: str  # "ETH/USDC"
    liquidity_usd: float
    volume_24h: float
    fee_tier: float  # 0.01, 0.05, 0.3, 1.0
    price: float
    timestamp: datetime


@dataclass
class PoolRiskAnalysis:
    """Output of zkML circuit"""
    pool_id: str
    dex: str
    pair: str
    risk_score: int  # 0-100
    flags: List[str]
    metrics: Dict[str, float]
    zkml_proof_hash: str
    confidence: float
    expected_apy: float
    recommended_allocation_pct: float


class ZkMLPoolEvaluator:
    """Evaluates pool risk using zkML circuit"""
    
    def __init__(self):
        self.volatility_cache: Dict[str, float] = {}
        self.maturity_cache: Dict[str, float] = {}

    async def evaluate_pool(self, pool: PoolMetrics) -> PoolRiskAnalysis:
        """
        Run zkML circuit on pool metrics.
        MVP: Uses heuristic scoring.
        Production: Would generate STARK proof.
        """
        
        # 1. Calculate volatility (7-day price std dev)
        volatility = self._get_or_mock_volatility(pool.pool_id)
        
        # 2. Evaluate liquidity depth
        slippage_1k = self._estimate_slippage(
            pool.liquidity_usd,
            min(1000, pool.price)  # $1000 worth of tokens
        )
        
        # 3. Score components
        risk_components = {
            "liquidity": self._score_liquidity(pool.liquidity_usd),
            "volume": self._score_volume(pool.volume_24h, pool.liquidity_usd),
            "volatility": volatility,
            "slippage": slippage_1k,
            "maturity": self._score_maturity(pool),
        }
        
        # 4. Calculate composite risk score
        risk_score = int(sum(risk_components.values()) / len(risk_components))
        risk_score = max(0, min(100, risk_score))  # Clamp 0-100
        
        # 5. Generate flags
        flags = self._generate_flags(risk_components, pool)
        
        # 6. Estimate APY based on risk tier
        expected_apy = self._estimate_apy(pool, risk_score)
        
        # 7. Create proof commitment
        proof_input = f"{pool.pool_id}:{risk_score}:{hashlib.sha256(str(risk_components).encode()).hexdigest()[:16]}"
        proof_hash = hashlib.sha256(proof_input.encode()).hexdigest()
        
        return PoolRiskAnalysis(
            pool_id=pool.pool_id,
            dex=pool.dex,
            pair=pool.pair,
            risk_score=risk_score,
            flags=flags,
            metrics=risk_components,
            zkml_proof_hash=proof_hash,
            confidence=0.85,
            expected_apy=expected_apy,
            recommended_allocation_pct=self._calculate_allocation(risk_score),
        )
    
    def _score_liquidity(self, liquidity_usd: float) -> int:
        """
        Score liquidity: 0 (excellent) to 30 (risky)
        Higher score = higher risk
        """
        if liquidity_usd > 1_000_000:
            return 0
        elif liquidity_usd > 500_000:
            return 5
        elif liquidity_usd > 100_000:
            return 10
        elif liquidity_usd > 50_000:
            return 15
        elif liquidity_usd > 10_000:
            return 20
        else:
            return 30
    
    def _score_volume(self, volume_24h: float, liquidity: float) -> int:
        """
        Score volume relative to liquidity.
        High ratio = high trading, good liquidity utilization.
        Low ratio = low trading, potential liquidity issue.
        """
        if liquidity == 0:
            return 25
        
        ratio = volume_24h / liquidity
        
        if ratio > 5:  # Trading 5x the liquidity daily
            return 5
        elif ratio > 2:
            return 10
        elif ratio > 1:
            return 15
        elif ratio > 0.1:
            return 20
        else:
            return 25  # Very low volume
    
    def _estimate_slippage(self, liquidity_usd: float, amount: float) -> float:
        """
        Estimate slippage for a given trade amount.
        In testnet: Mock conservative estimate
        """
        if liquidity_usd == 0:
            return 10.0
        
        # Slippage ≈ (amount / liquidity) * 100
        base_slippage = (amount / liquidity_usd) * 100
        
        # Add 20% buffer for LP spread
        return min(base_slippage * 1.2, 10.0)
    
    def _score_maturity(self, pool: PoolMetrics) -> int:
        """
        Score pool maturity (age).
        New pools are riskier.
        Older pools are more proven.
        """
        # Mock: assume pool is ~30 days old
        pool_age_days = 30
        max_age_days = 365
        
        # Score from 30 (new) to 0 (mature)
        maturity_score = max(0, int(30 * (1 - pool_age_days / max_age_days)))
        
        return maturity_score
    
    def _generate_flags(self, components: Dict[str, int], pool: PoolMetrics) -> List[str]:
        """Generate warning flags based on risk analysis"""
        flags = []
        
        if components["liquidity"] > 20:
            flags.append(RiskFlagType.LOW_LIQUIDITY.value)
        if components["volatility"] > 40:
            flags.append(RiskFlagType.HIGH_VOLATILITY.value)
        if components["slippage"] > 2.0:
            flags.append(RiskFlagType.HIGH_SLIPPAGE.value)
        if components["maturity"] > 20:
            flags.append(RiskFlagType.NEW_POOL.value)
        if components["volume"] > 20:
            flags.append(RiskFlagType.LOW_VOLUME.value)
        
        return flags
    
    def _estimate_apy(self, pool: PoolMetrics, risk_score: int) -> float:
        """
        Estimate APY based on pool characteristics and risk.
        Testnet estimates are higher than mainnet.
        """
        
        # Base APY from fee tier
        fee_apy_map = {
            0.01: 0.5,    # 0.01% fee: 0.5% APY
            0.05: 1.0,    # 0.05% fee: 1% APY
            0.3: 5.0,     # 0.3% fee: 5% APY
            1.0: 15.0,    # 1% fee: 15% APY
        }
        
        base_apy = fee_apy_map.get(pool.fee_tier, 5.0)
        
        # Adjust for volume
        volume_multiplier = min(pool.volume_24h / 10000, 2.0)
        
        # Testnet bonus (volatile = higher yield)
        testnet_multiplier = 2.0 if risk_score > 50 else 1.5
        
        estimated_apy = base_apy * volume_multiplier * testnet_multiplier
        
        return round(estimated_apy, 1)
    
    def _calculate_allocation(self, risk_score: int) -> float:
        """Recommend allocation % based on risk score"""
        if risk_score < 30:
            return 1.0   # 100% safe
        elif risk_score < 50:
            return 0.8   # 80%
        elif risk_score < 70:
            return 0.5   # 50%
        else:
            return 0.2   # 20% only for aggressive
    
    def _get_or_mock_volatility(self, pool_id: str) -> int:
        """
        Get volatility score 0-25 (risk component).
        In MVP: Use cached/mocked values.
        In production: Calculate from historical price data.
        """
        if pool_id in self.volatility_cache:
            return int(self.volatility_cache[pool_id])
        
        # Mock volatility based on pool ID
        if "ETH" in pool_id and "USDC" in pool_id:
            vol = 10  # Stable pair
        elif "STRK" in pool_id:
            vol = 25  # More volatile
        else:
            vol = 15
        
        self.volatility_cache[pool_id] = vol
        return vol
