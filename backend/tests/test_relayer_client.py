"""Tests for Relayer Client Service."""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from types import SimpleNamespace

from app.services.relayer_client import RelayerClient, get_relayer_client


@pytest.fixture
def relayer_client():
    """Create test relayer client."""
    return RelayerClient(relayer_url="http://localhost:8004", timeout=5.0)


class MockResponse:
    """Mock httpx response."""
    def __init__(self, status_code=200, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text

    def json(self):
        return self._json


class MockAsyncClient:
    """Mock httpx.AsyncClient as async context manager."""

    def __init__(self, get_response=None, post_response=None, post_side_effect=None, get_side_effect=None):
        default_nonce = MockResponse(200, {"nonce": 0})
        self._get_response = get_response or default_nonce
        self._post_response = post_response or MockResponse(200, {})
        self._post_side_effect = post_side_effect
        self._get_side_effect = get_side_effect

    def __call__(self, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, *args, **kwargs):
        if self._get_side_effect:
            raise self._get_side_effect
        return self._get_response

    async def post(self, *args, **kwargs):
        if self._post_side_effect:
            raise self._post_side_effect
        return self._post_response


@pytest.mark.asyncio
async def test_submit_call_success(relayer_client):
    """Test successful contract call submission."""
    mock = MockAsyncClient(
        post_response=MockResponse(200, {"tx_hash": "0x123abc456def789012345", "status": "pending"}),
        get_response=MockResponse(200, {"nonce": 0}),
    )
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        result = await relayer_client.submit_call(
            address="0x123...",
            adapter="lending",
            method="supply",
            calldata={"amount": 1000, "asset": "USDC"},
        )
        assert result["status"] == "pending"
        assert result["tx_hash"] == "0x123abc456def789012345"
        assert result["error"] is None
        assert "submitted_at" in result


@pytest.mark.asyncio
async def test_submit_call_relayer_error(relayer_client):
    """Test handling of relayer errors."""
    mock = MockAsyncClient(
        post_response=MockResponse(500, text="Internal Server Error"),
        get_response=MockResponse(200, {"nonce": 0}),
    )
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        result = await relayer_client.submit_call(
            address="0x123...",
            adapter="lending",
            method="supply",
            calldata={"amount": 1000},
        )
        assert result["status"] == "rejected"
        assert result["tx_hash"] is None
        assert "error" in result


@pytest.mark.asyncio
async def test_submit_call_timeout(relayer_client):
    """Test timeout handling."""
    import httpx

    mock = MockAsyncClient(
        post_side_effect=httpx.TimeoutException("timeout"),
        get_response=MockResponse(200, {"nonce": 0}),
    )
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        result = await relayer_client.submit_call(
            address="0x123...",
            adapter="lending",
            method="supply",
            calldata={"amount": 1000},
        )
        assert result["status"] == "rejected"
        assert result["error"] == "Relayer timeout"


@pytest.mark.asyncio
async def test_get_tx_status_confirmed(relayer_client):
    """Test transaction confirmation polling."""
    mock = MockAsyncClient(
        get_response=MockResponse(200, {
            "tx_hash": "0x123abc",
            "status": "confirmed",
            "block_number": 12345,
            "confirmed_at": "2026-03-08T10:00:00Z",
        }),
    )
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        result = await relayer_client.get_tx_status("0x123abc")
        assert result["status"] == "confirmed"
        assert result["block_number"] == 12345
        assert result["confirmed_at"] == "2026-03-08T10:00:00Z"


@pytest.mark.asyncio
async def test_get_tx_status_pending(relayer_client):
    """Test transaction still pending."""
    mock = MockAsyncClient(
        get_response=MockResponse(200, {"status": "pending", "block_number": None}),
    )
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        result = await relayer_client.get_tx_status("0x123abc")
        assert result["status"] == "pending"
        assert result["block_number"] is None


@pytest.mark.asyncio
async def test_get_tx_status_not_found(relayer_client):
    """Test transaction not found."""
    mock = MockAsyncClient(get_response=MockResponse(404))
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        result = await relayer_client.get_tx_status("0xnonexistent")
        assert result["status"] == "not_found"


@pytest.mark.asyncio
async def test_nonce_caching(relayer_client):
    """Test nonce caching via local cache."""
    relayer_client._nonce_cache["0x123..."] = 42
    nonce = await relayer_client._get_nonce("0x123...")
    assert nonce == 42

    relayer_client._nonce_cache["0x123..."] = 43
    nonce2 = await relayer_client._get_nonce("0x123...")
    assert nonce2 == 43


@pytest.mark.asyncio
async def test_check_relayer_health(relayer_client):
    """Test relayer health check."""
    mock = MockAsyncClient(get_response=MockResponse(200))
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        health = await relayer_client.check_relayer_health()
        assert health is True


@pytest.mark.asyncio
async def test_check_relayer_health_down(relayer_client):
    """Test relayer health check when down."""
    mock = MockAsyncClient(get_response=MockResponse(503))
    with patch("app.services.relayer_client.httpx.AsyncClient", return_value=mock):
        health = await relayer_client.check_relayer_health()
        assert health is False


def test_reset_nonce_cache(relayer_client):
    """Test nonce cache reset."""
    relayer_client._nonce_cache["0x123"] = 42
    relayer_client._nonce_cache["0x456"] = 99

    relayer_client.reset_nonce_cache("0x123")
    assert "0x123" not in relayer_client._nonce_cache
    assert relayer_client._nonce_cache["0x456"] == 99

    relayer_client.reset_nonce_cache()
    assert len(relayer_client._nonce_cache) == 0


def test_singleton_pattern():
    """Test singleton instance."""
    client1 = get_relayer_client()
    client2 = get_relayer_client()
    assert client1 is client2
