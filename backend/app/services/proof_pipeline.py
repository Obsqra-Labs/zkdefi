"""
Unified Proof Pipeline Service

Coordinates proof generation for:
- zkML proofs (Garaga/Groth16) for privacy
- EZKL proofs (Halo2/KZG) for ML model inference
- ModelBridge proofs (EZKL → Circom → Groth16 → Garaga)
- Execution proofs (Integrity/STARK) for constraints

Supports 3 proof modes:
  EZKL_ONLY        — off-chain EZKL verification only
  EZKL_BRIDGE      — EZKL → ModelBridge Circom → Groth16 → Garaga on-chain
  FULL_DUAL_PROVER — EZKL_BRIDGE + Integrity STARK

Handles caching, optimization, and proof formatting.
"""
import hashlib
import logging
import os
from datetime import datetime
from typing import Any

from app.services.zkml_risk_service import get_risk_service
from app.services.zkml_anomaly_service import get_anomaly_service
from app.services.proof_mode import ProofMode, get_proof_mode_resolver
from app.services.ezkl_prover_service import get_ezkl_prover
from app.services.obsqra_prover_client import get_obsqra_prover

logger = logging.getLogger(__name__)

OBSQRA_PROVER_URL = os.getenv("OBSQRA_PROVER_URL", "https://starknet.obsqra.fi/api/prover")


class ProofPipeline:
    """
    Unified proof generation pipeline.
    """
    
    def __init__(self):
        self.risk_service = get_risk_service()
        self.anomaly_service = get_anomaly_service()
        self.ezkl_prover = get_ezkl_prover()
        self.proof_mode_resolver = get_proof_mode_resolver()
        
        # Proof cache
        self._cache: dict[str, dict] = {}
        self._cache_ttl_seconds = 300  # 5 minutes

    async def _log_proof_event(
        self,
        user_address: str,
        event_type: str,
        gate: str = "proof",
        outcome: str = "success",
        proof_mode: str | None = None,
        model_name: str | None = None,
        value_eth: float = 0.0,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Fire-and-forget: log proof generation events to decision store."""
        try:
            from app.db.decision_store import DecisionStore
            store = DecisionStore()
            await store.log_event(
                user_address=user_address,
                event_type=event_type,
                gate=gate,
                outcome=outcome,
                proof_mode=proof_mode,
                model_name=model_name,
                value_eth=value_eth,
                metadata=metadata,
            )
        except Exception:
            pass  # Graceful degradation
    
    async def generate_rebalancing_proofs(
        self,
        user_address: str,
        portfolio_features: list[int],
        pool_id: str,
        risk_threshold: int = 30,
        constraints: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """
        Generate all proofs needed for rebalancing.
        
        Returns:
        - zkml_proofs: Risk score + anomaly detection (Garaga)
        - execution_proof: Constraint satisfaction (Integrity)
        """
        # Generate shared commitment
        commitment_hash = self._generate_commitment(
            user_address, portfolio_features, pool_id
        )
        
        # Check cache
        cache_key = f"rebalance_{commitment_hash}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached
        
        # Generate zkML proofs (Garaga)
        risk_proof = await self.risk_service.generate_risk_proof(
            user_address=user_address,
            portfolio_features=portfolio_features,
            threshold=risk_threshold,
            commitment_hash=commitment_hash
        )
        
        anomaly_proof = await self.anomaly_service.analyze_pool_safety(
            pool_id=pool_id,
            user_address=user_address,
            commitment_hash=commitment_hash
        )
        
        # Generate execution proof (Integrity)
        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints or {},
            commitment_hash=commitment_hash
        )

        # zkRAG enrichment: attach attested provenance to proof metadata
        zkrag_meta: dict[str, Any] = {}
        try:
            if os.getenv("ZKGRAPH_ENABLED", "true").lower() in ("true", "1"):
                from app.services.zkgraph_client import get_zkgraph_client
                zk = get_zkgraph_client()
                ctx = await zk.query_market_context(pool_id)
                if ctx.source == "zkrag" and ctx.provenance:
                    zkrag_meta = {
                        "zkrag_fact_hash": ctx.provenance.fact_hash,
                        "zkrag_block_range": ctx.provenance.block_range,
                        "zkrag_source_count": ctx.provenance.source_count,
                    }
        except Exception as exc:
            logger.debug("zkGraph proof enrichment skipped: %s", exc)
        
        # Check if all proofs pass
        zkml_passed = risk_proof["is_compliant"] and anomaly_proof["is_safe"]
        execution_passed = execution_proof["is_valid"]
        can_execute = zkml_passed and execution_passed
        
        result = {
            "commitment_hash": commitment_hash,
            "zkml_proofs": {
                "risk": risk_proof,
                "anomaly": anomaly_proof,
                "passed": zkml_passed
            },
            "execution_proof": execution_proof,
            "can_execute": can_execute,
            "combined_calldata": {
                "zkml_calldata": risk_proof["proof_calldata"] + anomaly_proof["proof_calldata"],
                "execution_proof_hash": execution_proof["proof_hash"]
            },
            "zkrag": zkrag_meta,
            "generated_at": datetime.utcnow().isoformat()
        }
        
        # Cache result
        self._cache_result(cache_key, result)
        
        # v6: Log proof generation event
        await self._log_proof_event(
            user_address=user_address,
            event_type="proof_generated" if can_execute else "proof_failed",
            gate="rebalance",
            outcome="success" if can_execute else "fail",
            metadata={
                "commitment_hash": commitment_hash,
                "zkml_passed": zkml_passed,
                "execution_passed": execution_passed,
            },
        )
        
        return result
    
    async def generate_deposit_proofs(
        self,
        user_address: str,
        amount: int,
        protocol_id: int,
        constraints: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Generate proofs for deposit action.
        """
        commitment_hash = self._generate_commitment(
            user_address, [amount, protocol_id], "deposit"
        )
        
        # For deposit, we need execution proof (constraints)
        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints,
            commitment_hash=commitment_hash,
            action_type="deposit",
            amount=amount
        )
        
        return {
            "commitment_hash": commitment_hash,
            "execution_proof": execution_proof,
            "can_execute": execution_proof["is_valid"],
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def generate_withdraw_proofs(
        self,
        user_address: str,
        amount: int,
        protocol_id: int,
        constraints: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Generate proofs for withdraw action.
        """
        commitment_hash = self._generate_commitment(
            user_address, [amount, protocol_id], "withdraw"
        )
        
        # For withdraw, we need execution proof
        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints,
            commitment_hash=commitment_hash,
            action_type="withdraw",
            amount=amount
        )
        
        return {
            "commitment_hash": commitment_hash,
            "execution_proof": execution_proof,
            "can_execute": execution_proof["is_valid"],
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def generate_ml_proofs(
        self,
        user_address: str,
        model_name: str,
        input_data: list[list[float]],
        *,
        proof_mode: ProofMode | str | int | None = None,
        tier: int = 0,
        action_type: str = "",
        value_eth: float = 0.0,
        expected_model_hash: int = 0,
        output_lower_bound: int = 0,
        output_upper_bound: int = 10000,
    ) -> dict[str, Any]:
        """
        Generate proofs for an ML model inference with mode-dependent depth.

        Flow:
          1. EZKL proves the ML inference (always runs)
          2. If EZKL_BRIDGE+: feed output into ModelBridge Circom → Groth16 → Garaga calldata
          3. If FULL_DUAL_PROVER: also generate Integrity STARK execution proof

        Returns:
            Dict with ezkl_proof, bridge_proof (optional), execution_proof (optional),
            proof_mode used, and combined_calldata for on-chain submission.
        """
        import time as _time
        from app.services.zkml.circuit_scanner import _generate_proof, build_model_bridge_inputs

        # Resolve proof mode
        mode = self.proof_mode_resolver.resolve(
            tier=tier,
            action_type=action_type,
            request_override=str(proof_mode) if proof_mode is not None else None,
            value_eth=value_eth,
        )

        commitment_hash = self._generate_commitment(user_address, model_name, "ml_proof")
        cache_key = f"ml_{commitment_hash}_{mode.name}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        t0 = _time.monotonic()

        # Step 1: EZKL proof (always)
        ezkl_proof = await self.ezkl_prover.prove_inference(model_name, input_data)
        ezkl_verified = await self.ezkl_prover.verify_proof(ezkl_proof)

        # Forward to parent proof sequencer for batching & settlement
        try:
            from app.services.proof_sequencer_client import get_sequencer_client
            seq = get_sequencer_client()
            await seq.submit_proof(
                proof_id=ezkl_proof.proof_hash,
                fact_hash=ezkl_proof.output_hash,
                model_name=model_name,
                metadata={"user": user_address, "action": action_type or "ml_inference"},
            )
        except Exception as seq_err:
            logger.debug("Sequencer forwarding skipped: %s", seq_err)

        result: dict[str, Any] = {
            "commitment_hash": commitment_hash,
            "proof_mode": mode.name,
            "proof_mode_level": int(mode),
            "ezkl_proof": ezkl_proof.to_dict(),
            "ezkl_verified": ezkl_verified,
            "bridge_proof": None,
            "execution_proof": None,
            "can_execute": ezkl_verified,
            "combined_calldata": None,
            "generated_at": datetime.utcnow().isoformat(),
        }

        # Step 2: ModelBridge Circom proof (EZKL_BRIDGE and above)
        if mode >= ProofMode.EZKL_BRIDGE and ezkl_verified:
            # Convert inference output to integer values for Circom
            int_outputs = [int(round(v)) for v in ezkl_proof.inference_output[:8]]
            proof_hash_int = int(ezkl_proof.proof_hash.replace("0x", "")[:62], 16)
            model_hash_int = int(ezkl_proof.model_hash[:62], 16)

            timestamp = int(datetime.utcnow().timestamp())
            bridge_inputs = build_model_bridge_inputs(
                model_output=int_outputs,
                ezkl_proof_hash=proof_hash_int,
                model_weights_hash=model_hash_int,
                expected_model_hash=expected_model_hash or model_hash_int,
                output_lower_bound=output_lower_bound,
                output_upper_bound=output_upper_bound,
                timestamp=timestamp,
            )

            bridge_proof = await _generate_proof("ModelBridge", bridge_inputs)
            result["bridge_proof"] = bridge_proof

            if bridge_proof.get("success") and bridge_proof.get("is_compliant"):
                # Format for Garaga if proof + VK available
                try:
                    from app.services.garaga_formatter import format_proof_for_garaga
                    from app.services.zkml.circuit_scanner import CIRCUITS_BUILD
                    vk_path = CIRCUITS_BUILD / "ModelBridge_verification_key.json"
                    if vk_path.exists():
                        calldata = format_proof_for_garaga(
                            bridge_proof["proof"],
                            bridge_proof["public_signals"],
                            vk_path,
                        )
                        result["combined_calldata"] = {
                            "model_bridge_calldata": calldata,
                            "execution_proof_hash": None,
                        }
                except Exception as e:
                    logger.warning("Garaga formatting failed for ModelBridge: %s", e)

                result["can_execute"] = True
            else:
                result["can_execute"] = False

        # Step 3: STARK execution proof (FULL_DUAL_PROVER only)
        if mode >= ProofMode.FULL_DUAL_PROVER and result["can_execute"]:
            try:
                execution_proof = await self._generate_execution_proof(
                    user_address=user_address,
                    constraints={"model_name": model_name, "action_type": action_type},
                    commitment_hash=commitment_hash,
                    action_type=action_type or "ml_inference",
                )
                result["execution_proof"] = execution_proof
                result["can_execute"] = execution_proof.get("is_valid", False)
                if result["combined_calldata"]:
                    result["combined_calldata"]["execution_proof_hash"] = execution_proof.get("proof_hash")
            except RuntimeError:
                # Execution proof not yet implemented — log but don't block
                logger.warning("STARK execution proof not available; ML proof proceeds without it")
                result["execution_proof"] = {
                    "is_valid": False,
                    "error": "Execution proof generation not yet implemented",
                }
                # In FULL_DUAL_PROVER mode, missing STARK = cannot execute
                result["can_execute"] = False

        result["total_duration_ms"] = int((_time.monotonic() - t0) * 1000)
        self._cache_result(cache_key, result)
        return result

    async def _generate_execution_proof(
        self,
        user_address: str,
        constraints: dict[str, Any],
        commitment_hash: str,
        action_type: str = "rebalance",
        amount: int = 0
    ) -> dict[str, Any]:
        """
        Generate execution proof via Obsqra cloud Stone prover.

        Flow:
        1. Build Cairo0 program input from constraints + commitment
        2. Call Obsqra Stone prover API for STARK proof
        3. Return proof hash + fact_hash for Integrity registration
        4. Falls back to local commitment-only proof if prover unavailable
        """
        import json as _json
        import time as _time

        prover = get_obsqra_prover()
        program_input = {
            "user_address": user_address,
            "action_type": action_type,
            "commitment_hash": commitment_hash,
            "amount": amount,
            "constraints": constraints,
            "timestamp": int(_time.time()),
        }

        try:
            # Check prover health first
            healthy = await prover.health_check()
            if not healthy:
                logger.warning("Obsqra Stone prover unavailable, using local execution proof")
                return self._local_execution_proof(user_address, commitment_hash, action_type, amount)

            # Call Obsqra Stone prover for STARK proof
            result = await prover.generate_stone_proof(
                cairo_program=f"execution_constraint_{action_type}",
                program_input=program_input,
                layout="recursive_with_poseidon",
            )

            proof_hash = result.get("proof_hash", "")
            fact_hash = result.get("fact_hash", proof_hash)

            logger.info(
                "Execution proof generated via Obsqra Stone prover: action=%s proof=%s",
                action_type, proof_hash[:18] if proof_hash else "none",
            )

            return {
                "is_valid": True,
                "proof_hash": proof_hash,
                "fact_hash": fact_hash,
                "proof_type": "stark_integrity",
                "prover": "obsqra_stone",
                "action_type": action_type,
                "commitment_hash": commitment_hash,
                "generated_at": datetime.utcnow().isoformat(),
            }

        except Exception as e:
            logger.warning("Obsqra Stone prover failed (%s), using local execution proof", e)
            return self._local_execution_proof(user_address, commitment_hash, action_type, amount)

    def _local_execution_proof(
        self,
        user_address: str,
        commitment_hash: str,
        action_type: str,
        amount: int,
    ) -> dict[str, Any]:
        """
        Local fallback execution proof: SHA-256 commitment binding.
        Not a STARK — provides auditability but not cryptographic verification.
        Clearly marked as local so consumers know the trust level.
        """
        proof_hash = "0x" + hashlib.sha256(
            f"local_exec:{user_address}:{commitment_hash}:{action_type}:{amount}".encode()
        ).hexdigest()

        return {
            "is_valid": True,
            "proof_hash": proof_hash,
            "fact_hash": None,
            "proof_type": "local_commitment",
            "prover": "local_fallback",
            "action_type": action_type,
            "commitment_hash": commitment_hash,
            "generated_at": datetime.utcnow().isoformat(),
            "warning": "Local fallback proof — not STARK-verified. Obsqra Stone prover was unavailable.",
        }
    
    def _generate_commitment(
        self,
        user_address: str,
        data: Any,
        context: str
    ) -> str:
        """Generate a commitment hash."""
        return "0x" + hashlib.sha256(
            f"{user_address}{data}{context}{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:32]
    
    def _get_cached(self, key: str) -> dict[str, Any] | None:
        """Get cached proof result."""
        if key not in self._cache:
            return None
        
        cached = self._cache[key]
        generated_at = datetime.fromisoformat(cached["generated_at"])
        age = (datetime.utcnow() - generated_at).total_seconds()
        
        if age > self._cache_ttl_seconds:
            del self._cache[key]
            return None
        
        return cached
    
    def _cache_result(self, key: str, result: dict[str, Any]) -> None:
        """Cache proof result."""
        self._cache[key] = result

    async def generate_reputation_passport(
        self,
        badge_fact_hashes: dict[str, str],
        tier_thresholds: list[int] | None = None,
        timestamp: int | None = None,
    ) -> dict[str, Any]:
        """
        Generate a STARK-proven reputation passport by aggregating badge fact-hashes.

        This calls the obsqra backend's POST /api/v1/aggregation/passport endpoint,
        which runs the reputation_passport Cairo0 program through Stone prover.

        Args:
            badge_fact_hashes: Map of badge_type → fact_hash (hex string).
            tier_thresholds: Override tier thresholds [bronze, silver, gold, diamond].
            timestamp: Unix epoch. Defaults to server time.

        Returns:
            Dict with passport result including STARK proof details.
        """
        from app.services.reputation_passport_client import get_reputation_passport_client

        client = get_reputation_passport_client()
        result = await client.aggregate_passport(
            badge_fact_hashes=badge_fact_hashes,
            tier_thresholds=tier_thresholds,
            timestamp=timestamp,
        )

        return result.to_dict()


# Singleton instance
_pipeline: ProofPipeline | None = None


def get_proof_pipeline() -> ProofPipeline:
    """Get or create the proof pipeline singleton."""
    global _pipeline
    if _pipeline is None:
        _pipeline = ProofPipeline()
    return _pipeline
