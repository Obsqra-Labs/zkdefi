"""
Demo Engine — shadow ledger for simulated DeFi positions.

Tracks virtual allocations against live mainnet pool APYs without
on-chain writes.  Every state change produces a SHA-256 snapshot hash
suitable for L3 settlement (proof binding via vault_settlement_hook pattern).

Flow:
  1. User connects wallet → PositionScanner reads real portfolio
  2. StrategySimulator proposes moves based on live pool data
  3. User "executes" on paper → PaperTradeEngine records the virtual allocation
  4. Engine periodically marks-to-market (live APYs × duration → P&L)
  5. Snapshots are hashed and optionally settled to L3 via proof sequencer

Privacy:
  - No real assets move; shadow ledger entries are keyed by session_id
  - L3 facts are privacy-preserving (same pattern as vault_settlement_hook)
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ─── Data types ───────────────────────────────────────────────────────────────

@dataclass
class PaperPosition:
    """A single simulated allocation."""
    position_id: str
    protocol: str           # vesu | ekubo | nostra | endur | hashstack
    pool_name: str          # e.g. "Vesu ETH Genesis"
    asset_symbol: str       # ETH, USDC, xSTRK, ...
    position_type: str      # lending | staking | lp | idle
    amount_usd: float       # notional USD at entry
    entry_price: float      # asset price at entry (for mark-to-market)
    apy_at_entry: float     # APY snapshot at entry (fraction, e.g. 0.08)
    current_apy: float      # latest APY (updated on mark-to-market)
    pnl_usd: float = 0.0   # accumulated P&L
    entered_at: str = ""    # ISO timestamp
    last_mtm_at: str = ""   # last mark-to-market timestamp
    closed: bool = False
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PaperTradeSession:
    """One user's paper trading session."""
    session_id: str
    wallet_address: str
    created_at: str
    positions: List[PaperPosition] = field(default_factory=list)
    snapshots: List[Dict[str, Any]] = field(default_factory=list)
    total_value_usd: float = 0.0        # current portfolio value
    starting_value_usd: float = 0.0     # value at session creation
    total_pnl_usd: float = 0.0
    total_pnl_pct: float = 0.0
    last_snapshot_hash: str = ""
    closed: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SessionSnapshot:
    """Point-in-time snapshot of a simulated trade session."""
    snapshot_id: str
    session_id: str
    timestamp: str
    total_value_usd: float
    total_pnl_usd: float
    total_pnl_pct: float
    position_count: int
    snapshot_hash: str          # SHA-256 for proof binding

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ─── Engine ───────────────────────────────────────────────────────────────────

# In-memory session store (keyed by session_id)
_sessions: Dict[str, PaperTradeSession] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_snapshot_hash(session: PaperTradeSession) -> str:
    """Deterministic hash of session state for proof binding."""
    canon = json.dumps(
        {
            "session_id": session.session_id,
            "wallet": session.wallet_address,
            "total_value_usd": round(session.total_value_usd, 6),
            "total_pnl_usd": round(session.total_pnl_usd, 6),
            "positions": [
                {
                    "id": p.position_id,
                    "protocol": p.protocol,
                    "asset": p.asset_symbol,
                    "amount_usd": round(p.amount_usd, 6),
                    "pnl_usd": round(p.pnl_usd, 6),
                }
                for p in session.positions
                if not p.closed
            ],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return "0x" + hashlib.sha256(canon.encode()).hexdigest()


def create_session(wallet_address: str, starting_value_usd: float = 0.0) -> PaperTradeSession:
    """Create a new paper trading session for a wallet."""
    session = PaperTradeSession(
        session_id=f"pts_{uuid.uuid4().hex[:16]}",
        wallet_address=wallet_address.strip().lower(),
        created_at=_now_iso(),
        starting_value_usd=starting_value_usd,
        total_value_usd=starting_value_usd,
    )
    session.last_snapshot_hash = _compute_snapshot_hash(session)
    _sessions[session.session_id] = session
    logger.info("Paper trade session created: %s wallet=%s", session.session_id, wallet_address[:20])
    return session


def get_session(session_id: str) -> Optional[PaperTradeSession]:
    """Retrieve a session by ID."""
    return _sessions.get(session_id)


def get_sessions_for_wallet(wallet_address: str) -> List[PaperTradeSession]:
    """Get all sessions for a wallet."""
    wallet = wallet_address.strip().lower()
    return [s for s in _sessions.values() if s.wallet_address == wallet and not s.closed]


def open_position(
    session_id: str,
    protocol: str,
    pool_name: str,
    asset_symbol: str,
    position_type: str,
    amount_usd: float,
    entry_price: float,
    apy: float,
    extra: Optional[Dict[str, Any]] = None,
) -> Optional[PaperPosition]:
    """Add a new virtual position to a session."""
    session = _sessions.get(session_id)
    if not session or session.closed:
        return None

    pos = PaperPosition(
        position_id=f"pp_{uuid.uuid4().hex[:12]}",
        protocol=protocol,
        pool_name=pool_name,
        asset_symbol=asset_symbol,
        position_type=position_type,
        amount_usd=amount_usd,
        entry_price=entry_price,
        apy_at_entry=apy,
        current_apy=apy,
        entered_at=_now_iso(),
        last_mtm_at=_now_iso(),
        extra=extra or {},
    )
    session.positions.append(pos)
    session.total_value_usd += amount_usd
    session.last_snapshot_hash = _compute_snapshot_hash(session)
    return pos


def close_position(session_id: str, position_id: str) -> bool:
    """Close a virtual position."""
    session = _sessions.get(session_id)
    if not session:
        return False
    for pos in session.positions:
        if pos.position_id == position_id and not pos.closed:
            pos.closed = True
            session.total_value_usd -= (pos.amount_usd + pos.pnl_usd)
            session.last_snapshot_hash = _compute_snapshot_hash(session)
            return True
    return False


def mark_to_market(
    session_id: str,
    current_apys: Optional[Dict[str, float]] = None,
) -> Optional[PaperTradeSession]:
    """
    Re-price all open positions using elapsed time × APY.

    current_apys: optional {pool_name: apy_fraction} to update live rates.
    If not provided, uses the last known APY for each position.
    """
    session = _sessions.get(session_id)
    if not session or session.closed:
        return None

    now = time.time()
    now_iso = _now_iso()
    total_pnl = 0.0
    total_value = session.starting_value_usd

    for pos in session.positions:
        if pos.closed:
            total_pnl += pos.pnl_usd
            continue

        # Update APY if fresh data available
        if current_apys and pos.pool_name in current_apys:
            pos.current_apy = current_apys[pos.pool_name]

        # Calculate time-weighted P&L
        last_mtm = datetime.fromisoformat(pos.last_mtm_at)
        elapsed_seconds = (datetime.now(timezone.utc) - last_mtm).total_seconds()
        elapsed_years = elapsed_seconds / (365.25 * 24 * 3600)

        period_pnl = pos.amount_usd * pos.current_apy * elapsed_years
        pos.pnl_usd += period_pnl
        pos.last_mtm_at = now_iso

        total_pnl += pos.pnl_usd
        total_value += pos.amount_usd + pos.pnl_usd

    session.total_pnl_usd = total_pnl
    session.total_value_usd = total_value
    session.total_pnl_pct = (total_pnl / session.starting_value_usd * 100) if session.starting_value_usd > 0 else 0.0
    session.last_snapshot_hash = _compute_snapshot_hash(session)

    return session


def take_snapshot(session_id: str) -> Optional[SessionSnapshot]:
    """
    Capture a point-in-time snapshot of the session.

    Returns a SessionSnapshot with a deterministic hash for L3 settlement.
    """
    session = _sessions.get(session_id)
    if not session:
        return None

    # Mark to market first
    mark_to_market(session_id)

    snap = SessionSnapshot(
        snapshot_id=f"snap_{uuid.uuid4().hex[:12]}",
        session_id=session_id,
        timestamp=_now_iso(),
        total_value_usd=session.total_value_usd,
        total_pnl_usd=session.total_pnl_usd,
        total_pnl_pct=session.total_pnl_pct,
        position_count=len([p for p in session.positions if not p.closed]),
        snapshot_hash=session.last_snapshot_hash,
    )
    session.snapshots.append(snap.to_dict())
    return snap


async def settle_snapshot_to_l3(snapshot: SessionSnapshot) -> Optional[Dict[str, Any]]:
    """
    Post a demo snapshot fact to L3 via the existing Madara batch queue.

    Uses the same privacy-preserving pattern as vault_settlement_hook:
    fact_hash = SHA-256(PAPER_TRADE | snapshot_hash | session_id | salt)
    """
    try:
        from app.api.routes.madara_settlement import _batch_queue
        from app.services.vault_settlement_hook import _compute_fact_hash, ANONYMOUS_ADDRESS

        fact_hash = _compute_fact_hash(
            "PAPER_TRADE",
            snapshot.snapshot_hash,
            snapshot.session_id,
        )
        item = _batch_queue.add(
            fact_hash=fact_hash,
            proof_type="trade_snapshot",
            user_address=ANONYMOUS_ADDRESS,
        )
        logger.info(
            "L3 demo fact queued: %s (batch_id=%s, pnl=$%.2f)",
            fact_hash[:16], item.id, snapshot.total_pnl_usd,
        )

        # Auto-flush if batch threshold reached
        if _batch_queue.should_flush():
            from app.services.vault_settlement_hook import _try_flush_batch
            await _try_flush_batch()

        return {
            "fact_hash": fact_hash,
            "batch_item_id": item.id,
            "status": "queued",
            "snapshot_hash": snapshot.snapshot_hash,
        }
    except Exception as exc:
        logger.warning("L3 demo settlement failed: %s", exc)
        return None


def close_session(session_id: str) -> bool:
    """Close a simulated trade session (no further trades allowed)."""
    session = _sessions.get(session_id)
    if not session:
        return False
    session.closed = True
    # Final mark-to-market
    mark_to_market(session_id)
    logger.info(
        "Paper trade session closed: %s pnl=$%.2f (%.2f%%)",
        session_id, session.total_pnl_usd, session.total_pnl_pct,
    )
    return True


def list_active_sessions(limit: int = 50) -> List[Dict[str, Any]]:
    """List all active (non-closed) sessions."""
    active = [s for s in _sessions.values() if not s.closed]
    active.sort(key=lambda s: s.created_at, reverse=True)
    return [
        {
            "session_id": s.session_id,
            "wallet_address": s.wallet_address,
            "created_at": s.created_at,
            "total_value_usd": s.total_value_usd,
            "total_pnl_usd": s.total_pnl_usd,
            "total_pnl_pct": s.total_pnl_pct,
            "position_count": len([p for p in s.positions if not p.closed]),
            "snapshot_count": len(s.snapshots),
        }
        for s in active[:limit]
    ]
