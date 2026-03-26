"""Unit tests for sepolia-mm watch delta formatting."""
from __future__ import annotations

from sepolia_mm.watch import _delta_line


def test_delta_line_first_tick_no_prev() -> None:
    state = {
        "block_number": 100,
        "total_tvl_usd": 50_000,
        "pools": [{"name": "A/B", "price": 1.0, "tick": 0, "tvl_usd": 1000}],
        "data_quality": "on-chain",
    }
    line = _delta_line(None, state, [], use_color=False)
    assert "block=100" in line
    assert "tvl=" in line
    assert "pools=1" in line
    assert "events=0" in line


def test_delta_line_shows_tvl_and_price_delta() -> None:
    prev = {
        "block_number": 100,
        "total_tvl_usd": 1000,
        "pools": [{"name": "X/Y", "price": 2.0, "tick": 0, "tvl_usd": 500}],
    }
    state = {
        "block_number": 101,
        "total_tvl_usd": 1500,
        "pools": [{"name": "X/Y", "price": 2.1, "tick": 1, "tvl_usd": 500}],
    }
    line = _delta_line(prev, state, [], use_color=False)
    assert "101" in line
    assert "Δtvl" in line or "+500" in line
    assert "X/Y" in line
