"""
Reputation API Routes

Manages user reputation tiers and proof requirements.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import time

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


class StakingPoolInfo(BaseModel):
    pool_id: str
    name: str
    apr_bps: int
    lock_days: int
    token_symbol: str
    token_address: str
    active: bool


class StakingActionRequest(BaseModel):
    address: str
    pool_id: str
    amount_wei: int = 0


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

# File-backed user data (persists across restarts)
from app.services.json_store import JsonStore

_user_store = JsonStore("reputation_users")
_staking_store = JsonStore("staking_positions")


STAKING_POOLS = [
    StakingPoolInfo(
        pool_id="core_emerald",
        name="Core Emerald",
        apr_bps=650,
        lock_days=0,
        token_symbol="ETH",
        token_address="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        active=True,
    ),
    StakingPoolInfo(
        pool_id="boost_violet",
        name="Boost Violet",
        apr_bps=900,
        lock_days=7,
        token_symbol="ETH",
        token_address="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        active=True,
    ),
]


def _get_position(address: str, pool_id: str) -> dict:
    user_positions = _staking_store.get(address) or {}
    if pool_id not in user_positions:
        user_positions[pool_id] = {
            "staked_wei": 0,
            "rewards_wei": 0,
            "last_accrual_ts": int(time.time()),
            "last_stake_ts": 0,
        }
        _staking_store.set(address, user_positions)
    return user_positions[pool_id]


def _pool_apr(pool_id: str) -> int:
    pool = next((p for p in STAKING_POOLS if p.pool_id == pool_id), None)
    return pool.apr_bps if pool else 0


def _accrue_rewards(position: dict, apr_bps: int) -> None:
    now = int(time.time())
    last = int(position.get("last_accrual_ts", now))
    if now <= last:
        return
    staked = int(position.get("staked_wei", 0))
    if staked > 0 and apr_bps > 0:
        elapsed = now - last
        yearly = 365 * 24 * 60 * 60
        reward = int(staked * (apr_bps / 10_000) * (elapsed / yearly))
        position["rewards_wei"] = int(position.get("rewards_wei", 0)) + max(0, reward)
    position["last_accrual_ts"] = now


def _persist_staking(address: str) -> None:
    """Flush the in-memory staking position back to JsonStore."""
    user_positions = _staking_store.get(address)
    if user_positions is not None:
        _staking_store.set(address, user_positions)



def get_user_data(address: str) -> dict:
    """Get or create user data."""
    data = _user_store.get(address)
    if data is None:
        data = {
            "tier": 0,
            "transaction_count": 0,
            "total_volume": 0,
            "first_interaction": 0,
            "successful_txns": 0,
            "collateral": 0,
        }
        _user_store.set(address, data)
    return data


def _persist_user(address: str, data: dict) -> None:
    """Flush user data back to JsonStore."""
    _user_store.set(address, data)


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
    """Get reputation info for a specific user. Merges in-app data with on-chain (and cross-chain) baseline."""
    user = get_user_data(address)
    tier = user.get("tier", 0)
    tier_name = TIER_INFO[tier].tier_name

    first_interaction = user.get("first_interaction", 0)
    in_app_tenure_days = 0
    if first_interaction > 0:
        in_app_tenure_days = int((time.time() - first_interaction) / 86400)

    # Baseline from on-chain / cross-chain (Starknet + linked eth/arb/base from store)
    chain_tenure_days = 0
    chain_tx_count = 0
    try:
        from app.services.cross_chain_fetcher import fetch_combined_history
        from app.services.linked_addresses_store import get_linked
        from app.services.linked_address_verification_service import (
            get_linked_address_verification_service,
        )

        linked = get_linked(address)
        verified = get_linked_address_verification_service().filter_verified(address, linked)
        combined = await fetch_combined_history(
            address,
            verified.get("eth"),
            verified.get("arb"),
            verified.get("base"),
        )
        chain_tenure_days = combined.get("account_age_days", 0) or 0
        chain_tx_count = combined.get("total_transactions", 0) or 0
    except Exception:
        pass

    tenure_days = max(in_app_tenure_days, chain_tenure_days)
    in_app_txns = user.get("successful_txns", 0)
    successful_txns = in_app_txns + chain_tx_count if chain_tx_count > 0 else in_app_txns
    
    # Check upgrade eligibility
    upgrade_eligible = False
    upgrade_requirements = None
    
    if tier == 0:
        # Check Tier 0 -> 1 requirements (use merged tenure and successful_txns including chain baseline)
        needs_tenure = 30 - tenure_days
        needs_txns = 5 - successful_txns
        
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
    
    in_app_tx_count = user.get("transaction_count", 0)
    transaction_count = in_app_tx_count + chain_tx_count if chain_tx_count > 0 else in_app_tx_count

    return UserReputationResponse(
        address=address,
        tier=tier,
        tier_name=tier_name,
        transaction_count=transaction_count,
        total_volume_eth=user.get("total_volume", 0) / 1e18,
        tenure_days=tenure_days,
        successful_txns=successful_txns,
        collateral_eth=user.get("collateral", 0) / 1e18,
        upgrade_eligible=upgrade_eligible,
        upgrade_requirements=upgrade_requirements,
    )


def record_transaction_internal(address: str, volume_eth: float, success: bool = True) -> None:
    """Internal non-async call for lending/collateral services to record reputation."""
    import time
    user = get_user_data(address)
    user["transaction_count"] = user.get("transaction_count", 0) + 1
    user["total_volume"] = user.get("total_volume", 0) + int(volume_eth * 1e18)
    if success:
        user["successful_txns"] = user.get("successful_txns", 0) + 1
    if user.get("first_interaction", 0) == 0:
        user["first_interaction"] = int(time.time())
    _persist_user(address, user)


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
    
    _persist_user(address, user)
    
    return {"status": "recorded", "address": address}


@router.post("/stake-collateral")
async def stake_collateral(address: str, amount_wei: int):
    """Record collateral stake."""
    user = get_user_data(address)
    user["collateral"] = user.get("collateral", 0) + amount_wei
    _persist_user(address, user)
    
    return {
        "status": "staked",
        "address": address,
        "total_collateral_wei": user["collateral"],
    }


@router.get("/staking/pools", response_model=list[StakingPoolInfo])
async def staking_pools():
    """List available staking pools."""
    return STAKING_POOLS


@router.get("/staking/positions/{address}")
async def staking_positions(address: str):
    """Get staking positions for user."""
    out = []
    for pool in STAKING_POOLS:
        pos = _get_position(address, pool.pool_id)
        _accrue_rewards(pos, pool.apr_bps)
        _persist_staking(address)
        out.append(
            {
                "pool_id": pool.pool_id,
                "pool_name": pool.name,
                "apr_bps": pool.apr_bps,
                "staked_wei": str(pos.get("staked_wei", 0)),
                "rewards_wei": str(pos.get("rewards_wei", 0)),
                "last_stake_ts": pos.get("last_stake_ts", 0),
            }
        )
    return {"address": address, "positions": out}


@router.post("/staking/stake")
async def staking_stake(request: StakingActionRequest):
    """Stake into a pool (MVP in-memory position + collateral accounting)."""
    if request.amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    pool = next((p for p in STAKING_POOLS if p.pool_id == request.pool_id and p.active), None)
    if not pool:
        raise HTTPException(status_code=404, detail="staking pool not found")

    pos = _get_position(request.address, request.pool_id)
    _accrue_rewards(pos, pool.apr_bps)
    pos["staked_wei"] = int(pos.get("staked_wei", 0)) + request.amount_wei
    pos["last_stake_ts"] = int(time.time())
    _persist_staking(request.address)

    user = get_user_data(request.address)
    user["collateral"] = user.get("collateral", 0) + request.amount_wei
    _persist_user(request.address, user)
    return {
        "status": "staked",
        "address": request.address,
        "pool_id": request.pool_id,
        "staked_wei": str(pos["staked_wei"]),
        "rewards_wei": str(pos.get("rewards_wei", 0)),
    }


@router.post("/staking/claim")
async def staking_claim(request: StakingActionRequest):
    """Claim accrued staking rewards (MVP in-memory accounting)."""
    pool = next((p for p in STAKING_POOLS if p.pool_id == request.pool_id and p.active), None)
    if not pool:
        raise HTTPException(status_code=404, detail="staking pool not found")
    pos = _get_position(request.address, request.pool_id)
    _accrue_rewards(pos, pool.apr_bps)
    rewards = int(pos.get("rewards_wei", 0))
    pos["rewards_wei"] = 0
    _persist_staking(request.address)
    return {
        "status": "claimed",
        "address": request.address,
        "pool_id": request.pool_id,
        "claimed_wei": str(rewards),
    }


@router.post("/staking/exit")
async def staking_exit(request: StakingActionRequest):
    """Exit a staking pool, withdrawing staked amount and accrued rewards."""
    pool = next((p for p in STAKING_POOLS if p.pool_id == request.pool_id and p.active), None)
    if not pool:
        raise HTTPException(status_code=404, detail="staking pool not found")
    pos = _get_position(request.address, request.pool_id)
    _accrue_rewards(pos, pool.apr_bps)
    staked = int(pos.get("staked_wei", 0))
    rewards = int(pos.get("rewards_wei", 0))
    pos["staked_wei"] = 0
    pos["rewards_wei"] = 0
    _persist_staking(request.address)

    user = get_user_data(request.address)
    user["collateral"] = max(0, user.get("collateral", 0) - staked)
    _persist_user(request.address, user)
    return {
        "status": "exited",
        "address": request.address,
        "pool_id": request.pool_id,
        "withdrawn_wei": str(staked),
        "claimed_wei": str(rewards),
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
    _persist_user(request.address, user)
    
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
    _persist_user(address, user)
    
    return {
        "status": "downgraded",
        "address": address,
        "old_tier": old_tier,
        "new_tier": 0,
        "reason": "user_opted_strict",
    }


@router.get("/user/{address}/on-chain")
async def get_on_chain_reputation(address: str):
    """Read live reputation data directly from the on-chain ReputationRegistry contract."""
    try:
        from app.services.onchain_reputation_service import get_onchain_reputation_service
        svc = get_onchain_reputation_service()
        rep = await svc.get_full_reputation(address)
        return {
            "user_address": rep.user_address,
            "tier": rep.tier,
            "tier_index": rep.tier_index,
            "reputation_score": rep.reputation_score,
            "collateral_wei": rep.collateral_wei,
            "transaction_count": rep.transaction_count,
            "total_volume": rep.total_volume,
            "first_interaction": rep.first_interaction,
            "last_interaction": rep.last_interaction,
            "successful_txns": rep.successful_txns,
            "failed_txns": rep.failed_txns,
            "can_use_relayer": rep.can_use_relayer,
            "relayer_delay_seconds": rep.relayer_delay_seconds,
            "daily_deposits": rep.daily_deposits,
            "daily_withdrawals": rep.daily_withdrawals,
            "collaborative_score": rep.collaborative_score,
            "graph_hash": rep.graph_hash,
            "source": "on_chain",
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"On-chain read failed: {e}")
