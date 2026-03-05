"""
LLM Decision Engine - Gets AI recommendations for pool allocation
MVP Week 1: Uses ChatGPT-mini with fallback to deterministic logic
"""

import os
import json
import logging
from typing import List, Dict, Optional
from dataclasses import dataclass, field, asdict
from typing import Optional as _Optional

logger = logging.getLogger(__name__)


@dataclass
class AllocationRecommendation:
    """AI-recommended allocation"""
    allocation: Dict[str, float]  # {pool_id: percentage (0-1)}
    reasoning: str
    confidence: float  # 0.0-1.0
    expected_apy: float  # 0.0-1.0
    risk_assessment: str
    zkrag_provenance: _Optional[Dict] = field(default=None)  # attested context from proven-index


class LLMEngine:
    """Decision engine using ChatGPT-mini or deterministic fallback"""

    def __init__(self):
        """Initialize LLM engine"""
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.use_llm = self.api_key is not None
        
        if self.use_llm:
            try:
                from openai import OpenAI
                self.client = OpenAI(api_key=self.api_key)
                logger.info("ChatGPT-mini enabled (using OPENAI_API_KEY)")
            except ImportError:
                logger.warning("OpenAI package not installed, using fallback")
                self.use_llm = False
                self.client = None
        else:
            logger.info("No OPENAI_API_KEY - using deterministic fallback")
            self.client = None

        self.system_prompt = """
You are an expert DeFi portfolio manager optimizing yield for users.

Your job: Given a user's risk profile and available pools, recommend how to allocate their capital.

Rules:
1. Always respect user risk tolerance (Conservative/Balanced/Aggressive)
2. Recommend diversification across protocols when possible
3. Prefer high-liquidity, verified pools
4. For conservative users: favor lending (Vesu) over LP
5. For balanced users: mix their risk (50/50 or split across multiple)
6. For aggressive users: accept higher risk for yield
7. Explain reasoning in plain English
8. All percentages must sum to 100%

Return ONLY valid JSON, no markdown or extra text:
{
    "allocation": {"pool_id_1": 0.50, "pool_id_2": 0.30, "pool_id_3": 0.20},
    "reasoning": "Clear explanation of why this allocation",
    "confidence": 0.85,
    "expected_apy": 0.15,
    "risk_assessment": "Portfolio risk level and explanation"
}
"""

    async def recommend_allocation(
        self,
        user_risk_profile: str,
        pools: List[Dict],
        user_amount: float = 1000,
    ) -> AllocationRecommendation:
        """
        Get recommendation for capital allocation (with zkRAG enrichment)
        
        Args:
            user_risk_profile: "conservative", "balanced", or "aggressive"
            pools: List of pool evaluations from pool_analyzer
            user_amount: Deposit amount (for context)
        
        Returns:
            AllocationRecommendation with allocation percentages and reasoning
        """

        # zkGraph enrichment: inject attested on-chain context into LLM prompt
        zkrag_context = ""
        zkrag_provenance = None
        try:
            if os.getenv("ZKGRAPH_ENABLED", "true").lower() in ("true", "1"):
                from app.services.zkgraph_client import get_zkgraph_client
                zk = get_zkgraph_client()
                # Fetch context for the first pool as representative sample
                if pools:
                    ctx = await zk.query_market_context(pools[0].get("pool_id", ""))
                    if ctx.source == "zkrag" and ctx.context_text:
                        zkrag_context = ctx.context_text
                        zkrag_provenance = {
                            "fact_hash": ctx.provenance.fact_hash,
                            "block_range": ctx.provenance.block_range,
                            "merkle_root": ctx.provenance.merkle_root,
                            "source_count": ctx.provenance.source_count,
                        } if ctx.provenance else None
        except Exception as exc:
            logger.debug("zkGraph enrichment skipped: %s", exc)

        if self.use_llm and self.client:
            rec = await self._get_llm_recommendation(user_risk_profile, pools, user_amount, zkrag_context)
        else:
            rec = self._get_fallback_recommendation(user_risk_profile, pools, user_amount)
        rec.zkrag_provenance = zkrag_provenance
        return rec

    async def _get_llm_recommendation(
        self,
        user_risk_profile: str,
        pools: List[Dict],
        user_amount: float,
        zkrag_context: str = "",
    ) -> AllocationRecommendation:
        """Get recommendation using ChatGPT-mini"""
        try:
            prompt = self._format_prompt(user_risk_profile, pools, user_amount)

            system = self.system_prompt
            if zkrag_context:
                system += (
                    "\n\nYou also have access to attested on-chain data from the "
                    "obsqra proven-index (zkRAG). Use it to ground your recommendation "
                    "in real on-chain activity:\n" + zkrag_context
                )

            response = self.client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,  # Low randomness = consistent decisions
                max_tokens=800,
            )

            content = response.choices[0].message.content
            result = json.loads(content)
            return self._validate_recommendation(result, pools)

        except Exception as e:
            logger.error(f"LLM error: {e}, falling back to deterministic")
            return self._get_fallback_recommendation(user_risk_profile, pools, user_amount)

    def _get_fallback_recommendation(
        self,
        user_risk_profile: str,
        pools: List[Dict],
        user_amount: float,
    ) -> AllocationRecommendation:
        """Deterministic fallback if LLM unavailable"""

        # Find best pools for this profile
        lending_pools = [p for p in pools if "Vesu" in p.get("protocol", "")]
        lp_pools = [p for p in pools if "Ekubo" in p.get("protocol", "")]

        if user_risk_profile == "conservative":
            # Conservative: 70% lending, 30% stable LP
            if lending_pools and lp_pools:
                best_lending = lending_pools[0]
                best_lp = lp_pools[0]
                return AllocationRecommendation(
                    allocation={
                        best_lending["pool_id"]: 0.70,
                        best_lp["pool_id"]: 0.30,
                    },
                    reasoning="Conservative investor: 70% in safe Vesu lending for stable yield, 30% in stable ETH/USDC pair for diversification. Expected combined APY: 6-8%.",
                    confidence=0.85,
                    expected_apy=0.07,
                    risk_assessment="Portfolio Risk: 25/100 - Low risk, stable yields",
                )
            elif lending_pools:
                return AllocationRecommendation(
                    allocation={lending_pools[0]["pool_id"]: 1.0},
                    reasoning="Conservative: 100% in Vesu safe lending. Highest safety, modest yield.",
                    confidence=0.90,
                    expected_apy=0.05,
                    risk_assessment="Portfolio Risk: 15/100 - Very low risk",
                )

        elif user_risk_profile == "balanced":
            # Balanced: 50% LP, 50% lending (or split across multiple)
            if lending_pools and lp_pools:
                best_lending = lending_pools[0]
                best_lp = lp_pools[0]
                second_lp = lp_pools[1] if len(lp_pools) > 1 else None
                
                if second_lp:
                    return AllocationRecommendation(
                        allocation={
                            best_lp["pool_id"]: 0.40,
                            second_lp["pool_id"]: 0.30,
                            best_lending["pool_id"]: 0.30,
                        },
                        reasoning="Balanced investor: 40% in stable ETH/USDC LP, 30% in STRK/USDC LP for yield, 30% in Vesu for safety. Diversified across pools and protocols. Expected combined APY: 12-15%.",
                        confidence=0.82,
                        expected_apy=0.13,
                        risk_assessment="Portfolio Risk: 45/100 - Moderate risk, good yield potential",
                    )
                else:
                    return AllocationRecommendation(
                        allocation={
                            best_lp["pool_id"]: 0.60,
                            best_lending["pool_id"]: 0.40,
                        },
                        reasoning="Balanced investor: 60% in solid LP, 40% in Vesu. Good risk/reward mix. Expected APY: 12-15%.",
                        confidence=0.80,
                        expected_apy=0.12,
                        risk_assessment="Portfolio Risk: 42/100 - Moderate risk",
                    )

        else:  # aggressive
            # Aggressive: 70% LP, 20% another LP, 10% lending safety net
            if len(lp_pools) >= 2 and lending_pools:
                return AllocationRecommendation(
                    allocation={
                        lp_pools[0]["pool_id"]: 0.70,
                        lp_pools[1]["pool_id"]: 0.20,
                        lending_pools[0]["pool_id"]: 0.10,
                    },
                    reasoning="Aggressive investor: 70% in high-yield STRK/ETH concentrated LP, 20% in STRK/USDC for diversity, 10% in Vesu for emergency cushion. Maximize yield while maintaining safety. Expected APY: 25-35%.",
                    confidence=0.78,
                    expected_apy=0.28,
                    risk_assessment="Portfolio Risk: 65/100 - High risk, high reward potential",
                )
            elif len(lp_pools) >= 1:
                return AllocationRecommendation(
                    allocation={
                        lp_pools[0]["pool_id"]: 0.80,
                    },
                    reasoning="Aggressive investor: 80% in highest-yield LP for maximum returns. Expected APY: 25-40%.",
                    confidence=0.75,
                    expected_apy=0.30,
                    risk_assessment="Portfolio Risk: 70/100 - High risk",
                )

        # Fallback if no pools available
        return AllocationRecommendation(
            allocation={},
            reasoning="No suitable pools found for your profile",
            confidence=0.0,
            expected_apy=0.0,
            risk_assessment="Unable to recommend allocation",
        )

    def _format_prompt(
        self,
        user_risk_profile: str,
        pools: List[Dict],
        user_amount: float,
    ) -> str:
        """Format prompt for LLM"""
        pools_text = "\n".join(
            [
                f"  - {p['pool_id']}: {p['protocol']} {p['pair']}, "
                f"Risk {p['risk_score']}/100, APY {p['expected_apy']*100:.1f}%, "
                f"Liquidity ${p['liquidity_usd']:,.0f}, "
                f"Volatility {p['volume_24h']:,.0f}"
                for p in pools
            ]
        )

        return f"""
User Risk Profile: {user_risk_profile.upper()}
Deposit Amount: ${user_amount:,.0f}

Available Pools for {user_risk_profile} investors:
{pools_text}

Please recommend allocation percentages across these pools.
"""

    def _validate_recommendation(
        self,
        result: Dict,
        pools: List[Dict],
    ) -> AllocationRecommendation:
        """Validate and normalize LLM output"""
        try:
            allocation = result.get("allocation", {})

            # Normalize to 100%
            total = sum(allocation.values())
            if total > 0:
                allocation = {k: v / total for k, v in allocation.items()}

            # Filter to only valid pools
            valid_pool_ids = {p["pool_id"] for p in pools}
            allocation = {
                k: v for k, v in allocation.items() if k in valid_pool_ids
            }

            # Ensure sum is close to 1.0 (within 1%)
            remaining = 1.0 - sum(allocation.values())
            if abs(remaining) > 0.01 and allocation:
                # Add to largest pool
                largest_pool = max(allocation, key=allocation.get)
                allocation[largest_pool] += remaining

            return AllocationRecommendation(
                allocation=allocation,
                reasoning=result.get("reasoning", ""),
                confidence=min(1.0, max(0.0, float(result.get("confidence", 0.5)))),
                expected_apy=min(1.0, max(0.0, float(result.get("expected_apy", 0.1)))),
                risk_assessment=result.get("risk_assessment", ""),
            )
        except Exception as e:
            logger.error(f"Recommendation validation error: {e}")
            return AllocationRecommendation(
                allocation={},
                reasoning="Error processing recommendation",
                confidence=0.0,
                expected_apy=0.0,
                risk_assessment="Error",
            )
