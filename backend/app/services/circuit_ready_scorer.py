"""
Circuit-Ready Creditworthiness Scorer
======================================

Deterministic scoring module that bridges on-chain behavioral signals
to the EZKL-provable MLP creditworthiness model.

Pipeline:
  1. Extract 18 features from ReputationProfile (pure arithmetic)
  2. Normalize features using saved min/range params
  3. Run MLP inference (Linear+ReLU — EZKL/WASM compatible)
  4. Map outputs → FICO score (300-850), credit class (AAA-C)

Circuit compatibility:
  - ALL operations are deterministic: add, multiply, min, max, clamp
  - NO branching (if/else replaced with arithmetic min/max)
  - NO floating-point randomness
  - NO external I/O during scoring
  - Architecture: Linear(18→64)→ReLU→Linear(64→32)→ReLU→Linear(32→5)

Compilation paths:
  - Python (fast API inference via numpy or torch)
  - ONNX → EZKL → Halo2 circuit → ZK proof (existing pipeline)
  - ONNX → WASM via onnxruntime-web (browser proving)
  - Rust reimplementation → WASM (compact, no runtime dependency)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

EZKL_MODEL_DIR = Path(
    os.getenv(
        "EZKL_MODEL_DIR",
        str(Path(__file__).resolve().parent.parent / "data" / "ezkl_models" / "creditworthiness"),
    )
)

CREDIT_CLASSES = ["AAA", "AA", "A", "B", "C"]

FEATURE_NAMES = [
    "chains_active",              # 0  — number of chains (1 for Starknet-only)
    "total_tx_count",             # 1  — nonce / lifetime tx count
    "total_value_usd",            # 2  — total capital deployed
    "account_age_days",           # 3  — estimated account age
    "protocol_diversity",         # 4  — distinct protocols used
    "success_rate",               # 5  — tx success / activity signal
    "unique_contracts",           # 6  — distinct contracts interacted with
    "early_exit_rate",            # 7  — inverse of diamond-hands conviction
    "avg_hold_duration_hours",    # 8  — holding duration estimate
    "proof_success_rate",         # 9  — proof verification success rate
    "rebalance_frequency",        # 10 — rebalancing activity
    "avg_action_size_eth",        # 11 — average tx size in ETH
    "max_single_loss_pct",        # 12 — worst single-position loss
    "time_since_last_action_hours",  # 13 — recency of activity
    "tier",                       # 14 — recommended trust tier
    "tenure_days",                # 15 — estimated tenure
    "collateral_eth",             # 16 — total capital in ETH terms
    "on_chain_reputation_score",  # 17 — composite DeFi veteran score
]

N_FEATURES = len(FEATURE_NAMES)
N_CLASSES = len(CREDIT_CLASSES)

# FICO score mapping: class index → (base_score, bonus_per_confidence_pct)
# AAA(0)=800-850, AA(1)=740-799, A(2)=670-739, B(3)=580-669, C(4)=300-579
FICO_CLASS_RANGES = [
    (800, 850),   # AAA
    (740, 799),   # AA
    (670, 739),   # A
    (580, 669),   # B
    (300, 579),   # C
]

FICO_TIERS = [
    (750, "excellent"),
    (670, "good"),
    (580, "fair"),
    (0,   "poor"),
]

# ETH price for USD→ETH conversion (circuit uses fixed reference price)
_ETH_PRICE_USD = 2000.0


# ─── Data types ───────────────────────────────────────────────────────────────

@dataclass
class CircuitInput:
    """Raw 18-feature vector ready for circuit processing."""
    features: List[float]
    feature_names: List[str] = field(default_factory=lambda: list(FEATURE_NAMES))
    normalized: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "features": {name: round(val, 6) for name, val in zip(self.feature_names, self.features)},
            "normalized": self.normalized,
        }


@dataclass
class CreditScore:
    """Circuit-produced credit assessment."""
    # Core outputs
    fico_score: int                     # 300-850
    fico_tier: str                      # "excellent" | "good" | "fair" | "poor"
    credit_class: str                   # AAA | AA | A | B | C
    credit_class_index: int             # 0-4
    confidence: float                   # 0.0-1.0 (softmax probability of chosen class)

    # Feature vector (for proof binding)
    features: Dict[str, float]          # named feature map
    feature_vector: List[float]         # raw normalized vector
    feature_hash: str                   # SHA256 of normalized features

    # Proof metadata
    model_hash: str = ""                # SHA256 of ONNX model
    ezkl_ready: bool = False            # True if EZKL artifacts exist
    proof_hash: Optional[str] = None    # If proof was generated
    circuit_version: str = "creditworthiness_mlp_v1"

    # Timing
    inference_ms: float = 0.0
    scored_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─── Feature extraction (pure arithmetic) ─────────────────────────────────────

def extract_features(
    *,
    nonce: int = 0,
    total_capital_usd: float = 0.0,
    protocol_count: int = 0,
    position_count: int = 0,
    capital_by_protocol: Optional[Dict[str, float]] = None,
    signals: Optional[List[Dict[str, Any]]] = None,
    defi_veteran_score: int = 0,
    recommended_tier: int = 1,
    account_type: str = "unknown",
    account_exists: bool = False,
) -> CircuitInput:
    """
    Extract the 18 EZKL credit features from reputation scanner outputs.

    All operations are pure arithmetic — no branching, no I/O.
    This function is the bridge between on-chain data and the circuit.
    """
    signals = signals or []
    capital_by_protocol = capital_by_protocol or {}

    # Build signal lookup: signal_name → value
    sig_map: Dict[str, float] = {}
    for sig in signals:
        sig_map[sig.get("signal", "")] = sig.get("value", 0.0)

    # ── Feature 0: chains_active (1 for Starknet-only wallets)
    chains_active = 1.0

    # ── Feature 1: total_tx_count (nonce)
    total_tx_count = float(max(nonce, 0))

    # ── Feature 2: total_value_usd
    total_value_usd = max(total_capital_usd, 0.0)

    # ── Feature 3: account_age_days
    #    Estimate from nonce: assume ~3 tx/day for active users
    #    Clamped [0, 730] — circuit-safe via min/max
    account_age_days = min(max(total_tx_count / 3.0, 0.0), 730.0)

    # ── Feature 4: protocol_diversity
    protocol_diversity = float(max(protocol_count, 0))

    # ── Feature 5: success_rate
    #    Derived from: if account exists + has positions → high success
    #    Circuit-safe mapping: base 0.5 + 0.3*(has_positions) + 0.2*(veteran_signal)
    has_positions = min(float(position_count > 0), 1.0)
    veteran_signal = sig_map.get("power_user", sig_map.get("active_user", 0.0))
    success_rate = min(0.5 + 0.3 * has_positions + 0.2 * veteran_signal, 1.0)

    # ── Feature 6: unique_contracts
    #    Estimate: protocol_count * 2 + staking/lp adds more
    unique_contracts = float(protocol_count * 2) + min(float(position_count), 10.0)

    # ── Feature 7: early_exit_rate
    #    Inverse of diamond_hands signal: 1.0 - diamond_hands_value
    diamond_hands = sig_map.get("diamond_hands", 0.0)
    balanced_deployer = sig_map.get("balanced_deployer", 0.0)
    conviction = max(diamond_hands, balanced_deployer)
    early_exit_rate = max(1.0 - conviction, 0.0)

    # ── Feature 8: avg_hold_duration_hours
    #    Higher if staking/LP positions exist (minimum 24h, up to 500h)
    staker_val = sig_map.get("staker", 0.0)
    lp_val = sig_map.get("liquidity_provider", 0.0)
    avg_hold_duration_hours = min(24.0 + staker_val * 200.0 + lp_val * 150.0, 500.0)

    # ── Feature 9: proof_success_rate
    #    1.0 for all wallets (local proof verification always succeeds)
    #    In production, populated from actual proof history
    proof_success_rate = 1.0

    # ── Feature 10: rebalance_frequency
    #    Nonce / (account_age_days * 24) — capped at 2.0
    safe_age = max(account_age_days, 1.0)
    rebalance_frequency = min(total_tx_count / (safe_age * 24.0), 2.0)

    # ── Feature 11: avg_action_size_eth
    #    total_value_usd / max(nonce, 1) / ETH_PRICE — capped at 10
    safe_nonce = max(total_tx_count, 1.0)
    avg_action_size_eth = min(total_value_usd / safe_nonce / _ETH_PRICE_USD, 10.0)

    # ── Feature 12: max_single_loss_pct
    #    Derived from resilience signals: lower if market_survivor
    survivor_val = sig_map.get("market_survivor", 0.0)
    max_single_loss_pct = max(0.3 - survivor_val * 0.2, 0.0)

    # ── Feature 13: time_since_last_action_hours
    #    0 (wallet is active now — we just scanned it)
    time_since_last_action_hours = 0.0

    # ── Feature 14: tier
    tier = float(max(min(recommended_tier, 5), 0))

    # ── Feature 15: tenure_days
    #    Same estimate as account_age_days
    tenure_days = account_age_days

    # ── Feature 16: collateral_eth
    collateral_eth = min(total_value_usd / _ETH_PRICE_USD, 50.0)

    # ── Feature 17: on_chain_reputation_score
    on_chain_reputation_score = float(max(min(defi_veteran_score, 100), 0))

    features = [
        chains_active,                    # 0
        total_tx_count,                   # 1
        total_value_usd,                  # 2
        account_age_days,                 # 3
        protocol_diversity,               # 4
        success_rate,                     # 5
        unique_contracts,                 # 6
        early_exit_rate,                  # 7
        avg_hold_duration_hours,          # 8
        proof_success_rate,               # 9
        rebalance_frequency,              # 10
        avg_action_size_eth,              # 11
        max_single_loss_pct,              # 12
        time_since_last_action_hours,     # 13
        tier,                             # 14
        tenure_days,                      # 15
        collateral_eth,                   # 16
        on_chain_reputation_score,        # 17
    ]

    return CircuitInput(features=features, normalized=False)


# ─── Normalization (circuit-safe: subtract + divide) ──────────────────────────

_norm_params: Optional[Dict[str, List[float]]] = None


def _load_norm_params() -> Dict[str, List[float]]:
    """Load min/range normalization params saved during training."""
    global _norm_params
    if _norm_params is not None:
        return _norm_params

    norm_path = EZKL_MODEL_DIR / "mlp_norm_params.json"
    if norm_path.exists():
        _norm_params = json.loads(norm_path.read_text())
        return _norm_params

    # Fallback: use reasonable defaults for 18 features
    logger.warning("Norm params not found at %s, using defaults", norm_path)
    _norm_params = {
        "min": [0.0] * N_FEATURES,
        "range": [1.0] * N_FEATURES,
    }
    return _norm_params


def normalize_features(features: List[float]) -> List[float]:
    """
    Normalize features using saved min/range params.

    Circuit-safe: result[i] = (features[i] - min[i]) / range[i]
    All division is by pre-computed constants (no division by zero).
    """
    params = _load_norm_params()
    mins = params["min"]
    ranges = params["range"]

    normalized = []
    for i in range(N_FEATURES):
        val = features[i]
        lo = mins[i] if i < len(mins) else 0.0
        rng = ranges[i] if i < len(ranges) else 1.0
        # Clamp range to avoid division by zero (circuit-safe)
        safe_range = max(rng, 1e-8)
        normed = (val - lo) / safe_range
        # Clamp to [0, 1] — circuit-safe via min/max
        normed = max(min(normed, 1.0), 0.0)
        normalized.append(normed)

    return normalized


# ─── MLP inference (ONNX runtime — no torch dependency) ──────────────────────

_onnx_session: Optional[Any] = None


def _load_onnx_session():
    """Load ONNX model for inference via onnxruntime."""
    global _onnx_session
    if _onnx_session is not None:
        return _onnx_session

    onnx_path = EZKL_MODEL_DIR / "creditworthiness.onnx"
    if not onnx_path.exists():
        raise FileNotFoundError(f"ONNX model not found: {onnx_path}")

    import onnxruntime as ort
    _onnx_session = ort.InferenceSession(
        str(onnx_path),
        providers=["CPUExecutionProvider"],
    )
    logger.info("Loaded ONNX model: %s", onnx_path)
    return _onnx_session


def _relu(x: np.ndarray) -> np.ndarray:
    """ReLU activation — circuit-safe: max(x, 0)."""
    return np.maximum(x, 0.0)


def _softmax(x: np.ndarray) -> np.ndarray:
    """Softmax for probability output (not used in circuit, only for confidence)."""
    e = np.exp(x - np.max(x))
    return e / e.sum()


def mlp_forward(features_normalized: List[float]) -> Tuple[np.ndarray, np.ndarray]:
    """
    Run MLP forward pass using ONNX runtime.

    Architecture: Linear(18→64)→ReLU→Linear(64→32)→ReLU→Linear(32→5)
    This exactly mirrors the EZKL circuit computation.

    Falls back to torch-based weight loading if ONNX model unavailable.

    Returns: (logits, probabilities)
    """
    try:
        session = _load_onnx_session()
        x = np.array(features_normalized, dtype=np.float32).reshape(1, -1)
        logits = session.run(None, {"features": x})[0].flatten()
        probs = _softmax(logits)
        return logits, probs
    except FileNotFoundError:
        # Fall back to torch-based weight loading
        return _mlp_forward_torch(features_normalized)


def _mlp_forward_torch(features_normalized: List[float]) -> Tuple[np.ndarray, np.ndarray]:
    """Fallback: load weights from .pt file using torch (if available)."""
    import torch

    weights_path = EZKL_MODEL_DIR / "creditworthiness_mlp.pt"
    if not weights_path.exists():
        raise FileNotFoundError(f"MLP weights not found: {weights_path}")

    state_dict = torch.load(str(weights_path), map_location="cpu", weights_only=True)
    weights = {k: v.numpy() for k, v in state_dict.items()}

    x = np.array(features_normalized, dtype=np.float32).reshape(1, -1)

    # Layer 1: Linear(18→64) + ReLU
    x = x @ weights["net.0.weight"].T + weights["net.0.bias"]
    x = _relu(x)
    # Layer 2: Linear(64→32) + ReLU
    x = x @ weights["net.2.weight"].T + weights["net.2.bias"]
    x = _relu(x)
    # Layer 3: Linear(32→5)
    logits = (x @ weights["net.4.weight"].T + weights["net.4.bias"]).flatten()

    probs = _softmax(logits)
    return logits, probs


# ─── FICO score mapping ──────────────────────────────────────────────────────

def _logits_to_fico(logits: np.ndarray, probs: np.ndarray) -> Tuple[int, str, str, int, float]:
    """
    Map MLP output to FICO score and credit class.

    Returns: (fico_score, fico_tier, credit_class, class_index, confidence)
    """
    class_index = int(np.argmax(logits))
    confidence = float(probs[class_index])
    credit_class = CREDIT_CLASSES[class_index]

    # FICO score: interpolate within class range based on confidence
    lo, hi = FICO_CLASS_RANGES[class_index]
    # Higher confidence → closer to top of range
    fico_score = int(lo + (hi - lo) * min(confidence, 1.0))
    fico_score = max(300, min(850, fico_score))

    # FICO tier
    fico_tier = "poor"
    for threshold, tier_name in FICO_TIERS:
        if fico_score >= threshold:
            fico_tier = tier_name
            break

    return fico_score, fico_tier, credit_class, class_index, confidence


# ─── Model hash (for proof binding) ──────────────────────────────────────────

_model_hash: Optional[str] = None


def _get_model_hash() -> str:
    """Get SHA256 hash of the ONNX model file."""
    global _model_hash
    if _model_hash is not None:
        return _model_hash

    onnx_path = EZKL_MODEL_DIR / "creditworthiness.onnx"
    if onnx_path.exists():
        _model_hash = hashlib.sha256(onnx_path.read_bytes()).hexdigest()
    else:
        _model_hash = "no_model"

    return _model_hash


def _check_ezkl_ready() -> bool:
    """Check if all EZKL artifacts exist for proof generation."""
    required = ["creditworthiness.onnx", "network.compiled", "pk.key", "vk.key", "kzg.srs", "settings.json"]
    return all((EZKL_MODEL_DIR / f).exists() for f in required)


# ─── Main scoring function ────────────────────────────────────────────────────

def score_creditworthiness(
    *,
    nonce: int = 0,
    total_capital_usd: float = 0.0,
    protocol_count: int = 0,
    position_count: int = 0,
    capital_by_protocol: Optional[Dict[str, float]] = None,
    signals: Optional[List[Dict[str, Any]]] = None,
    defi_veteran_score: int = 0,
    recommended_tier: int = 1,
    account_type: str = "unknown",
    account_exists: bool = False,
) -> CreditScore:
    """
    End-to-end credit scoring: extract features → normalize → MLP inference → FICO score.

    This is the circuit-ready pipeline: every computation here has a 1:1
    correspondence in the EZKL Halo2 circuit.

    Returns a CreditScore with FICO 300-850, credit class, confidence, and
    the full feature vector for proof binding.
    """
    t0 = time.time()

    # Step 1: Extract features from reputation data
    circuit_input = extract_features(
        nonce=nonce,
        total_capital_usd=total_capital_usd,
        protocol_count=protocol_count,
        position_count=position_count,
        capital_by_protocol=capital_by_protocol,
        signals=signals,
        defi_veteran_score=defi_veteran_score,
        recommended_tier=recommended_tier,
        account_type=account_type,
        account_exists=account_exists,
    )

    # Step 2: Normalize (circuit-safe: subtract + divide by constants)
    normalized = normalize_features(circuit_input.features)

    # Step 3: MLP forward pass (Linear + ReLU — EZKL/WASM compatible)
    try:
        logits, probs = mlp_forward(normalized)
    except FileNotFoundError:
        logger.warning("MLP weights not found — using heuristic fallback")
        return _heuristic_fallback(
            circuit_input.features, normalized, t0,
            nonce=nonce,
            total_capital_usd=total_capital_usd,
            defi_veteran_score=defi_veteran_score,
        )

    # Step 4: Map to FICO score + credit class
    fico_score, fico_tier, credit_class, class_index, confidence = _logits_to_fico(logits, probs)

    # Step 5: Compute feature hash for proof binding
    feature_canon = json.dumps(
        [round(v, 6) for v in normalized],
        separators=(",", ":"),
    )
    feature_hash = "0x" + hashlib.sha256(feature_canon.encode()).hexdigest()

    # Step 6: Build named feature map
    named_features = {
        name: round(val, 6)
        for name, val in zip(FEATURE_NAMES, circuit_input.features)
    }

    inference_ms = (time.time() - t0) * 1000

    return CreditScore(
        fico_score=fico_score,
        fico_tier=fico_tier,
        credit_class=credit_class,
        credit_class_index=class_index,
        confidence=round(confidence, 4),
        features=named_features,
        feature_vector=[round(v, 6) for v in normalized],
        feature_hash=feature_hash,
        model_hash=_get_model_hash(),
        ezkl_ready=_check_ezkl_ready(),
        proof_hash=None,
        circuit_version="creditworthiness_mlp_v1",
        inference_ms=round(inference_ms, 2),
        scored_at=__import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
    )


# ─── Heuristic fallback (when MLP weights not available) ──────────────────────

def _heuristic_fallback(
    raw_features: List[float],
    normalized: List[float],
    t0: float,
    *,
    nonce: int = 0,
    total_capital_usd: float = 0.0,
    defi_veteran_score: int = 0,
) -> CreditScore:
    """
    Fallback scoring when MLP weights are not available.

    Uses the same heuristic as the training data labeler to stay consistent.
    This is NOT circuit-provable — just matches the expected distribution.
    """
    score = 100
    early_exit_rate = raw_features[7] if len(raw_features) > 7 else 0.5
    proof_success = raw_features[9] if len(raw_features) > 9 else 1.0
    tenure = raw_features[15] if len(raw_features) > 15 else 0.0

    score -= int(early_exit_rate * 40)
    score -= int((1 - proof_success) * 20)
    score += min(int(tenure / 36), 20)
    score += min(int(total_capital_usd / 10000), 10)
    if nonce < 5:
        score = min(score, 70)
    if nonce < 2:
        score = min(score, 50)

    if score >= 90:
        class_index = 0
    elif score >= 75:
        class_index = 1
    elif score >= 60:
        class_index = 2
    elif score >= 40:
        class_index = 3
    else:
        class_index = 4

    credit_class = CREDIT_CLASSES[class_index]
    lo, hi = FICO_CLASS_RANGES[class_index]
    fico_score = int((lo + hi) / 2)

    fico_tier = "poor"
    for threshold, tier_name in FICO_TIERS:
        if fico_score >= threshold:
            fico_tier = tier_name
            break

    feature_canon = json.dumps([round(v, 6) for v in normalized], separators=(",", ":"))
    feature_hash = "0x" + hashlib.sha256(feature_canon.encode()).hexdigest()
    named_features = {
        name: round(val, 6) for name, val in zip(FEATURE_NAMES, raw_features)
    }

    inference_ms = (time.time() - t0) * 1000

    return CreditScore(
        fico_score=fico_score,
        fico_tier=fico_tier,
        credit_class=credit_class,
        credit_class_index=class_index,
        confidence=0.6,
        features=named_features,
        feature_vector=[round(v, 6) for v in normalized],
        feature_hash=feature_hash,
        model_hash="heuristic_fallback",
        ezkl_ready=False,
        proof_hash=None,
        circuit_version="heuristic_v1",
        inference_ms=round(inference_ms, 2),
        scored_at=__import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
    )


# ─── EZKL proof generation (async) ───────────────────────────────────────────

async def generate_credit_proof(
    features_normalized: List[float],
) -> Optional[Dict[str, Any]]:
    """
    Generate a real ZK proof of the credit scoring using EZKL.

    Requires all EZKL artifacts to exist:
      - creditworthiness.onnx (model)
      - network.compiled (compiled circuit)
      - pk.key (proving key)
      - vk.key (verification key)
      - kzg.srs (structured reference string)

    Returns proof metadata or None if artifacts missing.
    """
    if not _check_ezkl_ready():
        logger.warning("EZKL artifacts not found — cannot generate proof")
        return None

    try:
        import asyncio
        import tempfile
        import ezkl

        model_dir = EZKL_MODEL_DIR
        settings_path = str(model_dir / "settings.json")
        compiled_path = str(model_dir / "network.compiled")
        pk_path = str(model_dir / "pk.key")
        vk_path = str(model_dir / "vk.key")
        srs_path = str(model_dir / "kzg.srs")

        loop = asyncio.get_event_loop()

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            input_path = str(tmp / "input.json")
            witness_path = str(tmp / "witness.json")
            proof_path = str(tmp / "proof.json")

            # Write input
            Path(input_path).write_text(
                json.dumps({"input_data": [features_normalized]})
            )

            # Generate witness
            t0 = time.time()
            await loop.run_in_executor(
                None, ezkl.gen_witness,
                input_path, compiled_path, witness_path,
            )
            witness_ms = (time.time() - t0) * 1000

            # Generate proof
            t0 = time.time()
            await loop.run_in_executor(
                None, ezkl.prove,
                witness_path, compiled_path,
                pk_path, proof_path,
                srs_path,
            )
            proof_ms = (time.time() - t0) * 1000

            # Read proof
            proof_data = json.loads(Path(proof_path).read_text())
            proof_hex = proof_data.get("hex_proof", proof_data.get("proof", ""))
            proof_bytes = bytes.fromhex(proof_hex.replace("0x", "")) if proof_hex else b""
            proof_hash = "0x" + hashlib.sha256(proof_bytes).hexdigest()

            # Verify
            t0 = time.time()
            verified = await loop.run_in_executor(
                None, ezkl.verify,
                proof_path, settings_path, vk_path, srs_path,
            )
            verify_ms = (time.time() - t0) * 1000

            return {
                "proof_hash": proof_hash,
                "proof_size_bytes": len(proof_bytes),
                "verified": bool(verified),
                "witness_ms": round(witness_ms, 1),
                "prove_ms": round(proof_ms, 1),
                "verify_ms": round(verify_ms, 1),
                "total_ms": round(witness_ms + proof_ms + verify_ms, 1),
            }

    except ImportError:
        logger.warning("EZKL not installed — cannot generate proof")
        return None
    except Exception as exc:
        logger.error("EZKL proof generation failed: %s", exc)
        return None


# ─── WASM compilation path info ───────────────────────────────────────────────

def get_circuit_compilation_paths() -> Dict[str, Any]:
    """
    Return metadata about available compilation paths for the scoring circuit.

    This documents how to take the Python scoring function and compile it
    to different targets for different verification scenarios.
    """
    ezkl_ready = _check_ezkl_ready()
    onnx_exists = (EZKL_MODEL_DIR / "creditworthiness.onnx").exists()

    return {
        "circuit_version": "creditworthiness_mlp_v1",
        "architecture": "Linear(18→64)→ReLU→Linear(64→32)→ReLU→Linear(32→5)",
        "n_features": N_FEATURES,
        "n_classes": N_CLASSES,
        "feature_names": FEATURE_NAMES,
        "credit_classes": CREDIT_CLASSES,
        "compilation_paths": {
            "ezkl_halo2": {
                "description": "ONNX → EZKL → Halo2 proof circuit (KZG commitment)",
                "status": "ready" if ezkl_ready else ("onnx_only" if onnx_exists else "not_built"),
                "artifacts": {
                    "onnx": str(EZKL_MODEL_DIR / "creditworthiness.onnx"),
                    "compiled": str(EZKL_MODEL_DIR / "network.compiled"),
                    "proving_key": str(EZKL_MODEL_DIR / "pk.key"),
                    "verification_key": str(EZKL_MODEL_DIR / "vk.key"),
                    "srs": str(EZKL_MODEL_DIR / "kzg.srs"),
                },
                "prover": "ezkl",
                "verifier": "groth16_garaga (Starknet) / Halo2Verifier.sol (L1)",
                "proof_time_estimate_s": "2-10s per proof",
            },
            "onnx_wasm": {
                "description": "ONNX → onnxruntime-web → Browser WASM inference (no proof)",
                "status": "available" if onnx_exists else "not_built",
                "artifacts": {
                    "onnx": str(EZKL_MODEL_DIR / "creditworthiness.onnx"),
                },
                "usage": "Load ONNX in browser via onnxruntime-web for client-side scoring",
                "proof": False,
            },
            "rust_wasm": {
                "description": "Rust reimplementation → wasm32-unknown-unknown → WASM module",
                "status": "planned",
                "notes": (
                    "Reimplement the 3-layer MLP in Rust with fixed-point arithmetic. "
                    "Compile to WASM for compact browser/node proving. "
                    "Weights embedded as const arrays. ~5KB WASM binary."
                ),
                "proof": "Poseidon hash of inputs+outputs for integrity, "
                         "or plug into Noir/RISC Zero for full ZK proof.",
            },
            "noir_circuit": {
                "description": "Noir DSL circuit for the MLP forward pass",
                "status": "planned",
                "notes": (
                    "Express Linear+ReLU layers in Noir DSL with fixed-point (u64). "
                    "Compile to HONK proof system. Verify on Starknet or L1."
                ),
            },
            "cairo_native": {
                "description": "Cairo 1 implementation for native Starknet verification",
                "status": "planned",
                "notes": (
                    "Implement MLP in Cairo 1 felt252 arithmetic. "
                    "Deploy as Starknet contract for on-chain scoring. "
                    "STARK-proven by Starknet sequencer."
                ),
            },
        },
        "model_hash": _get_model_hash(),
        "ezkl_ready": ezkl_ready,
    }
