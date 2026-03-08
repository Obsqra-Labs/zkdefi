from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Signal:
    yield_prediction: float
    risk_prediction: float
    confidence: float
    recommended: bool


@dataclass
class GatingResult:
    status: str  # "unlocked"|"advisory"|"locked"|"proof_required"
    reason: str | None = None
    required_tier: int | None = None


@dataclass
class UnifiedOpportunity:
    id: str
    type: str          # "swap"|"lp"|"lending"|"staking"|"limit"|"dca"|"privacy"|"dark_ledger"
    product_slug: str  # Maps to product catalog slug
    title: str
    pair: str          # e.g. "ETH/USDC"
    protocol: str      # "Ekubo"|"zkde.fi"|etc.
    current_yield: float
    risk_score: float  # 0-100
    tvl_usd: float
    volume_24h: float
    privacy_level: str  # "public"|"shielded"|"fully_private"
    signal: Signal | None = None
    ai_narrative: str | None = None
    recommended: bool = False
    confidence: float = 0.0
    gating: GatingResult | None = None
    execution_mode: str = "wallet"  # "wallet"|"relayer"|"both"
    calldata_builder: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "productSlug": self.product_slug,
            "title": self.title,
            "pair": self.pair,
            "protocol": self.protocol,
            "currentYield": self.current_yield,
            "riskScore": self.risk_score,
            "tvlUsd": self.tvl_usd,
            "volume24h": self.volume_24h,
            "privacyLevel": self.privacy_level,
            "signal": {
                "yieldPrediction": self.signal.yield_prediction,
                "riskPrediction": self.signal.risk_prediction,
                "confidence": self.signal.confidence,
                "recommended": self.signal.recommended,
            } if self.signal else None,
            "aiNarrative": self.ai_narrative,
            "recommended": self.recommended,
            "confidence": self.confidence,
            "gating": {
                "status": self.gating.status,
                "reason": self.gating.reason,
                "requiredTier": self.gating.required_tier,
            } if self.gating else None,
            "executionMode": self.execution_mode,
            "calldataBuilder": self.calldata_builder,
            "metadata": self.metadata,
        }
