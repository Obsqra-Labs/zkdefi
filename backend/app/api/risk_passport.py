"""
Risk Passport API

Composes reputation, identity, onboarding, and receipts into user and pool passports.
No new user/tier storage; read-only view over existing data.
"""
import httpx
from fastapi import APIRouter, Request

from app.services.receipt_service import get_receipt_service
from app.services.pool_passport_store import get as get_pool_passport_store

router = APIRouter(prefix="/risk_passport", tags=["risk_passport"])


def _composite_score(tier: int, tenure_days: int, total_volume_eth: float, collateral_eth: float) -> int:
    """Deterministic composite score 0-100 from reputation inputs."""
    score = (
        tier * 30
        + min(tenure_days // 10, 20)
        + min(int(total_volume_eth * 2), 25)
        + min(int(collateral_eth * 10), 25)
    )
    return max(0, min(100, score))


def _letter_rating(composite: int) -> str:
    """Letter rating A/B/C/D from composite score."""
    if composite >= 80:
        return "A"
    if composite >= 60:
        return "B"
    if composite >= 40:
        return "C"
    return "D"


@router.get("/user/{address}")
async def get_user_passport(address: str, request: Request):
    """
    Get user Risk Passport: composite score, letter, tier, credit (if any), proof receipts.
    Composes existing reputation, onboarding, identity, and receipt data.
    """
    base = str(request.base_url).rstrip("/")
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1. Reputation
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

        # 2. Credit via onboarding -> identity
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

        # 3. Receipts (address normalized in receipt_service)
        receipt_svc = get_receipt_service()
        proof_receipts = await receipt_svc.get_user_receipts((address or "").strip().lower())
        # Sort by timestamp descending (newest first); receipts may have timestamp or other keys
        proof_receipts = sorted(
            proof_receipts,
            key=lambda x: x.get("timestamp", ""),
            reverse=True,
        )[:20]

        # 4. Composite and letter
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
    """
    Get pool Risk Passport: health score, safe, factors, last proof (when anomaly was run).
    Returns passport null if pool has not been analyzed yet.
    """
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
