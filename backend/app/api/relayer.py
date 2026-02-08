"""
Relayer API Routes

Manages private withdrawal relay requests.
"""
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/relayer", tags=["relayer"])


class RelayRequest(BaseModel):
    requester: str
    nullifier: str
    commitment: str
    amount_wei: int
    recipient: str
    proof_hash: str


class RelayRequestResponse(BaseModel):
    request_id: int
    requester: str
    amount_wei: int
    recipient: str
    ready_time: int
    fee_bps: int
    status: str


class RelayExecutionRequest(BaseModel):
    request_id: int
    proof_calldata: list[str]


# In-memory relay queue (replace with DB in production)
_relay_queue: dict[int, dict] = {}
_next_request_id = 1


def get_user_tier(address: str) -> int:
    """Get user tier (simplified - in production, call ReputationRegistry)."""
    from app.api.reputation import get_user_data
    user = get_user_data(address)
    return user.get("tier", 0)


def get_tier_delay(tier: int) -> int:
    """Get relay delay in seconds for tier."""
    if tier == 0:
        return 0  # Cannot use relayer
    elif tier == 1:
        return 3600  # 1 hour
    else:
        return 1  # Instant


def get_tier_fee(tier: int) -> int:
    """Get relay fee in basis points for tier."""
    if tier == 1:
        return 50  # 0.5%
    else:
        return 10  # 0.1%


@router.post("/request", response_model=RelayRequestResponse)
async def create_relay_request(request: RelayRequest):
    """Create a new relay request."""
    global _next_request_id
    
    tier = get_user_tier(request.requester)
    
    if tier == 0:
        raise HTTPException(
            status_code=403,
            detail="Tier 0 (Strict) users cannot use the relayer. Upgrade to Tier 1 or higher."
        )
    
    delay = get_tier_delay(tier)
    fee_bps = get_tier_fee(tier)
    request_time = int(time.time())
    ready_time = request_time + delay
    
    request_id = _next_request_id
    _next_request_id += 1
    
    _relay_queue[request_id] = {
        "request_id": request_id,
        "requester": request.requester,
        "nullifier": request.nullifier,
        "commitment": request.commitment,
        "amount_wei": request.amount_wei,
        "recipient": request.recipient,
        "proof_hash": request.proof_hash,
        "request_time": request_time,
        "ready_time": ready_time,
        "fee_bps": fee_bps,
        "executed": False,
        "cancelled": False,
    }
    
    return RelayRequestResponse(
        request_id=request_id,
        requester=request.requester,
        amount_wei=request.amount_wei,
        recipient=request.recipient,
        ready_time=ready_time,
        fee_bps=fee_bps,
        status="pending",
    )


@router.get("/request/{request_id}", response_model=RelayRequestResponse)
async def get_relay_request(request_id: int):
    """Get details of a relay request."""
    if request_id not in _relay_queue:
        raise HTTPException(status_code=404, detail="Request not found")
    
    req = _relay_queue[request_id]
    
    status = "pending"
    if req["executed"]:
        status = "executed"
    elif req["cancelled"]:
        status = "cancelled"
    elif int(time.time()) >= req["ready_time"]:
        status = "ready"
    
    return RelayRequestResponse(
        request_id=req["request_id"],
        requester=req["requester"],
        amount_wei=req["amount_wei"],
        recipient=req["recipient"],
        ready_time=req["ready_time"],
        fee_bps=req["fee_bps"],
        status=status,
    )


@router.get("/pending/{address}")
async def get_pending_relays(address: str):
    """Get all pending relay requests for an address."""
    pending = []
    for req in _relay_queue.values():
        if req["requester"] == address and not req["executed"] and not req["cancelled"]:
            status = "pending"
            if int(time.time()) >= req["ready_time"]:
                status = "ready"
            
            pending.append({
                "request_id": req["request_id"],
                "amount_wei": req["amount_wei"],
                "recipient": req["recipient"],
                "ready_time": req["ready_time"],
                "fee_bps": req["fee_bps"],
                "status": status,
            })
    
    return {"address": address, "pending_count": len(pending), "requests": pending}


@router.post("/cancel/{request_id}")
async def cancel_relay_request(request_id: int, requester: str):
    """Cancel a pending relay request."""
    if request_id not in _relay_queue:
        raise HTTPException(status_code=404, detail="Request not found")
    
    req = _relay_queue[request_id]
    
    if req["requester"] != requester:
        raise HTTPException(status_code=403, detail="Not the request owner")
    
    if req["executed"]:
        raise HTTPException(status_code=400, detail="Request already executed")
    
    req["cancelled"] = True
    _relay_queue[request_id] = req
    
    return {"status": "cancelled", "request_id": request_id}


@router.post("/execute")
async def execute_relay(request: RelayExecutionRequest):
    """Execute a ready relay request (called by relayer)."""
    if request.request_id not in _relay_queue:
        raise HTTPException(status_code=404, detail="Request not found")
    
    req = _relay_queue[request.request_id]
    
    if req["executed"]:
        raise HTTPException(status_code=400, detail="Already executed")
    
    if req["cancelled"]:
        raise HTTPException(status_code=400, detail="Request cancelled")
    
    if int(time.time()) < req["ready_time"]:
        raise HTTPException(
            status_code=400,
            detail=f"Delay not passed. Ready at {req['ready_time']}"
        )
    
    # In production, this would:
    # 1. Verify the relayer is registered
    # 2. Execute the withdrawal through ConfidentialTransfer contract
    # 3. Collect the fee
    
    req["executed"] = True
    req["execution_time"] = int(time.time())
    _relay_queue[request.request_id] = req
    
    fee = (req["amount_wei"] * req["fee_bps"]) // 10000
    amount_after_fee = req["amount_wei"] - fee
    
    return {
        "status": "executed",
        "request_id": request.request_id,
        "amount_sent": amount_after_fee,
        "fee_collected": fee,
        "recipient": req["recipient"],
    }


@router.get("/stats")
async def get_relayer_stats():
    """Get relayer statistics."""
    total = len(_relay_queue)
    executed = sum(1 for r in _relay_queue.values() if r["executed"])
    pending = sum(1 for r in _relay_queue.values() if not r["executed"] and not r["cancelled"])
    cancelled = sum(1 for r in _relay_queue.values() if r["cancelled"])
    
    total_volume = sum(r["amount_wei"] for r in _relay_queue.values() if r["executed"])
    total_fees = sum(
        (r["amount_wei"] * r["fee_bps"]) // 10000
        for r in _relay_queue.values()
        if r["executed"]
    )
    
    return {
        "total_requests": total,
        "executed": executed,
        "pending": pending,
        "cancelled": cancelled,
        "total_volume_wei": total_volume,
        "total_fees_wei": total_fees,
    }
