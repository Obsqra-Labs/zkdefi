"""
Risk Passport API

Composes reputation, identity, onboarding, and receipts into user and pool passports.
No new user/tier storage; read-only view over existing data.
"""

from __future__ import annotations

from typing import Any, Literal

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.services.pool_passport_store import get as get_pool_passport_store
from app.services.receipt_service import get_receipt_service

router = APIRouter(prefix="/risk_passport", tags=["risk_passport"])


def _composite_score(tier: int, tenure_days: int, total_volume_eth: float, collateral_eth: float) -> int:
    score = (
        tier * 30
        + min(tenure_days // 10, 20)
        + min(int(total_volume_eth * 2), 25)
        + min(int(collateral_eth * 10), 25)
    )
    return max(0, min(100, score))


def _letter_rating(composite: int) -> str:
    if composite >= 80:
        return "A"
    if composite >= 60:
        return "B"
    if composite >= 40:
        return "C"
    return "D"


@router.get("/user/{address}")
async def get_user_passport(address: str, request: Request):
    base = str(request.base_url).rstrip("/")
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(f"{base}/api/v1/zkdefi/reputation/user/{address}")
            r.raise_for_status()
            rep = r.json()
        except Exception:
            return {
                "composite_score": 0,
                "letter_rating": "D",
                "tier": 0,
                "tier_name": "Strict",
                "credit_tier": None,
                "credit_score": None,
                "proof_receipts": [],
                "message": "Reputation unavailable",
            }
        tier = rep.get("tier", 0)
        tier_name = rep.get("tier_name", "Strict")
        tenure_days = rep.get("tenure_days", 0)
        total_volume_eth = rep.get("total_volume_eth", 0.0)
        collateral_eth = rep.get("collateral_eth", 0.0)

        credit_tier = None
        credit_score = None
        try:
            onb = await client.get(f"{base}/api/v1/zkdefi/onboarding/status/{address}")
            if onb.status_code == 200:
                data = onb.json()
                commitment = data.get("identity_commitment")
                if commitment:
                    ident = await client.get(f"{base}/api/v1/identity/commitment/{commitment}")
                    if ident.status_code == 200:
                        idata = ident.json()
                        if idata.get("found"):
                            credit_tier = idata.get("tier")
                            credit_score = idata.get("score")
        except Exception:
            pass

        try:
            receipt_svc = get_receipt_service()
            proof_receipts = await receipt_svc.get_user_receipts((address or "").strip().lower())
            proof_receipts = sorted(
                proof_receipts,
                key=lambda x: x.get("timestamp", ""),
                reverse=True,
            )[:20]
        except Exception:
            proof_receipts = []

        composite = _composite_score(tier, tenure_days, total_volume_eth, collateral_eth)
        letter = _letter_rating(composite)

    return {
        "composite_score": composite,
        "letter_rating": letter,
        "tier": tier,
        "tier_name": tier_name,
        "credit_tier": credit_tier,
        "credit_score": credit_score,
        "proof_receipts": proof_receipts,
    }


@router.get("/pool/{pool_id}")
async def get_pool_passport(pool_id: str):
    entry = get_pool_passport_store(pool_id)
    if entry is None:
        return {
            "pool_id": pool_id,
            "passport": None,
            "safe": None,
            "health_score": None,
            "factors": {},
            "proof_receipts": [],
            "message": "No passport yet. Run anomaly analysis for this pool.",
        }
    receipt_svc = get_receipt_service()
    pool_receipts = receipt_svc.get_receipts_by_pool(pool_id)
    return {
        "pool_id": pool_id,
        "passport": entry,
        "safe": entry.get("safe"),
        "health_score": entry.get("health_score"),
        "factors": entry.get("factors", {}),
        "proof_receipts": pool_receipts,
        "snapshot_hash": entry.get("snapshot_hash"),
    }


class L3VerifyProofRequest(BaseModel):
    fact_hash: str
    proof_type: str = "stark"
    circuit_name: str = ""
    groth16_calldata: list[str] | None = None
    honk_calldata: list[str] | None = None
    kzg_calldata: list[str] | None = None
    stark_proof_data: dict[str, Any] | None = None
    execution_chain: Literal["l3", "l2", "dual"] = "l3"


@router.get("/l3/capabilities")
async def l3_capabilities():
    from app.services.l3_proving_path_client import get_l3_proving_path_client

    client = get_l3_proving_path_client()
    caps = await client.capabilities()
    if caps.error:
        return {"error": caps.error}
    return caps.raw


@router.get("/l3/proving-paths")
async def l3_proving_paths():
    from app.services.l3_proving_path_client import get_l3_proving_path_client

    client = get_l3_proving_path_client()
    return await client.proving_paths()


@router.get("/l3/stats")
async def l3_stats():
    from app.services.l3_proving_path_client import get_l3_proving_path_client

    client = get_l3_proving_path_client()
    return await client.stats()


@router.post("/l3/verify")
async def l3_verify_proof(request: L3VerifyProofRequest):
    from app.services.l3_proving_path_client import get_l3_proving_path_client

    client = get_l3_proving_path_client()
    result = await client.verify_proof(
        fact_hash=request.fact_hash,
        proof_type=request.proof_type,
        circuit_name=request.circuit_name,
        groth16_calldata=request.groth16_calldata,
        honk_calldata=request.honk_calldata,
        kzg_calldata=request.kzg_calldata,
        stark_proof_data=request.stark_proof_data,
        execution_chain=request.execution_chain,
    )
    return {
        "success": result.success,
        "mode": result.mode,
        "fact_hash": result.fact_hash,
        "tx_hash": result.tx_hash,
        "verified_on_chain": result.verified_on_chain,
        "latency_ms": result.latency_ms,
        "abi_used": result.abi_used or None,
        "verifier_state": result.verifier_state or None,
        "execution_chain": request.execution_chain,
        "error": result.error or None,
    }


@router.get("/l3/snos/queue")
async def l3_snos_queue():
    from app.services.l3_proving_path_client import get_l3_proving_path_client

    client = get_l3_proving_path_client()
    return await client.snos_queue()


@router.get("/l3/blocks")
async def l3_recent_blocks(limit: int = 10):
    from app.services.l3_proving_path_client import get_l3_proving_path_client

    client = get_l3_proving_path_client()
    return await client.recent_blocks(limit=limit)


class StarkHeavyReputationRequest(BaseModel):
    """4-pool metrics for StarkHeavyReputation (protocol-agnostic). Keys: pool_{0,1,2,3}_utilization, _volatility, _liquidity, _audit_score, _age_days."""
    pool_metrics: dict[str, Any] = {}
    submit_to_l3: bool = True
    execution_chain: Literal["l3", "l2", "dual"] = "l3"


@router.post("/stark-heavy-reputation")
async def generate_stark_heavy_reputation(request: StarkHeavyReputationRequest):
    """
    Generate STARK proof for StarkHeavyReputation (4-pool risk) and optionally submit to L3.
    Uses Obsqra Stone prover; L3 verification uses circuit_name=StarkHeavyReputation (same Integrity verifier).
    """
    from app.services.proof_pipeline import get_proof_pipeline

    pipeline = get_proof_pipeline()
    return await pipeline.generate_heavy_stark_proof(
        pool_metrics=request.pool_metrics,
        submit_to_l3=request.submit_to_l3,
        execution_chain=request.execution_chain,
    )
