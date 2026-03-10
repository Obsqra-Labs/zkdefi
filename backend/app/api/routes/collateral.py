"""Collateral Management API routes.

Wired to collateral_service (JsonStore-backed) + live oracle prices.
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.middleware.auth import WalletOwner, AdminOnly

try:
    from app.api.validators import (
        validate_starknet_address, validate_token_symbol, validate_wei_amount,
    )
except ImportError:
    from backend.app.api.validators import (
        validate_starknet_address, validate_token_symbol, validate_wei_amount,
    )

from app.services.collateral_service import (
    COLLATERAL_VAULT_ADDRESS,
    ETH_TOKEN,
    STRK_TOKEN,
    WEI_PER_ETH,
    build_deposit_calldata,
    build_withdraw_calldata,
    get_user_positions,
    get_user_total_collateral,
    record_deposit,
    record_withdrawal,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["collateral"])

# ── token symbol → address mapping ──────────────────────────────────────────

_TOKEN_MAP: dict[str, str] = {
    "ETH": ETH_TOKEN,
    "STRK": STRK_TOKEN,
}

LTV_RATIOS: dict[str, float] = {
    "ETH": 0.75,
    "STRK": 0.60,
}


async def _get_usd_price(token_symbol: str) -> float:
    """Fetch live USD price via the oracle adapter; fall back to sensible defaults."""
    try:
        from app.services.ekubo.oracle_adapter import get_live_prices

        prices = await get_live_prices()
        if token_symbol == "ETH":
            return float(prices.get("eth_usd") or 1800)
        if token_symbol == "STRK":
            return float(prices.get("strk_usd") or 0.45)
    except Exception:
        pass
    return {"ETH": 1800.0, "STRK": 0.45}.get(token_symbol, 0.0)


# ── Pydantic models ─────────────────────────────────────────────────────────


class CollateralDepositRequest(BaseModel):
    """Request to deposit collateral."""
    user_address: str = Field(..., description="User's Starknet address")
    token: str = Field(..., description="Collateral token symbol")
    amount: int = Field(..., ge=1, description="Amount in wei")
    pool_tier: str = Field("core", description="'core' or 'boost'")

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("token")
    @classmethod
    def check_token(cls, v: str) -> str:
        return validate_token_symbol(v)

    @field_validator("amount")
    @classmethod
    def check_amount(cls, v: int) -> int:
        return validate_wei_amount(v)


class CollateralWithdrawRequest(BaseModel):
    """Request to withdraw collateral."""
    user_address: str = Field(..., description="User's Starknet address")
    token: str = Field(..., description="Collateral token symbol")
    amount: int = Field(..., ge=1, description="Amount in wei")

    @field_validator("user_address")
    @classmethod
    def check_address(cls, v: str) -> str:
        return validate_starknet_address(v)

    @field_validator("token")
    @classmethod
    def check_token(cls, v: str) -> str:
        return validate_token_symbol(v)

    @field_validator("amount")
    @classmethod
    def check_amount(cls, v: int) -> int:
        return validate_wei_amount(v)


class CollateralResponse(BaseModel):
    """Response with collateral details."""
    user_address: str
    token: str
    balance: int
    locked: int
    available: int
    usd_value: float
    ltv_ratio: float


class CollateralHealthResponse(BaseModel):
    """Response with collateral health metrics."""
    user_address: str
    total_collateral_usd: float
    total_locked_usd: float
    health_factor: float
    status: str
    liquidation_price: float


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post(
    "/collateral/deposit",
    summary="Prepare collateral deposit calldata",
    description="Returns multicall calldata (approve + deposit_collateral) for wallet signing, and records position locally.",
)
async def deposit_collateral(request: CollateralDepositRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    """
    Build deposit calldata for the CollateralVault contract.
    Records position in JsonStore after returning calldata.
    """
    try:
        token_addr = _TOKEN_MAP.get(request.token.upper())
        if not token_addr:
            raise HTTPException(status_code=400, detail=f"Unsupported token: {request.token}")

        calldata = build_deposit_calldata(
            token=token_addr,
            amount_wei=request.amount,
            pool_tier=request.pool_tier,
        )

        # Record optimistically (tx confirmation should update later)
        import time
        position_id = int(time.time() * 1000) % (2**63)  # placeholder until chain event
        position = record_deposit(
            address=request.user_address,
            position_id=position_id,
            token=request.token.upper(),
            amount_wei=request.amount,
            pool_tier=request.pool_tier,
        )

        usd_price = await _get_usd_price(request.token.upper())
        usd_value = (request.amount / WEI_PER_ETH) * usd_price
        ltv = LTV_RATIOS.get(request.token.upper(), 0.6)

        return {
            "calldata": calldata,
            "position": position,
            "collateral": CollateralResponse(
                user_address=request.user_address,
                token=request.token.upper(),
                balance=request.amount,
                locked=request.amount if request.pool_tier == "boost" else 0,
                available=0 if request.pool_tier == "boost" else request.amount,
                usd_value=round(usd_value, 2),
                ltv_ratio=ltv,
            ).model_dump(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Collateral deposit failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/collateral/withdraw",
    summary="Prepare collateral withdrawal calldata",
    description="Returns calldata for withdraw_collateral and updates local cache.",
)
async def withdraw_collateral(request: CollateralWithdrawRequest, _caller: str = WalletOwner) -> dict[str, Any]:
    """
    Build withdrawal calldata.
    Finds matching position and returns calldata for wallet signing.
    """
    try:
        positions = get_user_positions(request.user_address)
        target = None
        for p in positions:
            if p.get("token", "").upper() == request.token.upper() and p.get("active"):
                target = p
                break

        if not target:
            raise HTTPException(
                status_code=404,
                detail=f"No active {request.token} collateral position found",
            )

        import time
        if target.get("locked_until", 0) > int(time.time()):
            raise HTTPException(
                status_code=400,
                detail=f"Position is time-locked until {target['locked_until']}",
            )

        calldata = build_withdraw_calldata(target["position_id"])
        record_withdrawal(request.user_address, target["position_id"])

        return {
            "calldata": calldata,
            "withdrawn_position": target,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Collateral withdrawal failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/collateral/{address}",
    summary="Get collateral details",
    description="Get all collateral positions for user with live USD pricing.",
)
async def get_collateral(
    address: str,
    limit: int = Query(20, ge=1, le=100, description="Max results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> dict[str, Any]:
    """Get user's collateral positions with live pricing and pagination."""
    try:
        positions = get_user_positions(address)

        # Enrich with live USD values
        enriched: list[dict[str, Any]] = []
        for p in positions:
            token_symbol = p.get("token", "ETH")
            usd_price = await _get_usd_price(token_symbol)
            amount_wei = int(p.get("amount_wei", 0))
            usd_value = (amount_wei / WEI_PER_ETH) * usd_price

            import time
            locked = p.get("locked_until", 0) > int(time.time())
            enriched.append({
                "token": token_symbol,
                "balance": amount_wei,
                "locked": amount_wei if locked else 0,
                "available": 0 if locked else amount_wei,
                "usd_value": round(usd_value, 2),
                "pool_tier": p.get("pool_tier", "core"),
                "position_id": p.get("position_id"),
            })

        total_usd = sum(e["usd_value"] for e in enriched)
        locked_usd = sum(e["usd_value"] for e in enriched if e["locked"] > 0)

        paginated = enriched[offset : offset + limit]
        return {
            "user_address": address,
            "positions": paginated,
            "total_collateral_usd": round(total_usd, 2),
            "total_locked_usd": round(locked_usd, 2),
            "pagination": {
                "offset": offset,
                "limit": limit,
                "total": len(enriched),
                "has_more": offset + limit < len(enriched),
            },
        }
    except Exception as e:
        logger.error(f"Fetch collateral failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/collateral/health/{address}",
    response_model=CollateralHealthResponse,
    summary="Get collateral health",
    description="Health factor computed from real positions + live prices.",
)
async def get_collateral_health(address: str) -> CollateralHealthResponse:
    """
    Compute health factor from persisted positions and live oracle prices.
    Health Factor = Total Collateral USD / Total Borrowed USD (at LTV).
    """
    from app.services.ttl_cache import collateral_cache

    try:
        cache_key = f"health:{address}"
        cached = await collateral_cache.get(cache_key)
        if cached:
            return CollateralHealthResponse(**cached)

        positions = get_user_positions(address)

        total_collateral_usd = 0.0
        total_locked_usd = 0.0
        import time as _time
        now = _time.time()

        for p in positions:
            token_symbol = p.get("token", "ETH")
            usd_price = await _get_usd_price(token_symbol)
            amount_wei = int(p.get("amount_wei", 0))
            usd_val = (amount_wei / WEI_PER_ETH) * usd_price
            total_collateral_usd += usd_val
            if p.get("locked_until", 0) > now:
                total_locked_usd += usd_val

        # Estimate borrowed amount from ledger if available
        borrowed_usd = 0.0
        try:
            from app.services.ledger_service import get_ledger_service
            ledger = get_ledger_service()
            accounts = ledger.list_accounts()
            addr_key = address.lower().strip()
            for acct in accounts:
                if acct.get("address", "").lower() == addr_key:
                    bal = acct.get("balance", 0)
                    if bal < 0:
                        borrowed_usd += abs(bal) / WEI_PER_ETH * 1800  # conservative ETH price
        except Exception:
            pass

        if borrowed_usd > 0:
            health_factor = total_collateral_usd / borrowed_usd
        elif total_collateral_usd > 0:
            health_factor = 99.0  # no debt → max healthy
        else:
            health_factor = 0.0

        status = "healthy" if health_factor > 1.5 else ("at-risk" if health_factor >= 1.0 else "liquidation")
        liq_price = 0.0
        if total_collateral_usd > 0 and borrowed_usd > 0:
            eth_price = await _get_usd_price("ETH")
            liq_price = eth_price * (borrowed_usd / total_collateral_usd)

        response = CollateralHealthResponse(
            user_address=address,
            total_collateral_usd=round(total_collateral_usd, 2),
            total_locked_usd=round(total_locked_usd, 2),
            health_factor=round(health_factor, 2),
            status=status,
            liquidation_price=round(liq_price, 2),
        )
        await collateral_cache.set(cache_key, response.model_dump())
        return response

    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/collateral/liquidate",
    summary="Liquidate collateral",
    description="Force liquidation of at-risk position",
)
async def liquidate_collateral(
    user_address: str = Query(..., description="User address"),
    token: str = Query(..., description="Token to liquidate"),
    _admin: str = AdminOnly,
) -> dict[str, Any]:
    """Trigger liquidation of at-risk collateral."""
    try:
        # Verify position is actually at-risk
        health = await get_collateral_health(user_address)
        if health.health_factor >= 1.0:
            raise HTTPException(
                status_code=400,
                detail=f"Position not eligible for liquidation (health_factor={health.health_factor})",
            )

        positions = get_user_positions(user_address)
        target = next(
            (p for p in positions if p.get("token", "").upper() == token.upper() and p.get("active")),
            None,
        )
        if not target:
            raise HTTPException(status_code=404, detail=f"No active {token} position to liquidate")

        amount_liquidated = int(target.get("amount_wei", 0))
        penalty = int(amount_liquidated * 0.05)  # 5% liquidation penalty

        record_withdrawal(user_address, target["position_id"])

        return {
            "status": "liquidated",
            "user_address": user_address,
            "token": token,
            "amount_liquidated": amount_liquidated,
            "penalty_applied": penalty,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Liquidation failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
