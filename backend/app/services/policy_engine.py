"""
Policy Engine (v1)

Evaluates whether an action (e.g. rebalance) is allowed based on zkML proofs
(risk score, anomaly detection). Returns allowed + proof calldata for execution.
"""
from typing import Any

from app.services.zkml_risk_service import get_risk_service
from app.services.zkml_anomaly_service import get_anomaly_service
from app.services.mainnet_oracle import get_oracle


# Volatility (bps) above which pool is considered stressed; 500 bps = 5%
STRESS_VOLATILITY_BPS_THRESHOLD = 500


def _check_pool_stress(
    pool_id: str,
    snapshot_hash: str | None,
    snapshot: Any = None,
) -> dict[str, Any]:
    """
    Deterministic pool stress check (Build 5). Uses oracle snapshot: volatility and TVL.
    Returns stress_ok False when aggregate volatility exceeds threshold (bound to snapshot).
    """
    if snapshot is None:
        try:
            oracle = get_oracle()
            snapshot = oracle.get_latest_snapshot()
        except Exception:
            return {"stress_ok": True}
    if snapshot is None:
        return {"stress_ok": True}
    # Pool stress from snapshot: jediswap + ekubo volatility (bps)
    j = getattr(snapshot, "jediswap", None) or {}
    e = getattr(snapshot, "ekubo", None) or {}
    vol_j = j.get("volatility_bps", 0) or 0
    vol_e = e.get("volatility_bps", 0) or 0
    max_vol = max(vol_j, vol_e)
    stress_ok = max_vol < STRESS_VOLATILITY_BPS_THRESHOLD
    return {"stress_ok": stress_ok, "max_volatility_bps": max_vol}


async def check(
    user_address: str,
    action_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Check if an action is allowed under current policy.

    Args:
        user_address: Starknet address (hex).
        action_type: e.g. "rebalance".
        payload: Action-specific data. For rebalance: proposal_id, portfolio_features,
                 pool_id (optional), from_protocol, to_protocol, amount, reason.

    Returns:
        - allowed: bool
        - proof_calldata: { "risk_calldata": [...], "anomaly_calldata": [...] } when allowed
        - snapshot_hash: str | None
        - risk_result, anomaly_result: full zkML results (for rebalancer to store on proposal)
        - reason: str when not allowed
        - missing: list[str] when not allowed (e.g. ["risk_score", "pool_safety"])
    """
    if action_type != "rebalance":
        return {
            "allowed": False,
            "reason": f"Unknown action_type: {action_type}",
            "missing": ["policy"],
        }

    proposal_id = payload.get("proposal_id", "")
    portfolio_features = payload.get("portfolio_features") or []
    pool_id = payload.get("pool_id")
    from_protocol = payload.get("from_protocol", 0)
    to_protocol = payload.get("to_protocol", 0)
    if pool_id is None:
        pool_id = f"pool_{to_protocol}"

    # Bind to latest oracle snapshot
    oracle = get_oracle()
    snapshot = oracle.get_latest_snapshot()
    snapshot_hash = snapshot.snapshot_hash if snapshot else None

    # Commitment for both proofs
    import hashlib
    commitment_hash = "0x" + hashlib.sha256(
        f"{user_address}{proposal_id}{portfolio_features}".encode()
    ).hexdigest()[:32]

    risk_service = get_risk_service()
    anomaly_service = get_anomaly_service()

    risk_result = await risk_service.generate_risk_proof(
        user_address=user_address,
        portfolio_features=portfolio_features,
        threshold=30,
        commitment_hash=commitment_hash,
        snapshot_hash=snapshot_hash,
    )
    anomaly_result = await anomaly_service.analyze_pool_safety(
        pool_id=pool_id,
        user_address=user_address,
        commitment_hash=commitment_hash,
        snapshot_hash=snapshot_hash,
    )

    risk_ok = risk_result.get("is_compliant", False)
    anomaly_ok = anomaly_result.get("is_safe", False)
    stress_result = _check_pool_stress(pool_id, snapshot_hash, snapshot)
    stress_ok = stress_result.get("stress_ok", True)
    allowed = risk_ok and anomaly_ok and stress_ok

    missing = []
    if not risk_ok:
        missing.append("risk_score")
    if not anomaly_ok:
        missing.append("pool_safety")
    if not stress_ok:
        missing.append("pool_stress")

    reason = ""
    if not allowed:
        reasons = []
        if not risk_ok:
            reasons.append("Risk score too high")
        if not anomaly_ok:
            reasons.append("Pool anomaly detected")
        if not stress_ok:
            reasons.append("Pool stress too high")
        reason = "; ".join(reasons)

    proof_calldata = {}
    if allowed:
        proof_calldata = {
            "risk_calldata": risk_result.get("proof_calldata", []),
            "anomaly_calldata": anomaly_result.get("proof_calldata", []),
        }

    return {
        "allowed": allowed,
        "proof_calldata": proof_calldata,
        "snapshot_hash": snapshot_hash,
        "risk_result": risk_result,
        "anomaly_result": anomaly_result,
        "stress_result": stress_result,
        "commitment_hash": commitment_hash,
        "reason": reason,
        "missing": missing,
    }
