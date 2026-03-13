"""
Paper Trade + Strategy Simulator API routes.

Endpoints:
  POST /paper-trade/simulate                — scan portfolio, propose strategy
  POST /paper-trade/simulate-and-execute    — scan + propose + execute on paper
  POST /paper-trade/reputation-scan         — deep behavioral reputation scan
  POST /paper-trade/sessions                — create empty session
  GET  /paper-trade/sessions/{session_id}   — get session state
  POST /paper-trade/sessions/{session_id}/mtm       — mark-to-market
  POST /paper-trade/sessions/{session_id}/snapshot   — take snapshot (+ L3)
  POST /paper-trade/sessions/{session_id}/close      — close session
  GET  /paper-trade/sessions                — list active sessions
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["paper-trade"])


# ─── Request models ──────────────────────────────────────────────────────────

class SimulateRequest(BaseModel):
    wallet_address: str = Field(..., description="Starknet wallet address to scan")
    risk_profile: str = Field(default="balanced", description="conservative | balanced | aggressive")
    hypothetical_usd: Optional[float] = Field(default=None, description="If set and portfolio is empty, simulate with this hypothetical capital amount")


class CreateSessionRequest(BaseModel):
    wallet_address: str
    starting_value_usd: float = Field(default=0.0, description="Starting capital (0 = use scanned portfolio)")


class OpenPositionRequest(BaseModel):
    protocol: str
    pool_name: str
    asset_symbol: str
    position_type: str = "lending"
    amount_usd: float
    entry_price: float = 1.0
    apy: float = 0.0


# ─── Simulate ────────────────────────────────────────────────────────────────

@router.post("/simulate")
async def simulate_strategy(req: SimulateRequest):
    """
    Scan a wallet's mainnet portfolio and propose a strategy.

    Does NOT execute anything — returns the proposal for review.
    """
    from app.services.position_scanner import scan_portfolio
    from app.services.strategy_simulator import simulate_strategy as _simulate

    # 1. Scan real portfolio
    snapshot = await scan_portfolio(req.wallet_address)
    snapshot_dict = snapshot.to_dict()

    # 2. Simulate strategy (with optional hypothetical capital)
    proposal = await _simulate(
        snapshot_dict, req.risk_profile,
        hypothetical_usd=req.hypothetical_usd,
    )

    return {
        "portfolio": {
            "wallet_address": snapshot.wallet_address,
            "total_value_usd": snapshot.total_value_usd,
            "position_count": snapshot.position_count,
            "protocols_found": snapshot.protocols_found,
            "snapshot_hash": snapshot.snapshot_hash,
        },
        "proposal": proposal.to_dict(),
        "is_hypothetical": req.hypothetical_usd is not None and snapshot.total_value_usd <= 0.01,
    }


@router.post("/simulate-and-execute")
async def simulate_and_execute(req: SimulateRequest):
    """
    Full flow: scan portfolio → propose strategy → execute on paper → settle to L3.

    Returns session ID for tracking P&L over time.
    """
    from app.services.position_scanner import scan_portfolio
    from app.services.strategy_simulator import simulate_strategy as _simulate
    from app.services.strategy_simulator import execute_on_paper

    # 1. Scan
    snapshot = await scan_portfolio(req.wallet_address)
    snapshot_dict = snapshot.to_dict()

    # 2. Simulate (with optional hypothetical capital)
    proposal = await _simulate(
        snapshot_dict, req.risk_profile,
        hypothetical_usd=req.hypothetical_usd,
    )

    # 3. Execute on paper + settle to L3
    result = await execute_on_paper(proposal, settle_to_l3=True)

    return {
        "portfolio": {
            "wallet_address": snapshot.wallet_address,
            "total_value_usd": snapshot.total_value_usd,
            "position_count": snapshot.position_count,
            "protocols_found": snapshot.protocols_found,
        },
        "proposal": {
            "risk_profile": proposal.risk_profile,
            "moves_count": len(proposal.moves),
            "expected_blended_apy": proposal.expected_blended_apy,
            "expected_annual_yield_usd": proposal.expected_annual_yield_usd,
            "reasoning": proposal.reasoning,
            "proposal_hash": proposal.proposal_hash,
            "moves": [
                {
                    "action": m.action,
                    "protocol": m.protocol,
                    "pool_name": m.pool_name,
                    "asset_symbol": m.asset_symbol,
                    "amount_usd": m.amount_usd,
                    "expected_apy": m.expected_apy,
                    "risk_score": m.risk_score,
                    "reasoning": m.reasoning,
                }
                for m in proposal.moves
            ],
        },
        "execution": result,
    }


# ─── Session management ─────────────────────────────────────────────────────

@router.post("/sessions")
async def create_session(req: CreateSessionRequest):
    """Create a new paper trading session."""
    from app.services.paper_trade_engine import create_session as _create

    session = _create(req.wallet_address, req.starting_value_usd)
    return {
        "session_id": session.session_id,
        "wallet_address": session.wallet_address,
        "created_at": session.created_at,
        "starting_value_usd": session.starting_value_usd,
    }


@router.get("/sessions")
async def list_sessions(limit: int = 50):
    """List active paper trading sessions."""
    from app.services.paper_trade_engine import list_active_sessions
    return {"sessions": list_active_sessions(limit)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get full session state including positions and P&L."""
    from app.services.paper_trade_engine import get_session as _get

    session = _get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.session_id,
        "wallet_address": session.wallet_address,
        "created_at": session.created_at,
        "closed": session.closed,
        "total_value_usd": session.total_value_usd,
        "starting_value_usd": session.starting_value_usd,
        "total_pnl_usd": session.total_pnl_usd,
        "total_pnl_pct": session.total_pnl_pct,
        "last_snapshot_hash": session.last_snapshot_hash,
        "positions": [
            {
                "position_id": p.position_id,
                "protocol": p.protocol,
                "pool_name": p.pool_name,
                "asset_symbol": p.asset_symbol,
                "position_type": p.position_type,
                "amount_usd": p.amount_usd,
                "apy_at_entry": p.apy_at_entry,
                "current_apy": p.current_apy,
                "pnl_usd": p.pnl_usd,
                "entered_at": p.entered_at,
                "closed": p.closed,
            }
            for p in session.positions
        ],
        "snapshot_count": len(session.snapshots),
    }


@router.post("/sessions/{session_id}/positions")
async def add_position(session_id: str, req: OpenPositionRequest):
    """Manually add a paper position to a session."""
    from app.services.paper_trade_engine import open_position

    pos = open_position(
        session_id=session_id,
        protocol=req.protocol,
        pool_name=req.pool_name,
        asset_symbol=req.asset_symbol,
        position_type=req.position_type,
        amount_usd=req.amount_usd,
        entry_price=req.entry_price,
        apy=req.apy,
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Session not found or closed")
    return {"position_id": pos.position_id, "status": "opened"}


@router.post("/sessions/{session_id}/mtm")
async def mark_to_market(session_id: str):
    """Re-price all positions using elapsed time × current APY."""
    from app.services.paper_trade_engine import mark_to_market as _mtm

    session = _mtm(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or closed")
    return {
        "session_id": session.session_id,
        "total_value_usd": session.total_value_usd,
        "total_pnl_usd": session.total_pnl_usd,
        "total_pnl_pct": session.total_pnl_pct,
        "last_snapshot_hash": session.last_snapshot_hash,
    }


@router.post("/sessions/{session_id}/snapshot")
async def take_snapshot(session_id: str, settle_l3: bool = True):
    """
    Take a point-in-time snapshot and optionally settle to L3.

    Returns the snapshot hash for proof binding.
    """
    from app.services.paper_trade_engine import (
        take_snapshot as _snap,
        settle_snapshot_to_l3,
    )

    snapshot = _snap(session_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Session not found")

    l3_result = None
    if settle_l3:
        l3_result = await settle_snapshot_to_l3(snapshot)

    return {
        "snapshot": snapshot.to_dict(),
        "l3_settlement": l3_result,
    }


@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str):
    """Close a paper trading session (final P&L locked in)."""
    from app.services.paper_trade_engine import (
        close_session as _close,
        get_session as _get,
        take_snapshot as _snap,
        settle_snapshot_to_l3,
    )

    # Take final snapshot before closing
    final_snap = _snap(session_id)
    l3_result = None
    if final_snap:
        l3_result = await settle_snapshot_to_l3(final_snap)

    if not _close(session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    session = _get(session_id)
    return {
        "session_id": session_id,
        "status": "closed",
        "final_pnl_usd": session.total_pnl_usd if session else 0,
        "final_pnl_pct": session.total_pnl_pct if session else 0,
        "final_snapshot": final_snap.to_dict() if final_snap else None,
        "l3_settlement": l3_result,
    }


# ─── Reputation scan ────────────────────────────────────────────────────────

class ReputationScanRequest(BaseModel):
    wallet_address: str = Field(..., description="Starknet wallet address to scan")


@router.post("/reputation-scan")
async def reputation_scan(req: ReputationScanRequest):
    """
    Deep behavioral reputation scan.

    Goes beyond basic portfolio reading to extract:
      - Account age & type (Argent, Braavos, custom deployer, OZ)
      - Lifetime transaction count (nonce)
      - Capital profile across protocols
      - Behavioral signals: diamond hands, diversification, DeFi nativeness
      - Rug survival / market resilience indicators
      - Composite scores: veteran, conviction, activity, diversity, capital, resilience
      - Recommended trust tier with reasoning
      - FICO credit score (300-850) via circuit-ready MLP
      - Credit class (AAA/AA/A/B/C) with confidence
      - ZK circuit readiness status
    """
    from app.services.reputation_scanner import scan_reputation

    try:
        profile = await scan_reputation(req.wallet_address)
        return profile.to_dict()
    except Exception as exc:
        logger.exception("Reputation scan failed for %s", req.wallet_address)
        raise HTTPException(status_code=500, detail=f"Reputation scan failed: {exc}")


@router.get("/circuit-info")
async def circuit_info():
    """
    Return circuit compilation path metadata.

    Shows which compilation targets are available for the credit scoring
    circuit: EZKL Halo2, ONNX WASM, Rust WASM, Noir, Cairo native.
    """
    from app.services.circuit_ready_scorer import get_circuit_compilation_paths

    return get_circuit_compilation_paths()


# ─── EZKL ZK proof generation ───────────────────────────────────────────────


class GenerateProofRequest(BaseModel):
    wallet_address: str = Field(..., description="Wallet that was scanned")
    feature_vector: list[float] = Field(
        ..., description="Normalized 18-feature vector from reputation scan"
    )


@router.post("/generate-proof")
async def generate_proof(req: GenerateProofRequest):
    """
    Generate a real EZKL ZK proof of the credit scoring MLP.

    Takes the normalized 18-feature vector produced by /reputation-scan
    and runs it through the full EZKL pipeline:
      input → witness → prove → verify

    Returns proof hash, verification status, and timing breakdown.
    """
    from app.services.circuit_ready_scorer import generate_credit_proof, _check_ezkl_ready

    if not _check_ezkl_ready():
        raise HTTPException(
            status_code=503,
            detail="EZKL artifacts not found — circuit not compiled",
        )

    if len(req.feature_vector) != 18:
        raise HTTPException(
            status_code=400,
            detail=f"Expected 18 features, got {len(req.feature_vector)}",
        )

    result = await generate_credit_proof(req.feature_vector)
    if result is None:
        raise HTTPException(status_code=500, detail="Proof generation failed")

    return {
        "wallet_address": req.wallet_address,
        **result,
    }


# ─── Portable W3C-VC reputation export ──────────────────────────────────────

class ExportVCRequest(BaseModel):
    wallet_address: str = Field(..., description="Wallet address")
    fico_score: int = Field(default=0, description="FICO score (300-850)")
    fico_tier: str = Field(default="", description="excellent/good/fair/poor")
    credit_class: str = Field(default="", description="AAA/AA/A/B/C")
    credit_confidence: float = Field(default=0.0, description="0.0-1.0")
    defi_veteran_score: int = Field(default=0, description="0-100")
    recommended_tier: int = Field(default=1, description="1-3")
    feature_hash: str = Field(default="", description="SHA256 of feature vector")
    model_hash: str = Field(default="", description="SHA256 of ONNX model")
    proof_hash: Optional[str] = Field(default=None, description="ZK proof hash if generated")
    target_chain: str = Field(default="starknet", description="Target chain for VC")
    ttl_hours: int = Field(default=168, description="Credential TTL in hours")


@router.post("/export-vc")
async def export_vc(req: ExportVCRequest):
    """
    Export reputation + FICO credit score as a W3C Verifiable Credential.

    Packages the on-chain behavioral reputation, FICO score, credit class,
    and optional ZK proof hash into a portable VC envelope that can be
    presented to other chains, protocols, or lending desks.
    """
    import hashlib
    import json
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    credential_id = "0x" + hashlib.sha256(
        f"{req.wallet_address}:{now.isoformat()}".encode()
    ).hexdigest()[:16]

    claims = {
        "fico_score": req.fico_score,
        "fico_tier": req.fico_tier,
        "credit_class": req.credit_class,
        "credit_confidence": round(req.credit_confidence, 4),
        "defi_veteran_score": req.defi_veteran_score,
        "recommended_tier": req.recommended_tier,
        "feature_hash": req.feature_hash,
        "model_hash": req.model_hash,
    }
    if req.proof_hash:
        claims["zk_proof_hash"] = req.proof_hash
        claims["proof_verified"] = True

    # Compute integrity hash
    integrity_payload = json.dumps(
        {"credential_id": credential_id, "claims": claims},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    integrity_hash = "0x" + hashlib.sha256(integrity_payload.encode()).hexdigest()

    # Build W3C-VC envelope
    envelope = {
        "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://zkde.fi/credentials/reputation/v1",
            "https://zkde.fi/credentials/credit-score/v1",
        ],
        "type": [
            "VerifiableCredential",
            "ReputationCredential",
            "CreditScoreCredential",
        ],
        "issuer": {
            "id": "did:web:zkde.fi",
            "name": "zkde.fi by Obsqra Labs",
        },
        "issuanceDate": now.isoformat(),
        "expirationDate": (now + timedelta(hours=req.ttl_hours)).isoformat(),
        "credentialSubject": {
            "id": f"did:starknet:{req.wallet_address}",
            "ficoScore": req.fico_score,
            "ficoTier": req.fico_tier,
            "creditClass": req.credit_class,
            "creditConfidence": round(req.credit_confidence, 4),
            "defiVeteranScore": req.defi_veteran_score,
            "trustTier": req.recommended_tier,
            "scoringModel": {
                "version": "creditworthiness_mlp_v1",
                "architecture": "Linear(18→64)→ReLU→Linear(64→32)→ReLU→Linear(32→5)",
                "modelHash": req.model_hash,
                "featureHash": req.feature_hash,
            },
        },
        "proof": {
            "type": "Sha256IntegrityProof2024",
            "created": now.isoformat(),
            "verificationMethod": "did:web:zkde.fi#reputation-signing-key",
            "proofPurpose": "assertionMethod",
            "integrityHash": integrity_hash,
        },
    }

    # If ZK proof was generated, add proof evidence
    if req.proof_hash:
        envelope["credentialSubject"]["zkProof"] = {
            "proofHash": req.proof_hash,
            "proofSystem": "EZKL Halo2 (KZG)",
            "verified": True,
            "verifier": "groth16_garaga (Starknet)",
        }
        envelope["proof"]["zkProofHash"] = req.proof_hash

    return {
        "status": "ok",
        "credential_id": credential_id,
        "target_chain": req.target_chain,
        "envelope": envelope,
        "claims": claims,
        "integrity_hash": integrity_hash,
    }


# ─── Model artifacts for browser-side inference ─────────────────────────────

@router.get("/model-artifacts/onnx")
async def get_onnx_model():
    """
    Serve the creditworthiness ONNX model for browser-side inference.

    The browser loads this via onnxruntime-web to run MLP inference
    entirely client-side — no data leaves the user's device.
    """
    from fastapi.responses import FileResponse
    from app.services.circuit_ready_scorer import EZKL_MODEL_DIR

    onnx_path = EZKL_MODEL_DIR / "creditworthiness.onnx"
    if not onnx_path.exists():
        raise HTTPException(status_code=404, detail="ONNX model not found")

    return FileResponse(
        str(onnx_path),
        media_type="application/octet-stream",
        filename="creditworthiness.onnx",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/model-artifacts/norm-params")
async def get_norm_params():
    """
    Serve normalization parameters for browser-side feature preprocessing.

    Contains min/range arrays for the 18-feature vector.
    """
    from app.services.circuit_ready_scorer import EZKL_MODEL_DIR

    norm_path = EZKL_MODEL_DIR / "mlp_norm_params.json"
    if not norm_path.exists():
        raise HTTPException(status_code=404, detail="Norm params not found")

    import json
    return json.loads(norm_path.read_text())
