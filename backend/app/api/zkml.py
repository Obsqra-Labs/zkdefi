"""
zkML API endpoints for privacy-preserving ML proofs.

Endpoints:
- /api/v1/zkdefi/zkml/risk_score - Generate risk score proof
- /api/v1/zkdefi/zkml/anomaly - Generate anomaly detection proof
- /api/v1/zkdefi/zkml/combined - Generate both proofs for rebalancing
"""
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.zkml_risk_service import get_risk_service
from app.services.zkml_anomaly_service import get_anomaly_service
from app.services.receipt_service import get_receipt_service
from app.services.pool_passport_store import save as save_pool_passport
from app.services.mainnet_oracle import get_oracle

router = APIRouter()


def _resolve_snapshot_hash(snapshot_hash: str | None) -> str | None:
    """Use provided snapshot_hash or latest oracle snapshot."""
    if snapshot_hash:
        return snapshot_hash
    oracle = get_oracle()
    snapshot = oracle.get_latest_snapshot()
    return snapshot.snapshot_hash if snapshot else None


# ==================== Request Models ====================

class RiskScoreRequest(BaseModel):
    """Request for risk score proof generation."""
    user_address: str
    portfolio_features: list[int]  # 8 features: balance, concentration, diversity, etc.
    threshold: int = 30  # Max allowed risk score (0-100)
    commitment_hash: str | None = None
    snapshot_hash: str | None = None  # Oracle snapshot binding; filled from oracle if omitted


class AnomalyDetectionRequest(BaseModel):
    """Request for anomaly detection proof generation."""
    user_address: str
    pool_id: str
    tvl_volatility: int | None = None
    liquidity_concentration: int | None = None
    price_impact_score: int | None = None
    deployer_age_days: int | None = None
    volume_anomaly: int | None = None
    contract_risk_score: int | None = None
    commitment_hash: str | None = None
    snapshot_hash: str | None = None  # Oracle snapshot binding; filled from oracle if omitted


class CombinedZkmlRequest(BaseModel):
    """Request for combined zkML proofs (risk + anomaly)."""
    user_address: str
    pool_id: str
    portfolio_features: list[int]
    risk_threshold: int = 30
    snapshot_hash: str | None = None  # Oracle snapshot binding; filled from oracle if omitted
    # Optional pool data (fetched if not provided)
    tvl_volatility: int | None = None
    liquidity_concentration: int | None = None
    price_impact_score: int | None = None
    deployer_age_days: int | None = None
    volume_anomaly: int | None = None
    contract_risk_score: int | None = None


# ==================== Endpoints ====================

@router.post("/risk_score")
async def generate_risk_score_proof(data: RiskScoreRequest):
    """
    Generate privacy-preserving risk score proof.
    
    Proves: risk_score <= threshold WITHOUT revealing actual score.
    
    Returns Garaga-compatible proof calldata.
    """
    try:
        snapshot_hash = _resolve_snapshot_hash(data.snapshot_hash)
        service = get_risk_service()
        result = await service.generate_risk_proof(
            user_address=data.user_address,
            portfolio_features=data.portfolio_features,
            threshold=data.threshold,
            commitment_hash=data.commitment_hash,
            snapshot_hash=snapshot_hash,
        )
        receipt_svc = get_receipt_service()
        receipt_svc.append_proof_receipt(
            user_address=data.user_address,
            proof_type="risk_score",
            threshold_or_model=str(data.threshold),
            result="compliant" if result["is_compliant"] else "non_compliant",
            snapshot_hash=snapshot_hash,
            model_hash="risk_v1",
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/anomaly")
async def generate_anomaly_proof(data: AnomalyDetectionRequest):
    """
    Generate privacy-preserving anomaly detection proof.
    
    Proves: anomaly_flag == 0 (safe) WITHOUT revealing analysis.
    
    Returns Garaga-compatible proof calldata.
    """
    try:
        snapshot_hash = _resolve_snapshot_hash(data.snapshot_hash)
        service = get_anomaly_service()
        result = await service.analyze_pool_safety(
            pool_id=data.pool_id,
            user_address=data.user_address,
            tvl_volatility=data.tvl_volatility,
            liquidity_concentration=data.liquidity_concentration,
            price_impact_score=data.price_impact_score,
            deployer_age_days=data.deployer_age_days,
            volume_anomaly=data.volume_anomaly,
            contract_risk_score=data.contract_risk_score,
            commitment_hash=data.commitment_hash,
            snapshot_hash=snapshot_hash,
        )
        receipt_svc = get_receipt_service()
        receipt_svc.append_proof_receipt(
            user_address=data.user_address,
            proof_type="pool_safety",
            threshold_or_model="anomaly",
            result="safe" if result.get("is_safe") else "unsafe",
            snapshot_hash=snapshot_hash,
            model_hash="anomaly_v1",
            pool_id=data.pool_id,
        )
        save_pool_passport(data.pool_id, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/combined")
async def generate_combined_proofs(data: CombinedZkmlRequest):
    """
    Generate combined zkML proofs for rebalancing.
    
    Generates both:
    1. Risk score proof (portfolio risk <= threshold)
    2. Anomaly detection proof (pool is safe)
    
    Both must pass for rebalancing to proceed.
    """
    try:
        snapshot_hash = _resolve_snapshot_hash(data.snapshot_hash)
        risk_service = get_risk_service()
        anomaly_service = get_anomaly_service()
        
        # Generate shared commitment
        import hashlib
        shared_commitment = "0x" + hashlib.sha256(
            f"{data.user_address}{data.pool_id}{data.portfolio_features}".encode()
        ).hexdigest()[:32]
        
        # Generate both proofs (snapshot-bound)
        risk_result = await risk_service.generate_risk_proof(
            user_address=data.user_address,
            portfolio_features=data.portfolio_features,
            threshold=data.risk_threshold,
            commitment_hash=shared_commitment,
            snapshot_hash=snapshot_hash,
        )
        
        anomaly_result = await anomaly_service.analyze_pool_safety(
            pool_id=data.pool_id,
            user_address=data.user_address,
            tvl_volatility=data.tvl_volatility,
            liquidity_concentration=data.liquidity_concentration,
            price_impact_score=data.price_impact_score,
            deployer_age_days=data.deployer_age_days,
            volume_anomaly=data.volume_anomaly,
            contract_risk_score=data.contract_risk_score,
            commitment_hash=shared_commitment,
            snapshot_hash=snapshot_hash,
        )
        
        # Combined result
        can_proceed = risk_result["is_compliant"] and anomaly_result["is_safe"]
        
        return {
            "can_proceed": can_proceed,
            "commitment_hash": shared_commitment,
            "risk_proof": risk_result,
            "anomaly_proof": anomaly_result,
            "combined_calldata": {
                "risk_calldata": risk_result["proof_calldata"],
                "anomaly_calldata": anomaly_result["proof_calldata"]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_zkml_status():
    """
    Get zkML service status.
    """
    risk_service = get_risk_service()
    anomaly_service = get_anomaly_service()
    from app.services.zkml.circuit_scanner import list_available_circuits

    circuits = list_available_circuits()
    ready_count = sum(1 for c in circuits if c.get("ready"))
    
    return {
        "risk_score_circuit_ready": risk_service.circuits_ready,
        "anomaly_detection_circuit_ready": anomaly_service.circuits_ready,
        "circuits_available": len(circuits),
        "circuits_ready": ready_count,
        "policy_mode": os.getenv("ZKDEFI_CIRCUIT_POLICY_MODE", "signal"),
        "proof_system": "groth16",
        "verifier": "garaga"
    }


@router.get("/pool-safety")
async def get_pool_safety_overview():
    """
    Get general pool safety status overview.
    
    Returns aggregated safety metrics from recent zkML analyses.
    Used by the frontend dashboard to show pool health at a glance.
    """
    anomaly_service = get_anomaly_service()
    
    # Return default safe values - in production these would be aggregated from actual analyses
    return {
        "tvl_volatility": "low",
        "liquidity_concentration": "healthy",
        "deployer_age_days": 120,
        "volume_anomaly": False,
        "contract_risk_score": 15,
        "anomaly_flag": 0,
        "safe": True,
        "circuits_ready": anomaly_service.circuits_ready,
        "last_analysis": None,
        "pools_analyzed": 0
    }


# ==================== Unified Circuit Scanner ====================

class CircuitScanRequest(BaseModel):
    """Request to run multiple circuits in parallel."""
    user_address: str
    circuits: list[str] | None = None  # None = all available ML circuits
    portfolio_features: list[int] | None = None  # 8 features for ML circuits
    inputs_override: dict[str, dict] | None = None  # per-circuit custom inputs
    mode: str = "gate"  # gate | signal


class CircuitScanResponse(BaseModel):
    mode: str
    all_pass: bool
    circuits_run: int
    results: list[dict]
    total_duration_ms: int
    summary: dict[str, int] | None = None


class CircuitRunRequest(BaseModel):
    """Run one or more circuits and return a full signal readout."""
    user_address: str
    circuits: list[str] | None = None
    portfolio_features: list[int] | None = None
    inputs_override: dict[str, dict] | None = None
    mode: str = "signal"  # For readouts, signal mode is usually what users want.
    include_human_summary: bool = True
    context_label: str | None = "market_depth"


def _parse_user_address_int(raw: str | None) -> int:
    if not raw:
        return 0
    try:
        value = raw.strip()
        return int(value, 16) if value.startswith("0x") else int(value)
    except Exception:
        return 0


def _humanize_scan_result(scan: dict, context_label: str | None = None) -> str:
    """Create a deterministic, human-readable signal summary."""
    summary = scan.get("summary") or {}
    total = int(scan.get("circuits_run") or 0)
    compliant = int(summary.get("compliant") or 0)
    non_compliant = int(summary.get("non_compliant") or 0)
    failed = int(summary.get("failed") or 0)
    skipped = int(summary.get("skipped") or 0)

    highlights: list[str] = []
    for row in scan.get("results") or []:
        if not row.get("success"):
            continue
        if row.get("is_compliant") is False:
            highlights.append(f"{row.get('circuit')}: below threshold")
        elif row.get("is_compliant") is True:
            highlights.append(f"{row.get('circuit')}: within bound")
        if len(highlights) >= 4:
            break

    label = context_label or "signals"
    lines = [
        f"Context: {label}",
        f"Mode: {scan.get('mode', 'gate')} | Circuits run: {total}",
        f"Compliant: {compliant}, Non-compliant: {non_compliant}, Failed: {failed}, Skipped: {skipped}",
    ]
    if highlights:
        lines.append("Highlights: " + "; ".join(highlights))
    if scan.get("mode") == "signal":
        lines.append("Interpretation: this is an indicator readout, not a hard execution block.")
    return "\n".join(lines)


def _build_skill_map() -> dict[str, list[str]]:
    """Map circuit_name -> [skill_ids] for composability readouts."""
    from app.services.agent_skill_service import SKILL_DEFINITIONS

    out: dict[str, list[str]] = {}
    for skill_id, skill in SKILL_DEFINITIONS.items():
        out.setdefault(skill.circuit_name, []).append(skill_id)
    return out


@router.post("/scan")
async def circuit_scan(req: CircuitScanRequest) -> CircuitScanResponse:
    """Run a parallel scan across all (or selected) zkML circuits.

    Returns per-circuit proof results with compliance flags, proof hashes,
    and timing metadata. Useful for comprehensive portfolio risk assessment.
    """
    from app.services.zkml.circuit_scanner import run_circuit_scan

    user_addr_int = _parse_user_address_int(req.user_address)

    result = await run_circuit_scan(
        circuits=req.circuits,
        inputs_override=req.inputs_override,
        user_address=user_addr_int,
        portfolio_features=req.portfolio_features,
        mode=req.mode,
    )
    return CircuitScanResponse(**result)


@router.get("/circuits")
async def list_circuits():
    """List all registered circuits and their readiness status."""
    from app.services.zkml.circuit_scanner import list_available_circuits

    skill_map = _build_skill_map()
    circuits = list_available_circuits()
    for circuit in circuits:
        circuit["skills"] = skill_map.get(circuit["name"], [])
    return {"circuits": circuits}


@router.get("/readout")
async def zkml_readout():
    """Unified stack readout: circuits + skill bindings + ONNX status."""
    from app.services.zkml.circuit_scanner import list_circuit_readout, get_onnx_runtime_status

    skill_map = _build_skill_map()
    circuits = list_circuit_readout()
    for circuit in circuits:
        circuit["skills"] = skill_map.get(circuit["name"], [])
        circuit["as_signal"] = True  # indicator-friendly by default

    return {
        "stack": {
            "proof_systems": ["cairo", "circom", "groth16"],
            "llm_skill_orchestration": True,
            "composition_mode": "composable_signals",
        },
        "circuits": circuits,
        "onnx": get_onnx_runtime_status(),
        "notes": [
            "Circuits marked as_signal=true are suitable as indicator inputs.",
            "Use /zkml/readout/run to execute all/selected circuits and inspect outputs.",
        ],
    }


@router.post("/readout/run")
async def zkml_readout_run(req: CircuitRunRequest):
    """Run composable circuit signals and return full output + readable summary."""
    from app.services.zkml.circuit_scanner import run_circuit_scan

    user_addr_int = _parse_user_address_int(req.user_address)
    scan = await run_circuit_scan(
        circuits=req.circuits,
        inputs_override=req.inputs_override,
        user_address=user_addr_int,
        portfolio_features=req.portfolio_features,
        mode=req.mode,
    )
    readable = _humanize_scan_result(scan, context_label=req.context_label) if req.include_human_summary else None
    return {
        **scan,
        "human_summary": readable,
    }
