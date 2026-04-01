"""Tests for OnChainActivityService."""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.onchain_activity_service import (
    get_onchain_activity,
    enrich_reputation_data,
    _normalize_felt,
    _get_bridge_deposits,
    OnChainActivity,
    BridgeDeposit,
    _activity_cache,
)


# ---- Address normalization ----

def test_normalize_felt_short():
    assert _normalize_felt("0x123") == "0x" + "0" * 61 + "123"


def test_normalize_felt_full():
    addr = "0x" + "a" * 64
    assert _normalize_felt(addr) == "0x" + "a" * 64


def test_normalize_felt_no_prefix():
    assert _normalize_felt("abc") == "0x" + "0" * 61 + "abc"


# ---- OnChainActivity dataclass ----

def test_activity_to_dict():
    a = OnChainActivity(
        wallet_address="0x123",
        starknet_nonce=42,
        bridge_deposit_count=2,
        bridge_total_eth=1.5,
        bridge_deposits=[
            BridgeDeposit(block_number=100, amount_eth=0.75, tx_hash="0xabc"),
            BridgeDeposit(block_number=200, amount_eth=0.75, tx_hash="0xdef"),
        ],
        collateral_eth=3.14,
        total_value_usd=7850.0,
        protocol_count=3,
        protocols_active=["vesu", "endur", "wallet"],
    )
    d = a.to_dict()
    assert d["starknet_nonce"] == 42
    assert d["bridge_deposit_count"] == 2
    assert d["bridge_total_eth"] == 1.5
    assert len(d["bridge_deposits"]) == 2
    assert d["collateral_eth"] == 3.14
    assert d["protocol_count"] == 3
    assert "vesu" in d["protocols_active"]


def test_activity_to_dict_caps_deposits():
    """Bridge deposits in to_dict are capped at 20."""
    a = OnChainActivity(
        wallet_address="0x1",
        bridge_deposits=[BridgeDeposit(block_number=i, amount_eth=0.01) for i in range(30)],
    )
    d = a.to_dict()
    assert len(d["bridge_deposits"]) == 20


# ---- Mock-based integration tests ----

@pytest.fixture(autouse=True)
def clear_cache():
    _activity_cache.clear()
    yield
    _activity_cache.clear()


@pytest.mark.asyncio
async def test_get_onchain_activity_with_mocked_rpc():
    """End-to-end with mocked RPC and position scanner."""
    mock_rpc_responses = {
        "starknet_blockNumber": 1_000_000,
        "starknet_getNonce": "0x2a",  # 42
        "starknet_getEvents": {"events": [], "continuation_token": None},
    }

    async def mock_post(url, json=None, **kw):
        method = json.get("method", "")
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = {"jsonrpc": "2.0", "result": mock_rpc_responses.get(method, None), "id": 1}
        return resp

    mock_positions = {
        "total_value_usd": 5000.0,
        "protocol_count": 2,
        "position_count": 3,
        "protocols_found": ["vesu", "wallet"],
        "lending_value_usd": 2000.0,
        "staking_value_usd": 500.0,
        "wallet_value_usd": 2500.0,
        "defi_positions_value_usd": 2500.0,
    }

    with patch("app.services.onchain_activity_service.httpx.AsyncClient") as MockClient, \
         patch("app.services.onchain_activity_service._get_position_stats", return_value=mock_positions), \
         patch("app.services.onchain_activity_service._get_eth_price", return_value=2500.0):
        instance = AsyncMock()
        instance.post = mock_post
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance

        activity = await get_onchain_activity("0x123abc")

    assert activity.starknet_nonce == 42
    assert activity.total_value_usd == 5000.0
    assert activity.protocol_count == 2
    assert activity.collateral_eth == 1.0  # 2500 USD / 2500 ETH price
    assert "vesu" in activity.protocols_active


@pytest.mark.asyncio
async def test_get_onchain_activity_caches():
    """Second call should return cached result."""
    with patch("app.services.onchain_activity_service.httpx.AsyncClient") as MockClient, \
         patch("app.services.onchain_activity_service._get_position_stats", return_value={}), \
         patch("app.services.onchain_activity_service._get_eth_price", return_value=2500.0):

        async def mock_post(url, json=None, **kw):
            method = json.get("method", "")
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            results = {
                "starknet_blockNumber": 500_000,
                "starknet_getNonce": "0xa",
                "starknet_getEvents": {"events": []},
            }
            resp.json.return_value = {"jsonrpc": "2.0", "result": results.get(method), "id": 1}
            return resp

        instance = AsyncMock()
        instance.post = mock_post
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance

        a1 = await get_onchain_activity("0xCACHE")
        assert a1.starknet_nonce == 10

    # Second call should use cache (no mocks needed)
    a2 = await get_onchain_activity("0xCACHE")
    assert a2.starknet_nonce == 10


@pytest.mark.asyncio
async def test_enrich_reputation_data():
    """Verify enrichment merges real data when it's better than stored."""
    mock_activity = OnChainActivity(
        wallet_address="0x1",
        starknet_nonce=100,
        collateral_eth=5.0,
        bridge_total_eth=2.0,
        total_value_usd=15000.0,
        protocol_count=3,
    )

    with patch("app.services.onchain_activity_service.get_onchain_activity", return_value=mock_activity):
        current = {
            "transaction_count": 5,
            "collateral_eth": 0.0,
            "total_volume_eth": 0.1,
        }
        enriched = await enrich_reputation_data("0x1", current)

    assert enriched["transaction_count"] == 100  # nonce > in-app
    assert enriched["collateral_eth"] == 5.0
    assert enriched["total_volume_eth"] == 7.0  # collateral + bridge
    assert "on_chain" in enriched
    assert enriched["on_chain"]["starknet_nonce"] == 100


@pytest.mark.asyncio
async def test_enrich_keeps_higher_stored_values():
    """If stored data is higher (e.g. user has recorded txns), keep it."""
    mock_activity = OnChainActivity(
        wallet_address="0x2",
        starknet_nonce=3,
        collateral_eth=0.5,
        bridge_total_eth=0.1,
    )

    with patch("app.services.onchain_activity_service.get_onchain_activity", return_value=mock_activity):
        current = {
            "transaction_count": 50,
            "collateral_eth": 10.0,
            "total_volume_eth": 100.0,
        }
        enriched = await enrich_reputation_data("0x2", current)

    assert enriched["transaction_count"] == 50  # stored was higher
    assert enriched["collateral_eth"] == 10.0
    assert enriched["total_volume_eth"] == 100.0


@pytest.mark.asyncio
async def test_bridge_deposit_parsing():
    """Test parsing of bridge deposit events from RPC response."""
    wallet = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    wallet_norm = _normalize_felt(wallet)

    mock_events = {
        "events": [
            {
                "block_number": 7917715,
                "transaction_hash": "0xabc123",
                "keys": [
                    "0x282f521c69b2bc696552b9e141009d3c84f2df75e2e7b7716644d31e60f23b1",
                    "0x1",  # token_name
                    "0xdeadbeef",  # l1_sender
                    wallet_norm,  # l2_recipient
                ],
                "data": [
                    hex(int(1.5e18)),  # amount_low
                    "0x0",  # amount_high
                ],
            }
        ],
        "continuation_token": None,
    }

    async def mock_post(url, json=None, **kw):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json.return_value = {"jsonrpc": "2.0", "result": mock_events, "id": 1}
        return resp

    client = AsyncMock()
    client.post = mock_post

    deposits = await _get_bridge_deposits(client, wallet, 7900000, 8000000)
    assert len(deposits) == 1
    assert deposits[0].block_number == 7917715
    assert abs(deposits[0].amount_eth - 1.5) < 0.001
    assert deposits[0].tx_hash == "0xabc123"
