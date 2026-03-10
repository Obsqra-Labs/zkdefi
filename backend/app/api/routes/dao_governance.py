"""
DAO governance + privacy pool routes.

Mounted at `/api/v1/dao` in `main.py`.
"""

from __future__ import annotations

import math
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import WalletOwner, AdminOnly
from app.services.dao_voting_service import get_dao_voting_service
from app.services.json_store import JsonStore
from app.services.privacy_pool_service import get_privacy_pool_service

router = APIRouter()

_proposal_store = JsonStore("dao_proposals")
_vote_store = JsonStore("dao_votes")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _proposal_rows() -> list[dict[str, Any]]:
    rows = list(_proposal_store.values())
    rows = [r for r in rows if isinstance(r, dict)]
    rows.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
    return rows


def _new_proposal_id() -> int:
    rows = _proposal_rows()
    if not rows:
        return 1
    return max(int(r.get("id", 0) or 0) for r in rows) + 1


class CreateProposalRequest(BaseModel):
    proposer_address: str
    proposal_type: str
    target_address: str = ""
    new_value: int = 0
    vote_duration_seconds: int = 604800
    description: str = ""


class VoteRequest(BaseModel):
    user_address: str
    proposal_id: int
    vote_direction: int


class CastVoteRequest(BaseModel):
    user_address: str
    proposal_id: int
    vote_direction: int


class PoolDepositRequest(BaseModel):
    amount: float = Field(gt=0)
    privacyMode: Literal["public", "shielded", "dark_ledger"] = "public"
    userAddress: str | None = None
    source: Literal["live", "simulated"] = "simulated"


class PoolWithdrawRequest(BaseModel):
    amount: float = Field(gt=0)
    address: str
    source: Literal["live", "simulated"] = "simulated"


class PoolGovernanceProposalRequest(BaseModel):
    proposerAddress: str = ""
    title: str = ""
    description: str = ""
    changes: dict[str, Any] = Field(default_factory=dict)
    source: Literal["live", "simulated"] = "simulated"


class GovernanceVoteRequest(BaseModel):
    proposalId: str
    vote: Literal["yes", "no"]
    userAddress: str | None = None


@router.post("/proposals")
@router.post("/dao/proposals")
async def create_proposal(request: CreateProposalRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    pid = _new_proposal_id()
    created_at = int(time.time())
    voting_ends_at = created_at + int(request.vote_duration_seconds)
    row = {
        "id": pid,
        "proposer": request.proposer_address,
        "proposal_type": request.proposal_type,
        "target": request.target_address,
        "new_value": request.new_value,
        "votes_for": 0,
        "votes_against": 0,
        "total_votes": 0,
        "created_at": created_at,
        "voting_ends_at": voting_ends_at,
        "executed": False,
        "passed": False,
        "status": "voting",
        "description": request.description,
    }
    _proposal_store.set(str(pid), row)
    return {
        "proposal_id": pid,
        "tx_hash": f"0x{pid:064x}",
        "voting_ends_at": voting_ends_at,
    }


@router.post("/vote/generate_proof")
@router.post("/dao/vote/generate_proof")
async def generate_vote_proof(request: VoteRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    voting_service = get_dao_voting_service()
    try:
        proof = await voting_service.generate_voting_proof(
            user_address=request.user_address,
            proposal_id=request.proposal_id,
            vote_direction=request.vote_direction,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "proof_calldata": proof.proof_calldata,
        "nullifier_hash": proof.nullifier_hash,
        "commitment": proof.commitment,
        "vote_value": proof.vote_value,
    }


@router.post("/vote/cast")
@router.post("/dao/vote/cast")
async def cast_vote(request: CastVoteRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    proof = await generate_vote_proof(
        VoteRequest(
            user_address=request.user_address,
            proposal_id=request.proposal_id,
            vote_direction=request.vote_direction,
        )
    )

    row = _proposal_store.get(str(request.proposal_id))
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Proposal not found")

    if request.vote_direction >= 1:
        row["votes_for"] = int(row.get("votes_for", 0)) + 1
    else:
        row["votes_against"] = int(row.get("votes_against", 0)) + 1
    row["total_votes"] = int(row.get("votes_for", 0)) + int(row.get("votes_against", 0))
    _proposal_store.set(str(request.proposal_id), row)

    return {
        "tx_hash": f"0xvote{request.proposal_id:060x}",
        "nullifier_hash": proof["nullifier_hash"],
        "vote_recorded": True,
    }


@router.get("/proposals/{proposal_id}")
@router.get("/dao/proposals/{proposal_id}")
async def get_proposal(proposal_id: int) -> dict[str, Any]:
    row = _proposal_store.get(str(proposal_id))
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Proposal not found")
    return row


@router.get("/proposals")
@router.get("/dao/proposals")
async def list_proposals(
    status: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    rows = _proposal_rows()
    if status:
        status_lower = status.lower()
        rows = [r for r in rows if str(r.get("status", "")).lower() == status_lower]
    total = len(rows)
    limit = min(limit, 100)
    items = rows[offset : offset + limit]
    next_offset = offset + len(items) if offset + len(items) < total else None
    return {"items": items, "total": total, "next_offset": next_offset}


@router.post("/proposals/{proposal_id}/tally")
@router.post("/dao/proposals/{proposal_id}/tally")
async def tally_proposal(proposal_id: int, _admin: str = AdminOnly) -> dict[str, Any]:
    row = _proposal_store.get(str(proposal_id))
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Proposal not found")
    votes_for = int(row.get("votes_for", 0))
    votes_against = int(row.get("votes_against", 0))
    passed = votes_for > votes_against
    row["passed"] = passed
    row["status"] = "passed" if passed else "rejected"
    _proposal_store.set(str(proposal_id), row)
    return {
        "proposal_id": proposal_id,
        "tallied": True,
        "passed": passed,
        "votes_for": votes_for,
        "votes_against": votes_against,
    }


@router.post("/proposals/{proposal_id}/execute")
@router.post("/dao/proposals/{proposal_id}/execute")
async def execute_proposal(proposal_id: int, _admin: str = AdminOnly) -> dict[str, Any]:
    row = _proposal_store.get(str(proposal_id))
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Proposal not found")
    if not bool(row.get("passed")):
        raise HTTPException(status_code=400, detail="Proposal has not passed")
    row["executed"] = True
    row["status"] = "executed"
    _proposal_store.set(str(proposal_id), row)
    return {
        "proposal_id": proposal_id,
        "executed": True,
        "tx_hash": f"0xexec{proposal_id:060x}",
    }


def _tier_info_for_user(address: str) -> tuple[int, str, float]:
    tier_idx = 0
    tier_name = "Tier 0"
    try:
        from app.api.reputation import TIER_INFO, get_user_data

        user = get_user_data(address)
        tier_idx = int(user.get("tier", 0))
        info = TIER_INFO.get(tier_idx)
        if info:
            tier_name = info.tier_name
    except Exception:
        pass
    tier_multiplier = {0: 1.0, 1: 1.5, 2: 2.0}.get(tier_idx, 1.0)
    return tier_idx, tier_name, tier_multiplier


async def _compute_capital_breakdown(address: str) -> tuple[float, float, float]:
    eth_price = 3200.0
    strk_price = 0.65
    usdc_price = 1.0

    lp_usd = 0.0
    lending_usd = 0.0
    staking_usd = 0.0

    _token_price = {"ETH": eth_price, "STRK": strk_price, "USDC": usdc_price}

    # ── 1. Ekubo LP positions (real position store) ───────────────────
    try:
        from app.services.ekubo_lp_service import list_positions as ekubo_list_positions

        for pos in ekubo_list_positions(address):
            amt0 = float(pos.get("amount0", 0))
            amt1 = float(pos.get("amount1", 0))
            lp_usd += (amt0 / 1e18) * eth_price + (amt1 / 1e18) * eth_price
    except Exception:
        pass

    # ── 2. Private yield vault positions ──────────────────────────────
    try:
        from app.services.private_yield_service import get_user_positions as get_private_yield_positions

        for pos in get_private_yield_positions(address):
            amt_wei = float(pos.get("amount_wei", 0))
            lp_usd += (amt_wei / 1e18) * eth_price
    except Exception:
        pass

    # ── 3. Privacy pool positions ─────────────────────────────────────
    try:
        psvc = get_privacy_pool_service()
        user_pool_positions = psvc.get_user_positions(address)
        pools = user_pool_positions.get("pools", {})
        if isinstance(pools, dict):
            for pool_pos in pools.values():
                lp_usd += float(pool_pos.get("deposited_amount", 0.0))
    except Exception:
        pass

    # ── 4. Lending service positions ──────────────────────────────────
    try:
        from app.services.lending_service import get_user_positions as get_lending_positions

        lending = get_lending_positions(address)
        for s in lending.get("supplies", []):
            lending_usd += (float(s.get("amount_wei", 0)) / 1e18) * eth_price
    except Exception:
        pass

    # ── 5. Double-entry ledger vault balances (real capital on deposit) ─
    try:
        import os
        from app.services.double_entry_ledger import DoubleEntryLedger
        from app.services.vault_account_service import VaultAccountService

        data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
        db_path = os.path.join(data_dir, "vault_v2.db")
        if os.path.exists(db_path):
            ledger = DoubleEntryLedger(db_path)
            vaults = VaultAccountService(db_path)
            # Use get_vault_by_address but only read — it auto-creates if
            # missing, which is harmless (empty vault → $0 balance).
            vault = vaults.get_vault_by_address(address) if address else None
            vault_id = vault.get("vault_id", "") if vault else ""
            if vault_id:
                for token in ("ETH", "STRK", "USDC"):
                    summary = ledger.vault_summary(vault_id, token)
                    total_wei = summary["available"] + summary["pending"] + summary["deployed"]
                    if total_wei > 0:
                        price = _token_price.get(token, 0.0)
                        decimals = 6 if token == "USDC" else 18
                        lending_usd += (total_wei / 10**decimals) * price
    except Exception:
        pass

    # ── 6. Staking positions (on-chain delegation) ────────────────────
    try:
        from app.services.staking.native_staking import get_user_delegation_positions

        positions = await get_user_delegation_positions(address)
        for p in positions:
            delegated_wei = float(getattr(p, "delegated_wei", 0.0))
            staking_usd += (delegated_wei / 1e18) * strk_price
    except Exception:
        pass

    return round(lp_usd, 6), round(lending_usd, 6), round(staking_usd, 6)


@router.get("/voting_power/{user_address}")
@router.get("/dao/voting_power/{user_address}")
async def get_voting_power(user_address: str) -> dict[str, Any]:
    tier, tier_name, tier_multiplier = _tier_info_for_user(user_address)
    lp_usd, lending_usd, staking_usd = await _compute_capital_breakdown(user_address)
    base_capital = max(0.0, lp_usd + lending_usd + staking_usd)
    voting_power = round(math.sqrt(base_capital) * tier_multiplier, 6)
    return {
        "user_address": user_address,
        "voting_power": voting_power,
        "lp_usd": lp_usd,
        "lending_usd": lending_usd,
        "staking_usd": staking_usd,
        "tier": tier,
        "tier_name": tier_name,
        "tier_multiplier": tier_multiplier,
        "base_capital_usd": round(base_capital, 6),
        "formula_version": "vp_v2_sqrt_capital_tier_multiplier",
        "basis": "sqrt(lp_usd + lending_usd + staking_usd) * tier_multiplier",
    }


@router.get("/governance/proposal/{proposal_id}")
async def get_governance_proposal_status(proposal_id: str) -> dict[str, Any]:
    row = _proposal_store.get(str(proposal_id))
    if not isinstance(row, dict):
        raise HTTPException(status_code=404, detail="Proposal not found")
    votes = {
        "yes": int(row.get("votes_for", 0)),
        "no": int(row.get("votes_against", 0)),
    }
    total = max(1, votes["yes"] + votes["no"])
    return {
        "id": str(row.get("id", proposal_id)),
        "status": row.get("status", "open"),
        "votes": votes,
        "totalVoters": votes["yes"] + votes["no"],
        "participationRate": round(((votes["yes"] + votes["no"]) / total) * 100.0, 2),
    }


@router.post("/governance/vote")
async def governance_vote(req: GovernanceVoteRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    vote_id = f"{req.proposalId}:{req.userAddress or 'anon'}:{int(time.time())}"
    _vote_store.set(
        vote_id,
        {
            "proposalId": req.proposalId,
            "vote": req.vote,
            "userAddress": req.userAddress,
            "timestamp": _now_iso(),
        },
    )
    return {
        "proposalId": req.proposalId,
        "vote": req.vote,
        "timestamp": _now_iso(),
    }


# Pool id must be one of: CONSERVATIVE_POOL, MODERATE_POOL, AGGRESSIVE_POOL (see privacy_pool_service.POOL_IDS).
@router.get("/pools/{pool}/stats")
async def pool_stats(pool: str) -> dict[str, Any]:
    svc = get_privacy_pool_service()
    try:
        return svc.get_pool_stats(pool)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# Pool id: CONSERVATIVE_POOL, MODERATE_POOL, or AGGRESSIVE_POOL.
@router.get("/pools/{pool}/positions/{address}")
async def pool_user_position(pool: str, address: str) -> dict[str, Any]:
    svc = get_privacy_pool_service()
    try:
        pool_id = str(pool).strip().upper()
        pos = svc.get_user_positions(address).get("pools", {}).get(pool_id, {})
        return {
            "pool": pool_id,
            "address": address,
            "deposited_amount": float(pos.get("deposited_amount", 0.0)),
            "updated_at": pos.get("updated_at"),
            "source": pos.get("source", "simulated"),
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/pools/{pool}/liquidity")
async def pool_liquidity(pool: str) -> dict[str, Any]:
    svc = get_privacy_pool_service()
    try:
        return svc.get_pool_liquidity(pool)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/pools/yield/distributions")
async def pool_yield_distributions() -> list[dict[str, Any]]:
    svc = get_privacy_pool_service()
    return svc.get_yield_distributions()


@router.post("/pools/{pool}/deposit")
async def pool_deposit(pool: str, req: PoolDepositRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    svc = get_privacy_pool_service()
    address = req.userAddress or "0x0000000000000000000000000000000000000000"
    try:
        return svc.deposit(
            pool=pool,
            amount=float(req.amount),
            address=address,
            privacy_mode=req.privacyMode,
            source=req.source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/pools/{pool}/withdraw")
async def pool_withdraw(pool: str, req: PoolWithdrawRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    svc = get_privacy_pool_service()
    try:
        return svc.withdraw(
            pool=pool,
            amount=float(req.amount),
            address=req.address,
            source=req.source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/pools/{pool}/lending-policy")
async def pool_lending_policy(pool: str) -> dict[str, Any]:
    svc = get_privacy_pool_service()
    try:
        return svc.get_lending_policy(pool)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/pools/{pool}/loans/active")
async def pool_active_loans(pool: str) -> list[dict[str, Any]]:
    svc = get_privacy_pool_service()
    try:
        return svc.get_active_loans(pool)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/pools/{pool}/governance/propose")
async def pool_governance_propose(pool: str, req: PoolGovernanceProposalRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    svc = get_privacy_pool_service()
    try:
        proposal = svc.create_governance_proposal(
            pool=pool,
            payload={
                "proposerAddress": req.proposerAddress,
                "title": req.title,
                "description": req.description,
                "changes": req.changes,
                "source": req.source,
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return proposal
