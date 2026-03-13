"""
EZKL Prover Service — wraps EZKL CLI for proving ML model inference.

Manages the full lifecycle:
  1. Model setup (ONNX → compiled model + proving/verification keys)
  2. Proof generation (inference + ZK proof)
  3. Proof verification (local check before on-chain submission)

Stores artifacts in ``backend/data/ezkl_models/<model_name>/``.

EZKL v23+ required (Halo2/KZG-based, audited by Trail of Bits).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "ezkl_models"
DATA_DIR.mkdir(parents=True, exist_ok=True)

EZKL_BIN = os.getenv("EZKL_BIN", "ezkl")
EZKL_TIMEOUT = int(os.getenv("EZKL_TIMEOUT", "300"))  # 5min default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


# Try importing ezkl Python bindings (preferred over CLI subprocess)
try:
    import ezkl as _ezkl_lib
    _HAS_EZKL_PYTHON = True
except ImportError:
    _ezkl_lib = None  # type: ignore[assignment]
    _HAS_EZKL_PYTHON = False


# ── Data classes ─────────────────────────────────────────────────────────

@dataclass
class EZKLModelArtifacts:
    """Paths for a compiled EZKL model."""
    model_name: str
    onnx_path: Path
    compiled_model_path: Path
    settings_path: Path
    pk_path: Path
    vk_path: Path
    srs_path: Path
    calibration_path: Path | None = None
    model_hash: str = ""  # SHA-256 of ONNX bytes

    def is_ready(self) -> bool:
        return (
            self.compiled_model_path.exists()
            and self.pk_path.exists()
            and self.vk_path.exists()
        )


@dataclass
class EZKLProof:
    """A generated EZKL proof."""
    proof_bytes: bytes
    proof_hex: str
    public_inputs: list[float]
    inference_output: list[float]
    model_hash: str
    model_name: str
    proof_hash: str  # SHA-256 of proof bytes
    verify_key_hash: str
    # Raw proof JSON for verification (EZKL needs exact field elements)
    raw_proof_json: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "proof_hex": self.proof_hex,
            "public_inputs": self.public_inputs,
            "inference_output": self.inference_output,
            "model_hash": self.model_hash,
            "model_name": self.model_name,
            "proof_hash": self.proof_hash,
            "verify_key_hash": self.verify_key_hash,
        }


# ── Service ──────────────────────────────────────────────────────────────

class EZKLProverService:
    """
    Singleton service for EZKL proof generation.

    Usage:
        svc = get_ezkl_prover()
        artifacts = await svc.setup_model("yield_forecast", "/path/to/model.onnx", cal_data)
        proof = await svc.prove_inference("yield_forecast", input_data)
        ok = await svc.verify_proof(proof)
    """

    def __init__(self) -> None:
        self._models: dict[str, EZKLModelArtifacts] = {}
        self._lock = asyncio.Lock()
        self._warm_kzg_on_prove = _env_bool("EZKL_PROVER_WARM_KZG_ON_PROVE", True)
        self._check_ezkl_available()

    # ── Model lifecycle ─────────────────────────────────────────────────

    async def setup_model(
        self,
        model_name: str,
        onnx_path: str | Path,
        calibration_data: list[dict[str, list[float]]] | None = None,
        *,
        input_scale: int = 7,
        param_scale: int = 7,
        bits: int = 16,
        logrows: int = 17,
        force: bool = False,
    ) -> EZKLModelArtifacts:
        """
        One-time setup: gen-settings → calibrate → compile → setup.

        Args:
            model_name: Identifier for caching & storage.
            onnx_path: Path to the ONNX model file.
            calibration_data: Representative inputs for quantisation calibration.
            input_scale: EZKL input scaling (2^scale).
            param_scale: EZKL param scaling.
            bits: Bit width for quantised lookups.
            logrows: KZG SRS size (2^logrows points).
            force: Re-run setup even if artifacts exist.

        Returns:
            EZKLModelArtifacts with all paths populated.
        """
        onnx_path = Path(onnx_path)
        if not onnx_path.exists():
            raise FileNotFoundError(f"ONNX model not found: {onnx_path}")

        model_dir = DATA_DIR / model_name
        model_dir.mkdir(parents=True, exist_ok=True)

        # Compute model hash
        model_hash = hashlib.sha256(onnx_path.read_bytes()).hexdigest()

        artifacts = EZKLModelArtifacts(
            model_name=model_name,
            onnx_path=onnx_path,
            compiled_model_path=model_dir / "network.compiled",
            settings_path=model_dir / "settings.json",
            pk_path=model_dir / "pk.key",
            vk_path=model_dir / "vk.key",
            srs_path=model_dir / "kzg.srs",
            calibration_path=model_dir / "calibration.json" if calibration_data else None,
            model_hash=model_hash,
        )

        if artifacts.is_ready() and not force:
            logger.info("EZKL model '%s' already set up (hash: %s…)", model_name, model_hash[:12])
            self._models[model_name] = artifacts
            return artifacts

        logger.info("Setting up EZKL model '%s' …", model_name)

        # Write calibration data
        if calibration_data:
            cal_path = model_dir / "calibration.json"
            cal_path.write_text(json.dumps({"input_data": calibration_data}))
            artifacts.calibration_path = cal_path

        if self._use_python_api:
            await self._setup_model_python(artifacts, onnx_path, input_scale, param_scale, bits, logrows)
        else:
            await self._setup_model_cli(artifacts, onnx_path, input_scale, param_scale, bits, logrows)

        self._models[model_name] = artifacts
        logger.info(
            "EZKL model '%s' setup complete. Hash: %s…, VK at: %s",
            model_name, model_hash[:12], artifacts.vk_path,
        )
        return artifacts

    # ── Proof generation ────────────────────────────────────────────────

    async def prove_inference(
        self,
        model_name: str,
        input_data: list[list[float]],
    ) -> EZKLProof:
        """
        Run inference and generate a ZK proof.

        Args:
            model_name: Must match a previously setup model.
            input_data: Model inputs as nested list matching ONNX input shape.

        Returns:
            EZKLProof with proof bytes, outputs, and hashes.
        """
        artifacts = self._get_artifacts(model_name)

        if self._use_python_api:
            proof = await self._prove_inference_python(artifacts, input_data)
        else:
            proof = await self._prove_inference_cli(artifacts, input_data)

        if self._warm_kzg_on_prove:
            try:
                from app.services.ezkl_kzg_serializer import warm_kzg_bundle_cache_for_proof

                warm_meta = warm_kzg_bundle_cache_for_proof(
                    proof,
                    model_name=artifacts.model_name,
                    model_dir=artifacts.vk_path.parent,
                )
                try:
                    setattr(proof, "kzg_bundle_meta", warm_meta)
                except Exception:
                    pass
                logger.info(
                    "EZKL prove warmup for '%s': bundle_present=%s source=%s",
                    artifacts.model_name,
                    bool(warm_meta.get("kzg_mpcheck_bundle_present")),
                    warm_meta.get("kzg_bundle_injected_source")
                    or warm_meta.get("kzg_mpcheck_bundle_source"),
                )
            except Exception as warm_exc:
                logger.warning(
                    "EZKL prove warmup failed for '%s': %s",
                    artifacts.model_name,
                    warm_exc,
                )
        return proof

    # ── Proof verification ──────────────────────────────────────────────

    async def verify_proof(self, proof: EZKLProof) -> bool:
        """
        Locally verify an EZKL proof (pre-flight before on-chain submit).
        """
        artifacts = self._get_artifacts(proof.model_name)

        if self._use_python_api:
            return await self._verify_proof_python(artifacts, proof)
        return await self._verify_proof_cli(artifacts, proof)

    # ── Model hash for on-chain registry ────────────────────────────────

    def get_model_hash_felt(self, model_name: str) -> int:
        """Return model hash truncated to fit felt252 (< 2^251)."""
        artifacts = self._get_artifacts(model_name)
        return int(artifacts.model_hash[:62], 16)

    def get_artifacts(self, model_name: str) -> EZKLModelArtifacts | None:
        """Return artifacts for a model if set up, else None."""
        return self._models.get(model_name)

    def list_models(self) -> list[str]:
        """Return names of all set-up models."""
        return list(self._models.keys())

    # ── Python API implementations ─────────────────────────────────────

    async def _setup_model_python(
        self, artifacts: EZKLModelArtifacts, onnx_path: Path,
        input_scale: int, param_scale: int, bits: int, logrows: int,
    ) -> None:
        """Setup model using ezkl Python bindings.

        EZKL v23 calling conventions:
          - gen_settings, calibrate_settings, compile_circuit, setup: synchronous
          - get_srs: async (downloads SRS via HTTP internally)
        """
        settings_path = str(artifacts.settings_path)
        onnx = str(onnx_path)

        # Step 1: gen-settings (sync)
        _ezkl_lib.gen_settings(onnx, settings_path)
        # Patch settings with desired scales
        s = json.loads(Path(settings_path).read_text())
        s["run_args"] = s.get("run_args", {})
        s["run_args"]["input_scale"] = input_scale
        s["run_args"]["param_scale"] = param_scale
        s["run_args"]["bits"] = bits
        s["run_args"]["logrows"] = logrows
        Path(settings_path).write_text(json.dumps(s))

        # Step 2: calibrate settings if data available (sync)
        if artifacts.calibration_path and artifacts.calibration_path.exists():
            _ezkl_lib.calibrate_settings(
                str(artifacts.calibration_path), onnx, settings_path, "resources",
            )

        # Step 3: get SRS (ASYNC — must be awaited)
        cal_settings = json.loads(Path(settings_path).read_text())
        actual_logrows = cal_settings.get("run_args", {}).get("logrows", logrows)
        await _ezkl_lib.get_srs(settings_path, actual_logrows, str(artifacts.srs_path))

        # Step 4: compile circuit (sync)
        _ezkl_lib.compile_circuit(
            onnx, str(artifacts.compiled_model_path), settings_path,
        )

        # Step 5: setup — pk + vk (sync)
        _ezkl_lib.setup(
            str(artifacts.compiled_model_path), str(artifacts.vk_path),
            str(artifacts.pk_path), str(artifacts.srs_path),
        )
        logger.info("EZKL model setup via Python API complete")

    async def _setup_model_cli(
        self, artifacts: EZKLModelArtifacts, onnx_path: Path,
        input_scale: int, param_scale: int, bits: int, logrows: int,
    ) -> None:
        """Setup model using ezkl CLI subprocess (fallback)."""
        await self._run_ezkl([
            "gen-settings", "-M", str(onnx_path),
            "-O", str(artifacts.settings_path),
            "--input-scale", str(input_scale), "--param-scale", str(param_scale),
            "--bits", str(bits), "--logrows", str(logrows),
        ])
        if artifacts.calibration_path and artifacts.calibration_path.exists():
            await self._run_ezkl([
                "calibrate-settings", "-M", str(onnx_path),
                "-D", str(artifacts.calibration_path),
                "-O", str(artifacts.settings_path),
            ])
        await self._run_ezkl([
            "get-srs", "-S", str(artifacts.settings_path),
            "-O", str(artifacts.srs_path),
        ])
        await self._run_ezkl([
            "compile-circuit", "-M", str(onnx_path),
            "-S", str(artifacts.settings_path),
            "--compiled-circuit", str(artifacts.compiled_model_path),
        ])
        await self._run_ezkl([
            "setup", "--compiled-circuit", str(artifacts.compiled_model_path),
            "--srs-path", str(artifacts.srs_path),
            "--pk-path", str(artifacts.pk_path),
            "--vk-path", str(artifacts.vk_path),
        ])

    async def _prove_inference_python(
        self, artifacts: EZKLModelArtifacts, input_data: list[list[float]],
    ) -> EZKLProof:
        """Generate proof using ezkl Python bindings.

        All EZKL v23 prove-path functions (gen_witness, prove) are synchronous.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            input_path = tmp / "input.json"
            witness_path = tmp / "witness.json"
            proof_path = tmp / "proof.json"

            input_path.write_text(json.dumps({"input_data": input_data}))

            # Generate witness (sync)
            _ezkl_lib.gen_witness(
                str(input_path), str(artifacts.compiled_model_path),
                str(witness_path),
            )

            witness = json.loads(witness_path.read_text())
            raw_outputs = witness.get("outputs", [[]])[0] if "outputs" in witness else []
            inference_output = [self._decode_field_element(v) for v in raw_outputs]

            # Generate proof (sync)
            _ezkl_lib.prove(
                str(witness_path), str(artifacts.compiled_model_path),
                str(artifacts.pk_path), str(proof_path),
                str(artifacts.srs_path),
            )

            proof_data = json.loads(proof_path.read_text())
            proof_hex = proof_data.get("hex_proof", proof_data.get("proof", ""))
            proof_bytes = bytes.fromhex(proof_hex.replace("0x", "")) if proof_hex else b""

            public_inputs_raw = proof_data.get("instances", [[]])[0] if "instances" in proof_data else []
            public_inputs = [self._decode_field_element(v) for v in public_inputs_raw]

            proof_hash = hashlib.sha256(proof_bytes).hexdigest()
            vk_hash = hashlib.sha256(artifacts.vk_path.read_bytes()).hexdigest()

            return EZKLProof(
                proof_bytes=proof_bytes,
                proof_hex=proof_hex,
                public_inputs=public_inputs,
                inference_output=inference_output,
                model_hash=artifacts.model_hash,
                model_name=artifacts.model_name,
                proof_hash=f"0x{proof_hash}",
                verify_key_hash=f"0x{vk_hash}",
                raw_proof_json=proof_data,
            )

    async def _prove_inference_cli(
        self, artifacts: EZKLModelArtifacts, input_data: list[list[float]],
    ) -> EZKLProof:
        """Generate proof using ezkl CLI subprocess (fallback)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            input_path = tmp / "input.json"
            witness_path = tmp / "witness.json"
            proof_path = tmp / "proof.json"

            input_path.write_text(json.dumps({"input_data": input_data}))

            await self._run_ezkl([
                "gen-witness", "--compiled-circuit", str(artifacts.compiled_model_path),
                "-D", str(input_path), "-O", str(witness_path),
            ])

            witness = json.loads(witness_path.read_text())
            raw_outputs = witness.get("outputs", [[]])[0] if "outputs" in witness else []
            inference_output = [self._decode_field_element(v) for v in raw_outputs]

            await self._run_ezkl([
                "prove", "--compiled-circuit", str(artifacts.compiled_model_path),
                "--witness", str(witness_path), "--pk-path", str(artifacts.pk_path),
                "--proof-path", str(proof_path), "--srs-path", str(artifacts.srs_path),
            ])

            proof_data = json.loads(proof_path.read_text())
            proof_hex = proof_data.get("hex_proof", proof_data.get("proof", ""))
            proof_bytes = bytes.fromhex(proof_hex.replace("0x", "")) if proof_hex else b""

            public_inputs_raw = proof_data.get("instances", [[]])[0] if "instances" in proof_data else []
            public_inputs = [self._decode_field_element(v) for v in public_inputs_raw]

            proof_hash = hashlib.sha256(proof_bytes).hexdigest()
            vk_hash = hashlib.sha256(artifacts.vk_path.read_bytes()).hexdigest()

            return EZKLProof(
                proof_bytes=proof_bytes,
                proof_hex=proof_hex,
                public_inputs=public_inputs,
                inference_output=inference_output,
                model_hash=artifacts.model_hash,
                model_name=artifacts.model_name,
                proof_hash=f"0x{proof_hash}",
                verify_key_hash=f"0x{vk_hash}",
                raw_proof_json=proof_data,
            )

    async def _verify_proof_python(
        self, artifacts: EZKLModelArtifacts, proof: EZKLProof,
    ) -> bool:
        """Verify proof using ezkl Python bindings (sync call)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            proof_path = tmp / "proof.json"
            # Use raw proof JSON if available (preserves exact hex field elements)
            if proof.raw_proof_json:
                proof_path.write_text(json.dumps(proof.raw_proof_json))
            else:
                proof_path.write_text(json.dumps({
                    "hex_proof": proof.proof_hex,
                    "instances": [proof.public_inputs],
                }))
            try:
                result = _ezkl_lib.verify(
                    str(proof_path), str(artifacts.settings_path),
                    str(artifacts.vk_path), str(artifacts.srs_path),
                )
                return bool(result)
            except Exception:
                logger.warning("EZKL verification failed for model '%s'", proof.model_name)
                return False

    async def _verify_proof_cli(
        self, artifacts: EZKLModelArtifacts, proof: EZKLProof,
    ) -> bool:
        """Verify proof using ezkl CLI subprocess (fallback)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            proof_path = tmp / "proof.json"
            if proof.raw_proof_json:
                proof_path.write_text(json.dumps(proof.raw_proof_json))
            else:
                proof_path.write_text(json.dumps({
                    "hex_proof": proof.proof_hex,
                    "instances": [proof.public_inputs],
                }))
            try:
                await self._run_ezkl([
                    "verify", "--proof-path", str(proof_path),
                    "--vk-path", str(artifacts.vk_path),
                    "--settings-path", str(artifacts.settings_path),
                    "--srs-path", str(artifacts.srs_path),
                ])
                return True
            except RuntimeError:
                logger.warning("EZKL verification failed for model '%s'", proof.model_name)
                return False

    # ── Internals ───────────────────────────────────────────────────────

    def _get_artifacts(self, model_name: str) -> EZKLModelArtifacts:
        if model_name not in self._models:
            raise ValueError(
                f"Model '{model_name}' not set up. "
                f"Call setup_model() first. Available: {list(self._models.keys())}"
            )
        return self._models[model_name]

    def _check_ezkl_available(self) -> None:
        if _HAS_EZKL_PYTHON:
            logger.info("EZKL Python API available (v%s). Using native bindings.",
                        getattr(_ezkl_lib, '__version__', 'unknown'))
            self._use_python_api = True
            return
        # Fallback: check CLI binary
        self._use_python_api = False
        try:
            result = subprocess.run(
                [EZKL_BIN, "--version"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                logger.info("EZKL CLI available: %s", result.stdout.strip())
            else:
                logger.warning("EZKL binary found but returned error: %s", result.stderr.strip())
        except FileNotFoundError:
            logger.warning(
                "EZKL binary not found at '%s' and Python API not installed. "
                "Proof generation will fail. Install via: pip install ezkl",
                EZKL_BIN,
            )
        except Exception as e:
            logger.warning("EZKL check failed: %s", e)

    async def _run_ezkl(self, args: list[str]) -> str:
        """Run an EZKL CLI command asynchronously."""
        cmd = [EZKL_BIN] + args
        logger.debug("Running: %s", " ".join(cmd))

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._run_ezkl_sync, cmd)
        return result

    def _run_ezkl_sync(self, cmd: list[str]) -> str:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=EZKL_TIMEOUT,
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            stdout = result.stdout.strip()
            msg = stderr or stdout or f"EZKL command failed with code {result.returncode}"
            raise RuntimeError(f"EZKL error: {msg}\nCommand: {' '.join(cmd)}")
        return result.stdout

    @staticmethod
    def _decode_field_element(val: str | int | float) -> float:
        """Decode EZKL encoded field element back to float.

        EZKL v23 outputs witness/proof values as hex strings representing
        BN254 field elements in **little-endian** byte order:
          "570e000...000" → bytes [0x57, 0x0e, 0x00, ...] → LE int 0x0E57 = 3671

        To decode: reverse bytes → int → handle field negatives → / 2^scale
        """
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, str):
            try:
                hex_str = val.replace("0x", "")
                if all(c in "0123456789abcdefABCDEF" for c in hex_str) and len(hex_str) > 0:
                    # EZKL stores as little-endian bytes — reverse to big-endian
                    if len(hex_str) % 2 != 0:
                        hex_str = "0" + hex_str
                    le_bytes = bytes.fromhex(hex_str)
                    v = int.from_bytes(le_bytes, byteorder="little")
                    # Handle negative values in BN254 scalar field
                    BN254_P = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
                    if v > BN254_P // 2:
                        v = v - BN254_P
                    # EZKL fixed-point: value / 2^scale (scale=13 from calibration)
                    return v / 8192.0  # 2^13
                return float(val)
            except (ValueError, OverflowError):
                return 0.0
        return 0.0


# ── Singleton ────────────────────────────────────────────────────────────

_instance: EZKLProverService | None = None


def get_ezkl_prover() -> EZKLProverService:
    """Get or create the EZKL prover singleton."""
    global _instance
    if _instance is None:
        _instance = EZKLProverService()
    return _instance
