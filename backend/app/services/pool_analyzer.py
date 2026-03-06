"""
Pool Analysis Service - Evaluates pools and generates risk scores
MVP Week 1: Mock data only, no real Sepolia queries (data comes later)
"""

import logging
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

logger = logging.getLogger(__name__)


class PoolProtocol(str, Enum):
    """Supported DeFi protocols"""
    EKUBO = "Ekubo"
    JEDISWAP = "JediSwap"
    VESU = "Vesu"
    OTHER = "Other"


@dataclass
class PoolMetrics:
    """Core pool metrics for analysis"""
    pool_id: str
    protocol: PoolProtocol
    pair: str  # e.g., "STRK/ETH"
    total_liquidity_usd: float
    volume_24h: float
    volatility_24h: float
    max_slippage_1pct: float
    impermanent_loss_risk: float
    expected_apy: float
    audit_status: str = "verified"  # verified, unaudited, beta


@dataclass
class PoolRiskFlag:
    """Risk warning/info about a pool"""
    severity: str  # critical, warning, info, ok
    category: str  # liquidity, volatility, audit, concentration, slippage
    message: str


@dataclass
class PoolEvaluation:
    """Complete risk assessment of a pool"""
    pool_id: str
    protocol: str
    pair: str
    risk_score: int  # 0-100
    expected_apy: float
    suitable_for_conservative: bool
    suitable_for_balanced: bool
    suitable_for_aggressive: bool
    flags: List[PoolRiskFlag]
    liquidity_usd: float
    volume_24h: float


def get_test_pools() -> List[PoolMetrics]:
    """
    Return test pool data for MVP (Week 1)
    In Week 2, replace with real Starknet RPC queries
    """
    return [
        PoolMetrics(
            pool_id="ekubo_strk_eth_0.3",
            protocol=PoolProtocol.EKUBO,
            pair="STRK/ETH",
            total_liquidity_usd=250_000,
            volume_24h=50_000,
            volatility_24h=0.08,
            max_slippage_1pct=0.005,
            impermanent_loss_risk=0.12,
            expected_apy=0.28,
            audit_status="verified",
        ),
        PoolMetrics(
            pool_id="ekubo_eth_usdc_0.3",
            protocol=PoolProtocol.EKUBO,
            pair="ETH/USDC",
            total_liquidity_usd=500_000,
            volume_24h=100_000,
            volatility_24h=0.03,
            max_slippage_1pct=0.002,
            impermanent_loss_risk=0.05,
            expected_apy=0.12,
            audit_status="verified",
        ),
        PoolMetrics(
            pool_id="ekubo_strk_usdc_0.3",
            protocol=PoolProtocol.EKUBO,
            pair="STRK/USDC",
            total_liquidity_usd=300_000,
            volume_24h=60_000,
            volatility_24h=0.06,
            max_slippage_1pct=0.003,
            impermanent_loss_risk=0.08,
            expected_apy=0.18,
            audit_status="verified",
        ),
        PoolMetrics(
            pool_id="vesu_usdc",
            protocol=PoolProtocol.VESU,
            pair="USDC Lending",
            total_liquidity_usd=1_000_000,
            volume_24h=0,  # Lending has no trading volume
            volatility_24h=0.0,
            max_slippage_1pct=0.0,
            impermanent_loss_risk=0.0,
            expected_apy=0.05,
            audit_status="verified",
        ),
        PoolMetrics(
            pool_id="vesu_strk",
            protocol=PoolProtocol.VESU,
            pair="STRK Lending",
            total_liquidity_usd=500_000,
            volume_24h=0,
            volatility_24h=0.0,
            max_slippage_1pct=0.0,
            impermanent_loss_risk=0.0,
            expected_apy=0.06,
            audit_status="verified",
        ),
    ]


def calculate_pool_risk_score(pool: PoolMetrics) -> int:
    """
    Calculate comprehensive risk score for a pool (0-100)
    
    Scoring breakdown:
    - Liquidity: 0-20 points
    - Volume: 0-20 points
    - Volatility: 0-30 points
    - Slippage: 0-20 points
    - IL Risk: 0-10 points
    """
    score = 0

    # Liquidity scoring (0-20)
    if pool.total_liquidity_usd < 50_000:
        score += 15
    elif pool.total_liquidity_usd < 200_000:
        score += 8
    elif pool.total_liquidity_usd < 1_000_000:
        score += 3
    # else: score += 0

    # Volume scoring (0-20)
    if pool.volume_24h > 0:
        volume_ratio = pool.volume_24h / max(pool.total_liquidity_usd, 1)
        if volume_ratio < 0.1:
            score += 15
        elif volume_ratio < 0.3:
            score += 8
        elif volume_ratio < 0.8:
            score += 3
        # else: score += 0
    else:
        # No volume = lending protocol (not LP), not necessarily risky
        if pool.protocol == PoolProtocol.VESU:
            score += 0  # Lending is safe
        else:
            score += 10  # LP with zero volume is risky

    # Volatility scoring (0-30)
    if pool.volatility_24h > 0.2:
        score += 25
    elif pool.volatility_24h > 0.12:
        score += 15
    elif pool.volatility_24h > 0.05:
        score += 8
    # else: score += 0

    # Slippage scoring (0-20)
    if pool.max_slippage_1pct > 0.05:
        score += 15
    elif pool.max_slippage_1pct > 0.02:
        score += 8
    elif pool.max_slippage_1pct > 0.005:
        score += 3
    # else: score += 0

    # IL Risk scoring (0-10)
    if pool.impermanent_loss_risk > 0.2:
        score += 8
    elif pool.impermanent_loss_risk > 0.1:
        score += 4
    # else: score += 0

    return min(100, score)


def generate_pool_flags(pool: PoolMetrics, user_amount: float) -> List[PoolRiskFlag]:
    """Generate risk flags for a pool"""
    flags: List[PoolRiskFlag] = []

    # Liquidity warnings
    if pool.total_liquidity_usd < 50_000:
        flags.append(
            PoolRiskFlag(
                severity="critical",
                category="liquidity",
                message="Pool has very low liquidity - high risk of slippage",
            )
        )
    elif pool.total_liquidity_usd < 200_000:
        flags.append(
            PoolRiskFlag(
                severity="warning",
                category="liquidity",
                message="Moderate liquidity - watch for slippage on large trades",
            )
        )

    # Volume warnings
    if pool.protocol != PoolProtocol.VESU and pool.volume_24h < 10_000:
        flags.append(
            PoolRiskFlag(
                severity="warning",
                category="liquidity",
                message=f"Low trading volume (${pool.volume_24h:,.0f}/day) - may face slippage",
            )
        )

    # Volatility warnings
    if pool.volatility_24h > 0.2:
        flags.append(
            PoolRiskFlag(
                severity="warning",
                category="volatility",
                message=f"High volatility ({pool.volatility_24h:.1%}) - price can swing significantly",
            )
        )
    elif pool.volatility_24h > 0.12:
        flags.append(
            PoolRiskFlag(
                severity="info",
                category="volatility",
                message=f"Moderate volatility ({pool.volatility_24h:.1%})",
            )
        )

    # Slippage warnings
    if pool.max_slippage_1pct > 0.05:
        flags.append(
            PoolRiskFlag(
                severity="warning",
                category="slippage",
                message=f"High slippage for large trades ({pool.max_slippage_1pct:.1%})",
            )
        )

    # IL warnings
    if pool.impermanent_loss_risk > 0.2:
        flags.append(
            PoolRiskFlag(
                severity="warning",
                category="concentration",
                message=f"High impermanent loss risk ({pool.impermanent_loss_risk:.1%}) at current volatility",
            )
        )

    # Protocol status
    if pool.audit_status != "verified":
        flags.append(
            PoolRiskFlag(
                severity="warning",
                category="audit",
                message=f"{pool.protocol} is {pool.audit_status} - community review recommended",
            )
        )

    # Positive assessments
    if pool.total_liquidity_usd > 500_000 and pool.volatility_24h < 0.1:
        flags.append(
            PoolRiskFlag(
                severity="ok",
                category="quality",
                message="Good liquidity and stable - suitable for conservative investors",
            )
        )

    return flags


async def analyze_pools(
    risk_profile: str,
    user_amount: float = 1000,
) -> List[PoolEvaluation]:
    """
    Analyze all available pools and return evaluations suitable for user's risk profile
    
    Args:
        risk_profile: "conservative", "balanced", or "aggressive"
        user_amount: Deposit amount in tokens (for slippage calculation)
    
    Returns:
        List of PoolEvaluations sorted by risk score
    """

    pools = get_test_pools()
    evaluations = []

    for pool in pools:
        # Calculate risk score
        risk_score = calculate_pool_risk_score(pool)

        # Generate flags
        flags = generate_pool_flags(pool, user_amount)

        # Determine suitability for each profile
        evaluation = PoolEvaluation(
            pool_id=pool.pool_id,
            protocol=pool.protocol.value,
            pair=pool.pair,
            risk_score=risk_score,
            expected_apy=pool.expected_apy,
            suitable_for_conservative=(risk_score < 40),
            suitable_for_balanced=(risk_score < 70),
            suitable_for_aggressive=True,
            flags=flags,
            liquidity_usd=pool.total_liquidity_usd,
            volume_24h=pool.volume_24h,
        )

        # Only include pools suitable for this user's profile
        if risk_profile == "conservative" and evaluation.suitable_for_conservative:
            evaluations.append(evaluation)
        elif risk_profile == "balanced" and evaluation.suitable_for_balanced:
            evaluations.append(evaluation)
        elif risk_profile == "aggressive":
            evaluations.append(evaluation)

    # Sort by risk score (lowest first)
    evaluations.sort(key=lambda e: e.risk_score)

    logger.info(f"Analyzed {len(pools)} pools, {len(evaluations)} suitable for {risk_profile}")

    return evaluations


async def evaluate_pool_for_user(
    pool_id: str,
    risk_profile: str,
    user_amount: float = 1000,
) -> Optional[PoolEvaluation]:
    """Evaluate a specific pool for a user"""

    pools = get_test_pools()
    target_pool = next((p for p in pools if p.pool_id == pool_id), None)

    if not target_pool:
        return None

    risk_score = calculate_pool_risk_score(target_pool)
    flags = generate_pool_flags(target_pool, user_amount)

    evaluation = PoolEvaluation(
        pool_id=target_pool.pool_id,
        protocol=target_pool.protocol.value,
        pair=target_pool.pair,
        risk_score=risk_score,
        expected_apy=target_pool.expected_apy,
        suitable_for_conservative=(risk_score < 40),
        suitable_for_balanced=(risk_score < 70),
        suitable_for_aggressive=True,
        flags=flags,
        liquidity_usd=target_pool.total_liquidity_usd,
        volume_24h=target_pool.volume_24h,
    )

    return evaluation
