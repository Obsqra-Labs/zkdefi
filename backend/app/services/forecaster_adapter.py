"""
Forecaster Adapter for Signals Integration.

Wraps the Snapshot Forecaster Service to provide market predictions
in the format expected by signals endpoints. Includes caching and 
error resilience.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.services.snapshot_forecaster_service import get_snapshot_forecaster_service

logger = logging.getLogger(__name__)


class ForecasterAdapter:
    """
    Adapter that exposes snapshot forecaster outputs as market predictions
    for signals consumption.
    
    Maps forecaster predictions (5m/30m/240m) to signal format:
    - Market probability predictions (calibrated)
    - Yield forecast (APY equivalent)
    - Calibration confidence
    """
    
    def __init__(self):
        self._forecaster = get_snapshot_forecaster_service()
        self._prediction_cache: dict[str, dict[str, Any]] = {}
        self._cache_ttl = 300  # 5 minutes
        self._last_cache_time: dict[str, float] = {}
    
    def get_market_forecast(
        self,
        pair_id: str,
        network_id: str = "starknet_sepolia",
        include_historical: bool = False,
    ) -> dict[str, Any]:
        """
        Get market forecast for a token pair.
        
        Returns probability predictions (5m/30m/4h) and yield forecast.
        
        Args:
            pair_id: Token pair (e.g., "ETH/USDC")
            network_id: Network context ("starknet_sepolia", "starknet_mainnet", "ethereum_mainnet")
            include_historical: If True, include subject reputation if available
            
        Returns:
            dict with predictions, calibration, and metadata
        """
        try:
            # Check cache
            cache_key = f"{pair_id}:{network_id}"
            cached = self._get_cached_forecast(cache_key)
            if cached:
                logger.debug(f"Forecaster cache hit for {pair_id}")
                return cached
            
            # Create a window for this pair (current snapshot)
            now = int(datetime.now(timezone.utc).timestamp())
            window_id = self._forecaster._hash_hex({
                "pair_id": pair_id,
                "window_open_ts": now,
                "network_id": network_id,
            })
            
            # Check if window exists; if not, suggest outputs for current conditions
            window = self._forecaster.get_window(window_id)
            if not window:
                # Create minimal window for forecasting
                window = self._forecaster.create_window(
                    pair_id=pair_id,
                    window_open_ts=now,
                    window_close_ts=now + 14400,  # 4 hours ahead
                    cadence_id="signals_forecast",
                    snapshot_data=self._get_market_snapshot(pair_id, network_id),
                    network_id=network_id,
                    data_source_id="signals_adapter",
                )
            
            # Get suggested outputs (forecaster's predictions)
            outputs = self._forecaster.suggest_outputs(
                window_id=window_id,
                horizons_min=[5, 30, 240],
            )
            
            # Transform to signals format
            forecast = self._transform_outputs_to_signals(outputs)
            
            # Cache the result
            self._cache_forecast(cache_key, forecast)
            
            return forecast
            
        except Exception as e:
            logger.error(f"Forecaster adapter error for {pair_id}: {e}")
            return self._fallback_forecast(pair_id)
    
    def get_subject_reputation(self, subject_id: str) -> dict[str, Any]:
        """
        Get historical reputation for a forecaster (subject).
        
        Maps forecaster trust scores to signal reputation format.
        """
        try:
            subject_rep = self._forecaster.get_subject_reputation(subject_id)
            
            trust_score = subject_rep.get("trust_score", 50)
            return {
                "subject_id": subject_id,
                "trust_score": trust_score,
                "trustworthiness": self._score_to_tier(trust_score),
                "sample_size": subject_rep.get("sample_size", 0),
                "metrics": subject_rep.get("avg_metrics", {}),
            }
        except Exception as e:
            logger.warning(f"Subject reputation fetch failed for {subject_id}: {e}")
            return {
                "subject_id": subject_id,
                "trust_score": 50,
                "trustworthiness": "moderate",
                "sample_size": 0,
            }
    
    def _transform_outputs_to_signals(self, outputs: dict[str, Any]) -> dict[str, Any]:
        """Transform forecaster outputs to signals prediction format."""
        outputs_scaled = outputs.get("outputs_scaled", {})
        signals_meta = outputs.get("signals", {})
        
        # Extract probability predictions (scaled 0-10000)
        p5 = int(outputs_scaled.get("p5", 5000)) / 10000.0
        p30 = int(outputs_scaled.get("p30", 5000)) / 10000.0
        p240 = int(outputs_scaled.get("p240", 5000)) / 10000.0
        
        # Extract return predictions (in basis points)
        r5_bps = int(outputs_scaled.get("r5", 0))
        r30_bps = int(outputs_scaled.get("r30", 0))
        r240_bps = int(outputs_scaled.get("r240", 0))
        
        # Convert return predictions to APY equivalent (approximate)
        # Basis points / horizon_mins * 525600 minutes/year / 10000
        r5_apy = (r5_bps / 5.0) * (525600 / 10000) * 100  # ~5000% annualized
        r30_apy = (r30_bps / 30.0) * (525600 / 10000) * 100
        r240_apy = (r240_bps / 240.0) * (525600 / 10000) * 100
        
        # Average APY across horizons (weight by confidence)
        weighted_apy = (
            (r5_apy * 0.2 * p5) +
            (r30_apy * 0.4 * p30) +
            (r240_apy * 0.4 * p240)
        )
        
        # Calculate calibration score from signals
        signal_strength = min(1.0, (
            abs(signals_meta.get("momentum", 0.0)) * 0.4 +
            abs(signals_meta.get("imbalance", 0.0)) * 0.3 +
            abs(signals_meta.get("liquidity", 0.0)) * 0.3
        ))
        
        # Calibration confidence: signal strength + probability consensus
        probability_consensus = min(1.0, max(
            abs(p5 - 0.5),
            abs(p30 - 0.5),
            abs(p240 - 0.5)
        ) * 2)
        calibration = (signal_strength * 0.5 + probability_consensus * 0.5)
        
        return {
            "model": "forecaster-circuit-v1",
            "probability_up_5m": round(p5, 4),
            "probability_up_30m": round(p30, 4),
            "probability_up_4h": round(p240, 4),
            "calibration_score": round(min(1.0, max(0.0, calibration)), 4),
            "predicted_apy": round(max(-50.0, min(50.0, weighted_apy)), 2),
            "return_5m_bps": r5_bps,
            "return_30m_bps": r30_bps,
            "return_240m_bps": r240_bps,
            "signal_strength": round(signal_strength, 4),
            "trend_bps": int(outputs.get("recent_trend_bps", 0)),
            "horizon": "7d",
        }
    
    def _get_market_snapshot(self, pair_id: str, network_id: str) -> dict[str, Any]:
        """Create a minimal market snapshot for forecasting."""
        return {
            "pair_id": pair_id,
            "network_id": network_id,
            "timestamp": int(datetime.now(timezone.utc).timestamp()),
            "momentum": 0.0,
            "imbalance": 0.0,
            "volatility": 30.0,
            "spread": 4.0,
            "liquidity": 1_000_000.0,
        }
    
    def _fallback_forecast(self, pair_id: str) -> dict[str, Any]:
        """Return neutral forecast on error."""
        return {
            "model": "forecaster-circuit-v1",
            "probability_up_5m": 0.50,
            "probability_up_30m": 0.50,
            "probability_up_4h": 0.50,
            "calibration_score": 0.50,
            "predicted_apy": 0.0,
            "return_5m_bps": 0,
            "return_30m_bps": 0,
            "return_240m_bps": 0,
            "signal_strength": 0.0,
            "error": f"Forecaster unavailable for {pair_id}",
        }
    
    def _score_to_tier(self, score: int) -> str:
        """Convert score (0-100) to trustworthiness tier."""
        if score >= 75:
            return "high"
        elif score >= 50:
            return "moderate"
        else:
            return "low"
    
    def _get_cached_forecast(self, cache_key: str) -> Optional[dict[str, Any]]:
        """Get forecast from cache if fresh."""
        import time
        now = time.time()
        last_time = self._last_cache_time.get(cache_key, 0)
        
        if (now - last_time) < self._cache_ttl and cache_key in self._prediction_cache:
            return self._prediction_cache[cache_key]
        
        return None
    
    def _cache_forecast(self, cache_key: str, forecast: dict[str, Any]) -> None:
        """Cache forecast with timestamp."""
        import time
        self._prediction_cache[cache_key] = forecast
        self._last_cache_time[cache_key] = time.time()
