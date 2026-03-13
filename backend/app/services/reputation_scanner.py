"""
Reputation Scanner — deep on-chain behavioral analysis for Starknet wallets.

Goes beyond simple balance checks to build real reputation signals:
  • Account age & activity (nonce = lifetime tx count)
  • Account type (Argent, Braavos, custom deployer, OZ, unknown)
  • Protocol diversity (interaction breadth across DeFi protocols)
  • Capital profile (aggregated positions across protocols)
  • Behavioral signals:
      – Diamond hands vs paper hands (holding through drawdowns)
      – Rug survivor (had tokens in exploited protocols, still active)
      – Catalyst (early depositor / LP in protocols)
      – Conviction (single-sided concentrated vs diversified)
  • Contract deployer detection (has this wallet deployed contracts?)
  • DeFi veteran score (composite of all signals)

Data sources:
  - Starknet mainnet RPC (getNonce, getClassHashAt, balance_of)
  - Vesu REST API (position history with pool vintage)
  - Position scanner (current balances)
  - Known protocol contract addresses (for interaction detection)

Cached per wallet for 5 minutes to avoid hammering free RPCs.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

STARKNET_MAINNET_RPC = os.getenv(
    "STARKNET_MAINNET_RPC_URL",
    "https://rpc.starknet.lava.build:443",
)

_CACHE_TTL = 300  # 5 min cache per wallet
_RPC_TIMEOUT = 5.0
_RPC_SPACING = 0.15  # seconds between RPC calls to avoid rate limits

# ─── Known class hashes for account type detection ────────────────────────────

KNOWN_CLASS_HASHES: Dict[str, str] = {
    # Argent Account V1
    "0x025ec026985a3bf9d0cc1fe17326b245dfdc3ff89b8fde106542a3ea56c5a918": "argent_v1",
    # Argent Account V0.3
    "0x029927c8af6bccf3f6fda035981e765a7bdbf18209e145b7f8d6821ed90ba2b": "argent_v0.3",
    # Argent Account (newer)
    "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f": "argent_new",
    # Argent Multisig
    "0x0737ee2f87ce571a58c6c8da558ec18a07ceb64a6172d5ec46171fbc80077a48": "argent_multisig",
    # Braavos Account
    "0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253": "braavos",
    # Braavos Base
    "0x013bfe114fb1cf405bfc3a5f8c48faa2640914b93969c3aaca1a0ed4f2c0a4c3": "braavos_base",
    # OpenZeppelin Account
    "0x04c6d6cf894f8bc96bb9c525e6853e5483177841f7388f74a46cfb92c3011164": "openzeppelin",
    # OpenZeppelin Account Cairo 1
    "0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003": "openzeppelin_c1",
}

# ─── Known protocol contracts for interaction detection ───────────────────────

PROTOCOL_CONTRACTS: Dict[str, Dict[str, str]] = {
    "ekubo": {
        "core": "0x00000005dd3d2f4429af886cd1a3b08228e5c6d1564b37e8c46e0000a0516413",
        "positions": "0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067",
        "router": "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4c8393c3",
    },
    "vesu": {
        "singleton": "0x02545b2e5d519fc230e9cd781046d3a64e092114f07e44771e0d719d148725ef",
        "genesis_pool": "0x4dc4f0ca6ea72a2a1b2b37ba9ec166d0bdd063b29b5e0fd5e1501a6b0e9b46f",
    },
    "nostra": {
        "interest_rate_model": "0x059a943ca214c10234b9a3b61c558ac20c005127d183b86a99a8f3c60a08b4ff",
    },
    "endur": {
        "xstrk": "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a",
    },
    "starkgate": {
        "bridge_eth": "0x073314940630fd6dcda0d772d4c972c4e0a9946bef9dabf4ef84eda8ef542b82",
        "bridge_usdc": "0x05cd48fccbfd8aa2773fe22c217e808319ffcc1c5a6a463f7d8fa2da48218196",
    },
    "myswap": {
        "amm": "0x010884171baf1914edc28d7afb619b40a4051cfae78a094a55d230f19e944a28",
    },
    "jediswap": {
        "router_v2": "0x041fd22b238fa21cfcf5dd45a8548974d8263b3a531a60388411c5e230f97023",
    },
}

# ─── Known rugged / exploited protocols on Starknet ───────────────────────────

RUGGED_PROTOCOLS: Dict[str, Dict[str, Any]] = {
    # Add verified exploited contract addresses here as they occur.
    # Structure: contract_addr -> {name, date, type}
    # For now, empty — Starknet mainnet hasn't had major exploits yet.
    # If/when one occurs, add it here and the scanner will detect survivors.
}

# ─── Starknet genesis / early block timestamp (Nov 2021 approx) ──────────────
STARKNET_MAINNET_GENESIS_TS = 1637000000  # approx Nov 15 2021


# ─── Data types ───────────────────────────────────────────────────────────────

@dataclass
class BehavioralSignal:
    """A single behavioral reputation signal with evidence."""
    signal: str             # e.g. "diamond_hands", "rug_survivor", "protocol_veteran"
    value: float            # 0.0 to 1.0 (strength)
    label: str              # human-readable label
    evidence: str           # brief evidence explanation
    category: str           # "conviction" | "resilience" | "experience" | "capital" | "governance"


@dataclass
class ReputationProfile:
    """Deep reputation profile for a wallet."""
    wallet_address: str
    scanned_at: str

    # Account basics
    account_type: str = "unknown"        # argent | braavos | openzeppelin | custom | unknown
    nonce: int = 0                        # lifetime tx count
    account_exists: bool = False
    is_contract_deployer: bool = False    # has this wallet deployed custom contracts?

    # Aggregate capital
    total_capital_usd: float = 0.0
    capital_by_protocol: Dict[str, float] = field(default_factory=dict)
    protocol_count: int = 0
    position_count: int = 0

    # Behavioral signals
    signals: List[BehavioralSignal] = field(default_factory=list)

    # Composite scores (0-100)
    defi_veteran_score: int = 0           # composite of all signals
    conviction_score: int = 0             # diamond hands / holding conviction
    activity_score: int = 0               # tx volume / frequency
    diversity_score: int = 0              # protocol breadth
    capital_score: int = 0                # aggregated capital tier
    resilience_score: int = 0             # survived drawdowns, maintained positions

    # Tier recommendation
    recommended_tier: int = 1             # 1-3 based on signals
    tier_reasoning: str = ""

    # ── Credit scoring (FICO pack / circuit-ready) ────────────────────────
    fico_score: int = 0                   # 300-850 FICO-equivalent score
    fico_tier: str = ""                   # excellent | good | fair | poor
    credit_class: str = ""                # AAA | AA | A | B | C
    credit_class_index: int = -1          # 0-4 (MLP output class)
    credit_confidence: float = 0.0        # softmax confidence of predicted class
    credit_features: Dict[str, float] = field(default_factory=dict)  # 18 named features
    credit_feature_hash: str = ""         # SHA256 of normalized feature vector
    credit_model_hash: str = ""           # SHA256 of ONNX model
    credit_circuit_version: str = ""      # e.g. "creditworthiness_mlp_v1"
    ezkl_ready: bool = False              # True if EZKL artifacts exist for proving

    # Proof binding
    profile_hash: str = ""
    scan_duration_ms: float = 0.0
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["signals"] = [asdict(s) for s in self.signals]
        return d

    def compute_hash(self) -> str:
        canon = json.dumps(
            {
                "wallet": self.wallet_address,
                "scanned_at": self.scanned_at,
                "nonce": self.nonce,
                "account_type": self.account_type,
                "total_capital_usd": round(self.total_capital_usd, 2),
                "defi_veteran_score": self.defi_veteran_score,
                "fico_score": self.fico_score,
                "credit_class": self.credit_class,
                "credit_feature_hash": self.credit_feature_hash,
                "signals": [
                    {"signal": s.signal, "value": round(s.value, 4)}
                    for s in self.signals
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return "0x" + hashlib.sha256(canon.encode()).hexdigest()


# ─── RPC helpers ──────────────────────────────────────────────────────────────

async def _rpc_call(
    client: httpx.AsyncClient,
    rpc_url: str,
    method: str,
    params: list,
    call_id: int = 1,
) -> dict:
    """Make a JSON-RPC call to Starknet."""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "id": call_id,
        "params": params,
    }
    try:
        resp = await client.post(rpc_url, json=payload)
        return resp.json()
    except Exception as exc:
        logger.debug("RPC %s failed: %s", method, exc)
        return {"error": {"code": -1, "message": str(exc)}}


async def _get_nonce(client: httpx.AsyncClient, rpc_url: str, address: str) -> Optional[int]:
    """Get account nonce (lifetime tx count)."""
    data = await _rpc_call(client, rpc_url, "starknet_getNonce", ["latest", address])
    if "result" in data:
        return int(data["result"], 16)
    return None


async def _get_class_hash(client: httpx.AsyncClient, rpc_url: str, address: str) -> Optional[str]:
    """Get contract class hash at address (tells us account type)."""
    data = await _rpc_call(client, rpc_url, "starknet_getClassHashAt", ["latest", address])
    if "result" in data:
        return data["result"]
    return None


def _identify_account_type(class_hash: Optional[str]) -> str:
    """Identify account type from class hash."""
    if not class_hash:
        return "unknown"
    ch = class_hash.lower()
    for known_hash, account_type in KNOWN_CLASS_HASHES.items():
        if ch == known_hash.lower():
            return account_type
    # Unknown class hash — could be a custom contract/deployer
    return "custom"


# ─── Behavioral analysis ─────────────────────────────────────────────────────

def _analyze_activity(nonce: int) -> List[BehavioralSignal]:
    """Analyze wallet activity level from nonce (tx count)."""
    signals = []

    if nonce is None or nonce == 0:
        return signals

    if nonce >= 1000:
        signals.append(BehavioralSignal(
            signal="power_user",
            value=1.0,
            label="Power User",
            evidence=f"{nonce:,} lifetime transactions — top-tier activity level",
            category="experience",
        ))
    elif nonce >= 200:
        signals.append(BehavioralSignal(
            signal="active_user",
            value=min(nonce / 1000, 0.9),
            label="Active User",
            evidence=f"{nonce:,} lifetime transactions — consistent on-chain activity",
            category="experience",
        ))
    elif nonce >= 50:
        signals.append(BehavioralSignal(
            signal="regular_user",
            value=min(nonce / 200, 0.5),
            label="Regular User",
            evidence=f"{nonce:,} lifetime transactions — moderate activity",
            category="experience",
        ))
    elif nonce >= 10:
        signals.append(BehavioralSignal(
            signal="new_user",
            value=0.2,
            label="New User",
            evidence=f"{nonce} transactions — just getting started",
            category="experience",
        ))

    return signals


def _analyze_capital(total_usd: float, by_protocol: Dict[str, float]) -> List[BehavioralSignal]:
    """Analyze capital profile and distribution."""
    signals = []

    if total_usd <= 0:
        return signals

    # Capital tier
    if total_usd >= 100_000:
        signals.append(BehavioralSignal(
            signal="whale",
            value=1.0,
            label="Whale",
            evidence=f"${total_usd:,.0f} deployed across protocols — significant capital commitment",
            category="capital",
        ))
    elif total_usd >= 10_000:
        signals.append(BehavioralSignal(
            signal="substantial_capital",
            value=min(total_usd / 100_000, 0.8),
            label="Substantial Capital",
            evidence=f"${total_usd:,.0f} deployed — committed capital participant",
            category="capital",
        ))
    elif total_usd >= 1_000:
        signals.append(BehavioralSignal(
            signal="modest_capital",
            value=min(total_usd / 10_000, 0.5),
            label="Active Capital",
            evidence=f"${total_usd:,.0f} deployed — active DeFi participant",
            category="capital",
        ))

    # Concentration vs diversification
    if len(by_protocol) >= 4:
        signals.append(BehavioralSignal(
            signal="diversified",
            value=min(len(by_protocol) / 5, 1.0),
            label="Diversified",
            evidence=f"Capital spread across {len(by_protocol)} protocols — hedged exposure",
            category="conviction",
        ))
    elif len(by_protocol) == 1 and total_usd >= 5_000:
        protocol = list(by_protocol.keys())[0]
        signals.append(BehavioralSignal(
            signal="concentrated",
            value=0.7,
            label="Concentrated Conviction",
            evidence=f"${total_usd:,.0f} concentrated in {protocol} — high-conviction bet",
            category="conviction",
        ))

    return signals


def _analyze_protocol_diversity(
    positions: List[Dict[str, Any]],
    by_protocol: Dict[str, float],
) -> List[BehavioralSignal]:
    """Analyze protocol interaction breadth."""
    signals = []
    protocols = set(by_protocol.keys())

    # DeFi native — has both lending + staking/LP
    position_types = set()
    for pos in positions:
        pt = pos.get("position_type", "")
        if pt:
            position_types.add(pt)

    has_lending = "lending" in position_types
    has_staking = "staking" in position_types
    has_lp = "lp" in position_types
    has_tokens = "token" in position_types

    defi_breadth = sum([has_lending, has_staking, has_lp])

    if defi_breadth >= 3:
        signals.append(BehavioralSignal(
            signal="defi_native",
            value=1.0,
            label="DeFi Native",
            evidence="Active in lending, staking, AND liquidity provision — full-spectrum DeFi user",
            category="experience",
        ))
    elif defi_breadth >= 2:
        types_found = [t for t in ["lending", "staking", "lp"] if t in position_types]
        signals.append(BehavioralSignal(
            signal="defi_experienced",
            value=0.7,
            label="DeFi Experienced",
            evidence=f"Active in {' + '.join(types_found)} — knows multiple DeFi primitives",
            category="experience",
        ))

    # Protocol veteran — interacting with specific known protocols
    if "vesu" in protocols:
        signals.append(BehavioralSignal(
            signal="vesu_user",
            value=0.6,
            label="Vesu Lender",
            evidence=f"Active Vesu position — ${by_protocol.get('vesu', 0):,.0f} deployed",
            category="experience",
        ))

    if "endur" in protocols:
        signals.append(BehavioralSignal(
            signal="endur_staker",
            value=0.5,
            label="Endur Staker",
            evidence="Holds xSTRK — liquid staking participant",
            category="conviction",
        ))

    if "nostra" in protocols:
        signals.append(BehavioralSignal(
            signal="nostra_user",
            value=0.5,
            label="Nostra User",
            evidence="Has Nostra iTokens — lending market participant",
            category="experience",
        ))

    return signals


def _analyze_account_type(
    account_type: str,
    class_hash: Optional[str],
) -> List[BehavioralSignal]:
    """Analyze what the account type tells us about the user."""
    signals = []

    if account_type == "custom":
        signals.append(BehavioralSignal(
            signal="custom_contract",
            value=0.8,
            label="Custom Contract / Deployer",
            evidence=f"Non-standard class hash ({class_hash[:14] if class_hash else '?'}…) — "
                     "likely a developer or contract deployer",
            category="experience",
        ))
    elif account_type.startswith("argent"):
        signals.append(BehavioralSignal(
            signal="argent_user",
            value=0.3,
            label="Argent Wallet",
            evidence="Uses Argent — a mainstream Starknet wallet with social recovery",
            category="experience",
        ))
        if account_type == "argent_multisig":
            signals.append(BehavioralSignal(
                signal="multisig",
                value=0.7,
                label="Multisig User",
                evidence="Uses Argent Multisig — institutional-grade security posture",
                category="resilience",
            ))
    elif account_type.startswith("braavos"):
        signals.append(BehavioralSignal(
            signal="braavos_user",
            value=0.3,
            label="Braavos Wallet",
            evidence="Uses Braavos — feature-rich Starknet wallet",
            category="experience",
        ))
    elif account_type.startswith("openzeppelin"):
        signals.append(BehavioralSignal(
            signal="oz_account",
            value=0.5,
            label="OpenZeppelin Account",
            evidence="Uses OZ standard account — likely a developer or protocol team",
            category="experience",
        ))

    return signals


def _analyze_holding_behavior(
    positions: List[Dict[str, Any]],
    total_usd: float,
) -> List[BehavioralSignal]:
    """
    Analyze holding behavior — diamond hands vs paper.

    Since we can see current positions but not historical,
    we infer conviction from:
      - Having positions at all (you held through recent volatility)
      - Size of positions relative to wallet (committed capital ratio)
      - Staking positions (locked = conviction)
      - LP positions (active earning = not panic-sold)
    """
    signals = []

    if not positions or total_usd <= 0:
        return signals

    defi_positions = [p for p in positions if p.get("protocol") != "wallet"]
    wallet_positions = [p for p in positions if p.get("protocol") == "wallet"]

    defi_usd = sum(p.get("value_usd", 0) for p in defi_positions)
    wallet_usd = sum(p.get("value_usd", 0) for p in wallet_positions)

    if total_usd > 0 and defi_usd > 0:
        deployed_ratio = defi_usd / total_usd

        if deployed_ratio >= 0.7:
            signals.append(BehavioralSignal(
                signal="diamond_hands",
                value=min(deployed_ratio, 1.0),
                label="Diamond Hands",
                evidence=f"{deployed_ratio*100:.0f}% of capital deployed in DeFi — "
                         "not sitting idle, not panic-sold",
                category="conviction",
            ))
        elif deployed_ratio >= 0.3:
            signals.append(BehavioralSignal(
                signal="balanced_deployer",
                value=deployed_ratio,
                label="Balanced Deployer",
                evidence=f"{deployed_ratio*100:.0f}% deployed, {(1-deployed_ratio)*100:.0f}% reserve — "
                         "prudent capital management",
                category="conviction",
            ))

    # Staking = locked conviction
    staking_positions = [p for p in positions if p.get("position_type") == "staking"]
    if staking_positions:
        staking_usd = sum(p.get("value_usd", 0) for p in staking_positions)
        signals.append(BehavioralSignal(
            signal="staker",
            value=min(staking_usd / max(total_usd, 1) * 2, 1.0),
            label="Staker",
            evidence=f"${staking_usd:,.0f} in staking — locked capital demonstrates conviction",
            category="conviction",
        ))

    # LP = active earning through volatility
    lp_positions = [p for p in positions if p.get("position_type") == "lp"]
    if lp_positions:
        lp_usd = sum(p.get("value_usd", 0) for p in lp_positions)
        signals.append(BehavioralSignal(
            signal="liquidity_provider",
            value=min(lp_usd / max(total_usd, 1) * 2, 1.0),
            label="Liquidity Provider",
            evidence=f"${lp_usd:,.0f} in LP positions — providing liquidity through volatility",
            category="resilience",
        ))

    return signals


def _analyze_rug_exposure(
    positions: List[Dict[str, Any]],
    nonce: int,
) -> List[BehavioralSignal]:
    """
    Detect rug exposure and survival.

    Logic:
      - Check if wallet interacted with known rugged protocols
        (inferred from having nonce > X + being active now)
      - If Starknet gets exploits, we add contract addresses to RUGGED_PROTOCOLS
        and check if the wallet held those tokens

    For now: if wallet has been active since early Starknet AND still has
    positions, they've survived all market volatility — that's the signal.
    """
    signals = []

    # If they have significant history and still active, they've survived downturns
    if nonce and nonce >= 100 and positions:
        signals.append(BehavioralSignal(
            signal="market_survivor",
            value=min(nonce / 500, 1.0),
            label="Market Survivor",
            evidence=f"{nonce:,} txns and still active with positions — "
                     "survived market volatility and maintained conviction",
            category="resilience",
        ))

    # Check against known rugged protocols (currently empty for Starknet)
    # This structure is ready for when exploits happen
    if RUGGED_PROTOCOLS:
        for pos in positions:
            # If they had tokens from a rugged protocol and still
            # have other positions, they survived calmly
            protocol = pos.get("protocol", "")
            if protocol in RUGGED_PROTOCOLS and nonce and nonce > 20:
                signals.append(BehavioralSignal(
                    signal="rug_survivor",
                    value=0.9,
                    label="Rug Survivor",
                    evidence=f"Interacted with {RUGGED_PROTOCOLS[protocol]['name']} "
                             f"(exploited {RUGGED_PROTOCOLS[protocol].get('date', '?')}) "
                             "and continued DeFi activity — resilient participant",
                    category="resilience",
                ))
                break

    return signals


# ─── Composite scores ─────────────────────────────────────────────────────────

def _compute_scores(
    signals: List[BehavioralSignal],
    nonce: int,
    total_usd: float,
    protocol_count: int,
) -> Dict[str, int]:
    """Compute composite scores from individual signals."""

    def _category_avg(category: str) -> float:
        cat_signals = [s for s in signals if s.category == category]
        if not cat_signals:
            return 0.0
        return sum(s.value for s in cat_signals) / len(cat_signals)

    # Activity score (0-100): from nonce + activity signals
    activity_raw = 0
    if nonce:
        activity_raw = min(nonce / 500, 1.0) * 60  # up to 60 from nonce
    activity_raw += _category_avg("experience") * 40  # up to 40 from experience signals
    activity_score = int(min(activity_raw, 100))

    # Conviction score (0-100): diamond hands, staking, concentration
    conviction_raw = _category_avg("conviction") * 100
    conviction_score = int(min(conviction_raw, 100))

    # Diversity score (0-100): protocol count + position types
    diversity_raw = min(protocol_count / 4, 1.0) * 70
    diversity_raw += _category_avg("experience") * 30
    diversity_score = int(min(diversity_raw, 100))

    # Capital score (0-100): based on total capital
    if total_usd >= 100_000:
        capital_score = 100
    elif total_usd >= 10_000:
        capital_score = int(60 + (total_usd - 10_000) / 90_000 * 40)
    elif total_usd >= 1_000:
        capital_score = int(20 + (total_usd - 1_000) / 9_000 * 40)
    elif total_usd > 0:
        capital_score = int(total_usd / 1_000 * 20)
    else:
        capital_score = 0

    # Resilience score (0-100): market survival + holding conviction
    resilience_raw = _category_avg("resilience") * 100
    resilience_score = int(min(resilience_raw, 100))

    # DeFi veteran composite (weighted average)
    veteran_score = int(
        activity_score * 0.25
        + conviction_score * 0.20
        + diversity_score * 0.15
        + capital_score * 0.25
        + resilience_score * 0.15
    )

    return {
        "activity_score": activity_score,
        "conviction_score": conviction_score,
        "diversity_score": diversity_score,
        "capital_score": capital_score,
        "resilience_score": resilience_score,
        "defi_veteran_score": veteran_score,
    }


def _recommend_tier(
    veteran_score: int,
    nonce: int,
    total_usd: float,
    signals: List[BehavioralSignal],
) -> tuple[int, str]:
    """Recommend a trust tier based on signals."""
    reasons = []

    # Start at tier 1
    tier = 1

    # Tier 2: need some activity + capital OR strong activity
    if veteran_score >= 30 and (nonce or 0) >= 10:
        tier = 2
        reasons.append(f"Veteran score {veteran_score}/100")
        if total_usd >= 1_000:
            reasons.append(f"${total_usd:,.0f} capital deployed")
        if (nonce or 0) >= 50:
            reasons.append(f"{nonce:,} lifetime transactions")

    # Tier 3: need strong signals across multiple dimensions
    if veteran_score >= 60 and (nonce or 0) >= 100 and total_usd >= 5_000:
        tier = 3
        has_diamond = any(s.signal == "diamond_hands" for s in signals)
        has_diversity = any(s.signal in ("diversified", "defi_native") for s in signals)
        if has_diamond:
            reasons.append("diamond hands holder")
        if has_diversity:
            reasons.append("diversified across protocols")

    reasoning = ". ".join(reasons) + "." if reasons else "New wallet — build reputation through activity."
    return tier, f"Tier {tier}: {reasoning}"


# ─── Main scanner ─────────────────────────────────────────────────────────────

_profile_cache: Dict[str, tuple] = {}  # wallet -> (ReputationProfile, timestamp)


async def scan_reputation(
    wallet_address: str,
    portfolio_snapshot: Optional[Dict[str, Any]] = None,
    *,
    skip_cache: bool = False,
) -> ReputationProfile:
    """
    Deep reputation scan for a wallet address.

    If portfolio_snapshot is provided (from position_scanner), uses it
    for capital/position analysis. Otherwise, runs a fresh position scan.

    Returns a ReputationProfile with behavioral signals and composite scores.
    """
    wallet = wallet_address.strip().lower()
    now = time.time()

    # Check cache
    if not skip_cache and wallet in _profile_cache:
        cached, ts = _profile_cache[wallet]
        if now - ts < _CACHE_TTL:
            return cached

    t0 = time.time()
    errors: List[str] = []

    # ── 1. RPC calls: nonce + class hash ──────────────────────────────────

    nonce: Optional[int] = None
    class_hash: Optional[str] = None
    account_exists = False

    async with httpx.AsyncClient(timeout=_RPC_TIMEOUT) as client:
        # Get nonce (tx count)
        nonce = await _get_nonce(client, STARKNET_MAINNET_RPC, wallet)
        if nonce is not None:
            account_exists = True

        await asyncio.sleep(_RPC_SPACING)

        # Get class hash (account type)
        class_hash = await _get_class_hash(client, STARKNET_MAINNET_RPC, wallet)

    account_type = _identify_account_type(class_hash)

    # ── 2. Portfolio data ─────────────────────────────────────────────────

    positions: List[Dict[str, Any]] = []
    total_usd = 0.0
    capital_by_protocol: Dict[str, float] = {}
    position_count = 0

    if portfolio_snapshot:
        positions = portfolio_snapshot.get("positions", [])
        total_usd = portfolio_snapshot.get("total_value_usd", 0.0)
        position_count = portfolio_snapshot.get("position_count", 0)
    else:
        # Run a fresh position scan
        try:
            from app.services.position_scanner import scan_portfolio
            snap = await scan_portfolio(wallet)
            positions = [asdict(p) if hasattr(p, '__dataclass_fields__') else p for p in snap.positions]
            total_usd = snap.total_value_usd
            position_count = snap.position_count
        except Exception as exc:
            errors.append(f"position_scan: {exc}")

    # Build capital by protocol
    for pos in positions:
        protocol = pos.get("protocol", "unknown")
        if protocol == "wallet":
            continue  # Don't count idle wallet tokens
        val = pos.get("value_usd", 0)
        if val > 0:
            capital_by_protocol[protocol] = capital_by_protocol.get(protocol, 0) + val

    # ── 3. Behavioral analysis ────────────────────────────────────────────

    all_signals: List[BehavioralSignal] = []

    # Activity analysis (from nonce)
    all_signals.extend(_analyze_activity(nonce or 0))

    # Account type analysis
    all_signals.extend(_analyze_account_type(account_type, class_hash))

    # Capital analysis
    all_signals.extend(_analyze_capital(total_usd, capital_by_protocol))

    # Protocol diversity
    all_signals.extend(_analyze_protocol_diversity(positions, capital_by_protocol))

    # Holding behavior (diamond hands / paper)
    all_signals.extend(_analyze_holding_behavior(positions, total_usd))

    # Rug exposure / survival
    all_signals.extend(_analyze_rug_exposure(positions, nonce or 0))

    # ── 4. Compute composite scores ───────────────────────────────────────

    scores = _compute_scores(
        all_signals,
        nonce or 0,
        total_usd,
        len(capital_by_protocol),
    )

    # ── 5. Tier recommendation ────────────────────────────────────────────

    recommended_tier, tier_reasoning = _recommend_tier(
        scores["defi_veteran_score"],
        nonce or 0,
        total_usd,
        all_signals,
    )

    # ── 5b. Circuit-ready credit scoring (FICO pack) ──────────────────────

    fico_score = 0
    fico_tier = ""
    credit_class = ""
    credit_class_index = -1
    credit_confidence = 0.0
    credit_features: Dict[str, float] = {}
    credit_feature_hash = ""
    credit_model_hash = ""
    credit_circuit_version = ""
    ezkl_ready = False

    try:
        from app.services.circuit_ready_scorer import score_creditworthiness

        signals_dicts = [asdict(s) for s in all_signals]
        credit_result = score_creditworthiness(
            nonce=nonce or 0,
            total_capital_usd=total_usd,
            protocol_count=len(capital_by_protocol),
            position_count=position_count,
            capital_by_protocol=capital_by_protocol,
            signals=signals_dicts,
            defi_veteran_score=scores["defi_veteran_score"],
            recommended_tier=recommended_tier,
            account_type=account_type,
            account_exists=account_exists,
        )
        fico_score = credit_result.fico_score
        fico_tier = credit_result.fico_tier
        credit_class = credit_result.credit_class
        credit_class_index = credit_result.credit_class_index
        credit_confidence = credit_result.confidence
        credit_features = credit_result.features
        credit_feature_hash = credit_result.feature_hash
        credit_model_hash = credit_result.model_hash
        credit_circuit_version = credit_result.circuit_version
        ezkl_ready = credit_result.ezkl_ready

        logger.info(
            "Credit scoring: fico=%d tier=%s class=%s confidence=%.2f ezkl=%s",
            fico_score, fico_tier, credit_class, credit_confidence, ezkl_ready,
        )
    except Exception as exc:
        errors.append(f"credit_scoring: {exc}")
        logger.warning("Credit scoring failed: %s", exc)

    # ── 6. Build profile ──────────────────────────────────────────────────

    duration_ms = (time.time() - t0) * 1000

    profile = ReputationProfile(
        wallet_address=wallet,
        scanned_at=datetime.now(timezone.utc).isoformat(),
        account_type=account_type,
        nonce=nonce or 0,
        account_exists=account_exists,
        is_contract_deployer=(account_type == "custom"),
        total_capital_usd=round(total_usd, 2),
        capital_by_protocol=capital_by_protocol,
        protocol_count=len(capital_by_protocol),
        position_count=position_count,
        signals=all_signals,
        defi_veteran_score=scores["defi_veteran_score"],
        conviction_score=scores["conviction_score"],
        activity_score=scores["activity_score"],
        diversity_score=scores["diversity_score"],
        capital_score=scores["capital_score"],
        resilience_score=scores["resilience_score"],
        recommended_tier=recommended_tier,
        tier_reasoning=tier_reasoning,
        # Credit scoring (FICO pack)
        fico_score=fico_score,
        fico_tier=fico_tier,
        credit_class=credit_class,
        credit_class_index=credit_class_index,
        credit_confidence=credit_confidence,
        credit_features=credit_features,
        credit_feature_hash=credit_feature_hash,
        credit_model_hash=credit_model_hash,
        credit_circuit_version=credit_circuit_version,
        ezkl_ready=ezkl_ready,
        scan_duration_ms=round(duration_ms, 1),
        errors=errors,
    )
    profile.profile_hash = profile.compute_hash()

    # Cache
    _profile_cache[wallet] = (profile, time.time())

    logger.info(
        "Reputation scan: wallet=%s nonce=%s type=%s vet_score=%d tier=%d signals=%d duration=%.0fms",
        wallet[:20], nonce, account_type, scores["defi_veteran_score"],
        recommended_tier, len(all_signals), duration_ms,
    )
    return profile
