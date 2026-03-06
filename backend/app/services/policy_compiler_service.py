"""Policy compiler service for Vault OS execution routing.

Architecture (see docs/plans/VAULT_AND_PRIVACY_ARCHITECTURE.md):
- execution_path: Privacy semantics for the same logical user vault (Track A).
  Values like full_privacy_pool, shielded_pool, hashed_withdraw_pool select *how*
  deposit/withdraw are proven (proof type, relayer), not which pool contract.
- shared_pool_id: When set, effective policy is computed for a shared pool (Track B)
  that the AI can manage; otherwise the user's personal vault profile (Track A) applies.
"""

from __future__ import annotations

import copy
from typing import Any

from app.services.shared_pool_service import get_shared_pool_service
from app.services.vault_policy_service import get_vault_policy_service


_PATH_PROOFS = {
    "shielded_pool": ["shielded_balance_proof"],
    "full_privacy_pool": ["privacy_merkle_proof", "nullifier_proof"],
    "hashed_withdraw_pool": ["hashed_claim_proof", "nullifier_proof"],
    "internal_ledger": ["internal_ledger_proof"],
}


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip().lower()

def _normalize_token(value: str | None) -> str:
    raw = _normalize_text(value)
    if not raw:
        return ""
    if raw.startswith("0x"):
        body = raw[2:].lstrip("0")
        return f"0x{body or '0'}"
    return raw


class PolicyCompilerService:
    def __init__(self) -> None:
        self.vault_policy_service = get_vault_policy_service()
        self.shared_pool_service = get_shared_pool_service()

    def compile(self, request: dict[str, Any]) -> dict[str, Any]:
        user_address = str(request.get("user_address") or "").strip()
        action_type = _normalize_text(request.get("action_type") or "deposit")
        execution_intent = _normalize_text(request.get("execution_intent") or "manual_wallet")
        wallet_connected = bool(request.get("wallet_connected", False))
        shared_pool_id = _normalize_text(request.get("shared_pool_id"))
        member_address = str(request.get("member_address") or user_address).strip()
        context = request.get("context") if isinstance(request.get("context"), dict) else {}

        base_policy = self.vault_policy_service.get_policy(member_address or user_address, create_if_missing=True)
        if not base_policy:
            raise ValueError("unable to load policy profile")

        effective_policy = copy.deepcopy(base_policy)
        if shared_pool_id:
            effective_policy = self.shared_pool_service.compute_effective_policy(
                shared_pool_id,
                effective_policy,
                member_address=member_address or user_address,
            )

        execution_path = self._resolve_privacy_path(effective_policy)
        legacy_preset_label = self._legacy_preset_label(effective_policy)

        blocking_reasons: list[str] = []
        warnings: list[str] = []

        strategy_allowed = self._action_allowed_by_strategy(action_type, effective_policy)
        if not strategy_allowed:
            blocking_reasons.append("action_not_enabled_by_strategy_permissions")

        if effective_policy.get("execution_policy", {}).get("emergency_pause"):
            blocking_reasons.append("emergency_pause_enabled")

        token_in = _normalize_token(context.get("token_in") if isinstance(context, dict) else "")
        token_out = _normalize_token(context.get("token_out") if isinstance(context, dict) else "")
        venue = _normalize_text(context.get("venue") if isinstance(context, dict) else "")

        if action_type in {"swap", "lp_add", "lp_remove", "deploy"}:
            if not venue:
                warnings.append("missing_venue_context")
            if action_type in {"swap", "lp_add", "lp_remove"} and not (token_in or token_out):
                warnings.append("missing_token_context")

        if token_in or token_out:
            token_allow = [
                _normalize_token(item)
                for item in effective_policy.get("token_allowlist", [])
                if isinstance(item, str)
            ]
            if token_allow:
                if token_in and token_in not in token_allow:
                    blocking_reasons.append("token_in_not_allowlisted")
                if token_out and token_out not in token_allow:
                    blocking_reasons.append("token_out_not_allowlisted")

        if venue:
            venue_allow = [
                _normalize_text(item)
                for item in effective_policy.get("venue_allowlist", [])
                if isinstance(item, str)
            ]
            if venue_allow and venue not in venue_allow:
                blocking_reasons.append("venue_not_allowlisted")

        privacy_policy = effective_policy.get("privacy_policy", {})
        settlement_mode = _normalize_text(privacy_policy.get("settlement_mode") if isinstance(privacy_policy, dict) else "")
        if settlement_mode == "internal_ledger":
            warnings.append("internal_ledger_not_available_v1")
            blocking_reasons.append("internal_ledger_not_available_v1")

        gate_required, advisory_only = self._gate_matrix(execution_intent, wallet_connected)

        required_proofs = list(_PATH_PROOFS.get(execution_path, []))
        if gate_required:
            required_proofs.extend(["zkml_risk_proof", "zkml_anomaly_proof"])
        if execution_intent in {"autonomous", "session"}:
            required_proofs.append("session_scope_proof")

        can_execute = len(blocking_reasons) == 0

        return {
            "effective_policy_hash": self.vault_policy_service.policy_hash(effective_policy),
            "execution_path": execution_path,
            "legacy_preset_label": legacy_preset_label,
            "required_proofs": required_proofs,
            "requires_relayer": self._requires_relayer(execution_path, effective_policy),
            "gate_required": gate_required,
            "advisory_only": advisory_only,
            "can_execute": can_execute,
            "blocking_reasons": blocking_reasons,
            "warnings": warnings,
            "effective_policy": effective_policy,
        }

    @staticmethod
    def _action_allowed_by_strategy(action_type: str, policy: dict[str, Any]) -> bool:
        if action_type in {"deposit", "withdraw", "privacy_deposit", "privacy_withdraw"}:
            return True

        strategy = policy.get("strategy_permissions") or {}
        enable_lp = bool(strategy.get("enable_lp", False))
        enable_rotation = bool(strategy.get("enable_rotation", False))
        enable_rebalance = bool(strategy.get("enable_rebalance", False))
        enable_dca = bool(strategy.get("enable_dca", False))

        if action_type in {"lp_add", "lp_remove"}:
            return enable_lp
        if action_type in {"swap", "rotate"}:
            return enable_rotation or enable_rebalance or enable_dca
        if action_type in {"deploy", "rebalance"}:
            return enable_rebalance or enable_lp or enable_rotation
        return True

    @staticmethod
    def _resolve_privacy_path(policy: dict[str, Any]) -> str:
        privacy = policy.get("privacy_policy") or {}
        settlement = _normalize_text(privacy.get("settlement_mode") if isinstance(privacy, dict) else "")
        hide_amounts = bool(privacy.get("hide_amounts", False))
        hide_recipient = bool(privacy.get("hide_recipient", False))

        if settlement == "internal_ledger":
            return "internal_ledger"
        if settlement == "hashed_claim":
            return "hashed_withdraw_pool"
        if hide_amounts and hide_recipient:
            return "full_privacy_pool"
        if hide_amounts:
            return "shielded_pool"
        return "shielded_pool"

    @staticmethod
    def _legacy_preset_label(policy: dict[str, Any]) -> str:
        preset = _normalize_text((policy.get("privacy_policy") or {}).get("preset"))
        if preset in {"unlinkable_basic", "preset_unlinkable_basic"}:
            return "pool_a"
        if preset in {"hidden_flow", "preset_hidden_flow"}:
            return "pool_b"
        if preset in {"hashed_claims", "preset_hashed_claims"}:
            return "pool_d"
        return "none"

    @staticmethod
    def _requires_relayer(execution_path: str, policy: dict[str, Any]) -> bool:
        privacy = policy.get("privacy_policy") or {}
        relay_mode = _normalize_text(privacy.get("relay_mode") if isinstance(privacy, dict) else "")
        if relay_mode == "required":
            return True
        if execution_path in {"full_privacy_pool", "hashed_withdraw_pool"} and relay_mode in {"optional", "required"}:
            return True
        return False

    @staticmethod
    def _gate_matrix(execution_intent: str, wallet_connected: bool) -> tuple[bool, bool]:
        if execution_intent == "manual_wallet" and wallet_connected:
            return False, True
        if execution_intent in {"autonomous", "session"}:
            return True, False
        return True, False


_policy_compiler_service: PolicyCompilerService | None = None


def get_policy_compiler_service() -> PolicyCompilerService:
    global _policy_compiler_service
    if _policy_compiler_service is None:
        _policy_compiler_service = PolicyCompilerService()
    return _policy_compiler_service
