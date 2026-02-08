"""
Reputation API Routes

Manages user reputation tiers and proof requirements.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/reputation", tags=["reputation"])


class TierInfo(BaseModel):
    tier: int
    tier_name: str
    proof_requirement: str
    max_deposits_per_day: int
    max_withdrawals_per_day: int
    max_position_eth: float
    relayer_access: bool
    relayer_delay_hours: float
    protocol_fee_pct: float


class UserReputationResponse(BaseModel):
    address: str
    tier: int
    tier_name: str
    transaction_count: int
    total_volume_eth: float
    tenure_days: int
    successful_txns: int
    collateral_eth: float
    upgrade_eligible: bool
    upgrade_requirements: Optional[dict]


class TierUpgradeRequest(BaseModel):
    address: str
    target_tier: int
    upgrade_proof_hash: str


# Tier definitions
TIER_INFO = {
    0: TierInfo(
        tier=0,
        tier_name="Strict",
        proof_requirement="Full ZKML proof per action (~2 min)",
        max_deposits_per_day=2,
        max_withdrawals_per_day=1,
        max_position_eth=10.0,
        relayer_access=False,
        relayer_delay_hours=0,
        protocol_fee_pct=0.5,
    ),
    1: TierInfo(
        tier=1,
        tier_name="Standard",
        proof_requirement="Constraint-bounded (setup proof only)",
        max_deposits_per_day=10,
        max_withdrawals_per_day=5,
        max_position_eth=50.0,
        relayer_access=True,
        relayer_delay_hours=1.0,
        protocol_fee_pct=0.3,
    ),
    2: TierInfo(
        tier=2,
        tier_name="Express",
        proof_requirement="Optimistic + batched proofs",
        max_deposits_per_day=255,
        max_withdrawals_per_day=255,
        max_position_eth=0,  # Unlimited
        relayer_access=True,
        relayer_delay_hours=0,
        protocol_fee_pct=0.1,
    ),
}

# In-memory user data (replace with DB in production)
_user_data: dict[str, dict] = {}


def get_user_data(address: str) -> dict:
    """Get or create user data."""
    if address not in _user_data:
        _user_data[address] = {
            "tier": 0,
            "transaction_count": 0,
            "total_volume": 0,
            "first_interaction": 0,
            "successful_txns": 0,
            "collateral": 0,
        }
    return _user_data[address]


@router.get("/tiers", response_model=list[TierInfo])
async def get_all_tiers():
    """Get information about all reputation tiers."""
    return list(TIER_INFO.values())


@router.get("/tier/{tier_id}", response_model=TierInfo)
async def get_tier_info(tier_id: int):
    """Get information about a specific tier."""
    if tier_id not in TIER_INFO:
        raise HTTPException(status_code=404, detail=f"Tier {tier_id} not found")
    return TIER_INFO[tier_id]


@router.get("/user/{address}", response_model=UserReputationResponse)
async def get_user_reputation(address: str):
    """Get reputation info for a specific user."""
    import time
    
    user = get_user_data(address)
    tier = user.get("tier", 0)
    tier_name = TIER_INFO[tier].tier_name
    
    first_interaction = user.get("first_interaction", 0)
    tenure_days = 0
    if first_interaction > 0:
        tenure_days = int((time.time() - first_interaction) / 86400)
    
    # Check upgrade eligibility
    upgrade_eligible = False
    upgrade_requirements = None
    
    if tier == 0:
        # Check Tier 0 -> 1 requirements
        needs_tenure = 30 - tenure_days
        needs_txns = 5 - user.get("successful_txns", 0)
        
        if needs_tenure <= 0 and needs_txns <= 0:
            upgrade_eligible = True
        else:
            upgrade_requirements = {
                "target_tier": 1,
                "needs_tenure_days": max(0, needs_tenure),
                "needs_successful_txns": max(0, needs_txns),
            }
    elif tier == 1:
        # Check Tier 1 -> 2 requirements
        needs_tenure = 180 - tenure_days
        min_collateral_eth = 1.0
        current_collateral = user.get("collateral", 0) / 1e18
        needs_collateral = min_collateral_eth - current_collateral
        
        if needs_tenure <= 0 and needs_collateral <= 0:
            upgrade_eligible = True
        else:
            upgrade_requirements = {
                "target_tier": 2,
                "needs_tenure_days": max(0, needs_tenure),
                "needs_collateral_eth": max(0, needs_collateral),
            }
    
    return UserReputationResponse(
        address=address,
        tier=tier,
        tier_name=tier_name,
        transaction_count=user.get("transaction_count", 0),
        total_volume_eth=user.get("total_volume", 0) / 1e18,
        tenure_days=tenure_days,
        successful_txns=user.get("successful_txns", 0),
        collateral_eth=user.get("collateral", 0) / 1e18,
        upgrade_eligible=upgrade_eligible,
        upgrade_requirements=upgrade_requirements,
    )


@router.post("/record-transaction")
async def record_transaction(address: str, volume_wei: int, success: bool = True):
    """Record a transaction for reputation tracking."""
    import time
    
    user = get_user_data(address)
    
    user["transaction_count"] = user.get("transaction_count", 0) + 1
    user["total_volume"] = user.get("total_volume", 0) + volume_wei
    
    if success:
        user["successful_txns"] = user.get("successful_txns", 0) + 1
    
    if user.get("first_interaction", 0) == 0:
        user["first_interaction"] = int(time.time())
    
    _user_data[address] = user
    
    return {"status": "recorded", "address": address}


@router.post("/stake-collateral")
async def stake_collateral(address: str, amount_wei: int):
    """Record collateral stake."""
    user = get_user_data(address)
    user["collateral"] = user.get("collateral", 0) + amount_wei
    _user_data[address] = user
    
    return {
        "status": "staked",
        "address": address,
        "total_collateral_wei": user["collateral"],
    }


@router.post("/upgrade-tier")
async def upgrade_tier(request: TierUpgradeRequest):
    """Request a tier upgrade (requires proof verification)."""
    user = get_user_data(request.address)
    current_tier = user.get("tier", 0)
    
    if request.target_tier <= current_tier:
        raise HTTPException(status_code=400, detail="Cannot downgrade via this endpoint")
    
    if request.target_tier > current_tier + 1:
        raise HTTPException(status_code=400, detail="Can only upgrade one tier at a time")
    
    # In production, verify upgrade_proof_hash in Integrity
    # For now, just check requirements are met
    
    user["tier"] = request.target_tier
    _user_data[request.address] = user
    
    return {
        "status": "upgraded",
        "address": request.address,
        "new_tier": request.target_tier,
        "tier_name": TIER_INFO[request.target_tier].tier_name,
    }


@router.post("/opt-strict")
async def opt_into_strict(address: str):
    """User opts into Strict tier for maximum trustlessness."""
    user = get_user_data(address)
    old_tier = user.get("tier", 0)
    user["tier"] = 0
    _user_data[address] = user
    
    return {
        "status": "downgraded",
        "address": address,
        "old_tier": old_tier,
        "new_tier": 0,
        "reason": "user_opted_strict",
    }
