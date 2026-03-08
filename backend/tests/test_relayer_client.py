"""Tests for Relayer Client Service."""

import pytest
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.relayer_client import RelayerClient, get_relayer_client


@pytest.fixture
def relayer_client():
    """Create test relayer client."""
    return RelayerClient(relayer_url="http://localhost:8004", timeout=5.0)


@pytest.mark.asyncio
async def test_submit_call_success(relayer_client):
    """Test successful contract call submission."""
    with patch("httpx.AsyncClient") as mock_client:
        # Mock relayer response
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "tx_hash": "0x123abc456def789012345",
            "status": "pending"
        }
        
        mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
        
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
    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        
        mock_client.return_value.__aenter__.return_value.post.return_value = mock_response
        
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
    
    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post.side_effect = httpx.TimeoutException("timeout")
        
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
    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "tx_hash": "0x123abc",
            "status": "confirmed",
            "block_number": 12345,
            "confirmed_at": "2026-03-08T10:00:00Z"
        }
        
        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
        
        result = await relayer_client.get_tx_status("0x123abc")
        
        assert result["status"] == "confirmed"
        assert result["block_number"] == 12345
        assert result["confirmed_at"] == "2026-03-08T10:00:00Z"


@pytest.mark.asyncio
async def test_get_tx_status_pending(relayer_client):
    """Test transaction still pending."""
    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "status": "pending",
            "block_number": None
        }
        
        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
        
        result = await relayer_client.get_tx_status("0x123abc")
        
        assert result["status"] == "pending"
        assert result["block_number"] is None


@pytest.mark.asyncio
async def test_get_tx_status_not_found(relayer_client):
    """Test transaction not found."""
    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 404
        
        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
        
        result = await relayer_client.get_tx_status("0xnonexistent")
        
        assert result["status"] == "not_found"


@pytest.mark.asyncio
async def test_nonce_caching(relayer_client):
    """Test nonce caching."""
    address = "0x123..."
    
    # First call should fetch from relayer
    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"nonce": 42}
        
        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
        
        nonce1 = await relayer_client._get_nonce(address)
        assert nonce1 == 42
    
    # Second call should use cache
    nonce2 = await relayer_client._get_nonce(address)
    assert nonce2 == 42
    
    # Increment should happen after successful submit
    relayer_client._nonce_cache[address] = 43
    nonce3 = await relayer_client._get_nonce(address)
    assert nonce3 == 43


@pytest.mark.asyncio
async def test_check_relayer_health(relayer_client):
    """Test relayer health check."""
    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 200
        
        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
        
        health = await relayer_client.check_relayer_health()
        assert health is True


@pytest.mark.asyncio
async def test_check_relayer_health_down(relayer_client):
    """Test relayer health check when down."""
    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.status_code = 503
        
        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
        
        health = await relayer_client.check_relayer_health()
        assert health is False


def test_reset_nonce_cache(relayer_client):
    """Test nonce cache reset."""
    relayer_client._nonce_cache["0x123"] = 42
    relayer_client._nonce_cache["0x456"] = 99
    
    # Reset specific address
    relayer_client.reset_nonce_cache("0x123")
    assert "0x123" not in relayer_client._nonce_cache
    assert relayer_client._nonce_cache["0x456"] == 99
    
    # Reset all
    relayer_client.reset_nonce_cache()
    assert len(relayer_client._nonce_cache) == 0


def test_singleton_pattern():
    """Test singleton instance."""
    client1 = get_relayer_client()
    client2 = get_relayer_client()
    
    assert client1 is client2
