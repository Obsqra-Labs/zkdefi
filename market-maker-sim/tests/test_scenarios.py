"""Unit tests for scenario loader."""
from __future__ import annotations

import pytest
from bots.scenario_loader import list_scenarios, load_scenario


def test_list_scenarios() -> None:
    scenarios = list_scenarios()
    assert isinstance(scenarios, list)
    assert len(scenarios) >= 5  # We created 6 presets
    names = [s.get("name") for s in scenarios]
    assert "Flash Crash" in names
    assert "Slow Bleed" in names
    assert "Whale Dump" in names


def test_load_scenario_flash_crash() -> None:
    data = load_scenario("flash_crash")
    assert data["scenario"] == "depeg_down"
    assert data["severity"] == 0.40
    assert data["duration_ticks"] == 30


def test_load_scenario_cascade_failure() -> None:
    data = load_scenario("cascade_failure")
    assert "steps" in data
    assert len(data["steps"]) == 2


def test_load_scenario_not_found() -> None:
    with pytest.raises(FileNotFoundError, match="not found"):
        load_scenario("nonexistent_scenario_xyz")
