"""
MEV-Resistant Predictive Timing Model.

Uses an LSTM trained on fee snapshot time series to predict the optimal
rebalance window. Outputs WHEN to rebalance (target block range), not just
IF — combined with a Poseidon pre-commitment scheme that proves the
decision was made BEFORE the target block.

Flow:
  1. LSTM analyzes fee_snapshots time series → predicts optimal rebalance window
  2. Commitment published on-chain BEFORE target block: hash(target_block, action, user, nonce)
  3. At execution time, RebalanceTimingCommitment.circom proves:
     a. The commitment was made before the target block
     b. Execution happened within tolerance of the predicted window
  4. This prevents the agent from front-running its own users

Training data: fee_snapshots.json from apy_tracker (per-position fee history).
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "ezkl_models" / "timing_predictor"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class TimingPrediction:
    """Output of the timing predictor."""
    target_block: int           # Predicted optimal block to rebalance
    confidence: float           # 0.0–1.0
    expected_improvement_bps: int  # Expected yield improvement if rebalanced at this time
    window_start: int           # Earliest acceptable block
    window_end: int             # Latest acceptable block
    reasoning: str


@dataclass
class TimingCommitment:
    """A pre-committed rebalance timing."""
    timing_hash: str            # Poseidon(target_block, action_type, user_address, nonce)
    target_block: int
    action_type: int            # 1=rebalance, 2=deposit, 3=withdraw
    user_address: str
    nonce: int
    committed_at_block: int     # Block number when commitment was published
    committed_at: str           # ISO timestamp

    def to_dict(self) -> dict[str, Any]:
        return {
            "timing_hash": self.timing_hash,
            "target_block": self.target_block,
            "action_type": self.action_type,
            "user_address": self.user_address,
            "nonce": self.nonce,
            "committed_at_block": self.committed_at_block,
            "committed_at": self.committed_at,
        }


class TimingPredictor:
    """
    Predicts optimal rebalance timing from fee snapshot time series.

    Currently uses a heuristic model (moving average crossover + volatility regime).
    Upgradeable to LSTM/ONNX with EZKL proof.
    """

    def __init__(self) -> None:
        self._model = None
        self._commitments: dict[str, TimingCommitment] = {}
        self._nonce = 0
        self._load_model()

    def _load_model(self) -> None:
        """Load ONNX model if available, else use heuristic."""
        onnx_path = MODEL_DIR / "timing_predictor.onnx"
        if onnx_path.exists():
            try:
                import onnxruntime as ort
                self._model = ort.InferenceSession(str(onnx_path))
                logger.info("Timing predictor ONNX model loaded")
            except ImportError:
                logger.info("onnxruntime not installed; using heuristic timing predictor")
        else:
            logger.info("No ONNX model at %s; using heuristic timing predictor", onnx_path)

    def predict_timing(
        self,
        fee_snapshots: list[dict[str, Any]],
        current_block: int,
        *,
        lookback_periods: int = 20,
        tolerance_blocks: int = 10,
    ) -> TimingPrediction:
        """
        Predict optimal rebalance timing from fee snapshot history.

        Args:
            fee_snapshots: List of {fees0_usd, fees1_usd, tvl_usd, timestamp} dicts.
            current_block: Current block number.
            lookback_periods: Number of recent snapshots to analyze.
            tolerance_blocks: Acceptable execution window around target.

        Returns:
            TimingPrediction with target block and confidence.
        """
        if self._model is not None:
            return self._predict_onnx(fee_snapshots, current_block, lookback_periods, tolerance_blocks)

        return self._predict_heuristic(fee_snapshots, current_block, lookback_periods, tolerance_blocks)

    def _predict_heuristic(
        self,
        fee_snapshots: list[dict[str, Any]],
        current_block: int,
        lookback: int,
        tolerance: int,
    ) -> TimingPrediction:
        """
        Heuristic timing prediction using fee velocity and volatility.

        Strategy: Rebalance when fee velocity crosses above its moving average
        (indicating increasing fee generation → good time to compound).
        """
        if len(fee_snapshots) < 5:
            # Not enough data — suggest immediate rebalance
            return TimingPrediction(
                target_block=current_block + 5,
                confidence=0.3,
                expected_improvement_bps=0,
                window_start=current_block + 1,
                window_end=current_block + tolerance,
                reasoning="Insufficient data (<5 snapshots); suggesting near-term rebalance",
            )

        recent = fee_snapshots[-lookback:]

        # Compute fee velocity (change per period)
        velocities = []
        for i in range(1, len(recent)):
            fee_now = float(recent[i].get("fees0_usd", 0)) + float(recent[i].get("fees1_usd", 0))
            fee_prev = float(recent[i-1].get("fees0_usd", 0)) + float(recent[i-1].get("fees1_usd", 0))
            velocities.append(fee_now - fee_prev)

        if not velocities:
            return TimingPrediction(
                target_block=current_block + 10,
                confidence=0.3,
                expected_improvement_bps=0,
                window_start=current_block + 1,
                window_end=current_block + tolerance,
                reasoning="Insufficient velocity data",
            )

        # Short vs long moving average
        short_ma = sum(velocities[-3:]) / min(3, len(velocities))
        long_ma = sum(velocities) / len(velocities)

        # Volatility (std of velocities)
        mean_v = sum(velocities) / len(velocities)
        variance = sum((v - mean_v) ** 2 for v in velocities) / len(velocities)
        std_v = variance ** 0.5

        # Decision: if short MA > long MA → fees accelerating → rebalance soon
        if short_ma > long_ma and short_ma > 0:
            # Momentum positive — rebalance in next few blocks
            blocks_ahead = max(3, int(5 * (1 - min(short_ma / (long_ma + 0.001), 2) / 2)))
            confidence = min(0.9, 0.5 + abs(short_ma - long_ma) / (std_v + 0.001) * 0.1)
            improvement = int(abs(short_ma) * 100)  # rough bps estimate
            reasoning = f"Fee velocity accelerating: short_ma={short_ma:.4f} > long_ma={long_ma:.4f}"
        elif std_v < abs(mean_v) * 0.3:
            # Low volatility regime — stable fees, rebalance at convenience
            blocks_ahead = 20
            confidence = 0.6
            improvement = int(abs(mean_v) * 50)
            reasoning = f"Low volatility regime (std={std_v:.4f}); stable fees"
        else:
            # High volatility — wait for settlement
            blocks_ahead = 30
            confidence = 0.4
            improvement = 0
            reasoning = f"High volatility (std={std_v:.4f}); deferring rebalance"

        target = current_block + blocks_ahead

        return TimingPrediction(
            target_block=target,
            confidence=round(confidence, 3),
            expected_improvement_bps=improvement,
            window_start=target - tolerance,
            window_end=target + tolerance,
            reasoning=reasoning,
        )

    def _predict_onnx(
        self,
        fee_snapshots: list[dict[str, Any]],
        current_block: int,
        lookback: int,
        tolerance: int,
    ) -> TimingPrediction:
        """ONNX model prediction (LSTM)."""
        import numpy as np

        # Prepare time series input: [fees0, fees1, tvl] per timestep
        recent = fee_snapshots[-lookback:]
        series = []
        for snap in recent:
            series.append([
                float(snap.get("fees0_usd", 0)),
                float(snap.get("fees1_usd", 0)),
                float(snap.get("tvl_usd", 0)),
            ])

        # Pad if needed
        while len(series) < lookback:
            series.insert(0, [0.0, 0.0, 0.0])

        input_array = np.array([series], dtype=np.float32)  # [1, lookback, 3]
        input_name = self._model.get_inputs()[0].name
        outputs = self._model.run(None, {input_name: input_array})

        # Expected output: [blocks_ahead, confidence]
        blocks_ahead = max(1, int(outputs[0][0][0]))
        confidence = float(min(1.0, max(0.0, outputs[0][0][1]))) if outputs[0].shape[1] > 1 else 0.7

        target = current_block + blocks_ahead
        return TimingPrediction(
            target_block=target,
            confidence=round(confidence, 3),
            expected_improvement_bps=0,  # Not predicted by basic LSTM
            window_start=target - tolerance,
            window_end=target + tolerance,
            reasoning=f"LSTM prediction: rebalance in {blocks_ahead} blocks",
        )

    async def create_commitment(
        self,
        prediction: TimingPrediction,
        user_address: str,
        action_type: int = 1,
        current_block: int = 0,
    ) -> TimingCommitment:
        """
        Create a Poseidon pre-commitment for the predicted timing.

        The hash is: Poseidon(target_block, action_type, user_address_int, nonce)
        This must be published on-chain BEFORE the target block.
        """
        from app.services.zkml.circuit_scanner import _poseidon_commitment

        self._nonce += 1
        nonce = self._nonce

        # Convert address to int for Poseidon
        addr_int = int(user_address, 16) if user_address.startswith("0x") else int(user_address)

        timing_hash = _poseidon_commitment(
            prediction.target_block, action_type, addr_int, nonce
        )

        commitment = TimingCommitment(
            timing_hash=timing_hash,
            target_block=prediction.target_block,
            action_type=action_type,
            user_address=user_address,
            nonce=nonce,
            committed_at_block=current_block,
            committed_at=datetime.now(timezone.utc).isoformat(),
        )

        # Store locally for proof generation later
        self._commitments[timing_hash] = commitment
        logger.info(
            "Timing commitment created: hash=%s, target_block=%d, user=%s",
            timing_hash[:16], prediction.target_block, user_address[:10],
        )

        return commitment

    def get_commitment(self, timing_hash: str) -> TimingCommitment | None:
        """Retrieve a stored commitment."""
        return self._commitments.get(timing_hash)


# ── Singleton ────────────────────────────────────────────────────────────

_predictor: TimingPredictor | None = None


def get_timing_predictor() -> TimingPredictor:
    global _predictor
    if _predictor is None:
        _predictor = TimingPredictor()
    return _predictor
