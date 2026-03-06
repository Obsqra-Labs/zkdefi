"""
Proof Mode Service — 3-tier proof execution toggle.

Modes:
  EZKL_ONLY       — EZKL proof verified off-chain, output + model_hash logged.
                     Zero gas cost. For Tier 0 (Strict) or low-value actions.

  EZKL_BRIDGE     — EZKL → output fed into ModelBridge.circom → Groth16 →
                     Garaga on-chain. Model identity verified on-chain.
                     ~34M gas. Default for Tier 1 (Standard).

  FULL_DUAL_PROVER — EZKL_BRIDGE + Integrity STARK proof. Both Garaga +
                     FactRegistry must pass. Default for Tier 2 (Express)
                     and all autonomous agent actions.

Mode selection:
  - Tier-based default (auto-selects based on reputation tier)
  - Per-request override via ``proof_mode`` parameter
  - Global override via ``PROOF_MODE_OVERRIDE`` env var
"""
from __future__ import annotations

import logging
import os
from enum import IntEnum
from typing import Any

logger = logging.getLogger(__name__)


class ProofMode(IntEnum):
    """Proof verification depth — higher = more secure + more expensive."""
    EZKL_ONLY = 0
    EZKL_BRIDGE = 1
    FULL_DUAL_PROVER = 2

    @classmethod
    def from_string(cls, s: str) -> "ProofMode":
        key = s.strip().upper().replace("-", "_").replace(" ", "_")
        if key in cls.__members__:
            return cls[key]
        try:
            return cls(int(s))
        except (ValueError, KeyError):
            logger.warning("Unknown proof mode '%s', defaulting to EZKL_BRIDGE", s)
            return cls.EZKL_BRIDGE


# ── Tier-based defaults ──────────────────────────────────────────────────

_TIER_DEFAULTS: dict[int, ProofMode] = {
    0: ProofMode.EZKL_ONLY,        # Strict tier — low-value exploration
    1: ProofMode.EZKL_BRIDGE,      # Standard tier — on-chain model verification
    2: ProofMode.FULL_DUAL_PROVER, # Express tier — full dual-prover
}

# Actions that always require FULL_DUAL_PROVER regardless of tier
_FORCE_DUAL_PROVER_ACTIONS: set[str] = {
    "autonomous_rebalance",
    "autonomous_deposit",
    "autonomous_withdraw",
    "borrow",
    "liquidate",
    "collateral_update",
}


# ── Global override ──────────────────────────────────────────────────────

_ENV_OVERRIDE = os.getenv("PROOF_MODE_OVERRIDE", "").strip()


# ── Resolver ─────────────────────────────────────────────────────────────

class ProofModeResolver:
    """Resolves the proof mode for a given request context."""

    def __init__(self) -> None:
        self._global_override: ProofMode | None = None
        if _ENV_OVERRIDE:
            try:
                self._global_override = ProofMode.from_string(_ENV_OVERRIDE)
                logger.info("Proof mode global override: %s", self._global_override.name)
            except Exception:
                pass

    def resolve(
        self,
        *,
        tier: int = 0,
        action_type: str = "",
        request_override: str | int | None = None,
        value_eth: float = 0.0,
    ) -> ProofMode:
        """
        Determine the proof mode for a request.

        Priority:
          1. Global env override (PROOF_MODE_OVERRIDE)
          2. Forced dual-prover for critical actions
          3. Per-request override
          4. Value-based escalation (> 10 ETH → at least EZKL_BRIDGE)
          5. Tier-based default

        Args:
            tier: User reputation tier (0/1/2).
            action_type: The action being executed.
            request_override: Explicit mode from the API caller.
            value_eth: Transaction value for escalation logic.

        Returns:
            The resolved ProofMode.
        """
        # 1. Global override
        if self._global_override is not None:
            return self._global_override

        # 2. Forced dual-prover for critical actions
        if action_type.lower() in _FORCE_DUAL_PROVER_ACTIONS:
            return ProofMode.FULL_DUAL_PROVER

        # 3. Per-request override
        if request_override is not None:
            mode = ProofMode.from_string(str(request_override))
            # Never allow downgrade below tier default for safety
            tier_default = _TIER_DEFAULTS.get(tier, ProofMode.EZKL_BRIDGE)
            return max(mode, tier_default)

        # 4. Value-based escalation
        if value_eth > 10.0:
            tier_default = _TIER_DEFAULTS.get(tier, ProofMode.EZKL_BRIDGE)
            return max(tier_default, ProofMode.EZKL_BRIDGE)

        # 5. Tier-based default
        return _TIER_DEFAULTS.get(tier, ProofMode.EZKL_BRIDGE)

    def describe(self, mode: ProofMode) -> dict[str, Any]:
        """Return human-readable description of a proof mode."""
        descriptions = {
            ProofMode.EZKL_ONLY: {
                "name": "EZKL_ONLY",
                "level": 0,
                "on_chain_verification": False,
                "stark_verification": False,
                "estimated_gas": 0,
                "description": "EZKL proof verified off-chain only. Model output logged but not proved on-chain.",
                "suitable_for": "Low-value exploration, Tier 0 (Strict) users",
            },
            ProofMode.EZKL_BRIDGE: {
                "name": "EZKL_BRIDGE",
                "level": 1,
                "on_chain_verification": True,
                "stark_verification": False,
                "estimated_gas": 34_000_000,
                "description": "EZKL → ModelBridge Circom → Groth16 → Garaga on-chain. Model identity verified.",
                "suitable_for": "Standard actions, Tier 1 (Standard) users",
            },
            ProofMode.FULL_DUAL_PROVER: {
                "name": "FULL_DUAL_PROVER",
                "level": 2,
                "on_chain_verification": True,
                "stark_verification": True,
                "estimated_gas": 77_000_000,
                "description": (
                    "EZKL_BRIDGE + Integrity STARK execution proof. "
                    "Both Garaga and FactRegistry must pass."
                ),
                "suitable_for": "High-value actions, autonomous execution, Tier 2 (Express) users",
            },
        }
        return descriptions.get(mode, descriptions[ProofMode.EZKL_BRIDGE])


# ── Singleton ────────────────────────────────────────────────────────────

_resolver: ProofModeResolver | None = None


def get_proof_mode_resolver() -> ProofModeResolver:
    """Get or create the proof mode resolver singleton."""
    global _resolver
    if _resolver is None:
        _resolver = ProofModeResolver()
    return _resolver
