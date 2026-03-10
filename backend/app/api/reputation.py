"""Reputation API routes.

V2-capable reputation surface with additive endpoints for staking, on-chain
visibility, and proof lifecycle/status while preserving legacy contracts.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.middleware.auth import WalletOwner
from app.services.json_store import JsonStore
from app.services.trust_event_service import log_trust_event
from app.services.trust_version_matrix import get_backend_trust_flags, get_trust_version_matrix

router = APIRouter(prefix="/reputation", tags=["reputation"])


def compute_reputation_score(tier: int, tenure: int, txns: int, collateral: float, failed_txns: int = 0) -> int:
    tier_weight = tier * 25
    tenure_weight = min(tenure / 365, 1) * 10
    txn_weight = min(txns / 100, 1) * 10
    coll_weight = min(collateral / 10, 1) * 5
    # Penalty: lose up to 15 points based on failure ratio
    total_txns = txns + failed_txns
    failure_penalty = 0
    if total_txns > 0:
        failure_ratio = failed_txns / total_txns
        failure_penalty = failure_ratio * 15
    raw = tier_weight + tenure_weight + txn_weight + coll_weight - failure_penalty
    return max(0, min(int(raw), 100))


def compute_gates(tier: int) -> dict[str, bool]:
    return {
        "canSwap": tier >= 1,
        "canLP": tier >= 1,
        "canLend": tier >= 1,
        "canBorrow": tier >= 2,
        "canStake": tier >= 1,
        "canPrivacy": tier >= 1,
        "canDarkLedger": tier >= 2,
        "canDCA": tier >= 2,
        "canLimits": tier >= 1,
    }


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
    failed_txns: int = 0
    collateral_eth: float
    upgrade_eligible: bool
    upgrade_requirements: Optional[dict]
    reputation_score: int = 0
    gates: dict[str, bool] = {}


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


class SolvencyProofRequest(BaseModel):
    user_address: str
    asset_positions: list[int]
    debt_positions: list[int]
    min_solvency_ratio_bps: int = 10_000


class RiskPassportProofRequest(BaseModel):
    user_address: str
    volatility_bps: int
    max_drawdown_bps: int
    concentration_bps: int
    effective_leverage_bps: int
    liquidation_events: int
    tenure_days: int
    required_tier: Optional[int] = None


class TraderPerformanceProofRequest(BaseModel):
    user_address: str
    returns_bps: list[int]
    equity_curve: list[int]
    wins_count: int
    trades_count: int
    min_sharpe_x100: int = 150
    max_drawdown_bps: int = 2000
    min_win_rate_bps: int = 5000


class StrategyIntegrityProofRequest(BaseModel):
    user_address: str
    position_weights_bps: list[int]
    effective_leverage_bps: int
    observed_slippage_bps: list[int]
    asset_exposures_bps: list[int]
    max_position_weight_bps: int = 2500
    max_leverage_bps: int = 20_000
    max_slippage_bps: int = 100


class ExecutionIntegrityProofRequest(BaseModel):
    user_address: str
    submission_block: int
    inclusion_block: int
    expected_price: int
    actual_price: int
    max_delay_blocks: int = 5
    max_price_deviation_bps: int = 50


class CreditEligibilityProofRequest(BaseModel):
    user_address: str
    credit_score: int
    collateral_wei: int
    min_credit_score: int = 600
    min_collateral: int = 0


class ProofStatus(BaseModel):
    proof_type: str
    status: str
    generated_at: Optional[int] = None
    proof_hash: Optional[str] = None
    on_chain_verified: bool = False


class UserProofsResponse(BaseModel):
    address: str
    proofs: list[ProofStatus]
    tier: int
    tier_name: str
    total_proofs_complete: int


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
        max_position_eth=0,
        relayer_access=True,
        relayer_delay_hours=0,
        protocol_fee_pct=0.1,
    ),
}

_user_store = JsonStore("reputation_users")
_staking_store = JsonStore("staking_positions")
_proofs_store = JsonStore("reputation_proofs")
_circuits_build = Path(__file__).resolve().parents[3] / "circuits" / "build"
_zkfico_pack_circuits: list[tuple[str, str]] = [
    ("solvency", "SolvencyProof"),
    ("risk_passport", "RiskPassportTier"),
    ("trader_performance", "TraderPerformanceProof"),
    ("strategy_integrity", "StrategyIntegrity"),
    ("execution_integrity", "ExecutionIntegrity"),
    ("credit_eligibility", "CreditEligibility"),
]

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


def _norm_addr(address: str) -> str:
    return str(address or "").strip().lower()


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _file_sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        return "0x" + hashlib.sha256(path.read_bytes()).hexdigest()
    except Exception:
        return None


def _circuit_manifest_entry(proof_type: str, circuit_id: str) -> dict[str, Any]:
    wasm_path = _circuits_build / f"{circuit_id}_js" / f"{circuit_id}.wasm"
    zkey_path = _circuits_build / f"{circuit_id}_final.zkey"
    vkey_candidates = [
        _circuits_build / f"{circuit_id}_verification_key.json",
        _circuits_build / f"{circuit_id}_vkey.json",
    ]
    vkey_path = next((candidate for candidate in vkey_candidates if candidate.exists()), None)
    vkey_payload = _read_json(vkey_path) if vkey_path is not None else None

    return {
        "proof_type": proof_type,
        "circuit_id": circuit_id,
        "version": "1.0",
        "artifacts": {
            "wasm": str(wasm_path) if wasm_path.exists() else None,
            "zkey": str(zkey_path) if zkey_path.exists() else None,
            "vkey": str(vkey_path) if vkey_path is not None and vkey_path.exists() else None,
        },
        "artifact_hashes": {
            "wasm_sha256": _file_sha256(wasm_path),
            "zkey_sha256": _file_sha256(zkey_path),
            "vkey_sha256": _file_sha256(vkey_path) if vkey_path is not None else None,
        },
        "vkey_schema": {
            "protocol": vkey_payload.get("protocol") if isinstance(vkey_payload, dict) else None,
            "curve": vkey_payload.get("curve") if isinstance(vkey_payload, dict) else None,
            "nPublic": vkey_payload.get("nPublic") if isinstance(vkey_payload, dict) else None,
        },
        "toolchain": {
            "prover": "snarkjs.groth16",
            "settlement_envelope": "stark_wrapped_async_envelope_v1",
        },
    }


def _parse_user_addr_int(value: str) -> int:
    raw = str(value).strip()
    if raw.startswith("0x"):
        return int(raw, 16)
    return int(raw)


def _persist_user(address: str, data: dict[str, Any]) -> None:
    _user_store.set(_norm_addr(address), data)


def get_user_data(address: str) -> dict[str, Any]:
    key = _norm_addr(address)
    data = _user_store.get(key)
    if data is None:
        data = {
            "tier": 0,
            "transaction_count": 0,
            "total_volume": 0,
            "first_interaction": 0,
            "successful_txns": 0,
            "collateral": 0,
        }
        _user_store.set(key, data)
    return data


def _get_position(address: str, pool_id: str) -> dict[str, Any]:
    key = _norm_addr(address)
    user_positions = _staking_store.get(key) or {}
    if pool_id not in user_positions:
        user_positions[pool_id] = {
            "staked_wei": 0,
            "rewards_wei": 0,
            "last_accrual_ts": int(time.time()),
            "last_stake_ts": 0,
        }
        _staking_store.set(key, user_positions)
    return user_positions[pool_id]


def _persist_staking(address: str) -> None:
    key = _norm_addr(address)
    user_positions = _staking_store.get(key)
    if user_positions is not None:
        _staking_store.set(key, user_positions)


def _accrue_rewards(position: dict[str, Any], apr_bps: int) -> None:
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


def _persist_proof_completion(
    address: str,
    proof_type: str,
    proof_hash: str,
    *,
    on_chain_verified: bool = False,
) -> None:
    if not address or not proof_type or not proof_hash:
        return
    key = _norm_addr(address)
    data = _proofs_store.get(key) or {}
    data[proof_type] = {
        "timestamp": int(time.time()),
        "proof_hash": proof_hash,
        "on_chain_verified": bool(on_chain_verified),
    }
    _proofs_store.set(key, data)


def record_transaction_internal(address: str, volume_eth: float, success: bool = True) -> None:
    """Internal helper used by lending/collateral flows.

    Tracks transactions and applies dynamic reputation adjustments:
    downgrades tier when success ratio drops below 90%, upgrades when
    the user is marked eligible and ratio is >= 95%.
    """
    user = get_user_data(address)
    user["transaction_count"] = user.get("transaction_count", 0) + 1
    user["total_volume"] = user.get("total_volume", 0) + int(max(0.0, volume_eth) * 1e18)
    if success:
        user["successful_txns"] = user.get("successful_txns", 0) + 1
    else:
        user["failed_txns"] = user.get("failed_txns", 0) + 1

    if user.get("first_interaction", 0) == 0:
        user["first_interaction"] = int(time.time())

    ratio = user["successful_txns"] / max(user["transaction_count"], 1)
    current_tier = user.get("tier", 1)

    if ratio < 0.9 and current_tier > 0:
        user["tier"] = current_tier - 1
        logger.info(
            "Tier downgrade for %s: %d -> %d (ratio=%.2f)",
            address, current_tier, current_tier - 1, ratio,
        )

    max_tier = max(TIER_INFO.keys()) if TIER_INFO else 2
    if user.get("upgrade_eligible") and ratio >= 0.95:
        if current_tier < max_tier:
            user["tier"] = current_tier + 1
            user["upgrade_eligible"] = False
            logger.info(
                "Tier upgrade for %s: %d -> %d",
                address, current_tier, current_tier + 1,
            )

    _persist_user(address, user)


@router.get("/tiers", response_model=list[TierInfo])
async def get_all_tiers() -> list[TierInfo]:
    return list(TIER_INFO.values())


@router.get("/tier/{tier_id}", response_model=TierInfo)
async def get_tier_info(tier_id: int) -> TierInfo:
    if tier_id not in TIER_INFO:
        raise HTTPException(status_code=404, detail=f"Tier {tier_id} not found")
    return TIER_INFO[tier_id]


@router.get("/user/{address}", response_model=UserReputationResponse)
async def get_user_reputation(address: str) -> UserReputationResponse:
    """Merged in-app + verified cross-chain reputation baseline."""
    user = get_user_data(address)
    tier = int(user.get("tier", 0))
    tier_name = TIER_INFO.get(tier, TIER_INFO[0]).tier_name

    first_interaction = int(user.get("first_interaction", 0) or 0)
    in_app_tenure_days = int((time.time() - first_interaction) / 86400) if first_interaction > 0 else 0

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
        chain_tenure_days = int(combined.get("account_age_days", 0) or 0)
        chain_tx_count = int(combined.get("total_transactions", 0) or 0)
    except Exception:
        pass

    tenure_days = max(in_app_tenure_days, chain_tenure_days)
    in_app_txns = int(user.get("successful_txns", 0) or 0)
    successful_txns = in_app_txns + chain_tx_count if chain_tx_count > 0 else in_app_txns

    upgrade_eligible = False
    upgrade_requirements: dict[str, Any] | None = None

    if tier == 0:
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
        needs_tenure = 180 - tenure_days
        min_collateral_eth = 1.0
        current_collateral = float(user.get("collateral", 0) or 0) / 1e18
        needs_collateral = min_collateral_eth - current_collateral
        if needs_tenure <= 0 and needs_collateral <= 0:
            upgrade_eligible = True
        else:
            upgrade_requirements = {
                "target_tier": 2,
                "needs_tenure_days": max(0, needs_tenure),
                "needs_collateral_eth": max(0, needs_collateral),
            }

    in_app_tx_count = int(user.get("transaction_count", 0) or 0)
    transaction_count = in_app_tx_count + chain_tx_count if chain_tx_count > 0 else in_app_tx_count
    collateral_eth = float(user.get("collateral", 0) or 0) / 1e18
    failed_txns = int(user.get("failed_txns", 0) or 0)

    return UserReputationResponse(
        address=address,
        tier=tier,
        tier_name=tier_name,
        transaction_count=transaction_count,
        total_volume_eth=float(user.get("total_volume", 0) or 0) / 1e18,
        tenure_days=tenure_days,
        successful_txns=successful_txns,
        failed_txns=failed_txns,
        collateral_eth=collateral_eth,
        upgrade_eligible=upgrade_eligible,
        upgrade_requirements=upgrade_requirements,
        reputation_score=compute_reputation_score(tier, tenure_days, successful_txns, collateral_eth, failed_txns),
        gates=compute_gates(tier),
    )


@router.post("/record-transaction")
async def record_transaction(address: str, volume_wei: int, success: bool = True, _caller: str = WalletOwner) -> dict[str, Any]:
    user = get_user_data(address)
    user["transaction_count"] = int(user.get("transaction_count", 0) or 0) + 1
    user["total_volume"] = int(user.get("total_volume", 0) or 0) + int(volume_wei)
    if success:
        user["successful_txns"] = int(user.get("successful_txns", 0) or 0) + 1
    else:
        user["failed_txns"] = int(user.get("failed_txns", 0) or 0) + 1
    if int(user.get("first_interaction", 0) or 0) == 0:
        user["first_interaction"] = int(time.time())

    _persist_user(address, user)
    return {"status": "recorded", "address": address}


@router.post("/stake-collateral")
async def stake_collateral(address: str, amount_wei: int, _caller: str = WalletOwner) -> dict[str, Any]:
    user = get_user_data(address)
    user["collateral"] = int(user.get("collateral", 0) or 0) + int(amount_wei)
    _persist_user(address, user)

    await log_trust_event(
        address,
        "collateral_staked",
        gate="credit",
        outcome="updated",
        metadata={"amount_wei": int(amount_wei), "collateral_wei": int(user["collateral"])},
        receipt_proof_type="collateral_staked",
    )

    return {
        "status": "staked",
        "address": address,
        "total_collateral_wei": user["collateral"],
    }


@router.get("/staking/pools", response_model=list[StakingPoolInfo])
async def staking_pools() -> list[StakingPoolInfo]:
    return STAKING_POOLS


@router.get("/staking/positions/{address}")
async def staking_positions(address: str) -> dict[str, Any]:
    out: list[dict[str, Any]] = []
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
                "last_stake_ts": int(pos.get("last_stake_ts", 0) or 0),
            }
        )
    return {"address": address, "positions": out}


@router.post("/staking/stake")
async def staking_stake(request: StakingActionRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    if request.amount_wei <= 0:
        raise HTTPException(status_code=400, detail="amount_wei must be positive")
    pool = next((p for p in STAKING_POOLS if p.pool_id == request.pool_id and p.active), None)
    if not pool:
        raise HTTPException(status_code=404, detail="staking pool not found")

    pos = _get_position(request.address, request.pool_id)
    _accrue_rewards(pos, pool.apr_bps)
    pos["staked_wei"] = int(pos.get("staked_wei", 0)) + int(request.amount_wei)
    pos["last_stake_ts"] = int(time.time())
    _persist_staking(request.address)

    user = get_user_data(request.address)
    user["collateral"] = int(user.get("collateral", 0)) + int(request.amount_wei)
    _persist_user(request.address, user)

    await log_trust_event(
        request.address,
        "staking_position_opened",
        gate="credit",
        outcome="updated",
        metadata={
            "pool_id": request.pool_id,
            "staked_wei": int(pos["staked_wei"]),
            "rewards_wei": int(pos.get("rewards_wei", 0)),
        },
        receipt_proof_type="staking_position_opened",
    )

    return {
        "status": "staked",
        "address": request.address,
        "pool_id": request.pool_id,
        "staked_wei": str(pos["staked_wei"]),
        "rewards_wei": str(pos.get("rewards_wei", 0)),
    }


@router.post("/staking/claim")
async def staking_claim(request: StakingActionRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    pool = next((p for p in STAKING_POOLS if p.pool_id == request.pool_id and p.active), None)
    if not pool:
        raise HTTPException(status_code=404, detail="staking pool not found")

    pos = _get_position(request.address, request.pool_id)
    _accrue_rewards(pos, pool.apr_bps)
    rewards = int(pos.get("rewards_wei", 0))
    pos["rewards_wei"] = 0
    _persist_staking(request.address)

    await log_trust_event(
        request.address,
        "staking_rewards_claimed",
        gate="credit",
        outcome="updated",
        metadata={"pool_id": request.pool_id, "claimed_wei": rewards},
        receipt_proof_type="staking_rewards_claimed",
    )

    return {
        "status": "claimed",
        "address": request.address,
        "pool_id": request.pool_id,
        "claimed_wei": str(rewards),
    }


@router.post("/staking/exit")
async def staking_exit(request: StakingActionRequest, _caller: str = WalletOwner) -> dict[str, Any]:
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
    user["collateral"] = max(0, int(user.get("collateral", 0)) - staked)
    _persist_user(request.address, user)

    await log_trust_event(
        request.address,
        "staking_position_closed",
        gate="credit",
        outcome="updated",
        metadata={
            "pool_id": request.pool_id,
            "withdrawn_wei": staked,
            "claimed_wei": rewards,
            "remaining_collateral_wei": int(user["collateral"]),
        },
        receipt_proof_type="staking_position_closed",
    )

    return {
        "status": "exited",
        "address": request.address,
        "pool_id": request.pool_id,
        "withdrawn_wei": str(staked),
        "claimed_wei": str(rewards),
    }


@router.post("/upgrade-tier")
async def upgrade_tier(request: TierUpgradeRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    user = get_user_data(request.address)
    current_tier = int(user.get("tier", 0) or 0)

    if request.target_tier <= current_tier:
        raise HTTPException(status_code=400, detail="Cannot downgrade via this endpoint")
    if request.target_tier > current_tier + 1:
        raise HTTPException(status_code=400, detail="Can only upgrade one tier at a time")

    # Validate eligibility requirements
    first_interaction = int(user.get("first_interaction", 0) or 0)
    tenure_days = int((time.time() - first_interaction) / 86400) if first_interaction > 0 else 0
    successful_txns = int(user.get("successful_txns", 0) or 0)
    collateral_eth = float(user.get("collateral", 0) or 0) / 1e18
    failed_txns = int(user.get("failed_txns", 0) or 0)

    # Check failure ratio — block upgrade if too many failures
    total = successful_txns + failed_txns
    if total >= 3 and failed_txns / total > 0.3:
        raise HTTPException(
            status_code=400,
            detail=f"Failure ratio too high ({failed_txns}/{total}). Improve repayment record first.",
        )

    if current_tier == 0:
        if tenure_days < 30:
            raise HTTPException(status_code=400, detail=f"Need 30 days tenure (have {tenure_days})")
        if successful_txns < 5:
            raise HTTPException(status_code=400, detail=f"Need 5 successful txns (have {successful_txns})")
    elif current_tier == 1:
        if tenure_days < 180:
            raise HTTPException(status_code=400, detail=f"Need 180 days tenure (have {tenure_days})")
        if collateral_eth < 1.0:
            raise HTTPException(status_code=400, detail=f"Need 1.0 ETH collateral (have {collateral_eth:.4f})")

    user["tier"] = request.target_tier
    _persist_user(request.address, user)

    await log_trust_event(
        request.address,
        "tier_transition",
        gate="reputation",
        outcome="upgraded",
        metadata={
            "from_tier": current_tier,
            "to_tier": request.target_tier,
            "to_tier_name": TIER_INFO[request.target_tier].tier_name,
        },
        receipt_proof_type="tier_transition",
    )

    return {
        "status": "upgraded",
        "address": request.address,
        "new_tier": request.target_tier,
        "tier_name": TIER_INFO[request.target_tier].tier_name,
    }


@router.post("/opt-strict")
async def opt_into_strict(address: str, _caller: str = WalletOwner) -> dict[str, Any]:
    user = get_user_data(address)
    old_tier = int(user.get("tier", 0) or 0)
    user["tier"] = 0
    _persist_user(address, user)

    await log_trust_event(
        address,
        "tier_transition",
        gate="reputation",
        outcome="downgraded",
        metadata={"from_tier": old_tier, "to_tier": 0, "to_tier_name": "Strict"},
        receipt_proof_type="tier_transition",
    )

    return {
        "status": "downgraded",
        "address": address,
        "old_tier": old_tier,
        "new_tier": 0,
        "reason": "user_opted_strict",
    }


@router.get("/user/{address}/on-chain")
async def get_on_chain_reputation(address: str) -> dict[str, Any]:
    """Read live reputation data from on-chain ReputationRegistry."""
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
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"On-chain read failed: {exc}")


@router.get("/proofs/{address}", response_model=UserProofsResponse)
async def get_user_proofs(address: str) -> UserProofsResponse:
    key = _norm_addr(address)
    user_data = get_user_data(key)
    tier = int(user_data.get("tier", 0) or 0)
    tier_name = TIER_INFO.get(tier, TIER_INFO[0]).tier_name

    user_proofs = _proofs_store.get(key) or {}

    proof_statuses: list[ProofStatus] = []
    proof_types = [
        "solvency",
        "risk_passport",
        "trader_performance",
        "strategy_integrity",
        "execution_integrity",
        "credit_eligibility",
    ]

    for proof_type in proof_types:
        proof_data = user_proofs.get(proof_type, {})
        if proof_data:
            status_obj = ProofStatus(
                proof_type=proof_type,
                status="complete",
                generated_at=int(proof_data.get("timestamp", int(time.time()))),
                proof_hash=proof_data.get("proof_hash"),
                on_chain_verified=bool(proof_data.get("on_chain_verified", False)),
            )
        else:
            status_obj = ProofStatus(
                proof_type=proof_type,
                status="available" if tier >= 1 else "pending",
            )
        proof_statuses.append(status_obj)

    complete_count = sum(1 for proof in proof_statuses if proof.status == "complete")

    return UserProofsResponse(
        address=key,
        proofs=proof_statuses,
        tier=tier,
        tier_name=tier_name,
        total_proofs_complete=complete_count,
    )


@router.get("/pack/manifest")
async def get_zkfico_pack_manifest() -> dict[str, Any]:
    """Expose zkFICO circuit pack metadata for integrity checks."""
    circuits = [_circuit_manifest_entry(proof_type, circuit_id) for proof_type, circuit_id in _zkfico_pack_circuits]
    return {
        "pack_id": "zkfico_pack_v1",
        "pack_version": get_trust_version_matrix().get("zkfico_pack_v1", "1.0"),
        "proof_policy": {
            "mode": "hybrid",
            "ux_verifier": "groth16",
            "canonical_settlement_envelope": "stark_wrapped_async_v1",
        },
        "toolchain": {
            "snark": "snarkjs.groth16",
            "stark_envelope": "stone_or_integrity_async_envelope",
        },
        "flags": get_backend_trust_flags(),
        "circuits": circuits,
        "generated_at": int(time.time()),
    }


@router.get("/zkfico/{address}")
async def get_zkfico_aggregate(address: str) -> dict[str, Any]:
    """Aggregate proof readiness + dual-scale score for policy and UX."""
    key = _norm_addr(address)
    user = get_user_data(key)
    proofs = await get_user_proofs(key)
    proofs_payload = proofs.model_dump() if hasattr(proofs, "model_dump") else proofs.dict()
    proof_rows = list(proofs_payload.get("proofs", []))
    complete_count = int(proofs_payload.get("total_proofs_complete", 0) or 0)
    total_count = max(1, len(proof_rows))
    readiness_ratio = complete_count / total_count

    tier = int(user.get("tier", 0) or 0)
    tx_count = int(user.get("transaction_count", 0) or 0)
    collateral_eth = float(user.get("collateral", 0) or 0) / 1e18
    tenure_days = 0
    first_interaction = int(user.get("first_interaction", 0) or 0)
    if first_interaction > 0:
        tenure_days = int((time.time() - first_interaction) / 86400)

    # Canonical policy score for gates.
    trust_score_0_100 = min(
        100.0,
        round(
            15.0
            + readiness_ratio * 55.0
            + min(15.0, tier * 7.5)
            + min(10.0, tx_count / 5.0)
            + min(5.0, collateral_eth),
            2,
        ),
    )
    # Display-only FICO style score.
    fico_display_300_850 = int(round(300 + (trust_score_0_100 / 100.0) * 550))

    credit_eligibility = next((row for row in proof_rows if row.get("proof_type") == "credit_eligibility"), None)
    has_credit_eligibility = bool(credit_eligibility and credit_eligibility.get("status") == "complete")

    return {
        "address": key,
        "pack_id": "zkfico_pack_v1",
        "pack_version": get_trust_version_matrix().get("zkfico_pack_v1", "1.0"),
        "proofs": proof_rows,
        "readiness": {
            "complete": complete_count,
            "total": total_count,
            "ratio": round(readiness_ratio, 4),
            "ready_for_policy": readiness_ratio >= 0.5,
            "ready_for_credit": has_credit_eligibility,
        },
        "scores": {
            "trust_score_0_100": trust_score_0_100,
            "fico_display_300_850": fico_display_300_850,
            "components": {
                "tier": tier,
                "tenure_days": tenure_days,
                "transaction_count": tx_count,
                "collateral_eth": round(collateral_eth, 6),
                "proof_completion_ratio": round(readiness_ratio, 4),
            },
        },
        "proof_policy": {
            "mode": "hybrid",
            "groth16_for_ux": True,
            "stark_envelope_async": True,
        },
        "flags": get_backend_trust_flags(),
        "version_matrix": get_trust_version_matrix(),
        "generated_at": int(time.time()),
    }


async def _run_proof_scan(
    *,
    user_address: str,
    circuit: str,
    inputs: dict[str, Any],
    proof_type: str,
) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import run_circuit_scan

    user_addr_int = _parse_user_addr_int(user_address)
    result = await run_circuit_scan(
        circuits=[circuit],
        user_address=user_addr_int,
        inputs_override={circuit: inputs},
        mode="gate",
    )

    if result.get("results"):
        first = result["results"][0]
        if first.get("success") and first.get("proof_hash"):
            proof_hash = str(first["proof_hash"])
            _persist_proof_completion(user_address, proof_type, proof_hash)
            await log_trust_event(
                user_address,
                "proof_generated",
                gate="reputation",
                outcome="success",
                metadata={"proof_type": proof_type, "proof_hash": proof_hash},
                receipt_proof_type=f"proof_{proof_type}",
            )
    return result


@router.post("/proof/solvency")
async def generate_solvency_proof(req: SolvencyProofRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_solvency_proof_inputs

    try:
        inputs = build_solvency_proof_inputs(
            asset_positions=req.asset_positions,
            debt_positions=req.debt_positions,
            min_solvency_ratio_bps=req.min_solvency_ratio_bps,
            user_address=_parse_user_addr_int(req.user_address),
        )
        return await _run_proof_scan(
            user_address=req.user_address,
            circuit="SolvencyProof",
            inputs=inputs,
            proof_type="solvency",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Proof generation failed: {exc}")


@router.post("/proof/risk-passport")
async def generate_risk_passport_proof(req: RiskPassportProofRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_risk_passport_tier_inputs

    try:
        inputs = build_risk_passport_tier_inputs(
            volatility_bps=req.volatility_bps,
            max_drawdown_bps=req.max_drawdown_bps,
            concentration_bps=req.concentration_bps,
            effective_leverage_bps=req.effective_leverage_bps,
            liquidation_events_lookback=req.liquidation_events,
            tenure_days=req.tenure_days,
            required_tier=req.required_tier or 3,
            user_address=_parse_user_addr_int(req.user_address),
        )
        return await _run_proof_scan(
            user_address=req.user_address,
            circuit="RiskPassportTier",
            inputs=inputs,
            proof_type="risk_passport",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Proof generation failed: {exc}")


@router.post("/proof/performance")
async def generate_trader_performance_proof(req: TraderPerformanceProofRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_trader_performance_inputs

    if len(req.returns_bps) != 30:
        raise HTTPException(status_code=400, detail="returns_bps must have exactly 30 values")
    if len(req.equity_curve) != 30:
        raise HTTPException(status_code=400, detail="equity_curve must have exactly 30 values")

    try:
        inputs = build_trader_performance_inputs(
            returns_bps=req.returns_bps,
            equity_curve=req.equity_curve,
            wins_count=req.wins_count,
            trades_count=req.trades_count,
            min_sharpe_x100=req.min_sharpe_x100,
            max_drawdown_bps=req.max_drawdown_bps,
            min_win_rate_bps=req.min_win_rate_bps,
            user_address=_parse_user_addr_int(req.user_address),
        )
        return await _run_proof_scan(
            user_address=req.user_address,
            circuit="TraderPerformanceProof",
            inputs=inputs,
            proof_type="trader_performance",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Proof generation failed: {exc}")


@router.post("/proof/strategy-integrity")
async def generate_strategy_integrity_proof(req: StrategyIntegrityProofRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_strategy_integrity_inputs

    if len(req.position_weights_bps) != 8:
        raise HTTPException(status_code=400, detail="position_weights_bps must have exactly 8 values")
    if len(req.observed_slippage_bps) != 8:
        raise HTTPException(status_code=400, detail="observed_slippage_bps must have exactly 8 values")
    if len(req.asset_exposures_bps) != 8:
        raise HTTPException(status_code=400, detail="asset_exposures_bps must have exactly 8 values")

    try:
        inputs = build_strategy_integrity_inputs(
            position_weights_bps=req.position_weights_bps,
            effective_leverage_bps=req.effective_leverage_bps,
            observed_slippage_bps=req.observed_slippage_bps,
            asset_exposures_bps=req.asset_exposures_bps,
            max_position_weight_bps=req.max_position_weight_bps,
            max_leverage_bps=req.max_leverage_bps,
            max_slippage_bps=req.max_slippage_bps,
            user_address=_parse_user_addr_int(req.user_address),
        )
        return await _run_proof_scan(
            user_address=req.user_address,
            circuit="StrategyIntegrity",
            inputs=inputs,
            proof_type="strategy_integrity",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Proof generation failed: {exc}")


@router.post("/proof/execution-integrity")
async def generate_execution_integrity_proof(req: ExecutionIntegrityProofRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    from app.services.zkml.circuit_scanner import build_execution_integrity_inputs

    try:
        inputs = build_execution_integrity_inputs(
            submission_block=req.submission_block,
            inclusion_block=req.inclusion_block,
            expected_price=req.expected_price,
            actual_price=req.actual_price,
            max_delay_blocks=req.max_delay_blocks,
            max_price_deviation_bps=req.max_price_deviation_bps,
            user_address=_parse_user_addr_int(req.user_address),
        )
        return await _run_proof_scan(
            user_address=req.user_address,
            circuit="ExecutionIntegrity",
            inputs=inputs,
            proof_type="execution_integrity",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Proof generation failed: {exc}")


@router.post("/proof/credit-eligibility")
async def generate_credit_eligibility(req: CreditEligibilityProofRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    """Generate Groth16 credit eligibility proof + async STARK envelope metadata."""
    from app.services.credit_eligibility_proof_service import generate_credit_eligibility_proof

    try:
        proof_payload = await asyncio.to_thread(
            generate_credit_eligibility_proof,
            req.credit_score,
            req.collateral_wei,
            req.min_credit_score,
            req.min_collateral,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"credit_eligibility_artifacts_unavailable: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Credit eligibility proof generation failed: {exc}")

    proof_hash = "0x" + hashlib.sha256(
        json.dumps(
            {
                "proof": proof_payload.get("proof"),
                "public_signals": proof_payload.get("public_signals"),
                "commitment_hash": proof_payload.get("commitment_hash"),
            },
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()
    envelope_id = f"env_{int(time.time())}_{_norm_addr(req.user_address)[:10]}"

    _persist_proof_completion(req.user_address, "credit_eligibility", proof_hash)
    await log_trust_event(
        req.user_address,
        "proof_generated",
        gate="credit",
        outcome="success",
        metadata={
            "proof_type": "credit_eligibility",
            "proof_hash": proof_hash,
            "envelope_id": envelope_id,
        },
        receipt_proof_type="proof_credit_eligibility",
    )

    return {
        "success": bool(proof_payload.get("verified", False)),
        "proof_type": "credit_eligibility",
        "proof_hash": proof_hash,
        "groth16": {
            "verified": bool(proof_payload.get("verified", False)),
            "public_signals": proof_payload.get("public_signals"),
            "calldata": proof_payload.get("calldata"),
            "circuit": proof_payload.get("circuit"),
        },
        "inputs": proof_payload.get("inputs"),
        "commitment_hash": proof_payload.get("commitment_hash"),
        "envelope": {
            "envelope_id": envelope_id,
            "status": "queued",
            "settlement_mode": "stark_wrapped_async_v1",
            "created_at": int(time.time()),
        },
        "version_matrix": get_trust_version_matrix(),
    }
