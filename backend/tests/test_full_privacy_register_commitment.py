from __future__ import annotations

from unittest.mock import MagicMock

import pytest

import app.api.routes.full_privacy as full_privacy_routes


@pytest.mark.asyncio
async def test_register_commitment_can_skip_onchain_wait(monkeypatch):
    mock_svc = MagicMock()
    mock_svc.register_commitment.return_value = {
        "leaf_index": 3,
        "merkle_root": "0xabc",
        "path_elements": ["0x1", "0x2"],
        "path_indices": [0, 1],
    }
    monkeypatch.setattr(full_privacy_routes, "get_full_privacy_service", lambda: mock_svc)

    created_tasks: list[object] = []

    async def fake_register_root_on_chain(root: int, max_retries: int = 3) -> bool:
        return True

    def fake_create_task(coro):
        created_tasks.append(coro)
        try:
            coro.close()
        except Exception:
            pass
        return MagicMock()

    monkeypatch.setattr(full_privacy_routes, "register_root_on_chain", fake_register_root_on_chain)
    monkeypatch.setattr(full_privacy_routes.asyncio, "create_task", fake_create_task)

    resp = await full_privacy_routes.register_commitment(
        full_privacy_routes.RegisterCommitmentRequest(commitment="0x1234", wait_for_onchain=False),
        _caller="0xabc",
    )

    assert resp.leaf_index == 3
    assert len(created_tasks) == 1


@pytest.mark.asyncio
async def test_register_commitment_waits_onchain_by_default(monkeypatch):
    mock_svc = MagicMock()
    mock_svc.register_commitment.return_value = {
        "leaf_index": 1,
        "merkle_root": "0xdef",
        "path_elements": ["0x5"],
        "path_indices": [1],
    }
    monkeypatch.setattr(full_privacy_routes, "get_full_privacy_service", lambda: mock_svc)

    awaited: list[tuple[int, int]] = []

    async def fake_register_root_on_chain(root: int, max_retries: int = 3) -> bool:
        awaited.append((root, max_retries))
        return True

    monkeypatch.setattr(full_privacy_routes, "register_root_on_chain", fake_register_root_on_chain)

    resp = await full_privacy_routes.register_commitment(
        full_privacy_routes.RegisterCommitmentRequest(commitment="0x5678"),
        _caller="0xabc",
    )

    assert resp.leaf_index == 1
    assert awaited == [(int("0xdef", 16), 3)]
