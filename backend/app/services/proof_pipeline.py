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
from pathlib import Path
from typing import Any

from app.services.obsqra_prover_client import get_obsqra_prover
from app.services.zkml_anomaly_service import get_anomaly_service
from app.services.zkml_risk_service import get_risk_service

logger = logging.getLogger(__name__)
STARKNET_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001
FELT251_MODULUS = 2**251


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
        self._native_kzg_require_mpcheck = _env_bool("NATIVE_KZG_REQUIRE_MPCHECK", True)
        self._native_kzg_require_real_ezkl = _env_bool("NATIVE_KZG_REQUIRE_REAL_EZKL", True)
        self._native_kzg_warm_on_real_prove = _env_bool("NATIVE_KZG_WARM_ON_REAL_PROVE", True)
        self._ezkl_auto_setup_on_demand = _env_bool("EZKL_AUTO_SETUP_ON_DEMAND", True)
        self._modelbridge_try_real_ezkl = _env_bool("MODELBRIDGE_TRY_REAL_EZKL", True)
        self._modelbridge_require_real_ezkl = _env_bool("MODELBRIDGE_REQUIRE_REAL_EZKL", False)
        self._modelbridge_require_real_groth16 = _env_bool("MODELBRIDGE_REQUIRE_REAL_GROTH16", True)
        self._l2_verify_chain_id = os.getenv("PROOF_L2_VERIFY_CHAIN_ID", "starknet-sepolia").strip()
        try:
            self._mirror_retry_count = max(0, int(os.getenv("PROOF_MIRROR_RETRY_COUNT", "1")))
        except ValueError:
            self._mirror_retry_count = 1

    @staticmethod
    def _local_ezkl_models_root() -> Path:
        return Path(__file__).resolve().parents[1] / "data" / "ezkl_models"

    def _resolve_local_ezkl_model_name(self, model_name: str) -> str:
        """
        Resolve common API model aliases to local EZKL artifact directory names.

        Example:
            yield_predictor -> yield_forecast
        """
        requested = str(model_name or "").strip()
        if not requested:
            return requested

        root = self._local_ezkl_models_root()
        if not root.exists():
            return requested

        local_dirs = [p.name for p in root.iterdir() if p.is_dir()]
        by_lower = {name.lower(): name for name in local_dirs}
        req_lower = requested.lower()

        if requested in local_dirs:
            return requested
        if req_lower in by_lower:
            return by_lower[req_lower]

        alias_map = {
            "yield_predictor": "yield_forecast",
            "yield_forecaster": "yield_forecast",
            "yield_model": "yield_forecast",
            "credit_predictor": "creditworthiness",
            "credit_model": "creditworthiness",
            "anomaly_detect": "anomaly_detector",
            "anomaly_detection": "anomaly_detector",
        }
        alias_target = alias_map.get(req_lower)
        if alias_target and alias_target.lower() in by_lower:
            return by_lower[alias_target.lower()]

        if "yield" in req_lower and "yield_forecast" in by_lower:
            return by_lower["yield_forecast"]
        if "credit" in req_lower and "creditworthiness" in by_lower:
            return by_lower["creditworthiness"]
        if "anomaly" in req_lower and "anomaly_detector" in by_lower:
            return by_lower["anomaly_detector"]

        return requested

    def _normalize_ezkl_input_data(
        self,
        *,
        resolved_model_name: str,
        input_data: list[list[float]],
    ) -> list[list[float]]:
        """
        Normalize request input rows to the model's expected feature width when known.
        """
        root = self._local_ezkl_models_root()
        model_dir = root / resolved_model_name
        meta_path = model_dir / "training_metadata.json"
        expected_features: int | None = None

        if meta_path.exists():
            try:
                import json
                meta = json.loads(meta_path.read_text())
                raw_n = meta.get("n_features")
                if raw_n is not None:
                    expected_features = int(raw_n)
            except Exception:
                expected_features = None

        if not expected_features or expected_features <= 0:
            return input_data

        norm_params: dict[str, Any] = {}
        norm_path = model_dir / "norm_params.json"
        if norm_path.exists():
            try:
                import json
                norm_params = json.loads(norm_path.read_text())
            except Exception:
                norm_params = {}
        mins = norm_params.get("min") if isinstance(norm_params, dict) else None
        ranges = norm_params.get("range") if isinstance(norm_params, dict) else None
        has_norm_params = (
            isinstance(mins, list)
            and isinstance(ranges, list)
            and len(mins) >= expected_features
            and len(ranges) >= expected_features
        )

        normalized: list[list[float]] = []
        adjusted_width = False
        adjusted_scale = False
        for row in input_data:
            vals = [float(v) for v in (row or [])]
            if len(vals) < expected_features:
                vals = vals + [0.0] * (expected_features - len(vals))
                adjusted_width = True
            elif len(vals) > expected_features:
                vals = vals[:expected_features]
                adjusted_width = True

            # If values look like raw (not model-normalized) and norm params exist,
            # map to training normalization domain with conservative clamping.
            if has_norm_params and any(v < -0.5 or v > 1.5 for v in vals):
                scaled: list[float] = []
                for i, v in enumerate(vals):
                    r = float(ranges[i])
                    m = float(mins[i])
                    if abs(r) < 1e-12:
                        scaled_val = 0.0
                    else:
                        scaled_val = (float(v) - m) / r
                    if scaled_val < 0.0:
                        scaled_val = 0.0
                    elif scaled_val > 1.0:
                        scaled_val = 1.0
                    scaled.append(scaled_val)
                vals = scaled
                adjusted_scale = True

            normalized.append(vals)

        if adjusted_width:
            logger.info(
                "Normalized EZKL input width for '%s' to %d features",
                resolved_model_name,
                expected_features,
            )
        if adjusted_scale:
            logger.info(
                "Applied norm_params scaling for '%s' input rows (clamped to [0,1])",
                resolved_model_name,
            )
        return normalized

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
        honk_calldata: list[str] | None = None,
        kzg_calldata: list[str] | None = None,
        proof_type: str = "groth16",
    ) -> dict[str, Any]:
        use_honk = (proof_type or "").lower() == "noir_honk" and honk_calldata
        use_kzg = (proof_type or "").lower() == "native_kzg" and kzg_calldata
        if not use_honk and not use_kzg and not groth16_calldata:
            return {
                "attempted": True,
                "success": False,
                "mode": "missing_calldata",
                "verified_on_chain": False,
                "tx_hash": None,
                "latency_ms": 0.0,
                "error": "Missing Groth16 or HONK calldata for L3 verification",
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
            proof_type=proof_type,
            circuit_name=circuit_name,
            groth16_calldata=groth16_calldata,
            honk_calldata=honk_calldata,
            kzg_calldata=kzg_calldata,
            execution_chain=execution_chain,
        )
        return {
            "attempted": True,
            "success": result.success,
            "mode": result.mode,
            "fact_hash": result.fact_hash or fact_hash,
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

            # Parent L3 /aggregation/l3/verify clamps fact_hash to 2**251.
            # Query mirrors with the same canonical representation.
            felt_fact_hash = self._felt251_hex(fact_hash)
            client = StoneProverClient()
            verify = await client.verify_proof_on_chain(
                fact_hash=felt_fact_hash,
                chain_id=self._l2_verify_chain_id,
            )
            verify_error = str(verify.get("error") or "")
            verify_source = str(verify.get("source") or "")
            verify_error_l = verify_error.lower()
            if "endpoint unavailable" in verify_error.lower():
                return {
                    "attempted": False,
                    "success": False,
                    "mode": "l2_registry_unavailable",
                    "verified_on_chain": False,
                    "tx_hash": None,
                    "error": "L2 verification endpoint unavailable on parent API",
                    "block": None,
                }
            verified = bool(verify.get("verified", False))
            if verified:
                verified_mode = (
                    "starknet_l2_registry_mirrored"
                    if verify_source == "mirrored_from_l3"
                    else "starknet_l2_registry"
                )
                return {
                    "attempted": True,
                    "success": True,
                    "mode": verified_mode,
                    "verified_on_chain": True,
                    "tx_hash": verify.get("tx_hash"),
                    "error": None,
                    "block": verify.get("block"),
                }

            if verify_error_l == "l3_registry_unavailable":
                return {
                    "attempted": True,
                    "success": False,
                    "mode": "l2_registry_unavailable",
                    "verified_on_chain": False,
                    "tx_hash": None,
                    "error": "L3 registry unavailable for mirror assist",
                    "block": verify.get("block"),
                }

            if verify_error_l.startswith("mirror_"):
                mirror_mode = "l2_mirror_failed"
                if "underfunded" in verify_error_l:
                    mirror_mode = "l2_mirror_underfunded"
                elif "nonce_conflict" in verify_error_l:
                    mirror_mode = "l2_mirror_nonce_conflict"
                return {
                    "attempted": True,
                    "success": False,
                    "mode": mirror_mode,
                    "verified_on_chain": False,
                    "tx_hash": verify.get("tx_hash"),
                    "error": verify_error or "L3->L2 mirror registration failed",
                    "block": verify.get("block"),
                }

            return {
                "attempted": True,
                "success": False,
                "mode": "l2_unverified",
                "verified_on_chain": False,
                "tx_hash": None,
                "error": verify.get("error") or "L2 fact not verified",
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

    @staticmethod
    def _felt_hex(value: int | str) -> str:
        """Normalize integers/hashes into felt252-safe hex for Starknet calldata."""
        if isinstance(value, str):
            raw = value.strip()
            if raw.startswith(("0x", "0X")):
                n = int(raw, 16)
            else:
                n = int(raw)
        else:
            n = int(value)
        return hex(n % STARKNET_PRIME)

    @staticmethod
    def _felt251_hex(value: int | str) -> str:
        """
        Normalize hashes to 2**251 clamp used by parent L3 verify route.
        """
        if isinstance(value, str):
            raw = value.strip()
            if raw.startswith(("0x", "0X")):
                n = int(raw, 16)
            else:
                n = int(raw)
        else:
            n = int(value)
        return hex(n % FELT251_MODULUS)

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

    @staticmethod
    def _discover_local_onnx_path(model_name: str) -> Path | None:
        """
        Discover a local ONNX artifact for `model_name` in backend data storage.
        """
        models_root = Path(__file__).resolve().parents[1] / "data" / "ezkl_models"
        if not models_root.exists():
            return None
        requested = str(model_name or "").strip()
        lower_requested = requested.lower()

        candidate_dirs: list[Path] = []
        if requested:
            candidate_dirs.append(models_root / requested)

        for entry in models_root.iterdir():
            if not entry.is_dir():
                continue
            name_lower = entry.name.lower()
            if name_lower == lower_requested:
                candidate_dirs.append(entry)
            elif lower_requested and (
                lower_requested in name_lower
                or name_lower in lower_requested
                or ("yield" in lower_requested and "yield" in name_lower)
                or ("credit" in lower_requested and "credit" in name_lower)
                or ("anomaly" in lower_requested and "anomaly" in name_lower)
            ):
                candidate_dirs.append(entry)

        seen: set[Path] = set()
        for model_dir in candidate_dirs:
            if model_dir in seen:
                continue
            seen.add(model_dir)
            model_stem = model_dir.name
            candidates = [model_dir / f"{model_stem}.onnx", *sorted(model_dir.glob("*.onnx"))]
            for candidate in candidates:
                if candidate.exists():
                    return candidate
        return None

    async def _try_generate_real_ezkl_proof(
        self,
        *,
        model_name: str,
        input_data: list[list[float]],
    ) -> tuple[Any | None, bool]:
        """
        Try generating and verifying a real EZKL proof from local artifacts.

        Returns:
            (proof_obj_or_none, verified_bool)
        """
        try:
            from app.services.ezkl_prover_service import get_ezkl_prover

            resolved_model_name = self._resolve_local_ezkl_model_name(model_name)
            if resolved_model_name != model_name:
                logger.info("Resolved EZKL model alias '%s' -> '%s'", model_name, resolved_model_name)

            ezkl = get_ezkl_prover()
            artifacts = ezkl.get_artifacts(resolved_model_name)
            if (not artifacts or not artifacts.is_ready()) and self._ezkl_auto_setup_on_demand:
                onnx_path = self._discover_local_onnx_path(resolved_model_name)
                if onnx_path is not None:
                    try:
                        artifacts = await ezkl.setup_model(resolved_model_name, onnx_path, force=False)
                    except Exception as setup_exc:
                        logger.warning(
                            "EZKL auto-setup failed for '%s' (%s): %s",
                            resolved_model_name,
                            onnx_path,
                            setup_exc,
                        )
            if not artifacts or not artifacts.is_ready():
                return None, False

            normalized_input_data = self._normalize_ezkl_input_data(
                resolved_model_name=resolved_model_name,
                input_data=input_data,
            )

            proof = await ezkl.prove_inference(
                model_name=resolved_model_name,
                input_data=normalized_input_data,
            )
            # Preserve the resolved local model identity for downstream bridge serializers.
            if not getattr(proof, "model_name", None):
                try:
                    setattr(proof, "model_name", resolved_model_name)
                except Exception:
                    pass
            verified = await ezkl.verify_proof(proof)
            if not verified:
                logger.warning(
                    "Real EZKL proof generated but local verify failed for model '%s'",
                    resolved_model_name,
                )
                return None, False
            if self._native_kzg_warm_on_real_prove:
                try:
                    from app.services.ezkl_kzg_serializer import warm_kzg_bundle_cache_for_proof

                    model_dir = self._local_ezkl_models_root() / resolved_model_name
                    warm_meta = warm_kzg_bundle_cache_for_proof(
                        proof,
                        model_name=resolved_model_name,
                        model_dir=model_dir if model_dir.exists() else None,
                    )
                    try:
                        setattr(proof, "kzg_bundle_meta", warm_meta)
                    except Exception:
                        pass
                    logger.info(
                        "Warmed KZG bundle cache for '%s': present=%s source=%s",
                        resolved_model_name,
                        bool(warm_meta.get("kzg_mpcheck_bundle_present")),
                        warm_meta.get("kzg_bundle_injected_source")
                        or warm_meta.get("kzg_mpcheck_bundle_source"),
                    )
                except Exception as warm_exc:
                    logger.warning(
                        "KZG bundle warm-up failed for '%s': %s",
                        resolved_model_name,
                        warm_exc,
                    )
            return proof, True
        except Exception as exc:
            logger.warning("Real EZKL path unavailable for '%s': %s", model_name, exc)
            return None, False

    def _build_bridge_bundle(
        self,
        *,
        ezkl_proof: Any,
        model_name: str = "",
        expected_model_hash: int,
        output_lower_bound: int,
        output_upper_bound: int,
        bridge_circuit: str = "ModelBridge",
    ) -> tuple[dict[str, Any], str, list[str], str]:
        """Returns (bridge_proof, bridge_fact_hash, calldata, circuit_name_for_l3)."""
        ts = int(datetime.now(timezone.utc).timestamp())
        use_noir_honk = (bridge_circuit or "").strip() == "NoirEzklBridge"
        use_native_kzg = (bridge_circuit or "").strip() == "EzklNativeKzg"
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

        # Noir HONK path (NoirEzklBridge)
        if use_noir_honk:
            try:
                from app.services.noir_prover import generate_noir_ezkl_bridge_proof
                honk_result = generate_noir_ezkl_bridge_proof(
                    expected_model_hash=effective_model_hash,
                    output_lower_bound=output_lower_bound,
                    output_upper_bound=output_upper_bound,
                    model_output=avg_out,
                )
                calldata = [hex(c) for c in honk_result["proof_calldata"]]
                circuit_name_for_l3 = "NoirEzklBridge"
                bridge_proof["bridge_backend"] = "noir_honk"
                logger.info("NoirEzklBridge HONK proof generated (calldata len=%s)", len(calldata))
            except Exception as exc:
                logger.warning("NoirEzklBridge HONK proof unavailable: %s", exc)
                bridge_proof["bridge_backend"] = "placeholder_fallback"
                bridge_proof["fallback_error"] = str(exc)
                circuit_name_for_l3 = "NoirEzklBridge"
                calldata = []
            return bridge_proof, bridge_fact_hash, calldata, circuit_name_for_l3

        # Native KZG path (Phase 4): serialize EZKL artifacts into deterministic calldata.
        if use_native_kzg:
            from app.services.ezkl_kzg_serializer import (
                build_placeholder_kzg_calldata,
                serialize_ezkl_proof_to_kzg_calldata,
            )

            circuit_name_for_l3 = "EzklNativeKzg"
            try:
                raw_proof_json = getattr(ezkl_proof, "raw_proof_json", {}) or {}
                if raw_proof_json:
                    requested_model_name = (
                        str(getattr(ezkl_proof, "model_name", "") or model_name or "").strip()
                    )
                    model_name_effective = self._resolve_local_ezkl_model_name(requested_model_name)
                    model_dir = None
                    if model_name_effective:
                        candidate = self._local_ezkl_models_root() / model_name_effective
                        if candidate.exists():
                            model_dir = candidate
                    if model_dir is None and requested_model_name:
                        candidate = self._local_ezkl_models_root() / requested_model_name
                        if candidate.exists():
                            model_dir = candidate
                    calldata, payload_meta = serialize_ezkl_proof_to_kzg_calldata(
                        ezkl_proof,
                        model_name=model_name_effective,
                        model_dir=model_dir,
                    )
                    if bool(payload_meta.get("kzg_mpcheck_bundle_present")):
                        bridge_proof["bridge_backend"] = "native_kzg_ezkl_serialized_mpcheck"
                    else:
                        bridge_proof["bridge_backend"] = "native_kzg_ezkl_serialized_no_mpcheck"
                        bridge_proof["warning"] = (
                            "ezkl_kzg_v1 payload lacks kzg_mpcheck_v1 trailer; "
                            "L3 cryptographic verification will reject"
                        )
                        if self._native_kzg_require_mpcheck:
                            bridge_proof["success"] = False
                            bridge_proof["is_compliant"] = False
                            bridge_proof["error"] = (
                                "Missing kzg_mpcheck_v1 trailer for EzklNativeKzg (strict mode)"
                            )
                else:
                    calldata, payload_meta = build_placeholder_kzg_calldata(
                        proof_hash=str(getattr(ezkl_proof, "proof_hash", "0x0")),
                        model_hash=str(getattr(ezkl_proof, "model_hash", "0x0")),
                        inference_output=list(getattr(ezkl_proof, "inference_output", []) or []),
                        timestamp=ts,
                    )
                    bridge_proof["bridge_backend"] = "native_kzg_placeholder"
                    if self._native_kzg_require_real_ezkl:
                        bridge_proof["success"] = False
                        bridge_proof["is_compliant"] = False
                        bridge_proof["error"] = (
                            "Real EZKL proof unavailable for EzklNativeKzg (strict mode)"
                        )
                bridge_proof["kzg_payload"] = payload_meta
                # Bind fact hash to the serialized payload when available.
                payload_fact = str(payload_meta.get("fact_hash_felt", "") or "").strip()
                if payload_fact.startswith("0x"):
                    bridge_fact_hash = payload_fact
                    bridge_proof["proof_hash"] = bridge_fact_hash
                logger.info(
                    "EzklNativeKzg calldata prepared via %s (len=%s)",
                    bridge_proof["bridge_backend"],
                    len(calldata),
                )
            except Exception as exc:
                logger.warning("EzklNativeKzg serialization failed, using minimal fallback: %s", exc)
                bridge_proof["bridge_backend"] = "placeholder_fallback"
                bridge_proof["fallback_error"] = str(exc)
                calldata = [
                    self._to_hex_felt("native_kzg_fallback"),
                    self._felt_hex(effective_model_hash),
                    self._felt_hex(bridge_fact_hash),
                    hex(ts),
                    self._felt_hex(ezkl_proof.proof_hash),
                ]
            return bridge_proof, bridge_fact_hash, calldata, circuit_name_for_l3

        # Prefer real Groth16 proof from ModelBridge or ModelBridgeHeavy circuit (EZKL to Garaga bridge)
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
            if self._modelbridge_require_real_groth16:
                bridge_proof["success"] = False
                bridge_proof["is_compliant"] = False
                bridge_proof["error"] = (
                    f"{circuit_name_for_l3} Groth16 proof unavailable (strict mode)"
                )
                calldata = []
            else:
                calldata = [
                    self._to_hex_felt("model_bridge"),
                    self._felt_hex(effective_model_hash),
                    self._felt_hex(output_commitment),
                    self._felt_hex(bridge_fact_hash),
                    hex(ts),
                    self._felt_hex(ezkl_proof.proof_hash),
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

        bridge_circuit_name = (bridge_circuit or "").strip() or "ModelBridge"
        use_native_kzg = bridge_circuit_name == "EzklNativeKzg"
        use_model_bridge_lane = bridge_circuit_name in {"ModelBridge", "ModelBridgeHeavy"}
        should_try_real_ezkl = bool(
            self._modelbridge_try_real_ezkl and (use_native_kzg or use_model_bridge_lane)
        )
        real_ezkl_requirement_error: str | None = None
        ezkl_verified = True
        trust_mode = "synthetic_dev_only"
        trust_warning = (
            "This ml-bridge path currently uses synthetic EZKL placeholders. "
            "Do not treat as trustless inference verification."
        )

        real_ezkl_proof, real_ezkl_verified = (None, False)
        if should_try_real_ezkl:
            real_ezkl_proof, real_ezkl_verified = await self._try_generate_real_ezkl_proof(
                model_name=model_name,
                input_data=input_data,
            )
        if real_ezkl_proof is not None and real_ezkl_verified:
            ezkl_proof = real_ezkl_proof
            ezkl_verified = True
            if use_native_kzg:
                trust_mode = "ezkl_local_verified"
                trust_warning = (
                    "EZKL proof generated and verified locally, then serialized for native KZG path. "
                    "On-chain trust still depends on deployed Cairo KZG verifier semantics."
                )
            else:
                trust_mode = "ezkl_local_verified_bridge"
                trust_warning = (
                    "EZKL proof generated and verified locally, then bound into ModelBridge Groth16 policy gates. "
                    "Execution trust depends on deployed ModelBridge verifier lanes."
                )
        else:
            ezkl_proof = self._generate_synthetic_ezkl_proof(
                model_name=model_name,
                input_data=input_data,
            )
            if use_native_kzg:
                trust_mode = "synthetic_fallback_native_kzg"
                trust_warning = (
                    "EzklNativeKzg requested but no locally verified EZKL proof was produced. "
                    "Strict native_kzg mode requires real EZKL artifacts."
                )
                logger.info(
                    "EzklNativeKzg requested but real EZKL artifacts unavailable; using deterministic placeholder payload."
                )
            elif use_model_bridge_lane:
                trust_mode = "synthetic_fallback_modelbridge"
                trust_warning = (
                    "ModelBridge requested but no locally verified EZKL proof was produced. "
                    "Current run uses deterministic placeholder EZKL payload."
                )

        if use_model_bridge_lane and self._modelbridge_require_real_ezkl and not real_ezkl_verified:
            ezkl_verified = False
            trust_mode = "real_ezkl_required_unavailable"
            trust_warning = (
                "MODELBRIDGE_REQUIRE_REAL_EZKL is enabled, but no locally verified EZKL proof was available."
            )
            real_ezkl_requirement_error = trust_warning

        try:
            from app.services.proof_sequencer_client import get_sequencer_client

            seq = get_sequencer_client()
            await seq.submit_proof(
                proof_id=str(getattr(ezkl_proof, "proof_hash", "")),
                fact_hash=str(getattr(ezkl_proof, "output_hash", getattr(ezkl_proof, "proof_hash", ""))),
                model_name=model_name,
                metadata={"user": user_address, "action": action_type or "ml_inference"},
            )
        except Exception as seq_err:
            logger.debug("Sequencer forwarding skipped: %s", seq_err)

        result: dict[str, Any] = {
            "commitment_hash": commitment_hash,
            "proof_mode": mode.name,
            "proof_mode_level": int(mode),
            "ezkl_proof": ezkl_proof.to_dict() if hasattr(ezkl_proof, "to_dict") else {},
            "ezkl_verified": ezkl_verified,
            "trust_mode": trust_mode,
            "trust_warning": trust_warning,
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
                "failure_reason": real_ezkl_requirement_error,
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        bridge_fact_hash = ""
        if mode >= ProofMode.EZKL_BRIDGE and ezkl_verified:
            bridge_proof, bridge_fact_hash, model_bridge_calldata, bridge_circuit_used = self._build_bridge_bundle(
                ezkl_proof=ezkl_proof,
                model_name=model_name,
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
                result["verification"]["failure_reason"] = (
                    bridge_proof.get("error")
                    or bridge_proof.get("warning")
                    or "Bridge proof was not compliant"
                )

            # Forward bridge payload with proof-type-specific calldata when available.
            if bridge_proof.get("success") and model_bridge_calldata:
                try:
                    from app.services.proof_sequencer_client import get_sequencer_client

                    seq = get_sequencer_client()
                    is_noir_honk = bridge_circuit_used == "NoirEzklBridge"
                    is_native_kzg = bridge_circuit_used == "EzklNativeKzg"
                    await seq.submit_proof(
                        proof_id=bridge_fact_hash,
                        fact_hash=bridge_fact_hash,
                        model_name=model_name,
                        metadata={
                            "user": user_address,
                            "action": action_type or "ml_inference",
                            "bridge_circuit": bridge_circuit_used,
                        },
                        groth16_calldata=None if (is_noir_honk or is_native_kzg) else model_bridge_calldata,
                        honk_calldata=model_bridge_calldata if is_noir_honk else None,
                        kzg_calldata=model_bridge_calldata if is_native_kzg else None,
                        circuit_name=bridge_circuit_used,
                    )
                except Exception as seq_err:
                    logger.debug("Bridge sequencer forwarding skipped: %s", seq_err)

        if mode < ProofMode.EZKL_BRIDGE and execution_chain in {"l3", "l2", "dual"}:
            result["can_execute"] = False
            result["verification"]["failure_reason"] = "ModelBridge proof is required for chain verification"
        elif result["can_execute"] and bridge_fact_hash:
            model_bridge_calldata = (result.get("combined_calldata") or {}).get("model_bridge_calldata")
            circuit_name_l3 = result.get("bridge_circuit_used") or "ModelBridge"

            if execution_chain in {"l3", "dual"}:
                is_noir_honk = (result.get("bridge_circuit_used") or "") == "NoirEzklBridge"
                is_native_kzg = (result.get("bridge_circuit_used") or "") == "EzklNativeKzg"
                l3_result = await self._verify_l3_bridge(
                    fact_hash=bridge_fact_hash,
                    circuit_name=circuit_name_l3,
                    groth16_calldata=None if (is_noir_honk or is_native_kzg) else model_bridge_calldata,
                    execution_chain=execution_chain,
                    honk_calldata=model_bridge_calldata if is_noir_honk else None,
                    kzg_calldata=model_bridge_calldata if is_native_kzg else None,
                    proof_type="noir_honk" if is_noir_honk else ("native_kzg" if is_native_kzg else "groth16"),
                )
                result["verification"]["l3"] = l3_result

            if execution_chain in {"l2", "dual"}:
                l2_fact_hash = bridge_fact_hash
                if execution_chain == "dual":
                    l3_fact_hash = str((result["verification"]["l3"] or {}).get("fact_hash") or "").strip()
                    if l3_fact_hash:
                        l2_fact_hash = l3_fact_hash
                attempts = 1 + (self._mirror_retry_count if execution_chain == "dual" else 0)
                l2_result: dict[str, Any] | None = None
                for _ in range(attempts):
                    l2_result = await self._verify_l2_bridge(fact_hash=l2_fact_hash)
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
                    l2_verification = result["verification"]["l2"]
                    l2_mode = str((l2_verification or {}).get("mode", "")).strip().lower()
                    if self._is_cryptographically_verified(l2_verification):
                        result["verification"]["mirror_status"] = "mirrored"
                    elif l2_mode == "l2_registry_unavailable":
                        result["verification"]["mirror_status"] = "mirror_unavailable"
                    elif l2_mode == "l2_mirror_underfunded":
                        result["verification"]["mirror_status"] = "mirror_underfunded"
                    else:
                        result["verification"]["mirror_status"] = "mirror_failed"

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

        async def _build_local_heavy_fallback(reason: str) -> dict[str, Any]:
            seed = "|".join(f"{k}:{program_input[k]}" for k in sorted(program_input.keys()))
            proof_hash = "0x" + hashlib.sha256(
                f"local_heavy_stark:{seed}:{datetime.now(timezone.utc).isoformat()}".encode()
            ).hexdigest()
            fact_hash = "0x" + hashlib.sha256(f"fact:{proof_hash}".encode()).hexdigest()
            fallback: dict[str, Any] = {
                "circuit_name": "StarkHeavyReputation",
                "success": True,
                "proof_hash": proof_hash,
                "fact_hash": fact_hash,
                "stark_proof_data": {"config_hash": fact_hash, "calldata": [fact_hash]},
                "prover": "local_fallback",
                "warning": (
                    "Local fallback receipt. External Stone prover unavailable; "
                    "hash registration path was used for continuity."
                ),
                "error": reason,
            }
            if submit_to_l3:
                try:
                    client = get_l3_proving_path_client()
                    l3_res = await client.verify_proof(
                        fact_hash=fact_hash,
                        proof_type="sha256",
                        circuit_name="StarkHeavyReputation",
                        execution_chain=execution_chain,
                    )
                    fallback["l3"] = {
                        "success": l3_res.success,
                        "mode": l3_res.mode,
                        "verified_on_chain": l3_res.verified_on_chain,
                        "tx_hash": l3_res.tx_hash,
                        "error": l3_res.error,
                    }
                except Exception as l3_exc:
                    fallback["l3"] = {
                        "success": False,
                        "mode": "unreachable",
                        "verified_on_chain": False,
                        "tx_hash": "",
                        "error": str(l3_exc),
                    }
            return fallback

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
                reason = "Obsqra Stone prover unavailable"
                logger.warning("StarkHeavyReputation fallback: %s", reason)
                return await _build_local_heavy_fallback(reason)

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
            reason = str(exc)
            logger.warning("StarkHeavyReputation proof failed, using local fallback: %s", reason)
            return await _build_local_heavy_fallback(reason)

        return result

    def _generate_commitment(self, user_address: str, data: Any, context: str) -> str:
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
