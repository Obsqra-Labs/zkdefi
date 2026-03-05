"""
DEPRECATED: Orchestrator Client for starknet.obsqra.fi

This client is DEPRECATED. zkde.fi now uses LocalOrchestrator for all agent logic.
Only obsqra_prover_client.py should be used for STONE proof generation.

Use instead:
- app.services.local_orchestrator.LocalOrchestrator for agent execution
- app.services.obsqra_prover_client.ObsqraProverClient for STONE proofs

TODO: Remove this file after verifying no dependencies.
"""

import os
import logging
import warnings
from typing import Dict, Any, List, Optional
import httpx

logger = logging.getLogger(__name__)

# Deprecation warning
warnings.warn(
    "orchestrator_client.py is deprecated. Use local_orchestrator.py instead.",
    DeprecationWarning,
    stacklevel=2
)


class OrchestratorClient:
    """
    Client for starknet.obsqra.fi multi-processor API.
    Generates all proofs for a composed agent in parallel.
    """
    
    def __init__(self):
        self.api_url = os.getenv(
            "OBSQRA_ORCHESTRATOR_URL",
            "https://starknet.obsqra.fi/api/multi-processor"
        )
        self.api_key = os.getenv("OBSQRA_API_KEY", "")
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=180.0)
        return self._client
    
    async def execute_composed_agent(
        self,
        agent_config: Dict[str, Any],
        user_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Execute a composed agent via the orchestrator API.
        
        Args:
            agent_config: {
                "processors": ["risk_scoring", "correlation_risk"],
                "decision_logic": {"type": "AND"}
            }
            user_data: {
                "address": "0x123...",
                "portfolio": {...},
                "constraints": {...}
            }
            
        Returns:
            {
                "should_execute": bool,
                "proofs": [...],
                "execution_proof": str or None,
                "calldata": [...]
            }
        """
        client = await self._get_client()
        
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        
        try:
            response = await client.post(
                f"{self.api_url}/execute",
                json={
                    "agent_config": agent_config,
                    "user_data": user_data
                },
                headers=headers
            )
            
            if response.status_code == 401:
                raise Exception("Orchestrator API authentication failed")
            
            response.raise_for_status()
            return response.json()
            
        except httpx.TimeoutException:
            logger.error("Orchestrator API request timed out")
            raise Exception("Proof generation timed out")
        except httpx.HTTPError as e:
            logger.error(f"Orchestrator API error: {e}")
            raise Exception(f"Orchestrator API error: {e}")
    
    async def list_processors(self) -> List[Dict[str, Any]]:
        """Get list of available processors from orchestrator."""
        client = await self._get_client()
        
        try:
            response = await client.get(f"{self.api_url}/processors")
            response.raise_for_status()
            data = response.json()
            return data.get("processors", [])
        except Exception as e:
            logger.error(f"Failed to list processors: {e}")
            return []
    
    async def health_check(self) -> bool:
        """Check if orchestrator is healthy."""
        client = await self._get_client()
        
        try:
            response = await client.get(f"{self.api_url}/health")
            return response.status_code == 200
        except Exception:
            return False


# Singleton instance
_client: Optional[OrchestratorClient] = None


def get_orchestrator_client() -> OrchestratorClient:
    """Get or create the orchestrator client singleton."""
    global _client
    if _client is None:
        _client = OrchestratorClient()
    return _client
