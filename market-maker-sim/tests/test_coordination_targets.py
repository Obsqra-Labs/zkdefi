from __future__ import annotations

from bots.onchain_engine import OnChainEngine


def test_coordination_target_pairs_defaults_to_volume_targets_when_explicit_empty() -> None:
    engine = OnChainEngine(
        wallet=None,
        pools=[],
        coordination_target_pairs=[],
        coordination_volume_targets_usd={
            "zkdai/zkdeth": 200000,
            "strk/zkdeth": 75000,
            "zkdai/strk": 75000,
        },
    )

    pairs = engine._coordination_target_pairs(
        {
            "pools": [
                {"name": "STRK/ETH"},
                {"name": "zkdAI/zkdETH"},
                {"name": "STRK/zkdETH"},
                {"name": "zkdAI/STRK"},
            ]
        }
    )

    assert pairs == ["zkdAI/zkdETH", "STRK/zkdETH", "zkdAI/STRK"]


def test_coordination_target_pairs_uses_explicit_targets_over_volume_targets() -> None:
    engine = OnChainEngine(
        wallet=None,
        pools=[],
        coordination_target_pairs=["STRK/ETH", "zkdAI/zkdETH"],
        coordination_volume_targets_usd={
            "zkdai/zkdeth": 200000,
            "strk/zkdeth": 75000,
        },
    )

    pairs = engine._coordination_target_pairs(
        {
            "pools": [
                {"name": "STRK/ETH"},
                {"name": "zkdAI/zkdETH"},
                {"name": "STRK/zkdETH"},
            ]
        }
    )

    assert pairs == ["STRK/ETH", "zkdAI/zkdETH"]
