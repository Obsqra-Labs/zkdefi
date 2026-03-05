"""ActionIntent + GuardResult — canonical types for the execution guard pipeline.

Every strategy bot / rebalancer / manual route builds an ActionIntent before
any on-chain call.  execution_guard.check(intent) returns a GuardResult that
must be ``allowed`` before the backend signs or forwards the transaction.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class ActionIntent:
    """A *proposed* on-chain action that has not yet been executed."""

    # Who is requesting
    user_address: str

    # Strategy tag  –  "lp_recenter" | "limit_grid" | "rebalance" | "manual" | …
    strategy: str

    # Full multicall calldata bundle (list of {contract, entrypoint, calldata})
    calldata_bundle: List[Dict[str, Any]] = field(default_factory=list)

    # Expected edge in basis points (e.g. 15 = 0.15 %).  0 means "no claim".
    expected_edge_bps: int = 0

    # Notional value of the trade in wei (token0 terms).
    notional_wei: int = 0

    # SHA-256 of the active VaultPolicy at proposal time.
    policy_hash: str = ""

    # Optional recommendation hash (from the AI / zkML engine).
    rec_hash: str = ""

    # Arbitrary key-value metadata (logged to audit trail).
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Timestamp (UTC ISO-8601) when the intent was created.
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def intent_hash(self) -> str:
        """Deterministic SHA-256 digest of the intent (for audit / dedup)."""
        blob = json.dumps(
            {
                "user": self.user_address,
                "strategy": self.strategy,
                "calldata": self.calldata_bundle,
                "edge": self.expected_edge_bps,
                "notional": self.notional_wei,
                "policy": self.policy_hash,
                "rec": self.rec_hash,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return "0x" + hashlib.sha256(blob.encode()).hexdigest()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class GuardResult:
    """Result returned by ``execution_guard.check()``."""

    allowed: bool
    reason: str = ""

    # The policy hash that was evaluated.
    policy_hash: str = ""

    # Individual check outcomes (for diagnostics / audit).
    checks: Dict[str, bool] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
