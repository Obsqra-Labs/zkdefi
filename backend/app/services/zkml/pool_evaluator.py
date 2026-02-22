"""
zkML Pool Risk Evaluator - Deterministic pool scoring circuit
For MVP: Generates hash-based proofs, ready to upgrade to real STARK proofs
"""

from dataclasses import dataclass
from typing import List, Optional
from datetime import datetime
import hashlib
import json


@dataclass
class PoolMetrics:
    """Metrics for a single pool"""
    pool_id: str
    name: str
    protocol: str  # "ekubo" | "jediswap" | "vesu"
    liquidity_usd: float
    volume_24h_usd: float
    fee_tier: float
    price_std_dev_24h: float  # volatility
    slippage_at_1000usd: float
    token0: str
    token1: str
    current_apy: float
    timestamp: datetime


@dataclass
class PoolRiskEvaluation:
    """Risk evaluation result for a pool"""
    pool_id: str
    risk_score: int  # 0-100
    confidence: float  # 0-1
    flags: List[str]
    safety_level: str  # "safe" | "moderate" | "risky"
    recommended_allocation_range: tuple  # (min%, max%)
    
    def to_dict(self):
        return {
            "pool_id": self.pool_id,
            "risk_score": self.risk_score,
            "confidence": self.confidence,
            "flags": self.flags,
            "safety_level": self.safety_level,
            "recommended_allocation_range": self.recommended_allocation_range,
        }

    def to_proof_hash(self) -> str:
        """Create deterministic hash for MVP (real proofs later)"""
        proof_data = json.dumps(self.to_dict(), sort_keys=True)
        return hashlib.sha256(proof_data.encode()).hexdigest()


class PoolRiskEvaluator:
    """
    Deterministic pool risk evaluation circuit
    Scores pools 0-100 based on safety metrics
    """
    
    def __init__(self):
        # Configuration for thresholds
        self.min_liquidity_usd = 50_000
        self.max_volatility_safe = 0.15  # 15% std dev
        self.min_volume_to_liquidity_ratio = 0.1

    def evaluate_pool(self, metrics: PoolMetrics) -> PoolRiskEvaluation:
        """
        Evaluate a single pool
        Returns risk score 0-100 (0=safest, 100=riskiest)
        """
        risk_score = 0
        flags = []
        
        # 1. Liquidity Check (0-30 points)
        liquidity_score = self._evaluate_liquidity(metrics.liquidity_usd)
        risk_score += liquidity_score
        if metrics.liquidity_usd < self.min_liquidity_usd:
            flags.append(f"low_liquidity_${metrics.liquidity_usd:,.0f}")
        
        # 2. Volatility Check (0-25 points)
        volatility_score = self._evaluate_volatility(metrics.price_std_dev_24h)
        risk_score += volatility_score
        if metrics.price_std_dev_24h > self.max_volatility_safe:
            flags.append(f"high_volatility_{metrics.price_std_dev_24h:.1%}")
        
        # 3. Volume/Liquidity Ratio (0-20 points)
        volume_score = self._evaluate_volume(
            metrics.volume_24h_usd,
            metrics.liquidity_usd
        )
        risk_score += volume_score
        ratio = metrics.volume_24h_usd / metrics.liquidity_usd if metrics.liquidity_usd > 0 else 0
        if ratio < self.min_volume_to_liquidity_ratio:
            flags.append(f"low_trading_volume_ratio_{ratio:.2%}")
        
        # 4. Slippage Check (0-15 points)
        slippage_score = self._evaluate_slippage(metrics.slippage_at_1000usd)
        risk_score += slippage_score
        if metrics.slippage_at_1000usd > 0.05:
            flags.append(f"high_slippage_{metrics.slippage_at_1000usd:.2%}")
        
        # 5. Fee Tier Appropriateness (0-10 points)
        fee_score = self._evaluate_fee_tier(metrics.fee_tier, metrics.token0, metrics.token1)
        risk_score += fee_score
        
        # Determine safety level based on risk score
        if risk_score < 30:
            safety_level = "safe"
            recommended_range = (30, 50)
        elif risk_score < 60:
            safety_level = "moderate"
            recommended_range = (10, 30)
        else:
            safety_level = "risky"
            recommended_range = (0, 10)
        
        # Confidence: higher risk = lower confidence
        confidence = max(0.5, 1.0 - (risk_score / 150))
        
        return PoolRiskEvaluation(
            pool_id=metrics.pool_id,
            risk_score=min(100, risk_score),
            confidence=confidence,
            flags=flags,
            safety_level=safety_level,
            recommended_allocation_range=recommended_range,
        )
    
    def _evaluate_liquidity(self, liquidity_usd: float) -> int:
        """
        Score liquidity: 0-30 points
        More liquidity = safer
        """
        if liquidity_usd < 50_000:
            return 30  # Very risky
        elif liquidity_usd < 100_000:
            return 20  # Risky
        elif liquidity_usd < 500_000:
            return 10  # Moderate
        else:
            return 0   # Safe
    
    def _evaluate_volatility(self, std_dev: float) -> int:
        """
        Score volatility: 0-25 points
        Lower volatility = safer
        """
        if std_dev < 0.05:
            return 0    # Very stable
        elif std_dev < 0.10:
            return 8    # Stable
        elif std_dev < 0.15:
            return 16   # Moderate
        else:
            return 25   # Volatile
    
    def _evaluate_volume(self, volume: float, liquidity: float) -> int:
        """
        Score volume/liquidity ratio: 0-20 points
        Better volume relative to liquidity = safer
        """
        if liquidity == 0:
            return 20
        
        ratio = volume / liquidity
        if ratio < 0.1:
            return 20   # Illiquid
        elif ratio < 0.5:
            return 10   # Moderate
        else:
            return 0    # Good liquidity
    
    def _evaluate_slippage(self, slippage_pct: float) -> int:
        """
        Score slippage: 0-15 points
        Lower slippage = safer
        """
        if slippage_pct < 0.01:
            return 0    # Very low
        elif slippage_pct < 0.03:
            return 5    # Low
        elif slippage_pct < 0.05:
            return 10   # Moderate
        else:
            return 15   # High
    
    def _evaluate_fee_tier(self, fee: float, token0: str, token1: str) -> int:
        """
        Score fee tier appropriateness: 0-10 points
        """
        # For MVP, all fee tiers are acceptable
        # Real implementation could penalize high fees on safe pairs
        return 0
    
    def evaluate_multiple(self, metrics_list: List[PoolMetrics]) -> List[PoolRiskEvaluation]:
        """Evaluate multiple pools"""
        return [self.evaluate_pool(m) for m in metrics_list]
    
    def rank_by_risk_adjusted_apy(
        self,
        evaluations: List[PoolRiskEvaluation],
        apy_by_pool: dict,
    ) -> List[tuple]:
        """
        Rank pools by risk-adjusted APY
        Returns: [(pool_id, apy, risk_adjusted_score), ...]
        """
        rankings = []
        for eval in evaluations:
            if eval.pool_id not in apy_by_pool:
                continue
            
            apy = apy_by_pool[eval.pool_id]
            # Penalize high-risk pools more
            risk_penalty = (eval.risk_score / 100) ** 2
            risk_adjusted = apy * (1 - risk_penalty) * eval.confidence
            
            rankings.append((eval.pool_id, apy, risk_adjusted))
        
        return sorted(rankings, key=lambda x: x[2], reverse=True)


# Example usage and testing
if __name__ == "__main__":
    evaluator = PoolRiskEvaluator()
    
    # Test with Ekubo ETH/USDC pool (mock data)
    ekubo_pool = PoolMetrics(
        pool_id="ekubo_eth_usdc_003",
        name="Ekubo ETH/USDC 0.3%",
        protocol="ekubo",
        liquidity_usd=500_000,
        volume_24h_usd=150_000,
        fee_tier=0.003,
        price_std_dev_24h=0.08,
        slippage_at_1000usd=0.02,
        token0="ETH",
        token1="USDC",
        current_apy=0.18,
        timestamp=datetime.now(),
    )
    
    eval_result = evaluator.evaluate_pool(ekubo_pool)
    print(f"Pool: {ekubo_pool.name}")
    print(f"Risk Score: {eval_result.risk_score}/100")
    print(f"Safety Level: {eval_result.safety_level}")
    print(f"Confidence: {eval_result.confidence:.2%}")
    print(f"Recommended Allocation: {eval_result.recommended_allocation_range[0]}-{eval_result.recommended_allocation_range[1]}%")
    print(f"Flags: {', '.join(eval_result.flags) if eval_result.flags else 'None'}")
    print(f"Proof Hash: {eval_result.to_proof_hash()[:16]}...")
