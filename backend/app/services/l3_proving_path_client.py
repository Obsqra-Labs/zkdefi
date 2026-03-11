"""
L3 Proving Path Client — zkdefi → obsqra L3 Proving Paths bridge.

Provides zkde.fi backend access to all three L3 proving paths:
  Path 1 — On-chain Verification (Garaga Groth16 / Integrity STARK, zero gas)
  Path 2 — SNOS Block Proving (L3 → L2 validity proofs)
  Path 3 — Recursive Aggregation on L3

Also exposes full obsqra stack capability discovery for the zkde.fi frontend.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Parent obsqra API (same pattern as MadaraSettlementClient)
PARENT_API_URL = os.getenv("OBSQRA_API_URL", "https://starknet.obsqra.fi/api/v1")
PARENT_LOCAL_URL = os.getenv("OBSQRA_LOCAL_API_URL", "http://127.0.0.1:8002/api/v1")


@dataclass
class L3VerificationResult:
    """Result of verifying a proof on L3 via obsqra."""
    success: bool
    mode: str = ""           # "groth16_garaga" | "stark_integrity" | "hash_only"
    fact_hash: str = ""
    tx_hash: str = ""
    verified_on_chain: bool = False
    latency_ms: float = 0.0
    error: str = ""


@dataclass
class L3Capabilities:
    """Full obsqra stack capabilities returned by /l3/capabilities."""
    proving_paths: dict = field(default_factory=dict)
    obsqra_services: dict = field(default_factory=dict)
    circuits: dict = field(default_factory=dict)
    raw: dict = field(default_factory=dict)
    error: str = ""


class L3ProvingPathClient:
    """
    HTTP client for accessing L3 proving paths via parent obsqra API.

    Endpoints used:
      GET  /aggregation/l3/capabilities       — full stack discovery
      GET  /aggregation/l3/proving-paths       — available proving paths
      GET  /aggregation/l3/stats               — comprehensive L3 stats
      GET  /aggregation/l3/verification/stats  — on-chain verification stats
      POST /aggregation/l3/verify              — verify + register a proof on L3
      GET  /aggregation/l3/snos/queue          — SNOS proving queue (Path 2)
      GET  /aggregation/l3/blocks              — recent block results
    """

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=20.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _get(self, path: str) -> dict | None:
        """GET request to parent API with local/remote fallback."""
        client = await self._get_client()
        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.get(f"{base_url}/aggregation/{path}")
                if resp.status_code == 200:
                    return resp.json()
            except Exception as e:
                logger.debug("L3 client GET %s/%s failed: %s", base_url, path, e)
        return None

    async def _post(self, path: str, payload: dict) -> dict | None:
        """POST request to parent API with local/remote fallback."""
        client = await self._get_client()
        for base_url in [PARENT_LOCAL_URL, PARENT_API_URL]:
            try:
                resp = await client.post(
                    f"{base_url}/aggregation/{path}",
                    json=payload,
                )
                if resp.status_code == 200:
                    return resp.json()
            except Exception as e:
                logger.debug("L3 client POST %s/%s failed: %s", base_url, path, e)
        return None

    # ── Discovery ──────────────────────────────────────────────────────

    async def capabilities(self) -> L3Capabilities:
        """
        Fetch full obsqra stack capabilities.

        Returns all proving paths, available services (Stone prover, dual prover,
        aggregator, sequencer, integrity verifier, etc.), and circuit inventory.
        """
        data = await self._get("l3/capabilities")
        if data is None:
            return L3Capabilities(error="Parent obsqra API unreachable")
        return L3Capabilities(
            proving_paths=data.get("proving_paths", {}),
            obsqra_services=data.get("obsqra_services", {}),
            circuits=data.get("circuits", {}),
            raw=data,
        )

    async def proving_paths(self) -> dict:
        """
        List available L3 proving paths.

        Returns:
            Dict with path_1 (on-chain verification), path_2 (SNOS),
            path_3 (recursive aggregation on L3).
        """
        data = await self._get("l3/proving-paths")
        return data or {"error": "unreachable"}

    # ── Verification (Path 1) ──────────────────────────────────────────

    async def verify_proof(
        self,
        fact_hash: str,
        proof_type: str = "stark",
        circuit_name: str = "",
        groth16_calldata: list[str] | None = None,
        honk_calldata: list[str] | None = None,
        stark_proof_data: dict | None = None,
        execution_chain: str = "l3",
    ) -> L3VerificationResult:
        """
        Submit a proof for L3 on-chain verification.

        The obsqra backend will choose the best verification mode:
        1. Noir HONK (if proof_type=noir_honk and honk_calldata provided)
        2. Garaga Groth16 (if groth16_calldata provided and verifier deployed)
        3. Integrity STARK (if proof data provided and verifier deployed)
        4. Hash-only registration (always available)
        """
        payload = {
            "fact_hash": fact_hash,
            "proof_type": proof_type,
            "circuit_name": circuit_name,
            "execution_chain": execution_chain,
        }
        if groth16_calldata:
            payload["groth16_calldata"] = groth16_calldata
        if honk_calldata:
            payload["honk_calldata"] = honk_calldata
        if stark_proof_data:
            payload["stark_proof_data"] = stark_proof_data

        data = await self._post("l3/verify", payload)
        if data is None:
            return L3VerificationResult(
                success=False,
                fact_hash=fact_hash,
                mode="unreachable",
                error="Parent obsqra API unreachable",
            )
        return self._normalize_verify_response(data, fallback_fact_hash=fact_hash)

    @staticmethod
    def _normalize_verify_response(data: dict, *, fallback_fact_hash: str) -> L3VerificationResult:
        """Normalize /aggregation/l3/verify payload into deterministic semantics."""
        mode = str(data.get("mode", "") or "").strip().lower()
        allowed_modes = {"groth16_garaga", "stark_integrity", "noir_honk", "hash_only"}
        if mode not in allowed_modes:
            mode = "unknown_mode"

        success = bool(data.get("success", False))
        verified_on_chain = bool(data.get("verified_on_chain", False))
        tx_hash = str(data.get("tx_hash", "") or "")
        fact_hash = str(data.get("fact_hash", fallback_fact_hash) or fallback_fact_hash)
        latency_ms = float(data.get("latency_ms", 0.0) or 0.0)
        error = str(data.get("error", "") or "")

        # Deterministic error semantics for strict enforcement callers.
        if success and mode == "hash_only" and verified_on_chain:
            # Guardrail for inconsistent parent responses.
            verified_on_chain = False
            if not error:
                error = "Inconsistent response: hash_only mode cannot be cryptographically verified"
        if not success and not error:
            error = f"L3 verification failed (mode={mode})"
        if success and mode == "unknown_mode" and not error:
            error = "Verification succeeded with unknown mode"

        return L3VerificationResult(
            success=success,
            mode=mode,
            fact_hash=fact_hash,
            tx_hash=tx_hash,
            verified_on_chain=verified_on_chain,
            latency_ms=latency_ms,
            error=error,
        )

    # ── Stats ──────────────────────────────────────────────────────────

    async def stats(self) -> dict:
        """
        Comprehensive L3 proving stats across all paths.

        Returns orchestrator stats, path_1 verification stats, path_2 SNOS queue
        status, and path_3 aggregation status.
        """
        data = await self._get("l3/stats")
        return data or {"error": "unreachable"}

    async def verification_stats(self) -> dict:
        """On-chain verification stats (groth16 / stark / hash_only counts)."""
        data = await self._get("l3/verification/stats")
        return data or {"error": "unreachable"}

    # ── SNOS Queue (Path 2) ────────────────────────────────────────────

    async def snos_queue(self) -> dict:
        """Get blocks queued for SNOS proving."""
        data = await self._get("l3/snos/queue")
        return data or {"error": "unreachable"}

    # ── Block History ──────────────────────────────────────────────────

    async def recent_blocks(self, limit: int = 10) -> dict:
        """Get recent blocks processed through L3 proving paths."""
        data = await self._get(f"l3/blocks?limit={limit}")
        return data or {"error": "unreachable"}


# ── Singleton ─────────────────────────────────────────────────────────
_instance: L3ProvingPathClient | None = None


def get_l3_proving_path_client() -> L3ProvingPathClient:
    """Get or create the singleton L3ProvingPathClient."""
    global _instance
    if _instance is None:
        _instance = L3ProvingPathClient()
    return _instance
