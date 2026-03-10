"""
P2P Lending Service — Request-book + first-come-fund model.

Borrowers post loan requests with collateral. Lenders fund requests
on a first-come basis. When fully funded, the loan activates.
Repayment is tracked. Liquidation triggers on health-factor breach.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Optional

from app.services.json_store import JsonStore

logger = logging.getLogger(__name__)

WEI_PER_ETH = 10**18

# Stores
_requests_store = JsonStore("p2p_lending_requests")
_loans_store = JsonStore("p2p_lending_loans")

# Tier-based interest rate caps (APY in basis points)
TIER_RATE_CAPS = {
    0: 2000,  # 20% max APY for tier-0 (strict)
    1: 1500,  # 15%
    2: 1000,  # 10%
}

# Collateral requirements (LTV in basis points)
TIER_LTV = {
    0: 5000,  # 50% LTV
    1: 6500,  # 65%
    2: 7500,  # 75%
}

LIQUIDATION_THRESHOLD_BPS = 8500  # 85%
LIQUIDATION_PENALTY_BPS = 500     # 5%
BPS_DENOM = 10_000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> int:
    return int(time.time())


def _get_user_tier(address: str) -> int:
    """Fetch reputation tier for the borrower."""
    try:
        from app.api.reputation import get_user_data
        user = get_user_data(address)
        return int(user.get("tier", 0) or 0)
    except Exception:
        return 0


def _get_collateral_eth(address: str) -> float:
    """Get user's total collateral in ETH."""
    try:
        from app.services.collateral_service import get_user_total_collateral
        summary = get_user_total_collateral(address)
        return float(summary.get("weighted_collateral_eth", 0))
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# Loan Request CRUD
# ---------------------------------------------------------------------------


def create_loan_request(
    borrower_address: str,
    amount_wei: int,
    collateral_wei: int,
    duration_secs: int,
    interest_rate_bps: int,
) -> dict[str, Any]:
    """Create a new loan request on the request book.

    Validates:
    - Collateral meets LTV requirement for borrower's tier
    - Interest rate does not exceed tier cap
    """
    tier = _get_user_tier(borrower_address)
    max_ltv = TIER_LTV.get(tier, TIER_LTV[0])
    max_rate = TIER_RATE_CAPS.get(tier, TIER_RATE_CAPS[0])

    # LTV check: amount / collateral <= max_ltv
    if collateral_wei <= 0:
        raise ValueError("Collateral must be positive")
    ltv = (amount_wei * BPS_DENOM) // collateral_wei
    if ltv > max_ltv:
        raise ValueError(
            f"LTV {ltv / 100:.1f}% exceeds tier-{tier} max {max_ltv / 100:.1f}%"
        )

    if interest_rate_bps > max_rate:
        raise ValueError(
            f"Rate {interest_rate_bps}bps exceeds tier-{tier} cap {max_rate}bps"
        )

    request_id = f"req_{uuid.uuid4().hex[:12]}"
    record: dict[str, Any] = {
        "id": request_id,
        "borrower": borrower_address,
        "amount_wei": amount_wei,
        "collateral_wei": collateral_wei,
        "funded_wei": 0,
        "duration_secs": duration_secs,
        "interest_rate_bps": interest_rate_bps,
        "tier": tier,
        "status": "open",  # open → funded → active → repaid | liquidated
        "funders": [],  # [{lender, amount_wei, timestamp}]
        "created_at": _now(),
        "funded_at": None,
        "repaid_at": None,
    }

    all_requests = _requests_store.get("all") or {}
    all_requests[request_id] = record
    _requests_store.set("all", all_requests)

    logger.info(
        "P2P loan request created: %s by %s for %d wei (tier=%d, rate=%dbps)",
        request_id, borrower_address[:12], amount_wei, tier, interest_rate_bps,
    )
    return record


def list_open_requests() -> list[dict[str, Any]]:
    """Return all open (unfunded) loan requests, sorted newest first."""
    all_requests = _requests_store.get("all") or {}
    open_reqs = [r for r in all_requests.values() if r.get("status") == "open"]
    open_reqs.sort(key=lambda r: r.get("created_at", 0), reverse=True)
    return open_reqs


def get_request(request_id: str) -> dict[str, Any] | None:
    """Get a single loan request by ID."""
    all_requests = _requests_store.get("all") or {}
    return all_requests.get(request_id)


def fund_request(
    request_id: str,
    lender_address: str,
    amount_wei: int,
) -> dict[str, Any]:
    """Fund (partially or fully) a loan request.

    When fully funded, the request transitions to 'funded' and a loan is created.
    """
    all_requests = _requests_store.get("all") or {}
    req = all_requests.get(request_id)
    if req is None:
        raise ValueError("Request not found")
    if req["status"] != "open":
        raise ValueError(f"Request is {req['status']}, not open")
    if lender_address.lower() == req["borrower"].lower():
        raise ValueError("Cannot fund your own request")

    remaining = req["amount_wei"] - req["funded_wei"]
    fund_amount = min(amount_wei, remaining)
    if fund_amount <= 0:
        raise ValueError("Request already fully funded")

    req["funded_wei"] += fund_amount
    req["funders"].append({
        "lender": lender_address,
        "amount_wei": fund_amount,
        "timestamp": _now(),
    })

    # Check if fully funded
    if req["funded_wei"] >= req["amount_wei"]:
        req["status"] = "funded"
        req["funded_at"] = _now()
        # Create the active loan
        _activate_loan(req)

    all_requests[request_id] = req
    _requests_store.set("all", all_requests)

    logger.info(
        "P2P request %s funded %d/%d wei by %s",
        request_id, req["funded_wei"], req["amount_wei"], lender_address[:12],
    )
    return req


def cancel_request(request_id: str, borrower_address: str) -> dict[str, Any]:
    """Cancel an open loan request (only if unfunded)."""
    all_requests = _requests_store.get("all") or {}
    req = all_requests.get(request_id)
    if req is None:
        raise ValueError("Request not found")
    if req["borrower"].lower() != borrower_address.lower():
        raise ValueError("Only the borrower can cancel")
    if req["status"] != "open":
        raise ValueError(f"Cannot cancel: request is {req['status']}")
    if req["funded_wei"] > 0:
        raise ValueError("Cannot cancel: request has partial funding")

    req["status"] = "cancelled"
    all_requests[request_id] = req
    _requests_store.set("all", all_requests)
    return req


# ---------------------------------------------------------------------------
# Loan lifecycle
# ---------------------------------------------------------------------------


def _activate_loan(request: dict[str, Any]) -> dict[str, Any]:
    """Create an active loan from a fully-funded request."""
    loan_id = f"loan_{uuid.uuid4().hex[:12]}"
    loan: dict[str, Any] = {
        "id": loan_id,
        "request_id": request["id"],
        "borrower": request["borrower"],
        "amount_wei": request["amount_wei"],
        "collateral_wei": request["collateral_wei"],
        "interest_rate_bps": request["interest_rate_bps"],
        "duration_secs": request["duration_secs"],
        "funders": request["funders"],
        "status": "active",
        "activated_at": _now(),
        "due_at": _now() + request["duration_secs"],
        "repaid_amount_wei": 0,
        "repaid_at": None,
    }

    all_loans = _loans_store.get("all") or {}
    all_loans[loan_id] = loan
    _loans_store.set("all", all_loans)

    # Record in reputation
    try:
        from app.api.reputation import record_transaction_internal
        record_transaction_internal(request["borrower"], request["amount_wei"] / WEI_PER_ETH, success=True)
    except Exception:
        pass

    logger.info("P2P loan activated: %s for borrower %s", loan_id, request["borrower"][:12])
    return loan


def list_loans(user_address: str | None = None) -> list[dict[str, Any]]:
    """List loans, optionally filtered by user (borrower or lender)."""
    all_loans = _loans_store.get("all") or {}
    if user_address is None:
        return list(all_loans.values())

    addr = user_address.lower()
    return [
        l for l in all_loans.values()
        if l["borrower"].lower() == addr
        or any(f["lender"].lower() == addr for f in l.get("funders", []))
    ]


def get_loan(loan_id: str) -> dict[str, Any] | None:
    all_loans = _loans_store.get("all") or {}
    return all_loans.get(loan_id)


def repay_loan(
    loan_id: str,
    borrower_address: str,
    amount_wei: int,
) -> dict[str, Any]:
    """Repay (partially or fully) an active loan."""
    all_loans = _loans_store.get("all") or {}
    loan = all_loans.get(loan_id)
    if loan is None:
        raise ValueError("Loan not found")
    if loan["borrower"].lower() != borrower_address.lower():
        raise ValueError("Only the borrower can repay")
    if loan["status"] != "active":
        raise ValueError(f"Loan is {loan['status']}, not active")

    # Calculate total owed (principal + interest)
    elapsed = _now() - loan["activated_at"]
    interest_factor = (loan["interest_rate_bps"] * elapsed) / (BPS_DENOM * 365 * 86400)
    total_owed = int(loan["amount_wei"] * (1 + interest_factor))
    remaining = total_owed - loan["repaid_amount_wei"]

    repay_amount = min(amount_wei, remaining)
    loan["repaid_amount_wei"] += repay_amount

    if loan["repaid_amount_wei"] >= total_owed:
        loan["status"] = "repaid"
        loan["repaid_at"] = _now()
        # Good repayment → positive reputation signal
        try:
            from app.api.reputation import record_transaction_internal
            record_transaction_internal(borrower_address, loan["amount_wei"] / WEI_PER_ETH, success=True)
        except Exception:
            pass

    all_loans[loan_id] = loan
    _loans_store.set("all", all_loans)

    logger.info(
        "P2P loan %s repaid %d/%d wei by %s (status=%s)",
        loan_id, loan["repaid_amount_wei"], total_owed,
        borrower_address[:12], loan["status"],
    )
    return {**loan, "total_owed_wei": total_owed, "remaining_wei": max(0, total_owed - loan["repaid_amount_wei"])}


def liquidate_loan(loan_id: str) -> dict[str, Any]:
    """Liquidate a loan whose health factor is below threshold."""
    all_loans = _loans_store.get("all") or {}
    loan = all_loans.get(loan_id)
    if loan is None:
        raise ValueError("Loan not found")
    if loan["status"] != "active":
        raise ValueError(f"Loan is {loan['status']}, not active")

    # Check health factor
    collateral = loan["collateral_wei"]
    amount = loan["amount_wei"]
    health = (collateral * LIQUIDATION_THRESHOLD_BPS) // (amount * BPS_DENOM // BPS_DENOM)
    # Simplified: if collateral < threshold * borrowed, liquidate
    if collateral * BPS_DENOM >= amount * LIQUIDATION_THRESHOLD_BPS:
        raise ValueError("Health factor OK — cannot liquidate")

    loan["status"] = "liquidated"
    loan["repaid_at"] = _now()

    # Negative reputation signal
    try:
        from app.api.reputation import record_transaction_internal
        record_transaction_internal(loan["borrower"], amount / WEI_PER_ETH, success=False)
    except Exception:
        pass

    all_loans[loan_id] = loan
    _loans_store.set("all", all_loans)

    logger.info("P2P loan %s liquidated for borrower %s", loan_id, loan["borrower"][:12])
    return loan


def get_loan_health(loan_id: str) -> dict[str, Any]:
    """Compute current health factor for a loan."""
    loan = get_loan(loan_id)
    if loan is None:
        raise ValueError("Loan not found")

    elapsed = _now() - loan["activated_at"]
    interest_factor = (loan["interest_rate_bps"] * elapsed) / (BPS_DENOM * 365 * 86400)
    total_owed = int(loan["amount_wei"] * (1 + interest_factor))
    remaining = total_owed - loan["repaid_amount_wei"]

    collateral = loan["collateral_wei"]
    health_factor = (collateral / remaining) if remaining > 0 else 999.0

    return {
        "loan_id": loan_id,
        "health_factor": round(health_factor, 4),
        "collateral_wei": collateral,
        "total_owed_wei": total_owed,
        "remaining_wei": max(0, remaining),
        "liquidation_threshold": LIQUIDATION_THRESHOLD_BPS / BPS_DENOM,
        "at_risk": health_factor < (LIQUIDATION_THRESHOLD_BPS / BPS_DENOM),
    }
