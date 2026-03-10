"""
Snapshot forecaster background worker.

Runs a periodic tick that:
1) Auto-ingests matured horizon outcomes (deterministic surrogate source)
2) Auto-scores forecasts once all configured horizons are available
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass

from app.services.snapshot_forecaster_service import get_snapshot_forecaster_service

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass
class SnapshotForecasterWorkerConfig:
    enabled: bool
    poll_seconds: float
    max_predictions_per_tick: int


class SnapshotForecasterWorker:
    def __init__(self, cfg: SnapshotForecasterWorkerConfig):
        self.cfg = cfg
        self._svc = get_snapshot_forecaster_service()

    @classmethod
    def from_env(cls) -> "SnapshotForecasterWorker":
        default_enabled = not bool(os.getenv("PYTEST_CURRENT_TEST"))
        cfg = SnapshotForecasterWorkerConfig(
            enabled=_env_bool("SNAPSHOT_FORECASTER_AUTO_ENABLED", default_enabled),
            poll_seconds=max(5.0, _env_float("SNAPSHOT_FORECASTER_AUTO_POLL_SECONDS", 15.0)),
            max_predictions_per_tick=max(10, _env_int("SNAPSHOT_FORECASTER_AUTO_MAX_PREDICTIONS", 400)),
        )
        return cls(cfg)

    async def run_forever(self) -> None:
        if not self.cfg.enabled:
            logger.info("Snapshot forecaster auto worker disabled.")
            return

        logger.info(
            "Snapshot forecaster auto worker started (poll=%.1fs max_predictions=%s)",
            self.cfg.poll_seconds,
            self.cfg.max_predictions_per_tick,
        )

        while True:
            try:
                summary = self._svc.auto_ingest_and_score(max_predictions=self.cfg.max_predictions_per_tick)
                if summary.get("outcomes_written") or summary.get("scored_predictions"):
                    logger.info(
                        "Snapshot forecaster tick: outcomes_written=%s scored_predictions=%s checked=%s",
                        summary.get("outcomes_written"),
                        summary.get("scored_predictions"),
                        summary.get("checked_predictions"),
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Snapshot forecaster worker tick failed: %s", exc, exc_info=True)

            await asyncio.sleep(self.cfg.poll_seconds)


_worker_task: asyncio.Task | None = None


async def maybe_start_snapshot_forecaster_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        return

    worker = SnapshotForecasterWorker.from_env()
    if not worker.cfg.enabled:
        logger.info("Snapshot forecaster auto worker not started (disabled via env).")
        return

    _worker_task = asyncio.create_task(
        worker.run_forever(),
        name="snapshot-forecaster-auto-worker",
    )


async def stop_snapshot_forecaster_worker() -> None:
    global _worker_task
    if not _worker_task:
        return
    if not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    _worker_task = None
