"""
Relayer Client Service - Submit contract calls to Starknet relayer.

Handles:
- Contract call submission to relayer endpoint
- Transaction status polling
- Nonce management
- Fee calculation & gas estimation
"""

import logging
import httpx
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


class RelayerClient:
    """Interface to Starknet relayer service for contract execution."""
    
    def __init__(self, relayer_url: str = "http://localhost:8004", timeout: float = 10.0):
        """
        Initialize relayer client.
        
        Args:
            relayer_url: Base URL of relayer service
            timeout: HTTP request timeout in seconds
        """
        self.relayer_url = relayer_url.rstrip("/")
        self.timeout = timeout
        self._nonce_cache: dict[str, int] = {}
    
    async def submit_call(
        self,
        address: str,
        adapter: str,
        method: str,
        calldata: dict[str, Any],
        max_fee: int = 1000000000000000,  # 0.001 ETH
    ) -> dict[str, Any]:
        """
        Submit contract call to relayer.
        
        Args:
            address: User's wallet address
            adapter: Adapter name (lending, staking, dex, etc.)
            method: Contract method to call
            calldata: Method parameters
            max_fee: Maximum fee in wei
            
        Returns:
            {
                "tx_hash": "0x...",
                "status": "pending|rejected",
                "error": null|string,
                "submitted_at": iso_timestamp
            }
        """
        try:
            # Get next nonce
            nonce = await self._get_nonce(address)
            
            # Build submission payload
            payload = {
                "address": address,
                "adapter": adapter,
                "method": method,
                "calldata": calldata,
                "nonce": nonce,
                "max_fee": max_fee,
            }
            
            logger.debug(f"Submitting to relayer: {address} → {adapter}.{method}")
            
            # Submit to relayer
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.relayer_url}/execute",
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                
                if response.status_code != 200:
                    error_text = response.text[:200]
                    logger.error(f"Relayer rejected submission: {response.status_code} - {error_text}")
                    return {
                        "tx_hash": None,
                        "status": "rejected",
                        "error": f"Relayer error ({response.status_code}): {error_text}",
                        "submitted_at": datetime.now(timezone.utc).isoformat(),
                    }
                
                data = response.json()
                
                # Increment nonce on success
                self._nonce_cache[address] = nonce + 1
                
                tx_hash = data.get("tx_hash", "0x" + "0" * 64)
                logger.info(f"Submitted: {address} → {tx_hash}")
                
                return {
                    "tx_hash": tx_hash,
                    "status": "pending",
                    "error": None,
                    "submitted_at": datetime.now(timezone.utc).isoformat(),
                }
                
        except httpx.TimeoutException:
            logger.error(f"Relayer timeout for {address}")
            return {
                "tx_hash": None,
                "status": "rejected",
                "error": "Relayer timeout",
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error(f"Relayer submission failed: {e}")
            return {
                "tx_hash": None,
                "status": "rejected",
                "error": str(e),
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            }
    
    async def get_tx_status(self, tx_hash: str) -> dict[str, Any]:
        """
        Poll transaction confirmation from relayer.
        
        Args:
            tx_hash: Transaction hash to check
            
        Returns:
            {
                "tx_hash": "0x...",
                "status": "pending|confirmed|failed|not_found",
                "block_number": int|null,
                "confirmed_at": iso_timestamp|null
            }
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.relayer_url}/tx/{tx_hash}",
                    headers={"Content-Type": "application/json"},
                )
                
                if response.status_code == 404:
                    return {
                        "tx_hash": tx_hash,
                        "status": "not_found",
                        "block_number": None,
                        "confirmed_at": None,
                    }
                
                if response.status_code != 200:
                    logger.warning(f"Relayer status check failed: {response.status_code}")
                    return {
                        "tx_hash": tx_hash,
                        "status": "unknown",
                        "block_number": None,
                        "confirmed_at": None,
                    }
                
                data = response.json()
                
                return {
                    "tx_hash": tx_hash,
                    "status": data.get("status", "unknown"),  # pending|confirmed|failed
                    "block_number": data.get("block_number"),
                    "confirmed_at": data.get("confirmed_at"),
                }
                
        except httpx.TimeoutException:
            logger.warning(f"Timeout checking tx {tx_hash}")
            return {
                "tx_hash": tx_hash,
                "status": "unknown",
                "block_number": None,
                "confirmed_at": None,
            }
        except Exception as e:
            logger.error(f"Failed to check tx status: {e}")
            return {
                "tx_hash": tx_hash,
                "status": "unknown",
                "block_number": None,
                "confirmed_at": None,
            }
    
    async def check_relayer_health(self) -> bool:
        """Check if relayer service is available."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.relayer_url}/health")
                return response.status_code == 200
        except Exception:
            return False
    
    async def _get_nonce(self, address: str) -> int:
        """
        Get account nonce from relayer or cache.
        
        Uses cache if available, otherwise fetches from relayer.
        """
        # Return cached nonce if available
        if address in self._nonce_cache:
            return self._nonce_cache[address]
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.relayer_url}/nonce/{address}",
                    headers={"Content-Type": "application/json"},
                )
                
                if response.status_code == 200:
                    data = response.json()
                    nonce = int(data.get("nonce", 0))
                    self._nonce_cache[address] = nonce
                    return nonce
                
        except Exception as e:
            logger.warning(f"Failed to fetch nonce from relayer: {e}")
        
        # Default: use 0 if all else fails
        return 0
    
    def reset_nonce_cache(self, address: Optional[str] = None):
        """Reset nonce cache (full or per-address)."""
        if address:
            self._nonce_cache.pop(address, None)
        else:
            self._nonce_cache.clear()


# Singleton instance
_relayer_client: Optional[RelayerClient] = None


def get_relayer_client(relayer_url: str = "http://localhost:8004") -> RelayerClient:
    """Get or create singleton RelayerClient."""
    global _relayer_client
    if _relayer_client is None:
        _relayer_client = RelayerClient(relayer_url=relayer_url)
    return _relayer_client
