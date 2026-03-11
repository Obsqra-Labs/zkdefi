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

    @staticmethod
    def _to_int(value: Any, default: int) -> int:
        try:
            return int(float(value))
        except Exception:
            return default

    @classmethod
    def _metric_row(cls, raw: Dict[str, Any] | None, *, defaults: Dict[str, int]) -> Dict[str, int]:
        source = raw if isinstance(raw, dict) else {}
        utilization = max(0, min(10000, cls._to_int(source.get("utilization"), defaults["utilization"])))
        volatility = max(0, min(10000, cls._to_int(source.get("volatility"), defaults["volatility"])))
        liquidity = max(0, cls._to_int(source.get("liquidity"), defaults["liquidity"]))
        audit_score = max(0, min(10000, cls._to_int(source.get("audit_score"), defaults["audit_score"])))
        age_days = max(0, cls._to_int(source.get("age_days"), defaults["age_days"]))
        return {
            "utilization": utilization,
            "volatility": volatility,
            "liquidity": liquidity,
            "audit_score": audit_score,
            "age_days": age_days,
        }

    def _proofs_generate_payload(self, program_input: Dict[str, Any], cairo_program: str) -> Dict[str, Any]:
        # Live obsqra API contract currently accepts metrics-only payload at /proofs/generate.
        if isinstance(program_input.get("jediswap_metrics"), dict) and isinstance(program_input.get("ekubo_metrics"), dict):
            return {
                "jediswap_metrics": self._metric_row(
                    program_input.get("jediswap_metrics"),
                    defaults={"utilization": 5000, "volatility": 2500, "liquidity": 2, "audit_score": 85, "age_days": 240},
                ),
                "ekubo_metrics": self._metric_row(
                    program_input.get("ekubo_metrics"),
                    defaults={"utilization": 6000, "volatility": 2200, "liquidity": 3, "audit_score": 90, "age_days": 320},
                ),
            }

        # Heavy pool payloads: map pool_0 -> jediswap and pool_1 -> ekubo.
        pool_keys = ("utilization", "volatility", "liquidity", "audit_score", "age_days")
        has_pool_shape = all(f"pool_0_{k}" in program_input for k in pool_keys) and all(
            f"pool_1_{k}" in program_input for k in pool_keys
        )
        if has_pool_shape:
            jediswap = {k: program_input.get(f"pool_0_{k}") for k in pool_keys}
            ekubo = {k: program_input.get(f"pool_1_{k}") for k in pool_keys}
            return {
                "jediswap_metrics": self._metric_row(
                    jediswap,
                    defaults={"utilization": 5200, "volatility": 2200, "liquidity": 2, "audit_score": 84, "age_days": 300},
                ),
                "ekubo_metrics": self._metric_row(
                    ekubo,
                    defaults={"utilization": 6100, "volatility": 2100, "liquidity": 3, "audit_score": 88, "age_days": 340},
                ),
            }

        constraints = program_input.get("constraints") if isinstance(program_input.get("constraints"), dict) else {}
        risk = self._to_int(
            constraints.get("risk_tolerance", constraints.get("max_risk", program_input.get("risk_tolerance", 50))),
            50,
        )
        util = risk * 100 if risk <= 100 else risk
        util = max(0, min(10000, util))
        amount = self._to_int(program_input.get("amount"), 0)
        liquidity = 3 if amount > 0 else 2
        action = str(program_input.get("action_type") or cairo_program or "").lower()
        audit_shift = 2 if "withdraw" in action else 0
        age_base = 365 if "withdraw" in action else 220
        return {
            "jediswap_metrics": self._metric_row(
                {
                    "utilization": util,
                    "volatility": constraints.get("volatility", constraints.get("max_volatility", 2800)),
                    "liquidity": liquidity,
                    "audit_score": 85 + audit_shift,
                    "age_days": age_base,
                },
                defaults={"utilization": 5000, "volatility": 2800, "liquidity": 2, "audit_score": 85, "age_days": 240},
            ),
            "ekubo_metrics": self._metric_row(
                {
                    "utilization": min(10000, util + 700),
                    "volatility": constraints.get("volatility", constraints.get("max_volatility", 2300)),
                    "liquidity": max(1, liquidity + 1),
                    "audit_score": 90 + audit_shift,
                    "age_days": max(30, age_base + 80),
                },
                defaults={"utilization": 6000, "volatility": 2300, "liquidity": 3, "audit_score": 90, "age_days": 320},
            ),
        }

    @staticmethod
    def _normalize_stone_response(raw: Dict[str, Any]) -> Dict[str, Any]:
        stark_part = raw.get("stark") if isinstance(raw.get("stark"), dict) else {}
        proof_hash = raw.get("proof_hash") or stark_part.get("proof_hash")
        fact_hash = raw.get("fact_hash") or stark_part.get("fact_hash") or proof_hash
        proof_blob = raw.get("proof") if raw.get("proof") is not None else stark_part
        return {
            "proof": proof_blob,
            "proof_hash": proof_hash,
            "fact_hash": fact_hash,
            "stark": stark_part or None,
            "groth16": raw.get("groth16"),
            "calldata": raw.get("calldata"),
            "status": raw.get("status"),
            "verified": raw.get("verified"),
            "message": raw.get("message"),
            "raw_response": raw,
        }
    
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
        attempted_errors: list[str] = []
        primary_payload = self._proofs_generate_payload(program_input=program_input, cairo_program=cairo_program)
        legacy_payload = {
            "program": cairo_program,
            "input": program_input,
            "layout": layout,
        }
        route_payloads = [
            ("proofs/generate", primary_payload),
            ("prove/stone", legacy_payload),
            ("prove", legacy_payload),
        ]

        try:
            for route, payload in route_payloads:
                response = await client.post(
                    f"{self.prover_url}/{route}",
                    json=payload,
                    headers=self._headers(),
                )
                if response.status_code == 404:
                    attempted_errors.append(f"{route}:404")
                    continue
                if response.status_code == 401:
                    raise Exception("Obsqra prover authentication failed")
                if response.status_code == 402:
                    raise Exception("Obsqra prover credits exhausted")
                if response.status_code in {405, 422} and route == "proofs/generate":
                    attempted_errors.append(f"{route}:{response.status_code}")
                    continue

                response.raise_for_status()
                data = response.json()
                normalized = self._normalize_stone_response(data if isinstance(data, dict) else {})
                normalized["endpoint"] = route
                normalized["http_status"] = response.status_code
                return normalized

            raise Exception(
                "Obsqra prover endpoints unavailable or rejected payload "
                f"({', '.join(attempted_errors) if attempted_errors else 'no route succeeded'})"
            )
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
            if response.status_code == 404:
                # Current public API does not expose /status; treat liveness as status source.
                healthy = await self.health_check()
                return {"available": healthy, "status_endpoint": "not_exposed"}
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
