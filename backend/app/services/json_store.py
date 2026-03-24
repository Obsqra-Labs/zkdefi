"""
Lightweight JSON file persistence layer.

Provides a dict-like store backed by a JSON file in the project ``data/``
directory.  Reads happen from an in-memory cache; writes flush to disk
immediately (safe for single-process services).

Usage
-----
    store = JsonStore("agents")        # → data/agents.json
    store.set("key", {...})
    store.get("key")  # → dict | None
    store.all()       # → dict[str, Any]
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)


class JsonStore:
    """Thread-safe JSON-file-backed key/value store."""

    def __init__(self, name: str) -> None:
        self._path = DATA_DIR / f"{name}.json"
        self._lock = threading.Lock()
        self._cache: dict[str, Any] = self._load()

    # ── public API ───────────────────────────────────────────────────────

    def get(self, key: str) -> Any | None:
        with self._lock:
            return self._cache.get(key)

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._cache[key] = value
            self._flush()

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                self._flush()
                return True
            return False

    def all(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._cache)

    def values(self) -> list[Any]:
        with self._lock:
            return list(self._cache.values())

    def keys(self) -> list[str]:
        with self._lock:
            return list(self._cache.keys())

    def items(self):
        with self._lock:
            return list(self._cache.items())

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._flush()

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)

    # ── internals ────────────────────────────────────────────────────────

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return {}
        try:
            with open(self._path, "r") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
            logger.warning("JsonStore(%s): file is not a dict, starting fresh", self._path.stem)
            return {}
        except Exception as exc:
            logger.warning("JsonStore(%s): load error %s, starting fresh", self._path.stem, exc)
            return {}

    def _flush(self) -> None:
        try:
            tmp = self._path.with_suffix(".tmp")
            with open(tmp, "w") as f:
                json.dump(self._cache, f, indent=2, default=str)
            tmp.rename(self._path)
        except Exception as exc:
            logger.error("JsonStore(%s): flush error %s", self._path.stem, exc)
