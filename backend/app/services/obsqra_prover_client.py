"""
Obsqra Prover Client - Cloud STONE/Garaga proof generation only.

zkde.fi owns all agent/model logic locally.
Obsqra.fi provides cloud proof computation services.
"""

import os
import logging
from typing import Dict, Any, Optional
import httpx

logger = logging.getLogger(__name__)


class ObsqraProverClient:
    """
    Client for obsqra.fi cloud prover services.
    
    This is ONLY for heavy proof computation (STONE, Garaga).
    All agent logic, models, and orchestration lives in zkde.fi.
    """
    
    def __init__(self):
        # Base URL for Stone prover. Liveness: GET {base}/ → 200. Proofs: POST {base}/proofs/generate
        self.prover_url = os.getenv(
            "OBSQRA_PROVER_URL",
            "https://starknet.obsqra.fi/api/v1"
        ).rstrip("/")
        self.api_key = os.getenv("OBSQRA_PROVER_API_KEY", "")
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=300.0)  # Long timeout for proofs
        return self._client
    
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers
    
    async def generate_stone_proof(
        self,
        cairo_program: str,
        program_input: Dict[str, Any],
        layout: str = "recursive_with_poseidon"
    ) -> Dict[str, Any]:
        """
        Generate STONE proof via obsqra cloud prover.
        
        Args:
            cairo_program: Compiled Cairo program (JSON or path)
            program_input: Input data for the program
            layout: Cairo layout (default: recursive_with_poseidon)
            
        Returns:
            {
                "proof": str,  # STONE proof
                "public_input": Dict,
                "proof_hash": str
            }
        """
        client = await self._get_client()
        
        try:
            response = await client.post(
                f"{self.prover_url}/prove/stone",
                json={
                    "program": cairo_program,
                    "input": program_input,
                    "layout": layout
                },
                headers=self._headers()
            )
            
            if response.status_code == 401:
                raise Exception("Obsqra prover authentication failed")
            if response.status_code == 402:
                raise Exception("Obsqra prover credits exhausted")
            
            response.raise_for_status()
            return response.json()
            
        except httpx.TimeoutException:
            logger.error("STONE proof generation timed out")
            raise Exception("STONE proof generation timed out")
        except httpx.HTTPError as e:
            logger.error(f"Obsqra prover error: {e}")
            raise Exception(f"Obsqra prover error: {e}")
    
    async def generate_garaga_calldata(
        self,
        groth16_proof: Dict[str, Any],
        public_signals: list,
        circuit_type: str = "bn254"
    ) -> Dict[str, Any]:
        """
        Format Groth16 proof for Garaga verifier via obsqra cloud.
        
        Args:
            groth16_proof: Groth16 proof from snarkjs
            public_signals: Public signals array
            circuit_type: Curve type (bn254, bls12_381)
            
        Returns:
            {
                "calldata": list[str],  # Garaga-compatible calldata
                "public_inputs_hash": str
            }
        """
        client = await self._get_client()
        
        try:
            response = await client.post(
                f"{self.prover_url}/format/garaga",
                json={
                    "proof": groth16_proof,
                    "public_signals": public_signals,
                    "circuit_type": circuit_type
                },
                headers=self._headers()
            )
            
            response.raise_for_status()
            return response.json()
            
        except httpx.HTTPError as e:
            logger.warning(f"Garaga formatting via obsqra failed: {e}")
            # Fall back to local formatting
            return self._format_garaga_locally(groth16_proof, public_signals)
    
    def _format_garaga_locally(
        self,
        proof: Dict[str, Any],
        public_signals: list
    ) -> Dict[str, Any]:
        """Local fallback for Garaga formatting."""
        calldata = []
        
        # pi_a (2 elements)
        calldata.extend(proof["pi_a"][:2])
        
        # pi_b (2x2 elements, row-major)
        calldata.extend(proof["pi_b"][0][:2])
        calldata.extend(proof["pi_b"][1][:2])
        
        # pi_c (2 elements)
        calldata.extend(proof["pi_c"][:2])
        
        # Public signals
        calldata.extend([str(s) for s in public_signals])
        
        return {
            "calldata": calldata,
            "public_inputs_hash": None
        }
    
    async def health_check(self) -> bool:
        """Liveness: GET {base}/ → 200 when API is up (starknet.obsqra.fi contract)."""
        client = await self._get_client()
        try:
            response = await client.get(self.prover_url, timeout=15.0)
            return response.status_code == 200
        except Exception:
            return False
    
    async def get_prover_status(self) -> Dict[str, Any]:
        """Get prover status and credits."""
        client = await self._get_client()
        
        try:
            response = await client.get(
                f"{self.prover_url}/status",
                headers=self._headers()
            )
            response.raise_for_status()
            return response.json()
        except Exception:
            return {"available": False, "credits": 0}


# Singleton
_prover_client: Optional[ObsqraProverClient] = None


def get_obsqra_prover() -> ObsqraProverClient:
    """Get or create the obsqra prover client singleton."""
    global _prover_client
    if _prover_client is None:
        _prover_client = ObsqraProverClient()
    return _prover_client
