"""
OpportunityAggregator — fetches from 8 real data sources and normalises
everything into UnifiedOpportunity objects for the TradeDesk V2 surface.

Sources:
  1. Ekubo swap pairs    (ekubo_client)
  2. Ekubo LP pools      (real_pool_aggregator)
  3. Lending pools       (backend API)
  4. Staking pools       (backend API)
  5. Limit orders        (limit_orders_adapter)
  6. DCA strategies      (synthetic from dca_service config)
  7. Privacy pools       (privacy_vault_service)
  8. Dark Ledger notes   (note_store)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

import httpx

from app.models.unified_opportunity import GatingResult, Signal, UnifiedOpportunity
from app.services.circuit_breaker import retry_with_backoff
from app.services.ttl_cache import opportunity_cache

logger = logging.getLogger(__name__)

_API_BASE = "http://127.0.0.1:8003/api/v1/zkdefi"
_HTTPX_TIMEOUT = 10.0

_PRODUCT_SLUGS: dict[str, str] = {
    "swap": "private-swaps",
    "lp": "private-lp-yield",
    "lending": "private-lending",
    "staking": "private-staking",
    "limit": "private-swaps",
    "dca": "private-swaps",
    "privacy": "privacy-pools",
    "dark_ledger": "dark-ledger",
}

_BASE_RISK: dict[str, float] = {
    "swap": 45.0,
    "lp": 40.0,
    "lending": 25.0,
    "staking": 20.0,
    "limit": 50.0,
    "dca": 30.0,
    "privacy": 35.0,
    "dark_ledger": 55.0,
}

_TIER_REQUIREMENTS: dict[str, int] = {
    "swap": 1,
    "lp": 1,
    "lending": 1,
    "staking": 0,
    "limit": 2,
    "dca": 1,
    "privacy": 2,
    "dark_ledger": 3,
}


def _stable_id(type_: str, key: str) -> str:
    return hashlib.sha256(f"{type_}:{key}".encode()).hexdigest()[:16]


class OpportunityAggregator:
    """Concurrent aggregator that merges 8 opportunity sources."""

    async def fetch_all(
        self,
        user_address: str | None = None,
        types: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[UnifiedOpportunity]:
        cache_key = f"opps:{types}:{limit}:{offset}:{user_address or ''}"
        cached = await opportunity_cache.get(cache_key)
        if cached is not None:
            return cached

        tasks = [
            self._fetch_swap_pairs(),
            self._fetch_lp_pools(),
            self._fetch_lending(),
            self._fetch_staking(),
            self._fetch_limit_orders(),
            self._fetch_dca(),
            self._fetch_privacy_pools(),
            self._fetch_dark_ledger(),
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        opps: list[UnifiedOpportunity] = []
        source_names = [
            "swap", "lp", "lending", "staking",
            "limit", "dca", "privacy", "dark_ledger",
        ]
        for name, result in zip(source_names, results):
            if isinstance(result, BaseException):
                logger.warning("Fetcher %s failed: %s", name, result)
                continue
            opps.extend(result)

        if types:
            allowed = set(types)
            opps = [o for o in opps if o.type in allowed]

        opps.sort(key=lambda o: o.current_yield, reverse=True)
        opps = opps[offset : offset + limit]

        if user_address:
            await self.enrich_with_signals(opps)
            await self.enrich_with_gating(opps, user_address)

        await opportunity_cache.set(cache_key, opps, ttl=30)
        return opps

    # ── 1. Ekubo swap pairs ──────────────────────────────────────────

    async def _fetch_swap_pairs(self) -> list[UnifiedOpportunity]:
        try:
            from app.services.ekubo_client import get_overview_pairs
            from app.services.real_pool_aggregator import (
                _estimated_fee_apy,
                _extract_items,
                _pair_symbol,
                _pool_id,
                _tvl_usd,
                _volume_24h_usd,
            )

            payload = await retry_with_backoff(
                get_overview_pairs,
                chain_id=None,
                min_tvl_usd=1000,
                max_retries=2,
                base_delay=1.0,
            )
            items = _extract_items(payload)
            opps: list[UnifiedOpportunity] = []
            for idx, item in enumerate(items[:30]):
                pair = _pair_symbol(item)
                tvl = _tvl_usd(item)
                vol = _volume_24h_usd(item)
                apy = _estimated_fee_apy(item, tvl)
                pid = _pool_id(item, idx)
                opps.append(UnifiedOpportunity(
                    id=_stable_id("swap", pid),
                    type="swap",
                    product_slug=_PRODUCT_SLUGS["swap"],
                    title=f"Swap {pair}",
                    pair=pair,
                    protocol="Ekubo",
                    current_yield=apy,
                    risk_score=_BASE_RISK["swap"],
                    tvl_usd=tvl,
                    volume_24h=vol,
                    privacy_level="shielded",
                    execution_mode="relayer",
                    calldata_builder="ekubo_swap",
                    metadata={"pool_id": pid},
                ))
            return opps
        except Exception as exc:
            logger.error("_fetch_swap_pairs failed: %s", exc)
            return []

    # ── 2. Ekubo LP pools ───────────────────────────────────────────

    async def _fetch_lp_pools(self) -> list[UnifiedOpportunity]:
        try:
            from app.services.real_pool_aggregator import EkuboPoolAggregator

            agg = EkuboPoolAggregator()
            pools = await agg.fetch_pools(min_tvl_usd=0, limit=50)
            opps: list[UnifiedOpportunity] = []
            for pool in pools:
                opps.append(UnifiedOpportunity(
                    id=_stable_id("lp", pool.pool_id),
                    type="lp",
                    product_slug=_PRODUCT_SLUGS["lp"],
                    title=f"LP {pool.pair}",
                    pair=pool.pair,
                    protocol=pool.protocol,
                    current_yield=pool.estimated_fee_apy_pct,
                    risk_score=_BASE_RISK["lp"],
                    tvl_usd=pool.tvl_usd,
                    volume_24h=pool.volume_24h_usd,
                    privacy_level="shielded",
                    execution_mode="relayer",
                    calldata_builder="ekubo_lp",
                    metadata={
                        "pool_id": pool.pool_id,
                        "fee_ratio": pool.fee_ratio,
                    },
                ))
            return opps
        except Exception as exc:
            logger.error("_fetch_lp_pools failed: %s", exc)
            return []

    # ── 3. Lending pools ─────────────────────────────────────────────

    async def _fetch_lending(self) -> list[UnifiedOpportunity]:
        try:
            async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
                r = await client.get(f"{_API_BASE}/lending/pool")
                r.raise_for_status()
                data = r.json()

            pools = data if isinstance(data, list) else data.get(
                "pools", data.get("data", [data] if isinstance(data, dict) else [])
            )
            if isinstance(pools, dict):
                pools = [pools]

            opps: list[UnifiedOpportunity] = []
            for pool in pools:
                if not isinstance(pool, dict):
                    continue
                token = pool.get("token", pool.get("asset", "UNKNOWN"))
                supply_apy = float(pool.get("supply_apy", pool.get("supplyApy", 0)))
                total_supplied = float(
                    pool.get("total_supplied", pool.get("totalSupplied", 0))
                )
                total_borrowed = float(
                    pool.get("total_borrowed", pool.get("totalBorrowed", 0))
                )
                utilization = float(
                    pool.get("utilization", pool.get("utilizationRate", 0))
                )
                borrow_apy = float(pool.get("borrow_apy", pool.get("borrowApy", 0)))
                pid = pool.get("pool_id", pool.get("id", f"lending-{token}"))
                opps.append(UnifiedOpportunity(
                    id=_stable_id("lending", str(pid)),
                    type="lending",
                    product_slug=_PRODUCT_SLUGS["lending"],
                    title=f"Lend {token}",
                    pair=f"{token}/USD",
                    protocol="zkde.fi",
                    current_yield=supply_apy,
                    risk_score=_BASE_RISK["lending"],
                    tvl_usd=total_supplied,
                    volume_24h=total_borrowed,
                    privacy_level="shielded",
                    execution_mode="wallet",
                    metadata={
                        "supply_apy": supply_apy,
                        "borrow_apy": borrow_apy,
                        "utilization": utilization,
                    },
                ))
            return opps
        except Exception as exc:
            logger.error("_fetch_lending failed: %s", exc)
            return []

    # ── 4. Staking pools ─────────────────────────────────────────────

    async def _fetch_staking(self) -> list[UnifiedOpportunity]:
        try:
            async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
                r = await client.get(f"{_API_BASE}/staking/pools")
                r.raise_for_status()
                data = r.json()

            pools = data if isinstance(data, list) else data.get(
                "pools", data.get("data", [data] if isinstance(data, dict) else [])
            )
            if isinstance(pools, dict):
                pools = [pools]

            opps: list[UnifiedOpportunity] = []
            for pool in pools:
                if not isinstance(pool, dict):
                    continue
                token = pool.get("token", pool.get("asset", "STRK"))
                apr = float(
                    pool.get("apr", pool.get("APR", pool.get("apy", 0)))
                )
                tvl = float(
                    pool.get("tvl_usd", pool.get("tvl", pool.get("total_staked", 0)))
                )
                name = pool.get("name", pool.get("validator", f"Stake {token}"))
                pid = pool.get("pool_id", pool.get("id", f"staking-{name}"))
                opps.append(UnifiedOpportunity(
                    id=_stable_id("staking", str(pid)),
                    type="staking",
                    product_slug=_PRODUCT_SLUGS["staking"],
                    title=f"Stake {token} — {name}",
                    pair=f"{token}/STRK",
                    protocol="zkde.fi",
                    current_yield=apr,
                    risk_score=_BASE_RISK["staking"],
                    tvl_usd=tvl,
                    volume_24h=0.0,
                    privacy_level="shielded",
                    execution_mode="wallet",
                    metadata={"apr": apr, "validator": name},
                ))
            return opps
        except Exception as exc:
            logger.error("_fetch_staking failed: %s", exc)
            return []

    # ── 5. Limit orders ─────────────────────────────────────────────

    async def _fetch_limit_orders(self) -> list[UnifiedOpportunity]:
        try:
            from app.services.ekubo.limit_orders_adapter import get_active_orders
            from app.services.real_pool_aggregator import _addr_to_symbol

            orders = get_active_orders()
            opps: list[UnifiedOpportunity] = []
            for order in orders:
                sell_sym = _addr_to_symbol(order.get("sell_token", ""))
                buy_sym = _addr_to_symbol(order.get("buy_token", ""))
                amount = int(order.get("amount_wei", 0))
                oid = order.get("order_id", order.get("tx_hash", "unknown"))
                opps.append(UnifiedOpportunity(
                    id=_stable_id("limit", str(oid)),
                    type="limit",
                    product_slug=_PRODUCT_SLUGS["limit"],
                    title=f"Limit {sell_sym}→{buy_sym}",
                    pair=f"{sell_sym}/{buy_sym}",
                    protocol="Ekubo",
                    current_yield=0.0,
                    risk_score=_BASE_RISK["limit"],
                    tvl_usd=0.0,
                    volume_24h=float(amount) / 1e18,
                    privacy_level="shielded",
                    execution_mode="relayer",
                    calldata_builder="ekubo_limit",
                    metadata={
                        "order_id": oid,
                        "limit_tick": order.get("limit_tick"),
                        "created_at": order.get("created_at"),
                    },
                ))
            return opps
        except Exception as exc:
            logger.error("_fetch_limit_orders failed: %s", exc)
            return []

    # ── 6. DCA strategies ────────────────────────────────────────────

    async def _fetch_dca(self) -> list[UnifiedOpportunity]:
        try:
            from app.services.dca_strategy_store import get_all_active

            active = get_all_active()
            if not active:
                # Fallback: show two default templates so the UI isn't empty
                return [
                    UnifiedOpportunity(
                        id=_stable_id("dca", "eth-usdc"),
                        type="dca",
                        product_slug=_PRODUCT_SLUGS["dca"],
                        title="DCA ETH → USDC",
                        pair="ETH/USDC",
                        protocol="zkde.fi",
                        current_yield=0.0,
                        risk_score=_BASE_RISK["dca"],
                        tvl_usd=0.0,
                        volume_24h=0.0,
                        privacy_level="shielded",
                        execution_mode="relayer",
                        calldata_builder="dca_swap",
                        metadata={"interval": "1h", "strategy": "dollar_cost_average"},
                    ),
                    UnifiedOpportunity(
                        id=_stable_id("dca", "strk-eth"),
                        type="dca",
                        product_slug=_PRODUCT_SLUGS["dca"],
                        title="DCA STRK → ETH",
                        pair="STRK/ETH",
                        protocol="zkde.fi",
                        current_yield=0.0,
                        risk_score=_BASE_RISK["dca"],
                        tvl_usd=0.0,
                        volume_24h=0.0,
                        privacy_level="shielded",
                        execution_mode="relayer",
                        calldata_builder="dca_swap",
                        metadata={"interval": "1h", "strategy": "dollar_cost_average"},
                    ),
                ]

            results: list[UnifiedOpportunity] = []
            for strat in active:
                pair = f"{strat['token_in'][:10]}/{strat['token_out'][:10]}"
                results.append(
                    UnifiedOpportunity(
                        id=_stable_id("dca", strat["id"]),
                        type="dca",
                        product_slug=_PRODUCT_SLUGS["dca"],
                        title=strat.get("label", f"DCA {pair}"),
                        pair=pair,
                        protocol="zkde.fi",
                        current_yield=0.0,
                        risk_score=_BASE_RISK["dca"],
                        tvl_usd=strat.get("total_volume", 0.0),
                        volume_24h=0.0,
                        privacy_level="shielded",
                        execution_mode="relayer",
                        calldata_builder="dca_swap",
                        metadata={
                            "interval_secs": strat.get("interval_secs", 3600),
                            "strategy": "dollar_cost_average",
                            "strategy_id": strat["id"],
                            "user_address": strat.get("user_address"),
                        },
                    )
                )
            return results
        except Exception as exc:
            logger.error("_fetch_dca failed: %s", exc)
            return []

    # ── 7. Privacy pools ─────────────────────────────────────────────

    async def _fetch_privacy_pools(self) -> list[UnifiedOpportunity]:
        try:
            from app.services.privacy_vault_service import get_privacy_vault_service

            svc = get_privacy_vault_service()
            deposit_count = sum(
                len(commitments) for commitments in svc.nullifier_store.values()
            )
            return [
                UnifiedOpportunity(
                    id=_stable_id("privacy", "shielded-pool"),
                    type="privacy",
                    product_slug=_PRODUCT_SLUGS["privacy"],
                    title="Shielded Pool Deposit",
                    pair="ANY/SHIELDED",
                    protocol="zkde.fi",
                    current_yield=0.0,
                    risk_score=_BASE_RISK["privacy"],
                    tvl_usd=0.0,
                    volume_24h=0.0,
                    privacy_level="fully_private",
                    execution_mode="relayer",
                    calldata_builder="privacy_deposit",
                    metadata={"active_commitments": deposit_count},
                ),
            ]
        except Exception as exc:
            logger.error("_fetch_privacy_pools failed: %s", exc)
            return []

    # ── 8. Dark Ledger ───────────────────────────────────────────────

    async def _fetch_dark_ledger(self) -> list[UnifiedOpportunity]:
        try:
            from app.services.note_store import NoteStore

            store = NoteStore()
            notes = store.list_notes(vault_id="default", status="OPEN")
            total_value = sum(n.get("amount_wei", 0) for n in notes) / 1e18
            return [
                UnifiedOpportunity(
                    id=_stable_id("dark_ledger", "dark-pool"),
                    type="dark_ledger",
                    product_slug=_PRODUCT_SLUGS["dark_ledger"],
                    title="Dark Ledger Pool",
                    pair="ANY/PRIVATE",
                    protocol="zkde.fi",
                    current_yield=0.0,
                    risk_score=_BASE_RISK["dark_ledger"],
                    tvl_usd=total_value,
                    volume_24h=0.0,
                    privacy_level="fully_private",
                    execution_mode="relayer",
                    calldata_builder="dark_ledger",
                    metadata={"open_notes": len(notes)},
                ),
            ]
        except Exception as exc:
            logger.error("_fetch_dark_ledger failed: %s", exc)
            return []

    # ── Enrichment ───────────────────────────────────────────────────

    async def enrich_with_signals(self, opps: list[UnifiedOpportunity]) -> None:
        """Fetch top signals from the signals API and merge into opportunities."""
        try:
            async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
                r = await client.get(f"{_API_BASE}/signals/top")
                r.raise_for_status()
                data = r.json()

            signals: list[dict[str, Any]] = (
                data
                if isinstance(data, list)
                else data.get("signals", data.get("data", []))
            )
            sig_by_pair: dict[str, dict[str, Any]] = {}
            for s in signals:
                if isinstance(s, dict):
                    pair_key = s.get(
                        "pair", s.get("pool", "")
                    ).strip().upper()
                    if pair_key:
                        sig_by_pair[pair_key] = s

            for opp in opps:
                sig = sig_by_pair.get(opp.pair.upper())
                if not sig:
                    continue
                opp.signal = Signal(
                    yield_prediction=float(
                        sig.get("yield_prediction", sig.get("predicted_apy", 0))
                    ),
                    risk_prediction=float(
                        sig.get("risk_prediction", sig.get("predicted_risk", 50))
                    ),
                    confidence=float(sig.get("confidence", 0.5)),
                    recommended=bool(sig.get("recommended", False)),
                )
                opp.confidence = opp.signal.confidence
                opp.recommended = opp.signal.recommended
                if sig.get("narrative"):
                    opp.ai_narrative = sig["narrative"]
        except Exception as exc:
            logger.warning("enrich_with_signals failed: %s", exc)

    async def enrich_with_gating(
        self, opps: list[UnifiedOpportunity], user_address: str
    ) -> None:
        """Fetch user reputation tier and compute per-opportunity gating."""
        try:
            async with httpx.AsyncClient(timeout=_HTTPX_TIMEOUT) as client:
                r = await client.get(
                    f"{_API_BASE}/reputation/score",
                    params={"address": user_address},
                )
                r.raise_for_status()
                rep = r.json()
            tier = int(rep.get("tier", rep.get("trust_tier", 0)))
        except Exception as exc:
            logger.warning("enrich_with_gating: reputation fetch failed: %s", exc)
            tier = 0

        for opp in opps:
            required = _TIER_REQUIREMENTS.get(opp.type, 1)
            if tier >= required:
                opp.gating = GatingResult(status="unlocked")
            elif tier == required - 1:
                opp.gating = GatingResult(
                    status="advisory",
                    reason=f"Tier {required} recommended",
                    required_tier=required,
                )
            else:
                opp.gating = GatingResult(
                    status="locked",
                    reason=f"Requires trust tier {required}",
                    required_tier=required,
                )


# ── Singleton ────────────────────────────────────────────────────────
_aggregator: OpportunityAggregator | None = None


def get_aggregator() -> OpportunityAggregator:
    global _aggregator
    if _aggregator is None:
        _aggregator = OpportunityAggregator()
    return _aggregator
