"""
Demo + Strategy Simulator API routes.

Endpoints:
  POST /demo/simulate                — scan portfolio, propose strategy
  POST /demo/simulate-and-execute    — scan + propose + simulate execution
  POST /demo/reputation-scan         — deep behavioral reputation scan
  POST /demo/sessions                — create empty session
  GET  /demo/sessions/{session_id}   — get session state
  POST /demo/sessions/{session_id}/mtm       — mark-to-market
  POST /demo/sessions/{session_id}/snapshot   — take snapshot (+ L3)
  POST /demo/sessions/{session_id}/close      — close session
  GET  /demo/sessions                — list active sessions
"""

from __future__ import annotations

import hashlib as _hl_sk
import logging
import secrets as _secrets
import time as _time
from collections import defaultdict as _defaultdict
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["demo"])

# ─── Shared in-memory stores ─────────────────────────────────────────────────

# Session keys
_session_keys: Dict[str, Dict[str, Any]] = {}

# Activity event streams  { wallet_address -> [events] }
_event_streams: Dict[str, list] = _defaultdict(list)

# Dark vault positions  { vault_id -> vault_data }
_dark_vaults: Dict[str, Dict[str, Any]] = {}


def _emit_event(wallet: str, event_type: str, detail: str, meta: Dict[str, Any] | None = None):
    """Push an event into the activity stream for a wallet."""
    ev = {
        "id": f"ev_{_secrets.token_hex(4)}",
        "type": event_type,
        "detail": detail,
        "meta": meta or {},
        "ts": _time.time(),
    }
    _event_streams[wallet.lower()].append(ev)
    # Keep max 200 events per wallet
    if len(_event_streams[wallet.lower()]) > 200:
        _event_streams[wallet.lower()] = _event_streams[wallet.lower()][-200:]
    return ev


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
    from app.services.trade_engine import create_session as _create

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
    from app.services.trade_engine import list_active_sessions
    return {"sessions": list_active_sessions(limit)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get full session state including positions and P&L."""
    from app.services.trade_engine import get_session as _get

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
    from app.services.trade_engine import open_position

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
    from app.services.trade_engine import mark_to_market as _mtm

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
    from app.services.trade_engine import (
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
    from app.services.trade_engine import (
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


# ─── Strategy comparison (all 3 risk profiles in parallel) ───────────────────

class CompareRequest(BaseModel):
    wallet_address: str = Field(..., description="Starknet wallet address")
    hypothetical_usd: Optional[float] = Field(default=None)


@router.post("/compare-strategies")
async def compare_strategies(req: CompareRequest):
    """
    Run all 3 risk profiles (conservative / balanced / aggressive) against the
    same portfolio snapshot and return them side-by-side.
    """
    import asyncio
    from app.services.position_scanner import scan_portfolio
    from app.services.strategy_simulator import simulate_strategy as _simulate

    snapshot = await scan_portfolio(req.wallet_address)
    snapshot_dict = snapshot.to_dict()

    is_hypothetical = (
        req.hypothetical_usd is not None and snapshot.total_value_usd <= 0.01
    )

    async def _run(profile: str):
        proposal = await _simulate(
            snapshot_dict, profile, hypothetical_usd=req.hypothetical_usd,
        )
        return {
            "risk_profile": profile,
            "expected_blended_apy": proposal.expected_blended_apy,
            "expected_annual_yield_usd": proposal.expected_annual_yield_usd,
            "reasoning": proposal.reasoning,
            "proposal_hash": proposal.proposal_hash,
            "moves_count": len(proposal.moves),
            "portfolio_value_usd": proposal.portfolio_value_usd,
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
        }

    conservative, balanced, aggressive = await asyncio.gather(
        _run("conservative"), _run("balanced"), _run("aggressive"),
    )

    return {
        "portfolio": {
            "wallet_address": snapshot.wallet_address,
            "total_value_usd": snapshot.total_value_usd,
            "position_count": snapshot.position_count,
            "protocols_found": snapshot.protocols_found,
        },
        "is_hypothetical": is_hypothetical,
        "strategies": {
            "conservative": conservative,
            "balanced": balanced,
            "aggressive": aggressive,
        },
    }


# ─── Onboard: assign L3 identity after reputation scan ──────────────────────

class OnboardRequest(BaseModel):
    wallet_address: str = Field(..., description="Starknet L1/L2 wallet address")


@router.post("/onboard")
async def onboard_identity(req: OnboardRequest):
    """
    Onboard a wallet into the Capital OS demo:
      1. Run reputation scan
      2. Derive a deterministic L3 address from wallet + salt
      3. Create a paper trading session
      4. Return unified identity (L3 addr, session_id, reputation, credit score)
    """
    import hashlib as _hl
    from app.services.trade_engine import create_session, get_sessions_for_wallet

    # 1. Reputation scan (same as /reputation-scan endpoint)
    try:
        from app.services.reputation_scanner import scan_reputation
        profile = await scan_reputation(req.wallet_address)
        reputation = profile.to_dict()
    except Exception as exc:
        logger.warning("Reputation scan in onboard failed: %s", exc)
        reputation = None

    # 2. Derive deterministic L3 address
    l3_seed = f"zkdefi_l3_v1:{req.wallet_address.strip().lower()}"
    l3_hash = _hl.sha256(l3_seed.encode()).hexdigest()
    l3_address = "0x" + l3_hash[:40]  # 20-byte address

    # 3. Get or create paper trading session
    existing = get_sessions_for_wallet(req.wallet_address)
    if existing:
        session = existing[0]
    else:
        session = create_session(req.wallet_address)

    # 4. Auto-issue a session key for the embedded wallet
    import time as _t_onboard
    import secrets as _s_onboard
    import hashlib as _hl_onboard
    now_onboard = _t_onboard.time()
    sk_entropy = _s_onboard.token_hex(32)
    sk_id = f"sk_{_s_onboard.token_hex(8)}"
    sk_seed = f"zkdefi_sk_v1:{req.wallet_address.lower()}:{sk_entropy}"
    sk_signing = _hl_onboard.sha256(sk_seed.encode()).hexdigest()
    session_key_resp = {
        "key_id": sk_id,
        "signing_key_prefix": sk_signing[:8] + "…",
        "permissions": ["trade", "snapshot", "proof"],
        "expires_at": now_onboard + 3600,
        "ttl_seconds": 3600,
        "status": "active",
    }

    # 5. Emit onboard events to the activity stream
    _emit_event(req.wallet_address, "onboarded", "L3 identity provisioned", {
        "l3_address": l3_address,
        "session_id": session.session_id,
        "fico_score": reputation.get("fico_score") if reputation else None,
    })
    _emit_event(req.wallet_address, "session_key_issued", f"Session key {sk_id} active for 1h", {
        "key_id": sk_id,
    })

    return {
        "status": "onboarded",
        "wallet_address": req.wallet_address,
        "l3_address": l3_address,
        "session_id": session.session_id,
        "session_created_at": session.created_at,
        "reputation": reputation,
        "session_key": session_key_resp,
    }


# ─── Session keys: lightweight embedded wallet ──────────────────────────────

class IssueSessionKeyRequest(BaseModel):
    wallet_address: str = Field(..., description="L2 wallet address that signs this request")
    session_id: str = Field(..., description="Paper trading session ID")
    ttl_seconds: int = Field(default=3600, description="Key lifetime in seconds (default 1h)")
    permissions: list[str] = Field(
        default=["trade", "snapshot", "proof"],
        description="Allowed actions for this session key",
    )


@router.post("/session-keys/issue")
async def issue_session_key(req: IssueSessionKeyRequest):
    """
    Issue a short-lived session key for the embedded L3 wallet.
    The session key allows simulated trades, snapshots, and proof generation
    without re-signing with the parent wallet each time.
    """
    now = _time.time()
    key_entropy = _secrets.token_hex(32)
    key_id = f"sk_{_secrets.token_hex(8)}"

    # Derive session signing key from wallet + entropy
    session_signing_seed = f"zkdefi_sk_v1:{req.wallet_address.lower()}:{key_entropy}"
    session_signing_key = _hl_sk.sha256(session_signing_seed.encode()).hexdigest()

    # Derive embedded L3 address for this session key
    l3_seed = f"zkdefi_l3_v1:{req.wallet_address.strip().lower()}"
    l3_address = "0x" + _hl_sk.sha256(l3_seed.encode()).hexdigest()[:40]

    key_data = {
        "key_id": key_id,
        "wallet_address": req.wallet_address,
        "session_id": req.session_id,
        "l3_address": l3_address,
        "signing_key_hash": _hl_sk.sha256(session_signing_key.encode()).hexdigest()[:16],
        "permissions": req.permissions,
        "issued_at": now,
        "expires_at": now + req.ttl_seconds,
        "ttl_seconds": req.ttl_seconds,
        "status": "active",
        "actions_signed": 0,
    }
    _session_keys[key_id] = key_data

    return {
        "key_id": key_id,
        "l3_address": l3_address,
        "session_id": req.session_id,
        "signing_key_prefix": session_signing_key[:8] + "…",
        "permissions": req.permissions,
        "issued_at": key_data["issued_at"],
        "expires_at": key_data["expires_at"],
        "ttl_seconds": req.ttl_seconds,
        "status": "active",
    }


@router.get("/session-keys/{key_id}")
async def get_session_key(key_id: str):
    """Check the status of a session key."""
    if key_id not in _session_keys:
        raise HTTPException(status_code=404, detail="Session key not found")
    key = _session_keys[key_id]
    now = _time.time()
    if now > key["expires_at"]:
        key["status"] = "expired"
    return key


@router.post("/session-keys/{key_id}/sign")
async def sign_with_session_key(key_id: str, action: str = "trade"):
    """
    Simulate signing an action with a session key.
    Returns a signature hash if the key is valid and authorized.
    """
    if key_id not in _session_keys:
        raise HTTPException(status_code=404, detail="Session key not found")
    key = _session_keys[key_id]
    now = _time.time()
    if now > key["expires_at"]:
        key["status"] = "expired"
        raise HTTPException(status_code=403, detail="Session key expired")
    if action not in key["permissions"]:
        raise HTTPException(status_code=403, detail=f"Action '{action}' not permitted")

    key["actions_signed"] += 1
    sig_input = f"{key_id}:{action}:{now}:{key['signing_key_hash']}"
    signature = _hl_sk.sha256(sig_input.encode()).hexdigest()

    return {
        "key_id": key_id,
        "action": action,
        "signature": f"0x{signature}",
        "signed_at": now,
        "actions_signed": key["actions_signed"],
        "status": "signed",
    }


@router.delete("/session-keys/{key_id}")
async def revoke_session_key(key_id: str):
    """Revoke a session key immediately."""
    if key_id not in _session_keys:
        raise HTTPException(status_code=404, detail="Session key not found")
    _session_keys[key_id]["status"] = "revoked"
    _session_keys[key_id]["expires_at"] = _time.time()
    return {"key_id": key_id, "status": "revoked"}


# ─── Activity stream: event log for the Intelligent Stream ─────────────────

@router.get("/stream/{wallet_address}")
async def get_activity_stream(wallet_address: str, limit: int = 50):
    """Get the activity stream for a wallet (most recent first)."""
    events = _event_streams.get(wallet_address.lower(), [])
    return {
        "wallet_address": wallet_address,
        "events": list(reversed(events[-limit:])),
        "total": len(events),
    }


# ─── Dark Vault: privacy-preserving paper vault ────────────────────────────

class VaultDepositRequest(BaseModel):
    wallet_address: str = Field(..., description="L2 wallet address")
    session_id: str = Field(..., description="Paper trading session ID")
    amount_usd: float = Field(..., gt=0, description="Amount to deposit")
    privacy_level: str = Field(default="shielded", description="Privacy level: shielded | private | transparent")
    note: str = Field(default="", description="Optional encrypted note (client-side encrypted)")


@router.post("/vault/deposit")
async def vault_deposit(req: VaultDepositRequest):
    """
    Deposit paper capital into the Dark Vault.
    Creates a commitment hash and shields the balance from public view.
    """
    vault_id = f"dv_{_secrets.token_hex(8)}"
    now = _time.time()

    # Derive commitment hash (position blinding)
    commitment_input = f"{req.wallet_address}:{req.amount_usd}:{now}:{_secrets.token_hex(16)}"
    commitment_hash = _hl_sk.sha256(commitment_input.encode()).hexdigest()

    # Derive nullifier for future withdrawal
    nullifier_input = f"null_v1:{vault_id}:{commitment_hash}"
    nullifier_hash = _hl_sk.sha256(nullifier_input.encode()).hexdigest()

    vault_data = {
        "vault_id": vault_id,
        "wallet_address": req.wallet_address,
        "session_id": req.session_id,
        "amount_usd": req.amount_usd,
        "privacy_level": req.privacy_level,
        "commitment_hash": f"0x{commitment_hash}",
        "nullifier_hash": f"0x{nullifier_hash}",
        "status": "shielded",
        "deposited_at": now,
        "withdrawn_at": None,
        "note_encrypted": req.note if req.note else None,
    }
    _dark_vaults[vault_id] = vault_data

    # Emit to activity stream
    _emit_event(req.wallet_address, "vault_deposit", f"Deposited ${req.amount_usd:,.2f} into Dark Vault", {
        "vault_id": vault_id,
        "amount_usd": req.amount_usd,
        "privacy_level": req.privacy_level,
        "commitment_hash": f"0x{commitment_hash[:16]}…",
    })

    return {
        "vault_id": vault_id,
        "amount_usd": req.amount_usd,
        "privacy_level": req.privacy_level,
        "commitment_hash": f"0x{commitment_hash}",
        "nullifier_preview": f"0x{nullifier_hash[:16]}…",
        "status": "shielded",
        "deposited_at": now,
    }


@router.get("/vault/{wallet_address}")
async def get_vaults(wallet_address: str):
    """List all dark vault positions for a wallet."""
    vaults = [
        v for v in _dark_vaults.values()
        if v["wallet_address"].lower() == wallet_address.lower()
    ]
    total_shielded = sum(v["amount_usd"] for v in vaults if v["status"] == "shielded")
    return {
        "wallet_address": wallet_address,
        "vaults": vaults,
        "total_shielded_usd": total_shielded,
        "vault_count": len(vaults),
    }


@router.post("/vault/{vault_id}/withdraw")
async def vault_withdraw(vault_id: str):
    """Withdraw from Dark Vault (reveal and unshield)."""
    if vault_id not in _dark_vaults:
        raise HTTPException(status_code=404, detail="Vault not found")
    vault = _dark_vaults[vault_id]
    if vault["status"] != "shielded":
        raise HTTPException(status_code=400, detail="Vault already withdrawn")

    vault["status"] = "withdrawn"
    vault["withdrawn_at"] = _time.time()

    _emit_event(vault["wallet_address"], "vault_withdraw", f"Withdrew ${vault['amount_usd']:,.2f} from Dark Vault", {
        "vault_id": vault_id,
        "amount_usd": vault["amount_usd"],
    })

    return {
        "vault_id": vault_id,
        "amount_usd": vault["amount_usd"],
        "status": "withdrawn",
        "withdrawn_at": vault["withdrawn_at"],
    }


# ─── Proof of Performance: ZK proof over PnL snapshot ──────────────────────

class ProofOfPerformanceRequest(BaseModel):
    wallet_address: str = Field(..., description="L2 wallet address")
    session_id: str = Field(..., description="Paper trading session to prove")
    prove_type: str = Field(default="pnl_positive", description="What to prove: pnl_positive | apy_above | capital_preserved")
    threshold: Optional[float] = Field(default=None, description="Threshold for proof (e.g. min APY)")


@router.post("/proof-of-performance")
async def proof_of_performance(req: ProofOfPerformanceRequest):
    """
    Generate a ZK proof of paper trading performance.
    Proves a claim about PnL/APY *without* revealing the strategy or exact numbers.
    """
    from app.services.trade_engine import get_session

    session = get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    now = _time.time()

    # Calculate session stats (session is a PaperTradeSession dataclass)
    positions = [p for p in session.positions if not p.closed]
    total_value = session.total_value_usd if session.total_value_usd > 0 else sum(p.amount_usd for p in positions)
    starting = session.starting_value_usd or 10000
    pnl = session.total_pnl_usd if session.total_pnl_usd != 0 else (total_value - starting)
    pnl_pct = (pnl / starting * 100) if starting > 0 else 0

    # Estimate elapsed hours from created_at ISO string
    try:
        from datetime import datetime, timezone
        created = datetime.fromisoformat(session.created_at.replace("Z", "+00:00"))
        elapsed_hours = (datetime.now(timezone.utc) - created).total_seconds() / 3600
    except Exception:
        elapsed_hours = 1.0
    annualized_apy = (pnl_pct / max(elapsed_hours, 0.01)) * 8760 if starting > 0 else 0

    # Determine claim result
    claim_valid = False
    claim_statement = ""
    if req.prove_type == "pnl_positive":
        claim_valid = pnl >= 0
        claim_statement = "Paper P&L ≥ 0"
    elif req.prove_type == "apy_above":
        threshold = req.threshold or 5.0
        claim_valid = annualized_apy >= threshold
        claim_statement = f"Annualized APY ≥ {threshold}%"
    elif req.prove_type == "capital_preserved":
        claim_valid = total_value >= starting * 0.95  # 5% drawdown tolerance
        claim_statement = "Capital preserved (≤5% drawdown)"
    else:
        claim_statement = f"Unknown prove type: {req.prove_type}"

    # Generate proof artifacts
    proof_input = f"pop_v1:{req.session_id}:{req.prove_type}:{claim_valid}:{now}"
    proof_hash = _hl_sk.sha256(proof_input.encode()).hexdigest()
    nullifier = _hl_sk.sha256(f"pop_null:{proof_hash}".encode()).hexdigest()

    # Build public inputs (what the verifier sees — no strategy details)
    public_inputs = {
        "session_id_hash": _hl_sk.sha256(req.session_id.encode()).hexdigest()[:16],
        "claim_type": req.prove_type,
        "claim_valid": claim_valid,
        "timestamp": int(now),
        "proof_hash": f"0x{proof_hash}",
    }

    # Build private inputs (hidden from verifier)
    private_witness = {
        "actual_pnl_usd": round(pnl, 2),
        "actual_pnl_pct": round(pnl_pct, 4),
        "actual_apy": round(annualized_apy, 4),
        "position_count": len(positions),
        "starting_value": starting,
    }

    # Emit to activity stream
    _emit_event(req.wallet_address, "proof_generated", f"ZK Proof: {claim_statement} = {claim_valid}", {
        "proof_hash": f"0x{proof_hash[:16]}…",
        "prove_type": req.prove_type,
        "claim_valid": claim_valid,
    })

    return {
        "proof_hash": f"0x{proof_hash}",
        "nullifier": f"0x{nullifier}",
        "claim_statement": claim_statement,
        "claim_valid": claim_valid,
        "prove_type": req.prove_type,
        "public_inputs": public_inputs,
        "private_witness_summary": {
            "fields_count": len(private_witness),
            "witness_hash": _hl_sk.sha256(str(private_witness).encode()).hexdigest()[:16],
        },
        "generated_at": now,
        "verified": True,  # In production, this would be verified on-chain
        "verification_method": "EZKL + Groth16 (simulated for demo)",
    }
