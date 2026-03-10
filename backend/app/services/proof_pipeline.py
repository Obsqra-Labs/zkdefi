"""
Unified Proof Pipeline Service

Coordinates proof generation for:
- zkML proofs (Garaga/Groth16) for privacy
- Synthetic EZKL -> ModelBridge bundle for ML proof-gated actions
- Execution proofs (Integrity/STARK) for constraints
"""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import IntEnum
from typing import Any

from app.services.obsqra_prover_client import get_obsqra_prover
from app.services.zkml_anomaly_service import get_anomaly_service
from app.services.zkml_risk_service import get_risk_service

logger = logging.getLogger(__name__)


class ProofMode(IntEnum):
    EZKL_ONLY = 0
    EZKL_BRIDGE = 1
    FULL_DUAL_PROVER = 2


@dataclass
class SyntheticEzklProof:
    proof_hash: str
    model_hash: str
    inference_output: list[float]
    output_hash: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "proof_hash": self.proof_hash,
            "model_hash": self.model_hash,
            "inference_output": self.inference_output,
            "output_hash": self.output_hash,
            "proof_type": "ezkl_synthetic",
            "trust_mode": "synthetic_dev_only",
            "trust_warning": (
                "Synthetic development proof. This is not a cryptographic EZKL inference proof."
            ),
        }


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


class ProofPipeline:
    """Unified proof generation pipeline."""

    def __init__(self):
        self.risk_service = get_risk_service()
        self.anomaly_service = get_anomaly_service()

        self._cache: dict[str, dict] = {}
        self._cache_ttl_seconds = 300

        self._strict_l3_verification = _env_bool("L3_STRICT_VERIFICATION", True)
        self._strict_l2_verification = _env_bool("L2_STRICT_VERIFICATION", True)
        self._dual_run_enabled = _env_bool("PROOF_DUAL_RUN_ENABLED", True)
        self._l3_healthcheck_enabled = _env_bool("L3_PREREQ_HEALTHCHECK", True)
        self._l2_verify_chain_id = os.getenv("PROOF_L2_VERIFY_CHAIN_ID", "starknet-sepolia").strip()
        try:
            self._mirror_retry_count = max(0, int(os.getenv("PROOF_MIRROR_RETRY_COUNT", "1")))
        except ValueError:
            self._mirror_retry_count = 1

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
        execution_chain: str | None = None,
        primary_chain: str | None = None,
        verification_mode: str | None = None,
        verified_on_chain: bool | None = None,
        l3_tx_hash: str | None = None,
        l2_tx_hash: str | None = None,
        mirror_status: str | None = None,
        failure_reason: str | None = None,
    ) -> None:
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
                execution_chain=execution_chain,
                primary_chain=primary_chain,
                verification_mode=verification_mode,
                verified_on_chain=verified_on_chain,
                l3_tx_hash=l3_tx_hash,
                l2_tx_hash=l2_tx_hash,
                mirror_status=mirror_status,
                failure_reason=failure_reason,
            )
        except Exception:
            logger.debug("DecisionStore unavailable, proof event: %s/%s", user_address[:10], event_type)

    @staticmethod
    def _resolve_mode(
        *,
        tier: int,
        action_type: str,
        request_override: ProofMode | str | int | None,
        value_eth: float,
    ) -> ProofMode:
        if request_override is not None:
            if isinstance(request_override, ProofMode):
                return request_override
            try:
                if isinstance(request_override, int):
                    return ProofMode(int(request_override))
                normalized = str(request_override).strip().upper()
                if normalized.isdigit():
                    return ProofMode(int(normalized))
                return ProofMode[normalized]
            except Exception:
                pass

        action = (action_type or "").strip().lower()
        if tier >= 2 or value_eth >= 5.0 or action in {"withdraw", "borrow", "leverage"}:
            return ProofMode.FULL_DUAL_PROVER
        if tier >= 1 or value_eth >= 1.0 or action in {"rebalance", "ml_inference", "policy_compile"}:
            return ProofMode.EZKL_BRIDGE
        return ProofMode.EZKL_ONLY

    @staticmethod
    def _normalize_execution_chain(execution_chain: str | None) -> str:
        value = (execution_chain or "l3").strip().lower()
        if value not in {"l3", "l2", "dual"}:
            return "l3"
        return value

    @staticmethod
    def _is_cryptographically_verified(result: dict[str, Any] | None) -> bool:
        if not isinstance(result, dict):
            return False
        if not result.get("success"):
            return False
        if not result.get("verified_on_chain"):
            return False
        mode = str(result.get("mode", "") or "").strip().lower()
        return mode not in {"", "hash_only", "unknown_mode", "unreachable"}

    async def _check_l3_prerequisites(self, client: Any) -> tuple[bool, str | None]:
        if not self._l3_healthcheck_enabled:
            return True, None
        try:
            paths = await client.proving_paths()
            if isinstance(paths, dict) and paths.get("error"):
                return False, f"L3 proving paths unavailable: {paths.get('error')}"
            path_1 = (paths or {}).get("path_1_onchain_verification", {}) if isinstance(paths, dict) else {}
            if isinstance(path_1, dict) and ("garaga_groth16" in path_1 or "integrity_stark" in path_1):
                garaga_ok = bool((path_1.get("garaga_groth16") or {}).get("available", False))
                integrity_ok = bool((path_1.get("integrity_stark") or {}).get("available", False))
                if not (garaga_ok or integrity_ok):
                    return False, "L3 verifiers are not available on parent proving path"
            return True, None
        except Exception as exc:
            return False, f"L3 prerequisite healthcheck failed: {exc}"

    async def _verify_l3_bridge(
        self,
        *,
        fact_hash: str,
        circuit_name: str,
        groth16_calldata: list[str] | None,
        execution_chain: str,
    ) -> dict[str, Any]:
        if not groth16_calldata:
            return {
                "attempted": True,
                "success": False,
                "mode": "missing_calldata",
                "verified_on_chain": False,
                "tx_hash": None,
                "latency_ms": 0.0,
                "error": "Missing Groth16 calldata for L3 verification",
            }

        from app.services.l3_proving_path_client import get_l3_proving_path_client

        client = get_l3_proving_path_client()
        ok, prereq_error = await self._check_l3_prerequisites(client)
        if not ok:
            return {
                "attempted": True,
                "success": False,
                "mode": "prereq_failed",
                "verified_on_chain": False,
                "tx_hash": None,
                "latency_ms": 0.0,
                "error": prereq_error,
            }

        result = await client.verify_proof(
            fact_hash=fact_hash,
            proof_type="groth16",
            circuit_name=circuit_name,
            groth16_calldata=groth16_calldata,
            execution_chain=execution_chain,
        )
        return {
            "attempted": True,
            "success": result.success,
            "mode": result.mode,
            "verified_on_chain": result.verified_on_chain,
            "tx_hash": result.tx_hash or None,
            "latency_ms": result.latency_ms,
            "error": result.error or None,
        }

    async def _verify_l2_bridge(self, *, fact_hash: str) -> dict[str, Any]:
        if not fact_hash:
            return {
                "attempted": True,
                "success": False,
                "mode": "missing_fact_hash",
                "verified_on_chain": False,
                "tx_hash": None,
                "error": "Missing fact hash for L2 verification",
            }
        try:
            from app.services.prover_integrations import StoneProverClient

            client = StoneProverClient()
            verify = await client.verify_proof_on_chain(
                fact_hash=fact_hash,
                chain_id=self._l2_verify_chain_id,
            )
            verified = bool(verify.get("verified", False))
            return {
                "attempted": True,
                "success": verified,
                "mode": "starknet_l2_registry" if verified else "l2_unverified",
                "verified_on_chain": verified,
                "tx_hash": None,
                "error": None if verified else (verify.get("error") or "L2 fact not verified"),
                "block": verify.get("block"),
            }
        except Exception as exc:
            return {
                "attempted": True,
                "success": False,
                "mode": "l2_verify_error",
                "verified_on_chain": False,
                "tx_hash": None,
                "error": str(exc),
            }

    @staticmethod
    def _to_hex_felt(text: str) -> str:
        return hex(int.from_bytes(text.encode("utf-8"), "big"))

    def _generate_synthetic_ezkl_proof(
        self,
        *,
        model_name: str,
        input_data: list[list[float]],
    ) -> SyntheticEzklProof:
        flattened = [float(v) for row in input_data for v in row]
        if not flattened:
            flattened = [0.0]

        output = [round(v, 6) for v in flattened[:8]]
        while len(output) < 8:
            output.append(0.0)

        model_hash = "0x" + hashlib.sha256(f"model:{model_name}".encode()).hexdigest()
        output_hash = "0x" + hashlib.sha256(str(output).encode()).hexdigest()
        proof_hash = "0x" + hashlib.sha256(f"{model_name}:{output_hash}:{datetime.now(timezone.utc).isoformat()}".encode()).hexdigest()
        return SyntheticEzklProof(
            proof_hash=proof_hash,
            model_hash=model_hash,
            inference_output=output,
            output_hash=output_hash,
        )

    def _build_bridge_bundle(
        self,
        *,
        ezkl_proof: SyntheticEzklProof,
        expected_model_hash: int,
        output_lower_bound: int,
        output_upper_bound: int,
        bridge_circuit: str = "ModelBridge",
    ) -> tuple[dict[str, Any], str, list[str], str]:
        """Returns (bridge_proof, bridge_fact_hash, calldata, circuit_name_for_l3)."""
        ts = int(datetime.now(timezone.utc).timestamp())
        use_heavy = (bridge_circuit or "ModelBridge").strip() == "ModelBridgeHeavy"
        n_out = 16 if use_heavy else 8
        outputs_int = [int(round(v)) for v in ezkl_proof.inference_output[:n_out]]
        while len(outputs_int) < n_out:
            outputs_int.append(0)
        avg_out = int(sum(outputs_int) / max(1, len(outputs_int)))
        is_compliant = output_lower_bound <= avg_out <= output_upper_bound

        # Circom/Bn254 inputs must fit field. Raw sha256 model hashes can exceed that.
        field_cap = (1 << 254) - 1
        effective_model_hash_raw = expected_model_hash or int(ezkl_proof.model_hash, 16)
        effective_model_hash = int(effective_model_hash_raw) % field_cap
        output_commitment = "0x" + hashlib.sha256(
            ",".join(str(v) for v in outputs_int).encode()
        ).hexdigest()

        bridge_seed = (
            f"{ezkl_proof.proof_hash}:{effective_model_hash}:{output_commitment}:"
            f"{output_lower_bound}:{output_upper_bound}:{ts}"
        )
        bridge_fact_hash = "0x" + hashlib.sha256(bridge_seed.encode()).hexdigest()

        bridge_proof = {
            "success": True,
            "is_compliant": is_compliant,
            "proof_hash": bridge_fact_hash,
            "proof": {
                "model_hash": hex(effective_model_hash),
                "model_hash_raw": hex(int(effective_model_hash_raw)),
                "output_commitment": output_commitment,
                "timestamp": ts,
            },
            "public_signals": [
                str(effective_model_hash),
                str(int(output_commitment, 16)),
                str(int(bridge_fact_hash, 16)),
                str(ts),
            ],
            "bridge_backend": "placeholder_fallback",
        }

        # Prefer real Groth16 proof from ModelBridge or ModelBridgeHeavy circuit (EZKL → Garaga bridge)
        try:
            from app.services.groth16_prover import Groth16Prover

            proof_hash_int = int(ezkl_proof.proof_hash, 16)
            if proof_hash_int >= (1 << 254):
                proof_hash_int = proof_hash_int % ((1 << 254) - 1)

            if use_heavy:
                bridge_result = Groth16Prover.generate_model_bridge_heavy_proof(
                    model_output=outputs_int,
                    ezkl_proof_hash=proof_hash_int,
                    model_weights_hash=effective_model_hash,
                    expected_model_hash=effective_model_hash,
                    output_lower_bound=output_lower_bound,
                    output_upper_bound=output_upper_bound,
                    timestamp=ts,
                )
                circuit_name_for_l3 = "ModelBridgeHeavy"
                bridge_proof["bridge_backend"] = "groth16_modelbridge_heavy"
            else:
                bridge_result = Groth16Prover.generate_model_bridge_proof(
                    model_output=outputs_int,
                    ezkl_proof_hash=proof_hash_int,
                    model_weights_hash=effective_model_hash,
                    expected_model_hash=effective_model_hash,
                    output_lower_bound=output_lower_bound,
                    output_upper_bound=output_upper_bound,
                    timestamp=ts,
                )
                circuit_name_for_l3 = "ModelBridge"
                bridge_proof["bridge_backend"] = "groth16_modelbridge"
            calldata = bridge_result["proof_calldata"]
            logger.info("%s Groth16 proof generated (calldata len=%s)", circuit_name_for_l3, len(calldata))
        except Exception as exc:
            logger.warning("ModelBridge Groth16 proof unavailable, using placeholder: %s", exc)
            bridge_proof["bridge_backend"] = "placeholder_fallback"
            bridge_proof["fallback_error"] = str(exc)
            circuit_name_for_l3 = "ModelBridge" if not use_heavy else "ModelBridgeHeavy"
            calldata = [
                self._to_hex_felt("model_bridge"),
                hex(effective_model_hash),
                output_commitment,
                bridge_fact_hash,
                hex(ts),
                hex(int(ezkl_proof.proof_hash, 16)),
            ]

        return bridge_proof, bridge_fact_hash, calldata, circuit_name_for_l3

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
        execution_chain: str = "l3",
        bridge_circuit: str = "ModelBridge",
    ) -> dict[str, Any]:
        import time as _time

        execution_chain = self._normalize_execution_chain(execution_chain)
        primary_authority = "l3" if execution_chain in {"l3", "dual"} else "l2"

        if execution_chain == "dual" and not self._dual_run_enabled:
            failure_reason = "Dual-run requested but PROOF_DUAL_RUN_ENABLED is false"
            return {
                "commitment_hash": None,
                "proof_mode": "N/A",
                "proof_mode_level": -1,
                "ezkl_proof": None,
                "ezkl_verified": False,
                "bridge_proof": None,
                "execution_proof": None,
                "can_execute": False,
                "combined_calldata": None,
                "verification": {
                    "requested_execution_chain": execution_chain,
                    "primary_authority": primary_authority,
                    "l3": {"attempted": False, "success": False, "verified_on_chain": False, "mode": None, "tx_hash": None, "error": None},
                    "l2": {"attempted": False, "success": False, "verified_on_chain": False, "mode": None, "tx_hash": None, "error": None},
                    "mirror_status": "dual_disabled",
                    "failure_reason": failure_reason,
                },
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "total_duration_ms": 0,
            }

        mode = self._resolve_mode(
            tier=tier,
            action_type=action_type,
            request_override=proof_mode,
            value_eth=value_eth,
        )

        commitment_hash = self._generate_commitment(user_address, model_name, "ml_proof")
        cache_key = f"ml_{commitment_hash}_{int(mode)}_{execution_chain}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        t0 = _time.monotonic()

        ezkl_proof = self._generate_synthetic_ezkl_proof(
            model_name=model_name,
            input_data=input_data,
        )
        ezkl_verified = True

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
            "trust_mode": "synthetic_dev_only",
            "trust_warning": (
                "This ml-bridge path currently uses synthetic EZKL placeholders. "
                "Do not treat as trustless inference verification."
            ),
            "bridge_proof": None,
            "execution_proof": None,
            "can_execute": ezkl_verified,
            "combined_calldata": None,
            "verification": {
                "requested_execution_chain": execution_chain,
                "primary_authority": primary_authority,
                "l3": {
                    "attempted": False,
                    "success": False,
                    "verified_on_chain": False,
                    "mode": None,
                    "tx_hash": None,
                    "error": None,
                },
                "l2": {
                    "attempted": False,
                    "success": False,
                    "verified_on_chain": False,
                    "mode": None,
                    "tx_hash": None,
                    "error": None,
                },
                "mirror_status": "not_requested",
                "failure_reason": None,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        bridge_fact_hash = ""
        if mode >= ProofMode.EZKL_BRIDGE and ezkl_verified:
            bridge_proof, bridge_fact_hash, model_bridge_calldata, bridge_circuit_used = self._build_bridge_bundle(
                ezkl_proof=ezkl_proof,
                expected_model_hash=expected_model_hash,
                output_lower_bound=output_lower_bound,
                output_upper_bound=output_upper_bound,
                bridge_circuit=bridge_circuit,
            )
            result["bridge_proof"] = bridge_proof
            result["bridge_circuit_used"] = bridge_circuit_used

            if bridge_proof.get("success") and bridge_proof.get("is_compliant"):
                result["combined_calldata"] = {
                    "model_bridge_calldata": model_bridge_calldata,
                    "execution_proof_hash": None,
                }
                result["can_execute"] = True
            else:
                result["can_execute"] = False

        if mode < ProofMode.EZKL_BRIDGE and execution_chain in {"l3", "l2", "dual"}:
            result["can_execute"] = False
            result["verification"]["failure_reason"] = "ModelBridge proof is required for chain verification"
        elif result["can_execute"] and bridge_fact_hash:
            model_bridge_calldata = (result.get("combined_calldata") or {}).get("model_bridge_calldata")
            circuit_name_l3 = result.get("bridge_circuit_used") or "ModelBridge"

            if execution_chain in {"l3", "dual"}:
                l3_result = await self._verify_l3_bridge(
                    fact_hash=bridge_fact_hash,
                    circuit_name=circuit_name_l3,
                    groth16_calldata=model_bridge_calldata,
                    execution_chain=execution_chain,
                )
                result["verification"]["l3"] = l3_result

            if execution_chain in {"l2", "dual"}:
                attempts = 1 + (self._mirror_retry_count if execution_chain == "dual" else 0)
                l2_result: dict[str, Any] | None = None
                for _ in range(attempts):
                    l2_result = await self._verify_l2_bridge(fact_hash=bridge_fact_hash)
                    if self._is_cryptographically_verified(l2_result):
                        break
                result["verification"]["l2"] = l2_result or {
                    "attempted": True,
                    "success": False,
                    "verified_on_chain": False,
                    "mode": "l2_unverified",
                    "tx_hash": None,
                    "error": "L2 verification unavailable",
                }
                if execution_chain == "dual":
                    result["verification"]["mirror_status"] = (
                        "mirrored"
                        if self._is_cryptographically_verified(result["verification"]["l2"])
                        else "mirror_failed"
                    )

            if primary_authority == "l3" and self._strict_l3_verification:
                if not self._is_cryptographically_verified(result["verification"]["l3"]):
                    result["can_execute"] = False
                    result["verification"]["failure_reason"] = (
                        result["verification"]["l3"].get("error")
                        or "Strict L3 verification failed"
                    )
            if primary_authority == "l2" and self._strict_l2_verification:
                if not self._is_cryptographically_verified(result["verification"]["l2"]):
                    result["can_execute"] = False
                    result["verification"]["failure_reason"] = (
                        result["verification"]["l2"].get("error")
                        or "Strict L2 verification failed"
                    )

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
                logger.warning("STARK execution proof not available; ML proof proceeds without it")
                result["execution_proof"] = {
                    "is_valid": False,
                    "error": "Execution proof generation not yet implemented",
                }
                result["can_execute"] = False

        verification_mode = None
        primary_result = result["verification"]["l3"] if primary_authority == "l3" else result["verification"]["l2"]
        if isinstance(primary_result, dict):
            verification_mode = primary_result.get("mode")

        await self._log_proof_event(
            user_address=user_address,
            event_type="proof_generated" if result["can_execute"] else "proof_failed",
            gate="ml_inference",
            outcome="success" if result["can_execute"] else "fail",
            proof_mode=mode.name,
            model_name=model_name,
            value_eth=value_eth,
            metadata={
                "commitment_hash": commitment_hash,
                "action_type": action_type or "ml_inference",
            },
            execution_chain=execution_chain,
            primary_chain=primary_authority,
            verification_mode=str(verification_mode or ""),
            verified_on_chain=bool(primary_result.get("verified_on_chain")) if isinstance(primary_result, dict) else False,
            l3_tx_hash=result["verification"]["l3"].get("tx_hash"),
            l2_tx_hash=result["verification"]["l2"].get("tx_hash"),
            mirror_status=result["verification"].get("mirror_status"),
            failure_reason=result["verification"].get("failure_reason"),
        )

        result["total_duration_ms"] = int((_time.monotonic() - t0) * 1000)
        self._cache_result(cache_key, result)
        return result

    async def generate_rebalancing_proofs(
        self,
        user_address: str,
        portfolio_features: list[int],
        pool_id: str,
        risk_threshold: int = 30,
        constraints: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        commitment_hash = self._generate_commitment(user_address, portfolio_features, pool_id)

        cache_key = f"rebalance_{commitment_hash}"
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        risk_proof = await self.risk_service.generate_risk_proof(
            user_address=user_address,
            portfolio_features=portfolio_features,
            threshold=risk_threshold,
            commitment_hash=commitment_hash,
        )

        anomaly_proof = await self.anomaly_service.analyze_pool_safety(
            pool_id=pool_id,
            user_address=user_address,
            commitment_hash=commitment_hash,
        )

        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints or {},
            commitment_hash=commitment_hash,
        )

        zkml_passed = risk_proof["is_compliant"] and anomaly_proof["is_safe"]
        execution_passed = execution_proof["is_valid"]
        can_execute = zkml_passed and execution_passed

        # Build combined calldata from zkML proofs
        risk_calldata = risk_proof.get("proof_calldata", [])
        anomaly_calldata = anomaly_proof.get("proof_calldata", [])
        zkml_calldata = risk_calldata + anomaly_calldata

        # Build fact hash from the combined calldata
        import hashlib as _hl
        rebalance_fact_hash = "0x" + _hl.sha256(
            f"rebalance:{commitment_hash}:{','.join(str(c) for c in zkml_calldata)}".encode()
        ).hexdigest()

        # L3 verification — submit each proof individually with native Garaga calldata
        risk_l3 = {
            "attempted": False, "success": False, "verified_on_chain": False,
            "mode": None, "tx_hash": None, "error": None,
        }
        anomaly_l3 = {
            "attempted": False, "success": False, "verified_on_chain": False,
            "mode": None, "tx_hash": None, "error": None,
        }
        if can_execute:
            # Submit risk proof with its native Garaga calldata (list[int] → list[str hex])
            if risk_calldata:
                risk_fact = "0x" + _hl.sha256(
                    f"risk:{commitment_hash}:{','.join(str(c) for c in risk_calldata)}".encode()
                ).hexdigest()
                risk_l3 = await self._verify_l3_bridge(
                    fact_hash=risk_fact,
                    circuit_name="RiskScoreAllocation",
                    groth16_calldata=[hex(c) if isinstance(c, int) else str(c) for c in risk_calldata],
                    execution_chain="l3",
                )

            # Submit anomaly proof with its native Garaga calldata
            if anomaly_calldata:
                anomaly_fact = "0x" + _hl.sha256(
                    f"anomaly:{commitment_hash}:{','.join(str(c) for c in anomaly_calldata)}".encode()
                ).hexdigest()
                anomaly_l3 = await self._verify_l3_bridge(
                    fact_hash=anomaly_fact,
                    circuit_name="AnomalyDetection",
                    groth16_calldata=[hex(c) if isinstance(c, int) else str(c) for c in anomaly_calldata],
                    execution_chain="l3",
                )

            # Also register the combined fact hash
            _combined_l3 = await self._verify_l3_bridge(
                fact_hash=rebalance_fact_hash,
                circuit_name="RebalanceZkML",
                groth16_calldata=None,  # hash-only for the combined fact
                execution_chain="l3",
            )

            if self._strict_l3_verification:
                # Either individual proof must be cryptographically verified
                any_crypto = (
                    self._is_cryptographically_verified(risk_l3)
                    or self._is_cryptographically_verified(anomaly_l3)
                )
                if not any_crypto:
                    can_execute = False

        # Merge L3 results into a summary
        l3_verification = {
            "attempted": risk_l3.get("attempted", False) or anomaly_l3.get("attempted", False),
            "success": risk_l3.get("success", False) or anomaly_l3.get("success", False),
            "verified_on_chain": risk_l3.get("verified_on_chain", False) or anomaly_l3.get("verified_on_chain", False),
            "mode": risk_l3.get("mode") or anomaly_l3.get("mode"),
            "tx_hash": risk_l3.get("tx_hash") or anomaly_l3.get("tx_hash"),
            "error": None if (risk_l3.get("success") or anomaly_l3.get("success")) else (risk_l3.get("error") or anomaly_l3.get("error")),
            "risk_l3": risk_l3,
            "anomaly_l3": anomaly_l3,
        }

        result = {
            "commitment_hash": commitment_hash,
            "zkml_proofs": {
                "risk": risk_proof,
                "anomaly": anomaly_proof,
                "passed": zkml_passed,
            },
            "execution_proof": execution_proof,
            "can_execute": can_execute,
            "combined_calldata": {
                "zkml_calldata": zkml_calldata,
                "execution_proof_hash": execution_proof["proof_hash"],
            },
            "verification": {
                "l3": l3_verification,
                "fact_hash": rebalance_fact_hash,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        self._cache_result(cache_key, result)
        return result

    async def generate_deposit_proofs(
        self,
        user_address: str,
        amount: int,
        protocol_id: int,
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        commitment_hash = self._generate_commitment(user_address, [amount, protocol_id], "deposit")

        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints,
            commitment_hash=commitment_hash,
            action_type="deposit",
            amount=amount,
        )

        can_execute = execution_proof["is_valid"]

        # L3 verification for deposit proof
        l3_verification = {
            "attempted": False, "success": False, "verified_on_chain": False,
            "mode": None, "tx_hash": None, "error": None,
        }
        fact_hash = execution_proof.get("fact_hash") or execution_proof.get("proof_hash", "")
        if can_execute and fact_hash:
            l3_verification = await self._verify_l3_bridge(
                fact_hash=fact_hash,
                circuit_name="DepositConstraint",
                groth16_calldata=None,
                execution_chain="l3",
            )

        return {
            "commitment_hash": commitment_hash,
            "execution_proof": execution_proof,
            "can_execute": can_execute,
            "verification": {"l3": l3_verification, "fact_hash": fact_hash},
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    async def generate_withdraw_proofs(
        self,
        user_address: str,
        amount: int,
        protocol_id: int,
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        commitment_hash = self._generate_commitment(user_address, [amount, protocol_id], "withdraw")

        execution_proof = await self._generate_execution_proof(
            user_address=user_address,
            constraints=constraints,
            commitment_hash=commitment_hash,
            action_type="withdraw",
            amount=amount,
        )

        can_execute = execution_proof["is_valid"]

        # L3 verification for withdraw proof
        l3_verification = {
            "attempted": False, "success": False, "verified_on_chain": False,
            "mode": None, "tx_hash": None, "error": None,
        }
        fact_hash = execution_proof.get("fact_hash") or execution_proof.get("proof_hash", "")
        if can_execute and fact_hash:
            l3_verification = await self._verify_l3_bridge(
                fact_hash=fact_hash,
                circuit_name="WithdrawConstraint",
                groth16_calldata=None,
                execution_chain="l3",
            )

        return {
            "commitment_hash": commitment_hash,
            "execution_proof": execution_proof,
            "can_execute": can_execute,
            "verification": {"l3": l3_verification, "fact_hash": fact_hash},
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    async def _generate_execution_proof(
        self,
        user_address: str,
        constraints: dict[str, Any],
        commitment_hash: str,
        action_type: str = "rebalance",
        amount: int = 0,
    ) -> dict[str, Any]:
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
            healthy = await prover.health_check()
            if not healthy:
                logger.warning("Obsqra Stone prover unavailable, using local execution proof")
                return self._local_execution_proof(user_address, commitment_hash, action_type, amount)

            result = await prover.generate_stone_proof(
                cairo_program=f"execution_constraint_{action_type}",
                program_input=program_input,
                layout="recursive_with_poseidon",
            )

            proof_hash = result.get("proof_hash", "")
            fact_hash = result.get("fact_hash", proof_hash)

            return {
                "is_valid": True,
                "proof_hash": proof_hash,
                "fact_hash": fact_hash,
                "proof_type": "stark_integrity",
                "prover": "obsqra_stone",
                "action_type": action_type,
                "commitment_hash": commitment_hash,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            logger.warning("Obsqra Stone prover failed (%s), using local execution proof", exc)
            return self._local_execution_proof(user_address, commitment_hash, action_type, amount)

    def _local_execution_proof(
        self,
        user_address: str,
        commitment_hash: str,
        action_type: str,
        amount: int,
    ) -> dict[str, Any]:
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
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "warning": "Local fallback proof - not STARK-verified. Obsqra Stone prover was unavailable.",
        }

    async def generate_heavy_stark_proof(
        self,
        pool_metrics: dict[str, Any],
        *,
        submit_to_l3: bool = True,
        execution_chain: str = "l3",
    ) -> dict[str, Any]:
        """
        Generate STARK proof for StarkHeavyReputation (4-pool risk) and optionally submit to L3.

        pool_metrics: dict with pool_0..pool_3 keys (utilization, volatility, liquidity, audit_score, age_days).
        Uses Obsqra Stone prover with cairo_program="stark_heavy_reputation".
        L3 verification uses circuit_name="StarkHeavyReputation" (same Integrity verifier).
        """
        from app.services.l3_proving_path_client import get_l3_proving_path_client

        prover = get_obsqra_prover()
        program_input = {}
        for i in range(4):
            prefix = f"pool_{i}_"
            for key in ("utilization", "volatility", "liquidity", "audit_score", "age_days"):
                k = prefix + key
                program_input[k] = pool_metrics.get(k, 5000 if key in ("utilization", "volatility") else (2 if key == "liquidity" else (80 if key == "audit_score" else 365)))

        result: dict[str, Any] = {
            "circuit_name": "StarkHeavyReputation",
            "success": False,
            "proof_hash": None,
            "fact_hash": None,
            "stark_proof_data": None,
            "l3": None,
        }

        try:
            healthy = await prover.health_check()
            if not healthy:
                result["error"] = "Obsqra Stone prover unavailable"
                return result

            stone_result = await prover.generate_stone_proof(
                cairo_program="stark_heavy_reputation",
                program_input=program_input,
                layout="small",
            )
            proof_hash = stone_result.get("proof_hash", "")
            fact_hash = stone_result.get("fact_hash", proof_hash)
            result["success"] = True
            result["proof_hash"] = proof_hash
            result["fact_hash"] = fact_hash
            result["stark_proof_data"] = stone_result.get("proof") or stone_result.get("calldata") or {"config_hash": fact_hash, "calldata": [fact_hash]}

            if submit_to_l3 and fact_hash:
                client = get_l3_proving_path_client()
                fact_hash_str = hex(fact_hash) if isinstance(fact_hash, int) else (str(fact_hash) if str(fact_hash).startswith("0x") else "0x" + str(fact_hash))
                l3_res = await client.verify_proof(
                    fact_hash=fact_hash_str,
                    proof_type="stark",
                    circuit_name="StarkHeavyReputation",
                    stark_proof_data=result["stark_proof_data"],
                    execution_chain=execution_chain,
                )
                result["l3"] = {
                    "success": l3_res.success,
                    "mode": l3_res.mode,
                    "verified_on_chain": l3_res.verified_on_chain,
                    "tx_hash": l3_res.tx_hash,
                    "error": l3_res.error,
                }
        except Exception as exc:
            result["error"] = str(exc)
            logger.warning("StarkHeavyReputation proof failed: %s", exc)

        return result
        return "0x" + hashlib.sha256(
            f"{user_address}{data}{context}{datetime.now(timezone.utc).isoformat()}".encode()
        ).hexdigest()[:32]

    def _get_cached(self, key: str) -> dict[str, Any] | None:
        if key not in self._cache:
            return None

        cached = self._cache[key]
        generated_at = datetime.fromisoformat(cached["generated_at"])
        age = (datetime.now(timezone.utc) - generated_at).total_seconds()

        if age > self._cache_ttl_seconds:
            del self._cache[key]
            return None

        return cached

    def _cache_result(self, key: str, result: dict[str, Any]) -> None:
        self._cache[key] = result


_pipeline: ProofPipeline | None = None


def get_proof_pipeline() -> ProofPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = ProofPipeline()
    return _pipeline
