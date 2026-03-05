"""Shared pool proposal execution service."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.policy_compiler_service import get_policy_compiler_service
from app.services.receipt_service import get_receipt_service
from app.services.shared_pool_service import get_shared_pool_service


class SharedPoolExecutor:
    def __init__(self) -> None:
        self.pool_service = get_shared_pool_service()
        self.compiler = get_policy_compiler_service()
        self.receipt_service = get_receipt_service()

    async def execute(
        self,
        *,
        shared_pool_id: str,
        proposal_id: str,
        member_address: str,
        execution_intent: str,
        wallet_connected: bool,
    ) -> dict[str, Any]:
        proposal = self.pool_service.get_proposal(shared_pool_id, proposal_id)
        if not proposal:
            raise ValueError("proposal not found")

        payload = proposal.get("payload") if isinstance(proposal.get("payload"), dict) else {}
        action_type = str(payload.get("action_type") or "rebalance")

        compile_result = self.compiler.compile(
            {
                "user_address": member_address,
                "member_address": member_address,
                "shared_pool_id": shared_pool_id,
                "action_type": action_type,
                "execution_intent": execution_intent,
                "wallet_connected": wallet_connected,
                "context": payload.get("context") if isinstance(payload.get("context"), dict) else {},
            }
        )

        allowed = bool(compile_result.get("can_execute", False))
        status = "blocked"
        reason = None

        member_policy = self.pool_service.get_member(shared_pool_id, member_address)
        if not member_policy:
            raise ValueError("member policy not found")

        if execution_intent in {"autonomous", "session"}:
            session_scope = member_policy.get("session_scope") if isinstance(member_policy.get("session_scope"), dict) else {}
            if not session_scope.get("enabled"):
                allowed = False
                compile_result.setdefault("blocking_reasons", []).append("member_session_scope_disabled")
            else:
                expires_at = session_scope.get("expires_at")
                if expires_at:
                    try:
                        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                        if expiry.tzinfo is None:
                            expiry = expiry.replace(tzinfo=timezone.utc)
                        if datetime.now(timezone.utc) > expiry:
                            allowed = False
                            compile_result.setdefault("blocking_reasons", []).append("member_session_scope_expired")
                    except Exception:
                        pass
                try:
                    max_notional = float(session_scope.get("max_notional_usd", 0))
                    proposal_notional = float(payload.get("notional_usd", 0))
                    if max_notional > 0 and proposal_notional > max_notional:
                        allowed = False
                        compile_result.setdefault("blocking_reasons", []).append("member_session_scope_notional_exceeded")
                except Exception:
                    pass

        if allowed:
            status = "executed"
            self.pool_service.update_proposal(
                shared_pool_id,
                proposal_id,
                {
                    "status": "executed",
                    "executed_by": member_address,
                    "executed_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        else:
            status = "blocked"
            reasons = compile_result.get("blocking_reasons") or []
            reason = reasons[0] if reasons else "policy_blocked"
            self.pool_service.update_proposal(
                shared_pool_id,
                proposal_id,
                {
                    "status": "blocked",
                    "blocked_for": member_address,
                    "blocked_at": datetime.now(timezone.utc).isoformat(),
                    "reason": reason,
                },
            )

        receipt = self.receipt_service.append_shared_pool_execution_receipt(
            shared_pool_id=shared_pool_id,
            manager_address=str(proposal.get("manager_address") or ""),
            member_address=member_address,
            proposal_id=proposal_id,
            status=status,
            compile_hash=compile_result.get("effective_policy_hash"),
            reason=reason,
        )

        return {
            "shared_pool_id": shared_pool_id,
            "proposal_id": proposal_id,
            "member_address": member_address,
            "status": status,
            "compile": {k: v for k, v in compile_result.items() if k != "effective_policy"},
            "receipt_id": receipt.get("receipt_id"),
            "reason": reason,
        }


_shared_pool_executor: SharedPoolExecutor | None = None


def get_shared_pool_executor() -> SharedPoolExecutor:
    global _shared_pool_executor
    if _shared_pool_executor is None:
        _shared_pool_executor = SharedPoolExecutor()
    return _shared_pool_executor
