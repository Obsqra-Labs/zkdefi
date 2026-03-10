"""
Oracle Execution Policies Service.

Manages per-address execution policies that gate what signals can be actioned.
Policies define trustworthiness thresholds, risk tolerance, privacy preferences,
and execution constraints.

Policies are stored as JSON and persist across restarts.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.services.json_store import JsonStore

logger = logging.getLogger(__name__)


class ExecutionPolicy:
    """Represents an execution policy for a user/address."""
    
    def __init__(self, address: str, policy_data: dict[str, Any]):
        self.address = address
        self.data = policy_data
    
    def matches_signal(self, signal: dict[str, Any]) -> tuple[bool, str]:
        """
        Check if a signal matches this policy's gating rules.
        
        Returns: (allowed: bool, reason: str)
        """
        reason_parts = []
        
        # Gate 1: Reputation threshold
        min_rep = self.data.get("gateRules", {}).get("minReputationScore", 0)
        signal_rep = signal.get("predictions", {}).get("reputationScore", {}).get("score", 0)
        if signal_rep < min_rep:
            return False, f"Reputation {signal_rep} below threshold {min_rep}"
        
        # Gate 2: Risk tolerance
        max_risk = self.data.get("gateRules", {}).get("maxRiskScore", 100)
        signal_risk = signal.get("riskScore", 0)
        if signal_risk > max_risk:
            return False, f"Risk {signal_risk} exceeds tolerance {max_risk}"
        
        # Gate 3: Circuit verification (optional)
        require_circuit = self.data.get("gateRules", {}).get("requireCircuitVerified", False)
        if require_circuit and not signal.get("circuit_verified", False):
            return False, "Circuit verification required but not present"
        
        # Gate 4: Privacy mode preference
        prefer_privacy = self.data.get("gateRules", {}).get("preferPrivacyMode", None)
        if prefer_privacy:
            signal_privacy = signal.get("privacyMode", "public")
            if signal_privacy != prefer_privacy:
                reason_parts.append(f"Privacy preference mismatch ({signal_privacy} vs {prefer_privacy})")
        
        return True, "Passed all gates"


class ExecutionPolicyService:
    """Service for managing execution policies."""
    
    def __init__(self, store_prefix: str = "execution_policies"):
        self._store = JsonStore(store_prefix)
    
    def get_policy(self, address: str) -> ExecutionPolicy:
        """Get policy for an address, or default if not exists."""
        address = self._normalize_address(address)
        policy_data = self._store.get(address)
        
        if not policy_data:
            policy_data = self._default_policy(address)
            self._store.set(address, policy_data)
        
        return ExecutionPolicy(address, policy_data)
    
    def set_policy(self, address: str, policy_data: dict[str, Any]) -> ExecutionPolicy:
        """Create or update policy for an address."""
        address = self._normalize_address(address)
        
        # Validate policy structure
        validated = self._validate_policy(policy_data)
        
        # Add metadata
        existing = self._store.get(address)
        if existing:
            validated["createdAt"] = existing.get("createdAt")
            validated["updatedAt"] = datetime.now(timezone.utc).isoformat()
        else:
            validated["createdAt"] = datetime.now(timezone.utc).isoformat()
            validated["updatedAt"] = datetime.now(timezone.utc).isoformat()
        
        self._store.set(address, validated)
        logger.info(f"Policy updated for {address}")
        
        return ExecutionPolicy(address, validated)
    
    def evaluate_signal(self, address: str, signal: dict[str, Any]) -> dict[str, Any]:
        """
        Evaluate if a signal is gated for execution by this address.
        
        Returns dict with:
        - allowed: bool
        - reason: str
        - policy_applied: dict
        """
        policy = self.get_policy(address)
        allowed, reason = policy.matches_signal(signal)
        
        return {
            "address": address,
            "signal_id": signal.get("id"),
            "allowed": allowed,
            "reason": reason,
            "policy_applied": {
                "minReputationScore": policy.data.get("gateRules", {}).get("minReputationScore"),
                "maxRiskScore": policy.data.get("gateRules", {}).get("maxRiskScore"),
                "requireCircuitVerified": policy.data.get("gateRules", {}).get("requireCircuitVerified"),
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    
    def _validate_policy(self, policy_data: dict[str, Any]) -> dict[str, Any]:
        """Validate and normalize policy structure."""
        
        gate_rules = policy_data.get("gateRules", {})
        exec_rules = policy_data.get("executionRules", {})
        
        # Validate gate rules
        min_rep = int(gate_rules.get("minReputationScore", 0))
        if not (0 <= min_rep <= 100):
            min_rep = max(0, min(100, min_rep))
        
        max_risk = int(gate_rules.get("maxRiskScore", 100))
        if not (0 <= max_risk <= 100):
            max_risk = max(0, min(100, max_risk))
        
        require_circuit = bool(gate_rules.get("requireCircuitVerified", False))
        
        privacy_mode = gate_rules.get("preferPrivacyMode")
        if privacy_mode and privacy_mode not in ("public", "shielded", "dark_ledger"):
            privacy_mode = None
        
        # Validate execution rules
        max_alloc = float(exec_rules.get("maxAllocationPct", 100.0))
        max_alloc = max(0.0, min(100.0, max_alloc))
        
        daily_limit_usd = float(exec_rules.get("dailyLimitUSD", 100000.0))
        daily_limit_usd = max(0.0, daily_limit_usd)
        
        auto_execute = bool(exec_rules.get("autoExecute", False))
        
        is_active = bool(policy_data.get("isActive", True))
        
        return {
            "address": policy_data.get("address", "unknown"),
            "gateRules": {
                "minReputationScore": min_rep,
                "maxRiskScore": max_risk,
                "requireCircuitVerified": require_circuit,
                "preferPrivacyMode": privacy_mode,
            },
            "executionRules": {
                "maxAllocationPct": max_alloc,
                "dailyLimitUSD": daily_limit_usd,
                "autoExecute": auto_execute,
            },
            "isActive": is_active,
            "createdAt": policy_data.get("createdAt"),
            "updatedAt": policy_data.get("updatedAt"),
        }
    
    def _default_policy(self, address: str) -> dict[str, Any]:
        """Return default policy (moderate risk tolerance)."""
        now = datetime.now(timezone.utc).isoformat()
        return {
            "address": address,
            "gateRules": {
                "minReputationScore": 50,  # Moderate trust
                "maxRiskScore": 50,         # Conservative risk
                "requireCircuitVerified": False,
                "preferPrivacyMode": None,
            },
            "executionRules": {
                "maxAllocationPct": 20.0,
                "dailyLimitUSD": 10000.0,
                "autoExecute": False,
            },
            "isActive": True,
            "createdAt": now,
            "updatedAt": now,
        }
    
    @staticmethod
    def _normalize_address(address: str) -> str:
        """Normalize address format."""
        return address.lower().strip() if address else "default"


def get_execution_policy_service() -> ExecutionPolicyService:
    """Singleton getter for policy service."""
    global _service
    if not hasattr(get_execution_policy_service, "_service"):
        get_execution_policy_service._service = ExecutionPolicyService()
    return get_execution_policy_service._service
