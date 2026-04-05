"""Telemetry persistence + summary for `/portfolio/auth` flow."""

from __future__ import annotations

import os
import time
import uuid
import math
from collections import Counter
from dataclasses import dataclass
from typing import Any

from app.services.json_store import JsonStore


def _env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    raw = os.getenv(name)
    try:
        value = int(str(raw).strip()) if raw is not None else default
    except Exception:
        value = default
    if minimum is not None:
        return max(minimum, value)
    return value


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    if q <= 0:
        return float(values[0])
    if q >= 1:
        return float(values[-1])
    # Nearest-rank percentile keeps p95 aligned with tail behavior for small samples.
    idx = max(0, math.ceil(q * len(values)) - 1)
    return float(values[idx])


def _to_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
        if number < 0:
            return None
        return number
    except Exception:
        return None


def _trim_text(value: Any, *, max_chars: int = 256) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_chars]


def _now_ts() -> int:
    return int(time.time())


@dataclass(frozen=True)
class _AlertThreshold:
    id: str
    stage: str | None
    status: int | None
    min_count: int
    min_ratio: float
    label: str
    severity: str = "warning"


ALERT_THRESHOLDS: tuple[_AlertThreshold, ...] = (
    _AlertThreshold(
        id="wallet_signature_spike",
        stage="wallet_signature",
        status=None,
        min_count=3,
        min_ratio=0.20,
        label="Wallet signature failures are spiking.",
        severity="high",
    ),
    _AlertThreshold(
        id="api_404_spike",
        stage=None,
        status=404,
        min_count=2,
        min_ratio=0.10,
        label="Auth API 404 responses detected in recent flow attempts.",
    ),
    _AlertThreshold(
        id="api_401_spike",
        stage=None,
        status=401,
        min_count=4,
        min_ratio=0.20,
        label="Auth API 401 responses are elevated.",
    ),
)


class PortfolioAuthTelemetryService:
    def __init__(self) -> None:
        self._store = JsonStore("portfolio_auth_telemetry")
        self._retention_sec = _env_int("PORTFOLIO_AUTH_TELEMETRY_RETENTION_SEC", 7 * 24 * 60 * 60, minimum=3600)
        self._max_events = _env_int("PORTFOLIO_AUTH_TELEMETRY_MAX_EVENTS", 10_000, minimum=100)
        self._alert_window_sec = _env_int("PORTFOLIO_AUTH_ALERT_WINDOW_SEC", 10 * 60, minimum=60)
        self._alert_cooldown_sec = _env_int("PORTFOLIO_AUTH_ALERT_COOLDOWN_SEC", 5 * 60, minimum=30)
        self._last_alerted_at: dict[str, int] = {}

    def record(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = _now_ts()
        event = {
            "recorded_at": now,
            "outcome": _trim_text(payload.get("outcome"), max_chars=16) or "unknown",
            "failure_stage": _trim_text(payload.get("failure_stage"), max_chars=64),
            "starknet_address": _trim_text(payload.get("starknet_address"), max_chars=80),
            "chain_id": _trim_text(payload.get("chain_id"), max_chars=48),
            "total_ms": _to_number(payload.get("total_ms")),
            "start_ms": _to_number(payload.get("start_ms")),
            "sign_ms": _to_number(payload.get("sign_ms")),
            "complete_ms": _to_number(payload.get("complete_ms")),
            "api_status": int(payload.get("api_status")) if isinstance(payload.get("api_status"), int) else None,
            "error": _trim_text(payload.get("error"), max_chars=256),
            "user_agent": _trim_text(payload.get("user_agent"), max_chars=256),
            "ip": _trim_text(payload.get("ip"), max_chars=64),
            "timestamp": _trim_text(payload.get("timestamp"), max_chars=64),
        }
        self._store.set(uuid.uuid4().hex, event)
        self._prune()
        return event

    def summarize(self, *, window_sec: int = 24 * 60 * 60) -> dict[str, Any]:
        now = _now_ts()
        window_start = now - max(60, int(window_sec))
        events = [
            item
            for item in self._store.values()
            if isinstance(item, dict) and int(item.get("recorded_at", 0)) >= window_start
        ]
        events.sort(key=lambda item: int(item.get("recorded_at", 0)))

        total = len(events)
        successes = sum(1 for item in events if str(item.get("outcome")) == "success")
        failures = total - successes

        by_stage = Counter(
            str(item.get("failure_stage"))
            for item in events
            if item.get("failure_stage")
        )
        by_status = Counter(
            str(item.get("api_status"))
            for item in events
            if item.get("api_status") is not None
        )

        total_samples = sorted(
            value for value in (_to_number(item.get("total_ms")) for item in events) if value is not None
        )
        start_samples = sorted(
            value for value in (_to_number(item.get("start_ms")) for item in events) if value is not None
        )
        sign_samples = sorted(
            value for value in (_to_number(item.get("sign_ms")) for item in events) if value is not None
        )
        complete_samples = sorted(
            value for value in (_to_number(item.get("complete_ms")) for item in events) if value is not None
        )

        return {
            "window_sec": max(60, int(window_sec)),
            "window_start": window_start,
            "window_end": now,
            "totals": {
                "events": total,
                "successes": successes,
                "failures": failures,
                "success_rate_pct": round((successes / total) * 100, 2) if total else None,
            },
            "latency_ms": {
                "total": {
                    "samples": len(total_samples),
                    "p50": _percentile(total_samples, 0.50),
                    "p95": _percentile(total_samples, 0.95),
                },
                "start": {
                    "samples": len(start_samples),
                    "p50": _percentile(start_samples, 0.50),
                    "p95": _percentile(start_samples, 0.95),
                },
                "sign": {
                    "samples": len(sign_samples),
                    "p50": _percentile(sign_samples, 0.50),
                    "p95": _percentile(sign_samples, 0.95),
                },
                "complete": {
                    "samples": len(complete_samples),
                    "p50": _percentile(complete_samples, 0.50),
                    "p95": _percentile(complete_samples, 0.95),
                },
            },
            "failures": {
                "by_stage": dict(by_stage),
                "by_status": dict(by_status),
            },
            "alerts": self._compute_alerts(events, now=now),
        }

    def _compute_alerts(self, events: list[dict[str, Any]], *, now: int) -> list[dict[str, Any]]:
        window_start = now - self._alert_window_sec
        recent = [item for item in events if int(item.get("recorded_at", 0)) >= window_start]
        total = len(recent)
        if total <= 0:
            return []

        by_stage = Counter(
            str(item.get("failure_stage"))
            for item in recent
            if item.get("failure_stage")
        )
        by_status = Counter(
            int(item.get("api_status"))
            for item in recent
            if isinstance(item.get("api_status"), int)
        )

        alerts: list[dict[str, Any]] = []
        for threshold in ALERT_THRESHOLDS:
            count = 0
            if threshold.stage is not None:
                count += by_stage.get(threshold.stage, 0)
            if threshold.status is not None:
                count += by_status.get(threshold.status, 0)
            ratio = count / total
            if count < threshold.min_count or ratio < threshold.min_ratio:
                continue

            prior = self._last_alerted_at.get(threshold.id, 0)
            should_emit = (now - prior) >= self._alert_cooldown_sec
            if should_emit:
                self._last_alerted_at[threshold.id] = now

            alerts.append(
                {
                    "id": threshold.id,
                    "severity": threshold.severity,
                    "message": threshold.label,
                    "count": count,
                    "window_event_count": total,
                    "ratio": round(ratio, 4),
                    "window_sec": self._alert_window_sec,
                    "emit_log_warning": should_emit,
                }
            )
        return alerts

    def _prune(self) -> None:
        items = [
            (key, value)
            for key, value in self._store.items()
            if isinstance(value, dict)
        ]
        items.sort(key=lambda pair: int(pair[1].get("recorded_at", 0)))
        now = _now_ts()

        # Drop expired items by retention.
        for key, payload in items:
            if now - int(payload.get("recorded_at", 0)) > self._retention_sec:
                self._store.delete(key)

        # Re-load after retention drop and trim by max size.
        items = [
            (key, value)
            for key, value in self._store.items()
            if isinstance(value, dict)
        ]
        if len(items) <= self._max_events:
            return
        items.sort(key=lambda pair: int(pair[1].get("recorded_at", 0)))
        overflow = len(items) - self._max_events
        for key, _payload in items[:overflow]:
            self._store.delete(key)


_service: PortfolioAuthTelemetryService | None = None


def get_portfolio_auth_telemetry_service() -> PortfolioAuthTelemetryService:
    global _service
    if _service is None:
        _service = PortfolioAuthTelemetryService()
    return _service
