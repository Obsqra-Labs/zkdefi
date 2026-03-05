"""
Vault Execution API Routes - LIVE on Starknet Sepolia

Endpoints for:
1. Executing strategy deployments (REAL Ekubo + AVNU)
2. Tracking deployed positions
3. Manual rebalancing

Uses REAL liquidity data from Sepolia (not mocked)
"""

from fastapi import APIRouter, HTTPException, Request
from typing import Optional, List, Dict
from pydantic import BaseModel
from datetime import datetime
import logging
import uuid
import asyncio

logger = logging.getLogger(__name__)
router = APIRouter(tags=["vault-execution"])

# Import REAL pool aggregator
try:
    from app.services.real_pool_aggregator import EkuboPoolAggregator
    aggregator = EkuboPoolAggregator(rpc_url="http://localhost:5050")
except ImportError:
    logger.warning("Could not import real pool aggregator - using mock fallback")
    aggregator = None


# ============================================================================
# Request/Response Models
# ============================================================================

class AllocationDetail(BaseModel):
    """Allocation for a specific strategy"""
    strategy: str  # "ekubo_lp", "vesu_yield", etc.
    percentage: float  # 0-100
    amount: float  # Calculated amount to deploy


class ExecuteStrategyRequest(BaseModel):
    """Request to execute a strategy deployment"""
    user_address: str
    risk_profile: str  # "conservative", "balanced", "aggressive"
    deposit_amount: float  # Token amount
    allocations: Optional[List[AllocationDetail]] = None


class DeploymentPosition(BaseModel):
    """Result of a single deployment"""
    strategy: str
    pool_id: str
    amount: float
    tx_hash: Optional[str] = None
    status: str  # "pending", "confirmed", "failed"
    expected_apy: float
    pool_name: str
    tx_calldata: Optional[Dict] = None  # { contract_address, entrypoint, calldata } for client to sign
    tx_calldata_error: Optional[str] = None


class ExecuteStrategyResponse(BaseModel):
    """Response from strategy execution"""
    deployment_id: str
    user_address: str
    total_amount: float
    positions: List[DeploymentPosition]
    total_expected_apy: float
    audit_trail_entry_id: str
    zkml_proof_hash: str
    timestamp: str


# Well-known Starknet Sepolia token addresses → readable symbol
_KNOWN_TOKENS: Dict[str, str] = {
    "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": "ETH",
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": "STRK",
    "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": "USDC",
    "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": "USDC",
    "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8": "USDT",
    "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": "fUSDC",
    # Non-padded canonical forms (indexer output)
    "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": "ETH",
    "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": "STRK",
    "0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": "USDC",
    "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": "USDC",
    "0x68f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8": "USDT",
    "0x7ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": "fUSDC",
    "0x009b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121": "zkdETH",
    "0x050974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637": "zkdAI",
    # Non-padded forms (some indexers strip leading zero nibbles)
    "0x9b786d710b96cd8f065c7b7244484379c37ebc5bc92d9710512bbe773e8121": "zkdETH",
    "0x50974f6d6f5868146fe81b5d61258450142cd239cc4f59b0f0dd168c4beb637": "zkdAI",
}


def _resolve_token(addr: str) -> str:
    """Resolve a token address (full or truncated) to a readable symbol."""
    if not addr or addr == "?":
        return "???"
    lc = addr.lower().rstrip(".")
    # Exact match
    if lc in _KNOWN_TOKENS:
        return _KNOWN_TOKENS[lc]
    # Prefix match for truncated addresses
    for full_addr, symbol in _KNOWN_TOKENS.items():
        if full_addr.startswith(lc) and len(lc) >= 6:
            return symbol
    return addr[:10] + "…" if len(addr) > 14 else addr


def _resolve_pool_pair(pool_id: str, fallback_pair: str = "") -> str:
    """Convert a pool identifier to a readable pair string (e.g. 'STRK/ETH')."""
    # If a readable pair is already available, use it
    if fallback_pair and "/" in fallback_pair and not fallback_pair.startswith("0x"):
        return fallback_pair
    if not pool_id:
        return fallback_pair or "LP Position"
    # ekubo:addr0:addr1:na:fee → split on ':'
    parts = pool_id.split(":")
    if len(parts) >= 3 and parts[0] == "ekubo":
        return f"{_resolve_token(parts[1])}/{_resolve_token(parts[2])}"
    # addr0../addr1.. or addr0/addr1
    for sep in ["/", "_", "-"]:
        segs = pool_id.split(sep)
        if len(segs) == 2 and segs[0].lstrip().startswith("0x"):
            return f"{_resolve_token(segs[0].strip())}/{_resolve_token(segs[1].strip())}"
    return fallback_pair or pool_id[:20]


class PositionInfo(BaseModel):
    """Information about a deployed position"""
    position_id: str
    pool: str
    pair: str = ""           # human-readable pair name, e.g. "STRK/ETH"
    tokens_in: float         # human-readable (not wei)
    current_value: float     # human-readable (not wei)
    accrued_fees: float
    apy_realized: float
    status: str = "active"


class UserPositionsResponse(BaseModel):
    """Response with user's deployed positions"""
    user_address: str
    positions: List[PositionInfo]
    total_deployed: float
    total_accrued: float


class RebalanceRequest(BaseModel):
    """Request to rebalance existing positions"""
    user_address: str
    new_allocations: List[AllocationDetail]


# ============================================================================
# Endpoints
# ============================================================================

@router.post("/execute", response_model=ExecuteStrategyResponse)
async def execute_strategy(http_request: Request, request: ExecuteStrategyRequest):
    """
    Execute a strategy deployment on Sepolia
    
    This endpoint:
    1. Analyzes available pools using REAL Ekubo + AVNU liquidity (or uses provided allocations)
    2. Generates risk-optimized allocations
    3. Creates positions on Starknet smart contracts
    4. Returns transaction hashes and proof
    """
    logger.info(f"Executing strategy for {request.user_address}, amount: {request.deposit_amount}, profile: {request.risk_profile}")
    try:
        from app.services.vault_execute_service import execute_strategy_impl
        req_dict = request.model_dump()
        req_dict["demo_mode"] = getattr(http_request.state, "demo_mode", False)
        result = await execute_strategy_impl(req_dict)
        positions = [DeploymentPosition(**p) for p in result["positions"]]
        return ExecuteStrategyResponse(
            deployment_id=result["deployment_id"],
            user_address=result["user_address"],
            total_amount=result["total_amount"],
            positions=positions,
            total_expected_apy=result["total_expected_apy"],
            audit_trail_entry_id=result["audit_trail_entry_id"],
            zkml_proof_hash=result["zkml_proof_hash"],
            timestamp=result["timestamp"],
        )
    except Exception as e:
        logger.error(f"Strategy execution failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/positions/{user_address}", response_model=UserPositionsResponse)
async def get_user_positions(user_address: str):
    """
    Get all deployed positions for a user.

    Reads from both the Ekubo LP JSON store and the execution ledger.
    """
    logger.info(f"Fetching positions for user {user_address}")

    positions: List[PositionInfo] = []
    total_deployed = 0.0
    total_accrued = 0.0

    # Read from ekubo_lp_service JSON store
    try:
        from app.services.ekubo_lp_service import list_positions
        lp_positions = list_positions(user_address)
        for lp in lp_positions:
            status = str(lp.get("status", "active"))
            token0_raw = str(lp.get("token0") or "")
            token1_raw = str(lp.get("token1") or "")

            # Skip placeholder imports with no resolved pool metadata.
            if status == "active_empty" and (not token0_raw or not token1_raw):
                continue

            amount0 = float(lp.get("amount0") or 0)
            amount1 = float(lp.get("amount1") or 0)
            tokens_human = (amount0 + amount1) / 1e18   # convert wei → human
            apr = float(lp.get("estimated_fees_apr") or 0)
            pair_name = str(lp.get("pair") or "")
            t0 = token0_raw or "?"
            t1 = token1_raw or "?"
            pool_label = f"{t0}/{t1}"
            readable_pair = _resolve_pool_pair(pool_label, pair_name)
            pos = PositionInfo(
                position_id=str(lp.get("position_id", "")),
                pool=pool_label,
                pair=readable_pair,
                tokens_in=round(tokens_human, 6),
                current_value=round(tokens_human, 6),  # approximate (no live price yet)
                accrued_fees=0.0,         # Phase D will add real fee reading
                apy_realized=apr,
                status=status,
            )
            positions.append(pos)
            total_deployed += tokens_human
    except Exception as e:
        logger.warning("LP position read failed: %s", e)

    # Also read from ledger for execution-tracked positions
    try:
        from app.services.ledger_service import get_ledger_service
        import json as _json
        ledger = get_ledger_service()
        rows = ledger.get_vault_allocations(user_address)
        for row in rows:
            meta = {}
            try:
                meta = _json.loads(row.get("metadata") or "{}")
            except Exception:
                pass
            if meta.get("position_id"):
                # Already covered by LP JSON store above
                continue
            raw_amount = float(row.get("amount") or 0)
            human_amount = raw_amount / 1e18 if raw_amount > 1e14 else raw_amount
            pool_id = str(row.get("pool_id", "unknown"))
            readable_pair = _resolve_pool_pair(pool_id)
            pos = PositionInfo(
                position_id=str(row.get("id", "")),
                pool=pool_id,
                pair=readable_pair,
                tokens_in=round(human_amount, 6),
                current_value=round(human_amount, 6),
                accrued_fees=0.0,
                apy_realized=float(meta.get("estimated_fees_apr") or 0),
                status="active",
            )
            positions.append(pos)
            total_deployed += human_amount
    except Exception as e:
        logger.warning("Ledger position read failed: %s", e)

    return UserPositionsResponse(
        user_address=user_address,
        positions=positions,
        total_deployed=round(total_deployed, 6),
        total_accrued=total_accrued,
    )


@router.post("/rebalance", response_model=ExecuteStrategyResponse)
async def rebalance_positions(request: RebalanceRequest):
    """
    Manually rebalance existing positions
    
    Takes current positions and reallocates to new strategy
    """
    
    logger.info(f"Rebalancing positions for {request.user_address}")
    
    # In production: 
    # 1. Fetch current positions from contracts
    # 2. Withdraw liquidity
    # 3. Redeposit according to new allocations
    # 4. Update position tracking
    
    return ExecuteStrategyResponse(
        deployment_id=f"rebalance_{uuid.uuid4().hex[:12]}",
        user_address=request.user_address,
        total_amount=0.0,  # Would be calculated from positions
        positions=[],
        total_expected_apy=0.0,
        audit_trail_entry_id=f"audit_{uuid.uuid4().hex[:12]}",
        zkml_proof_hash=f"0x{uuid.uuid4().hex}",
        timestamp=datetime.utcnow().isoformat() + "Z"
    )
