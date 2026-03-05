"""Vault policy service (file-backed, deterministic schema)."""

from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
POLICY_FILE = DATA_DIR / "vault_policies.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_address(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    without = raw[2:] if raw.startswith("0x") else raw
    stripped = without.lstrip("0")
    return f"0x{stripped or '0'}"


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _read_all() -> dict[str, dict[str, Any]]:
    if not POLICY_FILE.exists():
        return {}
    try:
        payload = json.loads(POLICY_FILE.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return {str(k): v for k, v in payload.items() if isinstance(v, dict)}
    except Exception:
        pass
    return {}


def _write_all(policies: dict[str, dict[str, Any]]) -> None:
    POLICY_FILE.parent.mkdir(parents=True, exist_ok=True)
    POLICY_FILE.write_text(json.dumps(policies, indent=2, sort_keys=True), encoding="utf-8")


def _profile_id_for(user_address: str, mode: str = "personal") -> str:
    h = hashlib.sha256(f"{user_address}:{mode}".encode("utf-8")).hexdigest()[:24]
    return f"vpol_{h}"


def _default_risk_budget() -> dict[str, int]:
    return {
        "max_drawdown_bps": 1500,
        "max_daily_turnover_bps": 2000,
        "max_position_pct": 35,
    }


def _default_strategy_permissions() -> dict[str, bool]:
    return {
        "enable_dca": True,
        "enable_lp": True,
        "enable_rotation": True,
        "enable_rebalance": True,
    }


def _default_execution_policy() -> dict[str, Any]:
    return {
        "mode": "assist",
        "session_max_notional_usd": 500,
        "session_duration_hours": 24,
        "emergency_pause": False,
        "cooldown_seconds": 300,
        # Strategy-expansion fields (guard reads these)
        "allowed_strategies": [],  # empty = all strategies allowed
        "min_expected_edge_bps": 0,  # 0 = no min-edge check
        "max_oracle_age_sec": 120,  # default 2 min oracle staleness
        "max_daily_notional_wei": 0,  # 0 = unlimited
        "max_trade_notional_wei": 0,  # 0 = unlimited
    }


def _default_disclosure_policy() -> dict[str, bool]:
    return {
        "allow_balance_proof": True,
        "allow_risk_proof": True,
        "allow_performance_proof": False,
    }


def _default_privacy_policy(preset: str = "unlinkable_basic") -> dict[str, Any]:
    if preset == "hidden_flow":
        return {
            "preset": "hidden_flow",
            "hide_amounts": True,
            "hide_recipient": True,
            "hide_sender": True,
            "use_nullifier": True,
            "settlement_mode": "public_transfer",
            "relay_mode": "required",
            "max_relayer_delay_seconds": 600,
        }
    if preset == "hashed_claims":
        return {
            "preset": "hashed_claims",
            "hide_amounts": True,
            "hide_recipient": True,
            "hide_sender": True,
            "use_nullifier": True,
            "settlement_mode": "hashed_claim",
            "relay_mode": "required",
            "max_relayer_delay_seconds": 1200,
        }
    return {
        "preset": "unlinkable_basic",
        "hide_amounts": True,
        "hide_recipient": False,
        "hide_sender": True,
        "use_nullifier": True,
        "settlement_mode": "public_transfer",
        "relay_mode": "optional",
        "max_relayer_delay_seconds": 1200,
    }


class VaultPolicyService:
    def get_policy(self, user_address: str, create_if_missing: bool = True) -> dict[str, Any] | None:
        addr = _normalize_address(user_address)
        if not addr:
            return None

        policies = _read_all()
        found = policies.get(addr)
        if found:
            result = copy.deepcopy(found)
            # Backfill any new default fields that were added after this
            # policy was originally created (non-destructive merge).
            ep = result.get("execution_policy", {})
            defaults = _default_execution_policy()
            changed = False
            for key, default_val in defaults.items():
                if key not in ep:
                    ep[key] = default_val
                    changed = True
            if changed:
                result["execution_policy"] = ep
                # Persist the backfilled version
                policies[addr] = result
                _write_all(policies)
            return result

        if not create_if_missing:
            return None

        created = self._build_default_policy(addr)
        policies[addr] = created
        _write_all(policies)
        return copy.deepcopy(created)

    def put_policy(self, user_address: str, patch: dict[str, Any]) -> dict[str, Any]:
        addr = _normalize_address(user_address)
        if not addr:
            raise ValueError("user_address is required")

        current = self.get_policy(addr, create_if_missing=True) or self._build_default_policy(addr)
        cleaned_patch = copy.deepcopy(patch or {})
        cleaned_patch.pop("profile_id", None)
        cleaned_patch.pop("user_address", None)
        cleaned_patch.pop("updated_at", None)

        merged = _deep_merge(current, cleaned_patch)
        merged["profile_id"] = current.get("profile_id") or _profile_id_for(addr, merged.get("mode", "personal"))
        merged["user_address"] = addr
        merged["mode"] = "shared_member" if merged.get("mode") == "shared_member" else "personal"
        merged["updated_at"] = _now_iso()

        policies = _read_all()
        policies[addr] = merged
        _write_all(policies)
        return copy.deepcopy(merged)

    def ensure_default_policy(
        self,
        user_address: str,
        *,
        mode: str = "personal",
        onboarding_hints: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        addr = _normalize_address(user_address)
        if not addr:
            raise ValueError("user_address is required")

        existing = self.get_policy(addr, create_if_missing=False)
        if existing:
            return existing

        policy = self._build_default_policy(addr, mode=mode)
        if onboarding_hints:
            risk_tolerance = onboarding_hints.get("risk_tolerance")
            max_position_wei = onboarding_hints.get("max_position")
            session_duration = onboarding_hints.get("session_duration")

            if isinstance(risk_tolerance, int):
                if risk_tolerance <= 35:
                    policy["risk_budget"]["max_drawdown_bps"] = 900
                    policy["risk_budget"]["max_daily_turnover_bps"] = 1200
                    policy["strategy_permissions"]["enable_rotation"] = False
                elif risk_tolerance >= 65:
                    policy["risk_budget"]["max_drawdown_bps"] = 2500
                    policy["risk_budget"]["max_daily_turnover_bps"] = 4000
            if isinstance(session_duration, int) and session_duration > 0:
                policy["execution_policy"]["session_duration_hours"] = min(session_duration, 168)
            if isinstance(max_position_wei, str) and max_position_wei.isdigit():
                try:
                    max_position_eth = int(max_position_wei) / float(10**18)
                    session_max_notional = max(100.0, min(25_000.0, max_position_eth * 2500.0))
                    policy["execution_policy"]["session_max_notional_usd"] = round(session_max_notional, 2)
                except Exception:
                    pass

        policies = _read_all()
        policies[addr] = policy
        _write_all(policies)
        return copy.deepcopy(policy)

    def upsert_from_onboarding(
        self,
        user_address: str,
        onboarding_hints: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Apply onboarding hints to a user's policy even if it already exists.
        This keeps onboarding as a live source for risk/session defaults.
        """
        addr = _normalize_address(user_address)
        if not addr:
            raise ValueError("user_address is required")

        current = self.get_policy(addr, create_if_missing=True) or self._build_default_policy(addr)
        if not onboarding_hints:
            return current

        patch: dict[str, Any] = {
            "mode": "personal",
            "risk_budget": {},
            "execution_policy": {},
            "strategy_permissions": {},
        }

        risk_tolerance = onboarding_hints.get("risk_tolerance")
        session_duration = onboarding_hints.get("session_duration")
        max_position_wei = onboarding_hints.get("max_position")

        if isinstance(risk_tolerance, int):
            if risk_tolerance <= 35:
                patch["risk_budget"]["max_drawdown_bps"] = 900
                patch["risk_budget"]["max_daily_turnover_bps"] = 1200
                patch["strategy_permissions"]["enable_rotation"] = False
            elif risk_tolerance >= 65:
                patch["risk_budget"]["max_drawdown_bps"] = 2500
                patch["risk_budget"]["max_daily_turnover_bps"] = 4000
                patch["strategy_permissions"]["enable_rotation"] = True

        if isinstance(session_duration, int) and session_duration > 0:
            patch["execution_policy"]["session_duration_hours"] = min(session_duration, 168)

        if isinstance(max_position_wei, str) and max_position_wei.isdigit():
            try:
                max_position_eth = int(max_position_wei) / float(10**18)
                session_max_notional = max(100.0, min(25_000.0, max_position_eth * 2500.0))
                patch["execution_policy"]["session_max_notional_usd"] = round(session_max_notional, 2)
            except Exception:
                pass

        # Strategy-expansion fields from onboarding constraints
        execution_mode = onboarding_hints.get("execution_mode")
        if isinstance(execution_mode, str) and execution_mode in ("assist", "autonomous", "monitor"):
            patch["execution_policy"]["mode"] = execution_mode

        allowed_strategies = onboarding_hints.get("allowed_strategies")
        if isinstance(allowed_strategies, list):
            patch["execution_policy"]["allowed_strategies"] = allowed_strategies

        min_edge = onboarding_hints.get("min_expected_edge_bps")
        if isinstance(min_edge, int) and min_edge > 0:
            patch["execution_policy"]["min_expected_edge_bps"] = min_edge

        max_oracle_age = onboarding_hints.get("max_oracle_age_sec")
        if isinstance(max_oracle_age, int) and max_oracle_age > 0:
            patch["execution_policy"]["max_oracle_age_sec"] = max_oracle_age

        max_daily = onboarding_hints.get("max_daily_notional")
        if isinstance(max_daily, str) and max_daily.isdigit():
            patch["execution_policy"]["max_daily_notional_wei"] = int(max_daily)

        max_trade = onboarding_hints.get("max_trade_notional")
        if isinstance(max_trade, str) and max_trade.isdigit():
            patch["execution_policy"]["max_trade_notional_wei"] = int(max_trade)

        # Remove empty sections so we don't overwrite existing values unintentionally.
        cleaned_patch = {
            k: v for k, v in patch.items() if not isinstance(v, dict) or len(v) > 0
        }
        return self.put_policy(addr, cleaned_patch)

    def delete_policy(self, user_address: str) -> bool:
        addr = _normalize_address(user_address)
        if not addr:
            return False
        policies = _read_all()
        existed = addr in policies
        if existed:
            del policies[addr]
            _write_all(policies)
        return existed

    @staticmethod
    def policy_hash(policy: dict[str, Any]) -> str:
        encoded = json.dumps(policy, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return "0x" + hashlib.sha256(encoded).hexdigest()

    def _build_default_policy(self, user_address: str, mode: str = "personal") -> dict[str, Any]:
        normalized = _normalize_address(user_address)
        selected_mode = "shared_member" if mode == "shared_member" else "personal"
        return {
            "profile_id": _profile_id_for(normalized, selected_mode),
            "user_address": normalized,
            "mode": selected_mode,
            "risk_budget": _default_risk_budget(),
            "strategy_permissions": _default_strategy_permissions(),
            "venue_allowlist": ["ekubo", "avnu"],
            "token_allowlist": [],
            "execution_policy": _default_execution_policy(),
            "disclosure_policy": _default_disclosure_policy(),
            "privacy_policy": _default_privacy_policy("hidden_flow" if selected_mode == "shared_member" else "unlinkable_basic"),
            "updated_at": _now_iso(),
        }


_vault_policy_service: VaultPolicyService | None = None


def get_vault_policy_service() -> VaultPolicyService:
    global _vault_policy_service
    if _vault_policy_service is None:
        _vault_policy_service = VaultPolicyService()
    return _vault_policy_service
