from __future__ import annotations

import asyncio
import contextlib
import random
import time
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Any, Deque


@dataclass
class BotFlags:
    price_alignment: bool = True
    volatility: bool = True
    liquidity_manager: bool = True


@dataclass
class MarketState:
    timestamp: float
    price: float
    peg_price: float
    tvl_usd: float
    liquidity_zkdeth: float
    liquidity_zkdai: float
    volume_24h: float = 0.0
    fees_24h: float = 0.0
    apr: float = 0.0
    trade_count_24h: int = 0
    pnl_sim_usd: float = 0.0
    bots: BotFlags = field(default_factory=BotFlags)
    active_scenario: str | None = None


@dataclass
class Event:
    ts: float
    category: str
    message: str
    payload: dict[str, Any] = field(default_factory=dict)


class MarketMakerEngine:
    def __init__(self, tick_interval_sec: float, start_price: float, peg_price: float, start_tvl_usd: float, zkdeth: float, zkdai: float) -> None:
        now = time.time()
        self.tick_interval_sec = tick_interval_sec
        self.state = MarketState(
            timestamp=now,
            price=start_price,
            peg_price=peg_price,
            tvl_usd=start_tvl_usd,
            liquidity_zkdeth=zkdeth,
            liquidity_zkdai=zkdai,
        )
        self.events: Deque[Event] = deque(maxlen=2500)
        self._lock = asyncio.Lock()
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._scenario_ticks_remaining = 0
        self._scenario_price_multiplier = 1.0

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        await self._emit("system", "Simulation engine started")

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        await self._emit("system", "Simulation engine stopped")

    async def set_peg(self, peg_price: float) -> None:
        async with self._lock:
            self.state.peg_price = max(1.0, peg_price)
            await self._emit("admin", "Peg updated", {"peg_price": self.state.peg_price})

    async def set_bot(self, bot_name: str, enabled: bool) -> None:
        async with self._lock:
            if not hasattr(self.state.bots, bot_name):
                raise ValueError(f"Unknown bot {bot_name}")
            setattr(self.state.bots, bot_name, enabled)
            await self._emit("admin", "Bot toggled", {"bot": bot_name, "enabled": enabled})

    async def inject_scenario(self, scenario: str, severity: float, duration_ticks: int) -> None:
        severity = max(0.01, min(severity, 0.95))
        duration_ticks = max(3, min(duration_ticks, 1800))
        async with self._lock:
            if scenario == "depeg_down":
                self._scenario_price_multiplier = 1.0 - severity
            elif scenario == "depeg_up":
                self._scenario_price_multiplier = 1.0 + severity
            elif scenario == "liquidity_drain":
                self.state.liquidity_zkdeth *= (1.0 - severity * 0.6)
                self.state.liquidity_zkdai *= (1.0 - severity * 0.6)
                self._scenario_price_multiplier = 1.0 + (severity * random.choice([-1.0, 1.0]) * 0.5)
            else:
                raise ValueError("Unsupported scenario")

            self._scenario_ticks_remaining = duration_ticks
            self.state.active_scenario = scenario
            await self._emit(
                "scenario",
                "Black swan injected",
                {"scenario": scenario, "severity": severity, "duration_ticks": duration_ticks},
            )

    async def force_trade(self, side: str, notional_usd: float) -> None:
        notional_usd = max(10.0, notional_usd)
        impact = min(0.08, notional_usd / max(1.0, self.state.tvl_usd * 0.35))
        async with self._lock:
            if side == "buy":
                self.state.price *= (1.0 + impact)
            elif side == "sell":
                self.state.price *= (1.0 - impact)
            else:
                raise ValueError("side must be buy or sell")
            self.state.volume_24h += notional_usd
            self.state.trade_count_24h += 1
            self.state.fees_24h += notional_usd * 0.003
            await self._emit("trade", "Manual trade executed", {"side": side, "notional_usd": notional_usd})

    async def snapshot(self) -> dict[str, Any]:
        async with self._lock:
            return asdict(self.state)

    async def recent_events(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 1000))
        return [asdict(ev) for ev in list(self.events)[-limit:]]

    async def _loop(self) -> None:
        while self._running:
            await asyncio.sleep(self.tick_interval_sec)
            await self._tick_once()

    async def _tick_once(self) -> None:
        async with self._lock:
            self.state.timestamp = time.time()
            base_drift = random.uniform(-0.0018, 0.0018)
            self.state.price *= (1.0 + base_drift)

            if self.state.bots.price_alignment:
                delta = (self.state.peg_price - self.state.price) / max(1.0, self.state.peg_price)
                self.state.price *= (1.0 + max(-0.004, min(0.004, delta * 0.4)))

            if self.state.bots.volatility:
                burst = random.uniform(-0.01, 0.01)
                if random.random() < 0.13:
                    self.state.price *= (1.0 + burst)
                    self.state.volume_24h += random.uniform(2_500, 45_000)
                    self.state.trade_count_24h += random.randint(1, 7)

            if self.state.bots.liquidity_manager:
                gap = abs(self.state.price - self.state.peg_price) / max(1.0, self.state.peg_price)
                if gap > 0.08:
                    self.state.tvl_usd *= 0.997
                else:
                    self.state.tvl_usd *= 1.0004

            if self._scenario_ticks_remaining > 0:
                self.state.price *= self._scenario_price_multiplier
                self._scenario_ticks_remaining -= 1
                self.state.volume_24h += random.uniform(8_000, 90_000)
                if self._scenario_ticks_remaining == 0:
                    self.state.active_scenario = None
                    self._scenario_price_multiplier = 1.0
                    await self._emit("scenario", "Scenario ended")

            self.state.price = max(10.0, self.state.price)
            self.state.fees_24h += self.state.volume_24h * 0.0000015
            self.state.apr = ((self.state.fees_24h * 365.0) / max(1.0, self.state.tvl_usd)) * 100.0
            self.state.pnl_sim_usd = (self.state.price - self.state.peg_price) * (self.state.liquidity_zkdeth * 0.2)

            if random.random() < 0.07:
                side = random.choice(["buy", "sell"])
                notional = random.uniform(400, 15_000)
                await self._emit("trade", "Bot trade", {"side": side, "notional_usd": round(notional, 2)})

    async def _emit(self, category: str, message: str, payload: dict[str, Any] | None = None) -> None:
        self.events.append(Event(ts=time.time(), category=category, message=message, payload=payload or {}))
