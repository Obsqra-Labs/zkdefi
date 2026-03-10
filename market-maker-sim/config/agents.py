"""
Agent fleet configuration — defines up to 10 bot agents, each with:
  - A dedicated wallet (address + private key)
  - Assigned pair(s) to trade
  - Strategy profile (swap interval, size range, behaviour mix)

Wallets are loaded from env vars:
  AGENT_1_ADDRESS, AGENT_1_PRIVATE_KEY
  AGENT_2_ADDRESS, AGENT_2_PRIVATE_KEY
  ...
  AGENT_10_ADDRESS, AGENT_10_PRIVATE_KEY

If an agent's env vars are missing, the primary bot wallet is reused with a
time-stagger so it still contributes without needing a separate account deployment.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Ensure .env is loaded before module-level os.getenv calls
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:
    pass


@dataclass(frozen=True)
class AgentProfile:
    """Configuration for a single market-making agent."""
    agent_id: int
    name: str
    account_address: str
    private_key: str
    # Which pairs this agent is responsible for (empty = all pairs)
    assigned_pairs: list[str] = field(default_factory=list)
    # Swap behaviour
    swap_interval_sec: float = 20.0
    swap_min_amount: float = 0.002
    swap_max_amount: float = 0.02
    # Behaviour bias: probability weights for degen/retail/whale
    behavior_weights: dict[str, float] = field(default_factory=lambda: {
        "degen": 0.40,
        "retail": 0.40,
        "whale": 0.20,
    })
    # LP management
    lp_enabled: bool = False
    lp_interval_sec: float = 300.0
    lp_amount0: float = 0.003
    lp_amount1: float = 0.003
    # Limit orders
    limit_enabled: bool = False
    limit_interval_sec: float = 180.0
    limit_amount: float = 0.001
    # Phase offset to stagger agents (seconds)
    startup_delay_sec: float = 0.0


# ── Default fleet layout ─────────────────────────────────────────────────────
# The primary wallet is used as fallback when agent-specific wallets aren't set.
_PRIMARY_ADDRESS = os.getenv(
    "BOT_ACCOUNT_ADDRESS",
    os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS", ""),
)
_PRIMARY_KEY = os.getenv(
    "BOT_PRIVATE_KEY",
    os.getenv("FULL_PRIVACY_MERKLE_TREE_ADMIN_PRIVATE_KEY", ""),
)


def _agent_wallet(n: int) -> tuple[str, str]:
    """Return (address, private_key) for agent N, falling back to primary."""
    addr = os.getenv(f"AGENT_{n}_ADDRESS", "")
    key = os.getenv(f"AGENT_{n}_PRIVATE_KEY", "")
    if addr and key:
        return addr, key
    return _PRIMARY_ADDRESS, _PRIMARY_KEY


def build_fleet_profiles(max_agents: int = 10) -> list[AgentProfile]:
    """
    Build the default fleet of agent profiles.

    Layout:
      Agent 1-2 : zkdAI/zkdETH (highest volume target pair)
      Agent 3-4 : STRK/zkdETH + zkdAI/STRK (dual-pair coverage)
      Agent 5   : STRK/ETH (recovery / depth)
      Agent 6   : ETH/zkdETH (recovery / depth)
      Agent 7   : zkdAI/ETH (recovery / depth)
      Agent 8-9 : All pairs round-robin (diversification)
      Agent 10  : LP-focused on all pairs (liquidity + fee harvest)
    """
    agents: list[AgentProfile] = []
    max_agents = max(1, min(max_agents, 10))

    # Global tuning knobs (all optional).
    swap_size_multiplier = max(0.1, float(os.getenv("AGENT_SWAP_SIZE_MULTIPLIER", "1.0")))
    swap_min_base = max(0.0001, float(os.getenv("AGENT_SWAP_MIN_AMOUNT_BASE", "0.002")))
    swap_max_base = max(swap_min_base, float(os.getenv("AGENT_SWAP_MAX_AMOUNT_BASE", "0.02")))
    swap_min_volume_king = max(
        swap_min_base,
        float(os.getenv("AGENT_SWAP_MIN_AMOUNT_VOLUME_KING", "0.003")),
    )
    swap_max_volume_king = max(
        swap_min_volume_king,
        float(os.getenv("AGENT_SWAP_MAX_AMOUNT_VOLUME_KING", "0.025")),
    )
    swap_max_specialist = max(
        swap_max_base,
        float(os.getenv("AGENT_SWAP_MAX_AMOUNT_SPECIALIST", "0.03")),
    )
    specialist_limit_enabled = os.getenv("AGENT_SPECIALIST_LIMIT_ENABLED", "true").lower() in ("true", "1", "yes")
    lp_agent_enabled = os.getenv("AGENT_LP_AGENT_ENABLED", "true").lower() in ("true", "1", "yes")
    lp_agent_limit_enabled = os.getenv("AGENT_LP_AGENT_LIMIT_ENABLED", "true").lower() in ("true", "1", "yes")

    pair_assignments: dict[int, list[str]] = {
        1:  ["zkdAI/zkdETH"],
        2:  ["zkdAI/zkdETH"],
        3:  ["STRK/zkdETH", "zkdAI/STRK"],
        4:  ["STRK/zkdETH", "zkdAI/STRK"],
        5:  ["STRK/ETH"],
        6:  ["ETH/zkdETH"],
        7:  ["zkdAI/ETH"],
        8:  [],  # all pairs
        9:  [],  # all pairs
        10: [],  # LP agent — all pairs
    }

    names = {
        1:  "VolumeKing-A",
        2:  "VolumeKing-B",
        3:  "DualCoverage-A",
        4:  "DualCoverage-B",
        5:  "STRK-ETH-Specialist",
        6:  "ETH-zkdETH-Specialist",
        7:  "zkdAI-ETH-Specialist",
        8:  "Roamer-A",
        9:  "Roamer-B",
        10: "LP-Manager",
    }

    behavior_profiles: dict[int, dict[str, float]] = {
        1:  {"degen": 0.30, "retail": 0.40, "whale": 0.30},
        2:  {"degen": 0.45, "retail": 0.35, "whale": 0.20},
        3:  {"degen": 0.35, "retail": 0.45, "whale": 0.20},
        4:  {"degen": 0.40, "retail": 0.40, "whale": 0.20},
        5:  {"degen": 0.25, "retail": 0.45, "whale": 0.30},
        6:  {"degen": 0.25, "retail": 0.45, "whale": 0.30},
        7:  {"degen": 0.25, "retail": 0.45, "whale": 0.30},
        8:  {"degen": 0.50, "retail": 0.35, "whale": 0.15},
        9:  {"degen": 0.35, "retail": 0.35, "whale": 0.30},
        10: {"degen": 0.20, "retail": 0.60, "whale": 0.20},
    }

    for n in range(1, max_agents + 1):
        addr, key = _agent_wallet(n)
        if not addr or not key:
            continue

        is_lp_agent = (n == 10)
        is_specialist = (n in (5, 6, 7))

        # ── Swap interval budget-aware ──
        # 200 STRK/day ÷ ~0.047 STRK/swap ≈ 4,255 swaps/day total.
        # 10 agents → ~425 swaps/agent/day → one swap every ~200s.
        # With burst mechanic (~15% extra), target ~170s base interval.
        # Volume-King agents (1-2) get slightly faster (150s) to hit
        # the zkdAI/zkdETH volume target; specialists get 200s.
        base_interval = float(os.getenv("AGENT_SWAP_INTERVAL_SEC", "0"))
        if base_interval <= 0:
            # Auto-calculate from daily gas budget
            budget_strk = float(os.getenv("DAILY_GAS_BUDGET_STRK", "200"))
            cost_per_swap = float(os.getenv("EST_GAS_PER_SWAP_STRK", "0.05"))
            swaps_per_day = budget_strk / cost_per_swap if cost_per_swap > 0 else 4000
            swaps_per_agent = swaps_per_day / max_agents
            base_interval = 86400.0 / swaps_per_agent  # ~200s for 200 STRK budget

        if n <= 2:
            interval = base_interval * 0.75          # VolumeKings: faster
        elif is_specialist:
            interval = base_interval * 1.1           # Specialists: slightly slower
        elif is_lp_agent:
            interval = base_interval * 1.2           # LP: slowest swaps
        else:
            interval = base_interval                 # default

        if n <= 2:
            swap_min_amount = swap_min_volume_king
            swap_max_amount = swap_max_volume_king
        elif is_specialist:
            swap_min_amount = swap_min_base
            swap_max_amount = swap_max_specialist
        else:
            swap_min_amount = swap_min_base
            swap_max_amount = swap_max_base

        swap_min_amount = max(0.0001, swap_min_amount * swap_size_multiplier)
        swap_max_amount = max(swap_min_amount, swap_max_amount * swap_size_multiplier)

        enable_lp = is_lp_agent and lp_agent_enabled
        enable_limit = (
            (is_lp_agent and lp_agent_limit_enabled)
            or (is_specialist and specialist_limit_enabled)
        )

        agents.append(AgentProfile(
            agent_id=n,
            name=names.get(n, f"Agent-{n}"),
            account_address=addr,
            private_key=key,
            assigned_pairs=list(pair_assignments.get(n, [])),
            swap_interval_sec=round(interval, 1),
            swap_min_amount=round(swap_min_amount, 6),
            swap_max_amount=round(swap_max_amount, 6),
            behavior_weights=behavior_profiles.get(n, {"degen": 0.40, "retail": 0.40, "whale": 0.20}),
            lp_enabled=enable_lp,
            lp_interval_sec=300.0 if is_lp_agent else 600.0,
            lp_amount0=0.005 if is_lp_agent else 0.003,
            lp_amount1=0.005 if is_lp_agent else 0.003,
            limit_enabled=enable_limit,
            limit_interval_sec=300.0,
            limit_amount=0.002,
            startup_delay_sec=float(n * 3.0),  # stagger by 3s each
        ))

    return agents
