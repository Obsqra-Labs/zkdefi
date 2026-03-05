"""
Audit Trail Service - Immutable decision ledger for zkML/autonomous actions.

Records every rebalance decision, position creation, and transfer so that
proof-gated actions can be inspected, verified, and exported for compliance.
No synthetic data – entries only appear when real events occur.
"""

from __future__ import annotations

import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

logger = logging.getLogger(__name__)


class DecisionType(str, Enum):
    POSITION_CREATED = "position_created"
    REBALANCE = "rebalance"
    TRANSFER = "transfer"
    ALLOCATION = "allocation"
    RISK_CHECK = "risk_check"
    ANOMALY = "anomaly"
    COMPLIANCE = "compliance"


@dataclass
class AuditEntry:
    decision_id: str
    decision_type: DecisionType
    position_id: Optional[str]
    user_address: Optional[str]
    model_version: int
    model_hash: Optional[str]
    inputs: dict
    outputs: dict
    trigger_reason: Optional[str]
    tx_hash: Optional[str]
    verified: bool
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return {
            "decision_id": self.decision_id,
            "decision_type": self.decision_type.value,
            "position_id": self.position_id,
            "user_address": self.user_address,
            "model_version": self.model_version,
            "model_hash": self.model_hash,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "trigger_reason": self.trigger_reason,
            "tx_hash": self.tx_hash,
            "verified": self.verified,
            "timestamp": self.timestamp,
        }


class AuditTrailService:
    """
    In-memory audit ledger.  Entries are appended on every recorded action
    and exposed via read-only query methods.  On-chain verification is
    optional – callers call verify_entry() once a tx_hash is available.
    """

    def __init__(self) -> None:
        self.entries: List[AuditEntry] = []

    # ------------------------------------------------------------------
    # Write helpers
    # ------------------------------------------------------------------

    def _append(self, entry: AuditEntry) -> AuditEntry:
        self.entries.append(entry)
        logger.info(
            "audit[%s] %s pos=%s verified=%s",
            entry.decision_id[:8],
            entry.decision_type.value,
            entry.position_id,
            entry.verified,
        )
        return entry

    def record_position_created(
        self,
        position_id: str,
        user_address: str,
        token_a: str,
        token_b: str,
        amount: float,
        fee_tier: int,
        model_version: int,
        model_hash: Optional[str],
    ) -> AuditEntry:
        entry = AuditEntry(
            decision_id=str(uuid.uuid4()),
            decision_type=DecisionType.POSITION_CREATED,
            position_id=position_id,
            user_address=user_address,
            model_version=model_version,
            model_hash=model_hash,
            inputs={"token_a": token_a, "token_b": token_b, "amount": amount, "fee_tier": fee_tier},
            outputs={},
            trigger_reason="new_position",
            tx_hash=None,
            verified=False,
        )
        return self._append(entry)

    def record_rebalance_decision(
        self,
        position_id: str,
        user_address: str,
        current_apy: float,
        optimal_apy: float,
        current_fee_tier: int,
        optimal_fee_tier: int,
        pool_utilization: float,
        trigger_reason: str,
        model_version: int,
        model_hash: Optional[str],
    ) -> AuditEntry:
        entry = AuditEntry(
            decision_id=str(uuid.uuid4()),
            decision_type=DecisionType.REBALANCE,
            position_id=position_id,
            user_address=user_address,
            model_version=model_version,
            model_hash=model_hash,
            inputs={
                "current_apy": current_apy,
                "optimal_apy": optimal_apy,
                "current_fee_tier": current_fee_tier,
                "optimal_fee_tier": optimal_fee_tier,
                "pool_utilization": pool_utilization,
            },
            outputs={"action": "rebalance"},
            trigger_reason=trigger_reason,
            tx_hash=None,
            verified=False,
        )
        return self._append(entry)

    def record_transfer_executed(
        self,
        transfer_id: str,
        from_address: str,
        to_address: str,
        amount_hidden: bool,
        model_version: int,
        model_hash: Optional[str],
    ) -> AuditEntry:
        entry = AuditEntry(
            decision_id=transfer_id,
            decision_type=DecisionType.TRANSFER,
            position_id=None,
            user_address=from_address,
            model_version=model_version,
            model_hash=model_hash,
            inputs={"from": from_address, "to": to_address, "amount_hidden": amount_hidden},
            outputs={},
            trigger_reason="confidential_transfer",
            tx_hash=None,
            verified=False,
        )
        return self._append(entry)

    def verify_entry(self, entry: AuditEntry, tx_hash: str) -> None:
        """Mark an entry as verified once a tx hash is available."""
        entry.tx_hash = tx_hash
        entry.verified = True

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    def get_recent_decisions(self, limit: int = 20) -> List[dict]:
        sorted_entries = sorted(self.entries, key=lambda e: e.timestamp, reverse=True)
        return [e.to_dict() for e in sorted_entries[:limit]]

    def get_position_audit_trail(self, position_id: str) -> List[AuditEntry]:
        return [e for e in self.entries if e.position_id == position_id]

    def get_model_version_decisions(self, model_version: str) -> List[dict]:
        try:
            mv = int(model_version)
        except (TypeError, ValueError):
            mv = None
        results = [
            e for e in self.entries
            if (mv is None or e.model_version == mv)
        ]
        return [e.to_dict() for e in results]

    def get_statistics(self) -> dict:
        total = len(self.entries)
        verified = sum(1 for e in self.entries if e.verified)
        type_counts: dict = {}
        for e in self.entries:
            type_counts[e.decision_type.value] = type_counts.get(e.decision_type.value, 0) + 1
        return {
            "total_decisions": total,
            "verified_decisions": verified,
            "unverified_decisions": total - verified,
            "decision_types": type_counts,
        }

    def get_compliance_report(self) -> dict:
        stats = self.get_statistics()
        total = stats["total_decisions"]
        verified = stats["verified_decisions"]

        pct = round((verified / total * 100), 1) if total > 0 else 0.0

        return {
            "zkml_completion": f"{pct}%",
            "total_decisions": total,
            "verified_decisions": verified,
            "verification_rate": pct,
            "status": "compliant" if pct >= 80 or total == 0 else "review_needed",
            "decision_breakdown": stats["decision_types"],
        }
