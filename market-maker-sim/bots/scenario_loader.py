"""Scenario preset loader.

Reads JSON scenario files from the scenarios/ directory and provides them
to the engine and API for easy triggering by name.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


SCENARIOS_DIR = Path(__file__).parent.parent / "scenarios"


def list_scenarios() -> list[dict[str, Any]]:
    """Return metadata for all available scenario presets."""
    results: list[dict[str, Any]] = []
    if not SCENARIOS_DIR.is_dir():
        return results
    for path in sorted(SCENARIOS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            data["_file"] = path.stem
            results.append(data)
        except (json.JSONDecodeError, OSError):
            continue
    return results


def load_scenario(name: str) -> dict[str, Any]:
    """Load a single scenario preset by file stem name.

    Raises FileNotFoundError if the scenario doesn't exist.
    """
    path = SCENARIOS_DIR / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Scenario '{name}' not found in {SCENARIOS_DIR}")
    data = json.loads(path.read_text())
    data["_file"] = path.stem
    return data
