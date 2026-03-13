"""
EZKL -> native KZG calldata serializer (Path B scaffolding).

This module prepares deterministic felt calldata for the `native_kzg` proving path.
It does not implement Cairo-side KZG verification; it serializes proof payloads so
the backend can route real EZKL artifacts once a KZG verifier contract is deployed.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import os
import shlex
import site
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

FELT252_PRIME = 3618502788666131213697322783095070105623107215331596699973092056135872020481
FIXED_POINT_SCALE = 1_000_000
U96_MASK = (1 << 96) - 1
BN254_FIELD_MODULUS = int(
    "30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47",
    16,
)

EZKL_KZG_V1_MARKER = int.from_bytes(b"ezkl_kzg_v1", "big") % FELT252_PRIME
NATIVE_KZG_PLACEHOLDER_MARKER = int.from_bytes(b"native_kzg_placeholder_v1", "big") % FELT252_PRIME
KZG_MPCHECK_V1_MARKER = int.from_bytes(b"kzg_mpcheck_v1", "big") % FELT252_PRIME
KZG_MPCHECK_V2_MARKER = int.from_bytes(b"kzg_mpcheck_v2", "big") % FELT252_PRIME
KZG_MPCHECK_V3_MARKER = int.from_bytes(b"kzg_mpcheck_v3", "big") % FELT252_PRIME


def _canonical_hex(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    if not raw.startswith("0x"):
        raw = f"0x{raw}"
    body = raw[2:].lstrip("0")
    return f"0x{body}" if body else "0x0"


def _felt_from_hex_or_text(value: str) -> int:
    raw = (value or "").strip()
    if not raw:
        return 0
    if raw.startswith("0x"):
        try:
            return int(raw, 16) % FELT252_PRIME
        except ValueError:
            return 0
    try:
        return int(raw, 16) % FELT252_PRIME
    except ValueError:
        return int.from_bytes(raw.encode("utf-8"), "big") % FELT252_PRIME


def _int_from_any(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return int(raw, 16) if raw.startswith("0x") else int(raw)
        except ValueError:
            return None
    return None


def _float_to_felt(value: float, *, scale: int = FIXED_POINT_SCALE) -> int:
    scaled = int(round(float(value) * scale))
    if scaled < 0:
        scaled = FELT252_PRIME + scaled
    return scaled % FELT252_PRIME


def _bytes_to_felts(blob: bytes, *, chunk_size: int = 31) -> list[int]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    out: list[int] = []
    for i in range(0, len(blob), chunk_size):
        chunk = blob[i : i + chunk_size]
        out.append(int.from_bytes(chunk, "big") % FELT252_PRIME)
    return out


def _u384_to_limbs(value: int) -> list[int] | None:
    if value is None or value < 0:
        return None
    return [
        value & U96_MASK,
        (value >> 96) & U96_MASK,
        (value >> 192) & U96_MASK,
        (value >> 288) & U96_MASK,
    ]


def _u288_to_limbs(value: int) -> list[int] | None:
    if value is None or value < 0:
        return None
    if value >> 288:
        return None
    return [
        value & U96_MASK,
        (value >> 96) & U96_MASK,
        (value >> 192) & U96_MASK,
    ]


def _parse_g1_point(value: Any) -> tuple[int, int] | None:
    if isinstance(value, dict):
        x = _int_from_any(value.get("x"))
        y = _int_from_any(value.get("y"))
        if x is None or y is None:
            return None
        return (x, y)
    if isinstance(value, (list, tuple)) and len(value) == 2:
        x = _int_from_any(value[0])
        y = _int_from_any(value[1])
        if x is None or y is None:
            return None
        return (x, y)
    return None


def _parse_g2_point(value: Any) -> tuple[int, int, int, int] | None:
    if not isinstance(value, dict):
        return None
    x0 = _int_from_any(value.get("x0"))
    x1 = _int_from_any(value.get("x1"))
    y0 = _int_from_any(value.get("y0"))
    y1 = _int_from_any(value.get("y1"))
    if x0 is None or x1 is None or y0 is None or y1 is None:
        return None
    return (x0, x1, y0, y1)


def _parse_felt_list(values: Any) -> list[int]:
    if not isinstance(values, (list, tuple)):
        return []
    out: list[int] = []
    for item in values:
        v = _int_from_any(item)
        if v is None:
            return []
        out.append(v % FELT252_PRIME)
    return out


def _negate_g1_point(point: tuple[int, int]) -> tuple[int, int]:
    return (int(point[0]), (BN254_FIELD_MODULUS - int(point[1])) % BN254_FIELD_MODULUS)


def _bundle_from_pairings(pairings: Any, hints: Any = None) -> dict[str, Any]:
    if not isinstance(pairings, (list, tuple)) or len(pairings) < 2:
        return {}

    def _pick_pair_point(value: Any) -> tuple[int, int] | None:
        if isinstance(value, dict):
            for key in ("p", "g1", "lhs", "point"):
                parsed = _parse_g1_point(value.get(key))
                if parsed:
                    return parsed
        return _parse_g1_point(value)

    p0 = _pick_pair_point(pairings[0])
    p1 = _pick_pair_point(pairings[1])
    if not p0 or not p1:
        return {}
    bundle: dict[str, Any] = {
        "pair0": {"x": str(p0[0]), "y": str(p0[1])},
        "pair1": {"x": str(p1[0]), "y": str(p1[1])},
    }
    hint_felts = _parse_felt_list(hints)
    if hint_felts:
        bundle["mpcheck_hint_felts"] = [str(v) for v in hint_felts]
        bundle["auto_build_hint"] = False
    return bundle


def _extend_bundle_with_dynamic_fields(bundle: dict[str, Any], container: Any) -> dict[str, Any]:
    if not isinstance(bundle, dict) or not bundle or not isinstance(container, dict):
        return bundle

    out = dict(bundle)
    for key in ("g2_pair0", "g2_pair1"):
        value = container.get(key)
        if isinstance(value, dict) and value:
            out[key] = value

    for source_key in ("precomputed_line_felts", "mpcheck_line_felts", "line_felts"):
        value = container.get(source_key)
        if isinstance(value, (list, tuple)) and value:
            out["precomputed_line_felts"] = value
            break

    if "auto_build_hint" in container:
        out["auto_build_hint"] = container.get("auto_build_hint")
    return out


def _extract_kzg_bundle(raw_json: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if not isinstance(raw_json, dict):
        return {}, "none"

    def _looks_like_bundle_dict(value: Any) -> bool:
        if not isinstance(value, dict) or not value:
            return False
        structural_keys = {
            "pair0",
            "pair1",
            "pairings",
            "pairs",
            "g2_pair0",
            "g2_pair1",
            "mpcheck_hint_felts",
            "hint_felts",
            "precomputed_line_felts",
            "mpcheck_line_felts",
            "line_felts",
            "auto_build_hint",
        }
        return any(key in value for key in structural_keys)

    direct_keys = (
        "kzg_mpcheck_bundle",
        "kzg_pairing_bundle",
        "kzg_bundle",
        "pairing_bundle",
        "mpcheck_bundle",
    )
    for key in direct_keys:
        value = raw_json.get(key)
        if _looks_like_bundle_dict(value):
            return value, key

    # Optional nested containers used by some proof wrappers.
    nested_containers = (
        ("kzg", raw_json.get("kzg")),
        ("mpcheck", raw_json.get("mpcheck")),
        ("proof_metadata", raw_json.get("proof_metadata")),
        ("metadata", raw_json.get("metadata")),
    )
    for name, container in nested_containers:
        if not isinstance(container, dict):
            continue
        for key in direct_keys:
            value = container.get(key)
            if isinstance(value, dict) and value:
                return value, f"{name}.{key}"
        maybe_direct = _bundle_from_pairings(
            container.get("pairings") or container.get("pairs"),
            container.get("mpcheck_hint_felts")
            or container.get("hint_felts")
            or container.get("mpcheck_hint")
            or container.get("hints"),
        )
        if maybe_direct:
            return _extend_bundle_with_dynamic_fields(maybe_direct, container), f"{name}.pairings"

    # Flat top-level pairings fallback.
    maybe_top = _bundle_from_pairings(
        raw_json.get("kzg_pairings") or raw_json.get("pairings") or raw_json.get("pairs"),
        raw_json.get("mpcheck_hint_felts")
        or raw_json.get("hint_felts")
        or raw_json.get("mpcheck_hint")
        or raw_json.get("hints"),
    )
    if maybe_top:
        return _extend_bundle_with_dynamic_fields(maybe_top, raw_json), "top_level_pairings"

    # Flat top-level pair0/pair1 fallback.
    if raw_json.get("pair0") and raw_json.get("pair1"):
        maybe = {
            "pair0": raw_json.get("pair0"),
            "pair1": raw_json.get("pair1"),
            "g2_pair0": raw_json.get("g2_pair0"),
            "g2_pair1": raw_json.get("g2_pair1"),
            "precomputed_line_felts": raw_json.get("precomputed_line_felts")
            or raw_json.get("mpcheck_line_felts")
            or raw_json.get("line_felts"),
            "mpcheck_hint_felts": raw_json.get("mpcheck_hint_felts")
            or raw_json.get("hint_felts")
            or raw_json.get("mpcheck_hint")
            or raw_json.get("hints"),
            "auto_build_hint": raw_json.get("auto_build_hint", True),
        }
        return maybe, "top_level_pairs"

    return {}, "none"


def _extract_bundle_from_json_obj(
    obj: Any,
    *,
    proof_hash: str = "",
) -> tuple[dict[str, Any], str]:
    """
    Extract a KZG MPCheck bundle from a generic JSON object.

    Supports:
      - direct bundle object
      - wrapper with `kzg_mpcheck_bundle`
      - map keyed by proof hash
    """
    if not isinstance(obj, dict):
        return {}, "none"

    # Direct wrappers.
    direct_bundle = obj.get("kzg_mpcheck_bundle")
    if isinstance(direct_bundle, dict) and any(
        key in direct_bundle
        for key in (
            "pair0",
            "pair1",
            "pairings",
            "pairs",
            "g2_pair0",
            "g2_pair1",
            "mpcheck_hint_felts",
            "hint_felts",
            "precomputed_line_felts",
            "mpcheck_line_felts",
            "line_felts",
            "auto_build_hint",
        )
    ):
        return obj, "json.kzg_mpcheck_bundle"

    bundle, source = _extract_kzg_bundle(obj)
    if bundle:
        return bundle, f"json.{source}"

    # Proof-hash keyed map.
    canon_hash = _canonical_hex(proof_hash)
    if canon_hash and isinstance(direct_bundle, dict):
        for key in (canon_hash, canon_hash[2:]):
            entry = direct_bundle.get(key)
            if not isinstance(entry, dict):
                continue
            if isinstance(entry.get("kzg_mpcheck_bundle"), dict):
                return entry, "json.kzg_mpcheck_bundle.by_proof_hash"
            nested_bundle, nested_source = _extract_kzg_bundle(entry)
            if nested_bundle:
                return nested_bundle, f"json.kzg_mpcheck_bundle.by_proof_hash.{nested_source}"
    if canon_hash:
        for key in (canon_hash, canon_hash[2:]):
            entry = obj.get(key)
            if isinstance(entry, dict):
                if isinstance(entry.get("kzg_mpcheck_bundle"), dict):
                    return entry, "json.by_proof_hash.kzg_mpcheck_bundle"
                nested_bundle, nested_source = _extract_kzg_bundle(entry)
                if nested_bundle:
                    return nested_bundle, f"json.by_proof_hash.{nested_source}"

    return {}, "none"


def _candidate_bundle_files(
    *,
    model_dir: Path | None,
) -> list[Path]:
    candidates: list[Path] = []

    env_file = (os.getenv("EZKL_KZG_BUNDLE_FILE", "") or "").strip()
    if env_file:
        for raw in env_file.split(os.pathsep):
            p = Path(raw.strip())
            if p:
                candidates.append(p)

    env_dir = (os.getenv("EZKL_KZG_BUNDLE_DIR", "") or "").strip()
    if env_dir:
        d = Path(env_dir)
        candidates.extend(
            [
                d / "kzg_mpcheck_bundle.json",
                d / "kzg_pairing_bundle.json",
                d / "kzg_bundle.json",
            ]
        )

    if model_dir is not None:
        trace_dir = model_dir / ".kzg_trace_verifier"
        candidates.extend(
            [
                model_dir / "kzg_mpcheck_bundle.json",
                model_dir / "kzg_pairing_bundle.json",
                model_dir / "kzg_bundle.json",
                trace_dir / "kzg_mpcheck_bundle.json",
                trace_dir / "kzg_pairing_bundle.json",
                trace_dir / "kzg_bundle.json",
            ]
        )

    # De-duplicate while preserving order.
    seen: set[str] = set()
    uniq: list[Path] = []
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(path)
    return uniq


def _scan_model_sidecars_by_proof_hash(
    *,
    proof_hash: str,
    exclude_model_dir: Path | None,
) -> tuple[dict[str, Any], str]:
    """
    Fallback scan: search local model sidecars for an entry keyed by proof hash.

    This allows native KZG payloads to resolve bundles even when request model aliases
    differ from the artifact folder that originally produced the EZKL proof.
    """
    canon_hash = _canonical_hex(proof_hash)
    if not canon_hash:
        return {}, "none"

    enabled = (os.getenv("EZKL_KZG_BUNDLE_SCAN_MODELS", "true") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not enabled:
        return {}, "none"

    models_root = Path(__file__).resolve().parents[1] / "data" / "ezkl_models"
    if not models_root.exists() or not models_root.is_dir():
        return {}, "none"

    needle_hex = canon_hash.lower()
    needle_raw = canon_hash[2:].lower()
    exclude_resolved = None
    if exclude_model_dir is not None:
        try:
            exclude_resolved = exclude_model_dir.resolve()
        except Exception:
            exclude_resolved = exclude_model_dir

    for model_entry in sorted(models_root.iterdir()):
        if not model_entry.is_dir():
            continue
        try:
            if exclude_resolved is not None and model_entry.resolve() == exclude_resolved:
                continue
        except Exception:
            if exclude_model_dir is not None and model_entry == exclude_model_dir:
                continue

        candidates = [
            model_entry / "kzg_mpcheck_bundle.json",
            model_entry / "kzg_pairing_bundle.json",
            model_entry / "kzg_bundle.json",
            model_entry / ".kzg_trace_verifier" / "kzg_mpcheck_bundle.json",
            model_entry / ".kzg_trace_verifier" / "kzg_pairing_bundle.json",
            model_entry / ".kzg_trace_verifier" / "kzg_bundle.json",
        ]
        for path in candidates:
            if not path.exists():
                continue
            try:
                raw_text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            lowered = raw_text.lower()
            if needle_hex not in lowered and needle_raw not in lowered:
                continue
            try:
                parsed = json.loads(raw_text)
            except Exception:
                continue
            bundle_obj, src = _extract_bundle_from_json_obj(parsed, proof_hash=canon_hash)
            if bundle_obj:
                return bundle_obj, f"model_scan:{path}:{src}"

    return {}, "none"


def _default_bundle_extractor_cmd() -> str:
    root = Path(__file__).resolve().parents[3]
    script = root / "scripts" / "extract_ezkl_kzg_mpcheck_bundle.py"
    if script.exists():
        return f"python3 {script}"
    return ""


def _can_auto_extract_bundle(*, model_dir: Path | None) -> bool:
    if not model_dir:
        return False
    required = (
        model_dir / "vk.key",
        model_dir / "settings.json",
        model_dir / "kzg.srs",
    )
    return all(path.exists() for path in required)


def _run_bundle_extractor(
    *,
    cmd: str,
    raw_json: dict[str, Any],
    proof_hash: str,
    model_name: str,
    model_dir: Path | None,
    timeout_seconds: int = 180,
) -> tuple[dict[str, Any], str, str | None]:
    """
    Optional external hook for producing KZG MPCheck bundles.

    The command must print JSON to stdout containing either:
      - `kzg_mpcheck_bundle`, or
      - a direct bundle object, or
      - a proof-hash keyed map.
    """
    args = shlex.split(cmd)
    if not args:
        return {}, "none", "empty_command"

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        tmp.write(json.dumps(raw_json))
        tmp_path = Path(tmp.name)

    env = os.environ.copy()
    env["EZKL_RAW_PROOF_JSON_PATH"] = str(tmp_path)
    env["EZKL_PROOF_HASH"] = str(proof_hash or "")
    env["EZKL_MODEL_NAME"] = str(model_name or "")
    env["EZKL_MODEL_DIR"] = str(model_dir or "")

    try:
        proc = subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            timeout=max(10, int(timeout_seconds)),
            env=env,
        )
        out = (proc.stdout or "").strip()
        if not out:
            return {}, "none", "empty_stdout"
        try:
            parsed = json.loads(out)
        except Exception as exc:
            return {}, "none", f"invalid_json:{exc}"
        bundle_obj, source = _extract_bundle_from_json_obj(parsed, proof_hash=proof_hash)
        if not bundle_obj:
            return {}, "none", "no_bundle_in_output"
        return bundle_obj, source, None
    except subprocess.TimeoutExpired:
        return {}, "none", f"timeout_after_{max(10, int(timeout_seconds))}s"
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or exc.stdout or "").strip()
        if len(stderr) > 400:
            stderr = stderr[-400:]
        msg = f"nonzero_exit:{exc.returncode}"
        if stderr:
            msg = f"{msg}:{stderr}"
        return {}, "none", msg
    except Exception as exc:
        return {}, "none", str(exc)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def _persist_bundle_sidecar(
    *,
    model_dir: Path | None,
    proof_hash: str,
    bundle_obj: dict[str, Any],
) -> str:
    if model_dir is None:
        return ""
    try:
        model_dir.mkdir(parents=True, exist_ok=True)
        out_path = model_dir / "kzg_mpcheck_bundle.json"
        canon_hash = _canonical_hex(proof_hash)
        if not canon_hash:
            return ""

        payload: dict[str, Any] = {}
        if out_path.exists():
            try:
                existing = json.loads(out_path.read_text())
                if isinstance(existing, dict):
                    payload = existing
            except Exception:
                payload = {}

        entry = bundle_obj
        if isinstance(bundle_obj.get("kzg_mpcheck_bundle"), dict):
            entry = {"kzg_mpcheck_bundle": bundle_obj["kzg_mpcheck_bundle"]}
        payload[canon_hash] = entry
        out_path.write_text(json.dumps(payload, indent=2))
        return str(out_path)
    except Exception:
        return ""


def _inject_kzg_bundle_from_sources(
    *,
    raw_json: dict[str, Any],
    proof_hash: str,
    model_name: str,
    model_dir: Path | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Try to enrich `raw_json` with a `kzg_mpcheck_bundle` from sidecar sources.
    """
    enriched = dict(raw_json or {})
    initial_bundle, initial_source = _extract_kzg_bundle(enriched)
    if initial_bundle:
        _, initial_trailer_meta = _build_kzg_mpcheck_trailer(enriched)
        if bool(initial_trailer_meta.get("kzg_mpcheck_bundle_present")):
            return enriched, {
                "kzg_bundle_injected": False,
                "kzg_bundle_injected_source": f"raw_json.{initial_source}",
                "kzg_bundle_extractor_attempted": False,
                "kzg_bundle_extractor_error": None,
            }

    # 1) Sidecar files.
    for path in _candidate_bundle_files(model_dir=model_dir):
        if not path.exists():
            continue
        try:
            parsed = json.loads(path.read_text())
        except Exception:
            continue
        bundle_obj, src = _extract_bundle_from_json_obj(parsed, proof_hash=proof_hash)
        if not bundle_obj:
            continue
        if isinstance(bundle_obj.get("kzg_mpcheck_bundle"), dict):
            enriched["kzg_mpcheck_bundle"] = bundle_obj["kzg_mpcheck_bundle"]
        else:
            enriched["kzg_mpcheck_bundle"] = bundle_obj
        return enriched, {
            "kzg_bundle_injected": True,
            "kzg_bundle_injected_source": f"file:{path}:{src}",
            "kzg_bundle_extractor_attempted": False,
            "kzg_bundle_extractor_error": None,
        }

    # 2) Optional external extractor command.
    extractor_cmd = (os.getenv("EZKL_KZG_BUNDLE_EXTRACTOR_CMD", "") or "").strip()
    auto_extract_enabled = (os.getenv("EZKL_KZG_BUNDLE_AUTO_EXTRACT", "true") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not extractor_cmd and auto_extract_enabled and _can_auto_extract_bundle(model_dir=model_dir):
        extractor_cmd = _default_bundle_extractor_cmd()
    if extractor_cmd:
        extractor_attempted = True
        try:
            extractor_timeout = int((os.getenv("EZKL_KZG_BUNDLE_EXTRACTOR_TIMEOUT", "180") or "180").strip())
        except ValueError:
            extractor_timeout = 180
        bundle_obj, src, extractor_error = _run_bundle_extractor(
            cmd=extractor_cmd,
            raw_json=enriched,
            proof_hash=proof_hash,
            model_name=model_name,
            model_dir=model_dir,
            timeout_seconds=extractor_timeout,
        )
        if bundle_obj:
            extractor_keys: list[str] = []
            if isinstance(bundle_obj.get("kzg_mpcheck_bundle"), dict):
                extractor_keys = sorted(str(k) for k in bundle_obj["kzg_mpcheck_bundle"].keys())
            elif isinstance(bundle_obj, dict):
                extractor_keys = sorted(str(k) for k in bundle_obj.keys())
            if isinstance(bundle_obj.get("kzg_mpcheck_bundle"), dict):
                enriched["kzg_mpcheck_bundle"] = bundle_obj["kzg_mpcheck_bundle"]
            else:
                enriched["kzg_mpcheck_bundle"] = bundle_obj
            cached_path = _persist_bundle_sidecar(
                model_dir=model_dir,
                proof_hash=proof_hash,
                bundle_obj=bundle_obj,
            )
            return enriched, {
                "kzg_bundle_injected": True,
                "kzg_bundle_injected_source": f"extractor:{src}",
                "kzg_bundle_extractor_keys": extractor_keys,
                "kzg_bundle_cached_path": cached_path or None,
                "kzg_bundle_extractor_attempted": extractor_attempted,
                "kzg_bundle_extractor_error": None,
            }
    else:
        extractor_attempted = False
        extractor_error = None

    # 3) Cross-model hash scan fallback.
    bundle_obj, src = _scan_model_sidecars_by_proof_hash(
        proof_hash=proof_hash,
        exclude_model_dir=model_dir,
    )
    if bundle_obj:
        if isinstance(bundle_obj.get("kzg_mpcheck_bundle"), dict):
            enriched["kzg_mpcheck_bundle"] = bundle_obj["kzg_mpcheck_bundle"]
        else:
            enriched["kzg_mpcheck_bundle"] = bundle_obj
        cached_path = _persist_bundle_sidecar(
            model_dir=model_dir,
            proof_hash=proof_hash,
            bundle_obj=bundle_obj,
        )
        return enriched, {
            "kzg_bundle_injected": True,
            "kzg_bundle_injected_source": src,
            "kzg_bundle_cached_path": cached_path or None,
            "kzg_bundle_extractor_attempted": extractor_attempted,
            "kzg_bundle_extractor_error": extractor_error if extractor_attempted else None,
        }

    return enriched, {
        "kzg_bundle_injected": False,
        "kzg_bundle_injected_source": "none",
        "kzg_bundle_extractor_attempted": extractor_attempted,
        "kzg_bundle_extractor_error": extractor_error if extractor_attempted else None,
    }


def _garaga_module_path() -> Path | None:
    root = Path(__file__).resolve().parents[3]
    module = root / "circuits" / "node_modules" / "garaga" / "dist" / "index.cjs"
    return module if module.exists() else None


def _garaga_hydra_path() -> Path | None:
    cache_root = Path.home() / ".cache" / "scarb" / "registry" / "git" / "checkouts"
    if not cache_root.exists():
        return None
    candidates = sorted(cache_root.glob("garaga-*/*/hydra"))
    for candidate in candidates:
        if (candidate / "garaga" / "precompiled_circuits" / "multi_miller_loop.py").exists():
            return candidate
    return None


def _load_garaga_dynamic_builder() -> tuple[Any, Any, Any, Any, Any, Any] | None:
    hydra_path = _garaga_hydra_path()
    if hydra_path is None:
        return None

    injected_site_paths: list[str] = []
    for site_path in site.getsitepackages():
        if site_path and site_path not in sys.path:
            sys.path.insert(0, site_path)
            injected_site_paths.append(site_path)

    inserted = False
    hydra_str = str(hydra_path)
    if hydra_str not in sys.path:
        sys.path.insert(0, hydra_str)
        inserted = True
    try:
        try:
            curves = importlib.import_module("garaga.curves")
            points = importlib.import_module("garaga.points")
            miller = importlib.import_module("garaga.precompiled_circuits.multi_miller_loop")
            mpcheck = importlib.import_module("garaga.starknet.tests_and_calldata_generators.mpcheck")
            return (
                curves.CurveID,
                points.G1Point,
                points.G2Point,
                points.G1G2Pair,
                miller.precompute_lines,
                mpcheck.MPCheckCalldataBuilder,
            )
        except Exception:
            return None
    finally:
        if inserted:
            try:
                sys.path.remove(hydra_str)
            except ValueError:
                pass
        for site_path in injected_site_paths:
            try:
                sys.path.remove(site_path)
            except ValueError:
                pass


def _build_bn254_mpcheck_hint_felts(pair0: tuple[int, int], pair1: tuple[int, int]) -> list[int]:
    """
    Build MPCheck hint felts for MPCHECK_BN254_2P_2F with fixed KZG G2 points.

    Requires local Node + Garaga npm package at `circuits/node_modules/garaga`.
    """
    garaga_module = _garaga_module_path()
    if garaga_module is None:
        return []

    payload = json.dumps(
        {
            "pair0": [str(pair0[0]), str(pair0[1])],
            "pair1": [str(pair1[0]), str(pair1[1])],
        }
    )
    js = r"""
const garaga = require(process.argv[1]);
const payload = JSON.parse(process.argv[2]);
const makeU384 = (l0, l1, l2, l3) =>
  BigInt(l0) + (BigInt(l1) << 96n) + (BigInt(l2) << 192n) + (BigInt(l3) << 288n);

// garaga::apps::noir::{G2_POINT_KZG_1, G2_POINT_KZG_2}
const G2_1 = [
  [makeU384("0xf75edadd46debd5cd992f6ed", "0x426a00665e5c4479674322d4", "0x1800deef121f1e76", "0x0"),
   makeU384("0x35a9e71297e485b7aef312c2", "0x7260bfb731fb5d25f1aa4933", "0x198e9393920d483a", "0x0")],
  [makeU384("0x0c43d37b4ce6cc0166fa7daa", "0x4aab71808dcb408fe3d1e769", "0x12c85ea5db8c6deb", "0x0"),
   makeU384("0x70b38ef355acdadcd122975b", "0xec9e99ad690c3395bc4b3133", "0x090689d0585ff075", "0x0")],
];
const G2_2 = [
  [makeU384("0x3b32078b7e231fec938883b0", "0xbc89b5b398b5974e9f594407", "0x0118c4d5b837bcc2", "0x0"),
   makeU384("0x358e038b4efe30fac09383c1", "0xe7ff4e580791dee8ea51d87a", "0x260e01b251f6f1c7", "0x0")],
  [makeU384("0x96e6cea2854a87d4dacc5e55", "0x56475b4214e5615e11e6dd3f", "0x22febda3c0c0632a", "0x0"),
   makeU384("0x41f99ba4ee413c80da6a5fe4", "0xd25156c1bb9a72859cf2a046", "0x04fc6369f7110fe3", "0x0")],
];

async function main() {
  await garaga.init();
  const p0 = [BigInt(payload.pair0[0]), BigInt(payload.pair0[1])];
  const p1 = [BigInt(payload.pair1[0]), BigInt(payload.pair1[1])];
  const pairs = [[p0, G2_1], [p1, G2_2]];
  const out = garaga.mpcCalldataBuilder(garaga.CurveId.BN254, pairs, 2);
  console.log(JSON.stringify(out.map((x) => x.toString())));
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
"""
    try:
        proc = subprocess.run(
            ["node", "-e", js, str(garaga_module), payload],
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
        )
        raw = json.loads(proc.stdout.strip() or "[]")
        return [int(x) % FELT252_PRIME for x in raw if str(x).strip()]
    except Exception:
        return []


def _build_bn254_dynamic_mpcheck_artifacts(
    pair0: tuple[int, int],
    pair1: tuple[int, int],
    g2_pair0: tuple[int, int, int, int],
    g2_pair1: tuple[int, int, int, int],
) -> tuple[list[int], list[int], str]:
    """
    Build a matched MPCheck hint and precomputed line list for BN254 2P_2F.

    This uses Garaga's Python builder with `n_fixed_g2=2`, so the hint transcript
    and Miller-loop lines correspond to the same fixed G2 pair.
    """
    modules = _load_garaga_dynamic_builder()
    if modules is not None:
        try:
            CurveID, G1Point, G2Point, G1G2Pair, precompute_lines, MPCheckCalldataBuilder = modules
            p0 = G1Point(int(pair0[0]), int(pair0[1]), CurveID.BN254)
            p1 = G1Point(int(pair1[0]), int(pair1[1]), CurveID.BN254)
            q0 = G2Point((int(g2_pair0[0]), int(g2_pair0[1])), (int(g2_pair0[2]), int(g2_pair0[3])), CurveID.BN254)
            q1 = G2Point((int(g2_pair1[0]), int(g2_pair1[1])), (int(g2_pair1[2]), int(g2_pair1[3])), CurveID.BN254)
            pairs = [G1G2Pair(p0, q0), G1G2Pair(p1, q1)]
            builder = MPCheckCalldataBuilder(CurveID.BN254, pairs, 2, None)
            hint = [int(x) % FELT252_PRIME for x in builder.serialize_to_calldata()]
            lines = [int(x.value) for x in precompute_lines([q0, q1])]
            return hint, lines, ""
        except Exception as exc:
            inproc_error = f"inproc:{exc}"
    else:
        inproc_error = "garaga_hydra_not_found"

    hydra_path = _garaga_hydra_path()
    if hydra_path is None:
        return [], [], inproc_error

    python_bin = "/usr/bin/python3.12"
    if not Path(python_bin).exists():
        python_bin = shutil.which("python3") or sys.executable

    payload = json.dumps(
        {
            "pair0": [str(pair0[0]), str(pair0[1])],
            "pair1": [str(pair1[0]), str(pair1[1])],
            "g2_pair0": [str(v) for v in g2_pair0],
            "g2_pair1": [str(v) for v in g2_pair1],
        }
    )
    py = r"""
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])

from garaga.curves import CurveID
from garaga.points import G1Point, G2Point, G1G2Pair
from garaga.precompiled_circuits.multi_miller_loop import precompute_lines
from garaga.starknet.tests_and_calldata_generators.mpcheck import MPCheckCalldataBuilder

payload = json.loads(sys.argv[2])
p0 = G1Point(int(payload["pair0"][0]), int(payload["pair0"][1]), CurveID.BN254)
p1 = G1Point(int(payload["pair1"][0]), int(payload["pair1"][1]), CurveID.BN254)
q0 = G2Point(
    (int(payload["g2_pair0"][0]), int(payload["g2_pair0"][1])),
    (int(payload["g2_pair0"][2]), int(payload["g2_pair0"][3])),
    CurveID.BN254,
)
q1 = G2Point(
    (int(payload["g2_pair1"][0]), int(payload["g2_pair1"][1])),
    (int(payload["g2_pair1"][2]), int(payload["g2_pair1"][3])),
    CurveID.BN254,
)
pairs = [G1G2Pair(p0, q0), G1G2Pair(p1, q1)]
builder = MPCheckCalldataBuilder(CurveID.BN254, pairs, 2, None)
hint = [int(x) for x in builder.serialize_to_calldata()]
lines = [int(x.value) for x in precompute_lines([q0, q1])]
print(json.dumps({"hint": [str(v) for v in hint], "lines": [str(v) for v in lines]}))
"""
    try:
        env = os.environ.copy()
        existing_pythonpath = [part for part in env.get("PYTHONPATH", "").split(os.pathsep) if part]
        extra_pythonpath = list(site.getsitepackages()) + [str(hydra_path)]
        merged_pythonpath: list[str] = []
        for part in extra_pythonpath + existing_pythonpath:
            if part and part not in merged_pythonpath:
                merged_pythonpath.append(part)
        if merged_pythonpath:
            env["PYTHONPATH"] = os.pathsep.join(merged_pythonpath)
        proc = subprocess.run(
            [python_bin, "-c", py, str(hydra_path), payload],
            check=True,
            capture_output=True,
            text=True,
            timeout=90,
            env=env,
        )
        raw = json.loads(proc.stdout.strip() or "{}")
        hint = [int(v) % FELT252_PRIME for v in raw.get("hint", []) if str(v).strip()]
        lines = [int(v) for v in raw.get("lines", []) if str(v).strip()]
        return hint, lines, ""
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or exc.stdout or "").strip()
        if stderr:
            stderr = stderr[-600:]
        msg = f"{inproc_error}; subprocess_exit:{exc.returncode}"
        if stderr:
            msg = f"{msg}:{stderr}"
        return [], [], msg
    except Exception as exc:
        return [], [], f"{inproc_error}; subprocess:{exc}"


def _build_kzg_mpcheck_trailer(raw_json: dict[str, Any]) -> tuple[list[int], dict[str, Any]]:
    """
    Optional cryptographic trailer for ezkl_kzg_v1:
      v1: [kzg_mpcheck_v1][pair0_g1(8 felts)][pair1_g1(8 felts)][hint_len][hint_felts...]
      v2: [kzg_mpcheck_v2][pair0_g1(8 felts)][pair1_g1(8 felts)]
          [g2_pair0(16 felts)][g2_pair1(16 felts)][hint_len][hint_felts...]
      v3: [kzg_mpcheck_v3][pair0_g1(8 felts)][pair1_g1(8 felts)]
          [g2_pair0(16 felts)][g2_pair1(16 felts)][line_count][line_felts...]
          [hint_len][hint_felts...]
    """
    bundle, bundle_source = _extract_kzg_bundle(raw_json)
    if not isinstance(bundle, dict):
        bundle = {}

    pair0 = _parse_g1_point(bundle.get("pair0") or bundle.get("p1"))
    pair1 = _parse_g1_point(bundle.get("pair1") or bundle.get("p2"))
    g2_pair0 = _parse_g2_point(bundle.get("g2_pair0"))
    g2_pair1 = _parse_g2_point(bundle.get("g2_pair1"))
    provided_hint_felts = _parse_felt_list(
        bundle.get("mpcheck_hint_felts")
        or bundle.get("hint_felts")
        or bundle.get("mpcheck_hint")
    )
    provided_line_felts = _parse_felt_list(
        bundle.get("precomputed_line_felts")
        or bundle.get("mpcheck_line_felts")
        or bundle.get("line_felts")
    )
    hint_error = str(bundle.get("hint_error") or "").strip()
    line_error = str(bundle.get("line_error") or "").strip()
    hint_source = "provided"
    line_source = "provided"
    hint_felts = list(provided_hint_felts)
    line_values = list(provided_line_felts)

    if pair0 and pair1 and g2_pair0 and g2_pair1:
        pair0_neg = _negate_g1_point(pair0)
        pair1_neg = _negate_g1_point(pair1)
        sign_variants = [
            ("pair0_raw_pair1_neg", pair0, pair1_neg),
            ("pair0_raw_pair1_raw", pair0, pair1),
            ("pair0_neg_pair1_raw", pair0_neg, pair1),
            ("pair0_neg_pair1_neg", pair0_neg, pair1_neg),
        ]
        chosen_variant = "pair0_raw_pair1_raw"
        rebuilt_error = ""
        for variant_name, variant_pair0, variant_pair1 in sign_variants:
            rebuilt_hint_felts, rebuilt_line_values, rebuilt_error = _build_bn254_dynamic_mpcheck_artifacts(
                variant_pair0,
                variant_pair1,
                g2_pair0,
                g2_pair1,
            )
            if rebuilt_hint_felts:
                pair0 = variant_pair0
                pair1 = variant_pair1
                chosen_variant = variant_name
                hint_felts = rebuilt_hint_felts
                hint_source = "garaga_dynamic_pairs_2f"
                if rebuilt_line_values:
                    line_values = rebuilt_line_values
                    line_source = "garaga_precompute_lines_2f"
                break
        if rebuilt_error:
            if not hint_error:
                hint_error = rebuilt_error
            if not line_error:
                line_error = rebuilt_error
        if chosen_variant != "pair0_raw_pair1_raw":
            bundle["selected_sign_variant"] = chosen_variant

    if pair0 and pair1 and not hint_felts and bool(bundle.get("auto_build_hint", True)):
        hint_felts = _build_bn254_mpcheck_hint_felts(pair0, pair1)
        hint_source = "garaga_mpc_builder"

    if not pair0 or not pair1 or not g2_pair0 or not g2_pair1 or not hint_felts:
        return [], {
            "kzg_mpcheck_bundle_present": False,
            "kzg_mpcheck_hint_felts": 0,
            "kzg_mpcheck_hint_source": "none",
            "kzg_mpcheck_line_source": "none",
            "kzg_mpcheck_precomputed_line_values": 0,
            "kzg_mpcheck_precomputed_lines": 0,
            "kzg_mpcheck_bundle_source": bundle_source,
            "kzg_mpcheck_hint_error": hint_error or None,
            "kzg_mpcheck_line_error": line_error or None,
        }

    pair0_x_limbs = _u384_to_limbs(pair0[0])
    pair0_y_limbs = _u384_to_limbs(pair0[1])
    pair1_x_limbs = _u384_to_limbs(pair1[0])
    pair1_y_limbs = _u384_to_limbs(pair1[1])
    if not pair0_x_limbs or not pair0_y_limbs or not pair1_x_limbs or not pair1_y_limbs:
        return [], {
            "kzg_mpcheck_bundle_present": False,
            "kzg_mpcheck_hint_felts": 0,
            "kzg_mpcheck_hint_source": "none",
            "kzg_mpcheck_line_source": "none",
            "kzg_mpcheck_precomputed_line_values": 0,
            "kzg_mpcheck_precomputed_lines": 0,
            "kzg_mpcheck_bundle_source": bundle_source,
            "kzg_mpcheck_hint_error": hint_error or None,
            "kzg_mpcheck_line_error": line_error or None,
        }

    g2_pair0_limbs = (
        _u384_to_limbs(g2_pair0[0]),
        _u384_to_limbs(g2_pair0[1]),
        _u384_to_limbs(g2_pair0[2]),
        _u384_to_limbs(g2_pair0[3]),
    )
    g2_pair1_limbs = (
        _u384_to_limbs(g2_pair1[0]),
        _u384_to_limbs(g2_pair1[1]),
        _u384_to_limbs(g2_pair1[2]),
        _u384_to_limbs(g2_pair1[3]),
    )
    if any(not limbs for limbs in (*g2_pair0_limbs, *g2_pair1_limbs)):
        return [], {
            "kzg_mpcheck_bundle_present": False,
            "kzg_mpcheck_hint_felts": 0,
            "kzg_mpcheck_hint_source": "none",
            "kzg_mpcheck_line_source": "none",
            "kzg_mpcheck_precomputed_line_values": 0,
            "kzg_mpcheck_precomputed_lines": 0,
            "kzg_mpcheck_bundle_source": bundle_source,
            "kzg_mpcheck_hint_error": hint_error or None,
            "kzg_mpcheck_line_error": line_error or None,
        }

    line_limbs: list[int] = []
    line_count = 0
    if line_values:
        if len(line_values) % 4 == 0:
            for value in line_values:
                limbs = _u288_to_limbs(value)
                if not limbs:
                    line_limbs = []
                    line_count = 0
                    line_error = line_error or "invalid_precomputed_line_value"
                    break
                line_limbs.extend(limbs)
            if line_limbs:
                line_count = len(line_values) // 4
        else:
            line_error = line_error or "precomputed_line_values_not_multiple_of_four"

    if line_limbs and g2_pair0 and g2_pair1:
        trailer = [KZG_MPCHECK_V3_MARKER]
        trailer.extend(pair0_x_limbs)
        trailer.extend(pair0_y_limbs)
        trailer.extend(pair1_x_limbs)
        trailer.extend(pair1_y_limbs)
        for limbs in g2_pair0_limbs:
            trailer.extend(limbs or [])
        for limbs in g2_pair1_limbs:
            trailer.extend(limbs or [])
        trailer.append(line_count)
        trailer.extend(line_limbs)
        trailer.append(len(hint_felts))
        trailer.extend(hint_felts)
    else:
        trailer = [KZG_MPCHECK_V2_MARKER]
        trailer.extend(pair0_x_limbs)
        trailer.extend(pair0_y_limbs)
        trailer.extend(pair1_x_limbs)
        trailer.extend(pair1_y_limbs)
        for limbs in g2_pair0_limbs:
            trailer.extend(limbs or [])
        for limbs in g2_pair1_limbs:
            trailer.extend(limbs or [])
        trailer.append(len(hint_felts))
        trailer.extend(hint_felts)
    return trailer, {
        "kzg_mpcheck_bundle_present": True,
        "kzg_mpcheck_bundle_source": bundle_source,
        "kzg_mpcheck_hint_felts": len(hint_felts),
        "kzg_mpcheck_hint_source": hint_source,
        "kzg_mpcheck_line_source": line_source if line_count else "none",
        "kzg_mpcheck_precomputed_line_values": len(line_values),
        "kzg_mpcheck_precomputed_lines": line_count,
        "kzg_mpcheck_trailer_marker": (
            "kzg_mpcheck_v3" if line_count else "kzg_mpcheck_v2"
        ),
        "kzg_mpcheck_hint_error": hint_error or None,
        "kzg_mpcheck_line_error": line_error or None,
        "kzg_mpcheck_pair0_x": hex(pair0[0]),
        "kzg_mpcheck_pair0_y": hex(pair0[1]),
        "kzg_mpcheck_pair1_x": hex(pair1[0]),
        "kzg_mpcheck_pair1_y": hex(pair1[1]),
        "kzg_mpcheck_g2_pair0_x0": hex(g2_pair0[0]),
        "kzg_mpcheck_g2_pair0_x1": hex(g2_pair0[1]),
        "kzg_mpcheck_g2_pair0_y0": hex(g2_pair0[2]),
        "kzg_mpcheck_g2_pair0_y1": hex(g2_pair0[3]),
        "kzg_mpcheck_g2_pair1_x0": hex(g2_pair1[0]),
        "kzg_mpcheck_g2_pair1_x1": hex(g2_pair1[1]),
        "kzg_mpcheck_g2_pair1_y0": hex(g2_pair1[2]),
        "kzg_mpcheck_g2_pair1_y1": hex(g2_pair1[3]),
    }


def warm_kzg_bundle_cache_for_proof(
    proof: Any,
    *,
    model_name: str = "",
    model_dir: str | Path | None = None,
) -> dict[str, Any]:
    """
    Warm sidecar/extractor bundle cache for an EZKL proof without emitting calldata.

    This is intended for non-native-kzg paths (e.g., ModelBridge Groth16 lane)
    so future native-kzg requests can reuse cached `kzg_mpcheck_bundle` material.
    """
    raw_json = dict(getattr(proof, "raw_proof_json", {}) or {})
    model_name_effective = str(model_name or getattr(proof, "model_name", "") or "").strip()
    model_dir_path = Path(model_dir) if model_dir is not None else None
    if model_dir_path is None and model_name_effective:
        model_dir_path = Path(__file__).resolve().parents[1] / "data" / "ezkl_models" / model_name_effective

    enriched_json, inject_meta = _inject_kzg_bundle_from_sources(
        raw_json=raw_json,
        proof_hash=str(getattr(proof, "proof_hash", "") or ""),
        model_name=model_name_effective,
        model_dir=model_dir_path,
    )
    _, trailer_meta = _build_kzg_mpcheck_trailer(enriched_json)
    try:
        setattr(proof, "raw_proof_json", enriched_json)
    except Exception:
        pass
    out = {"kzg_warm_attempted": True}
    out.update(inject_meta)
    out.update(trailer_meta)
    return out


def serialize_ezkl_proof_to_kzg_calldata(
    proof: Any,
    *,
    model_name: str = "",
    model_dir: str | Path | None = None,
) -> tuple[list[str], dict[str, Any]]:
    """
    Serialize an EZKL proof object to deterministic felt calldata.

    Expected fields on `proof`:
      - proof_hash (0x...)
      - model_hash (hex string)
      - verify_key_hash (0x...)
      - public_inputs (list[float])
      - inference_output (list[float])
      - proof_hex (0x...) or proof_bytes (bytes)
      - raw_proof_json (dict)
    """
    marker = EZKL_KZG_V1_MARKER
    model_hash_felt = _felt_from_hex_or_text(str(getattr(proof, "model_hash", "")))
    vk_hash_felt = _felt_from_hex_or_text(str(getattr(proof, "verify_key_hash", "")))
    proof_hash_felt = _felt_from_hex_or_text(str(getattr(proof, "proof_hash", "")))

    public_inputs = [_float_to_felt(v) for v in list(getattr(proof, "public_inputs", []) or [])]
    outputs = [_float_to_felt(v) for v in list(getattr(proof, "inference_output", []) or [])]

    proof_hex = str(getattr(proof, "proof_hex", "") or "")
    proof_bytes = bytes(getattr(proof, "proof_bytes", b"") or b"")
    if proof_hex:
        try:
            proof_bytes = bytes.fromhex(proof_hex.replace("0x", ""))
        except ValueError:
            pass
    proof_blob_felts = _bytes_to_felts(proof_bytes)

    model_name_effective = str(model_name or getattr(proof, "model_name", "") or "").strip()
    model_dir_path = Path(model_dir) if model_dir is not None else None
    if model_dir_path is None and model_name_effective:
        model_dir_path = Path(__file__).resolve().parents[1] / "data" / "ezkl_models" / model_name_effective

    warm_meta = warm_kzg_bundle_cache_for_proof(
        proof,
        model_name=model_name_effective,
        model_dir=model_dir_path,
    )
    raw_json = dict(getattr(proof, "raw_proof_json", {}) or {})

    raw_hash_bytes = hashlib.sha256(
        json.dumps(raw_json, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).digest()
    raw_hash_felt = int.from_bytes(raw_hash_bytes, "big") % FELT252_PRIME
    kzg_trailer, trailer_meta = _build_kzg_mpcheck_trailer(raw_json)

    calldata_ints: list[int] = [
        marker,
        model_hash_felt,
        vk_hash_felt,
        proof_hash_felt,
        len(public_inputs),
        len(outputs),
        len(proof_blob_felts),
        raw_hash_felt,
    ]
    calldata_ints.extend(public_inputs)
    calldata_ints.extend(outputs)
    calldata_ints.extend(proof_blob_felts)
    calldata_ints.extend(kzg_trailer)

    meta = {
        "format": "ezkl_kzg_v1",
        "fact_hash_felt": hex(proof_hash_felt),
        "public_inputs_count": len(public_inputs),
        "output_count": len(outputs),
        "proof_blob_felts": len(proof_blob_felts),
        "raw_proof_hash": hex(raw_hash_felt),
        "fixed_point_scale": FIXED_POINT_SCALE,
        "verification_semantics": (
            "cryptographic_pairing"
            if trailer_meta.get("kzg_mpcheck_bundle_present")
            else "payload_and_fact_binding_only"
        ),
    }
    meta.update(warm_meta)
    meta.update(trailer_meta)
    return [hex(v) for v in calldata_ints], meta


def build_placeholder_kzg_calldata(
    *,
    proof_hash: str,
    model_hash: str,
    inference_output: list[float],
    timestamp: int,
) -> tuple[list[str], dict[str, Any]]:
    """
    Deterministic placeholder calldata for native KZG path when EZKL artifacts
    are unavailable. This keeps routing/test paths active without claiming proof
    verification semantics.
    """
    marker = NATIVE_KZG_PLACEHOLDER_MARKER
    outputs = [_float_to_felt(v) for v in (inference_output or [])[:16]]
    payload = [
        marker,
        _felt_from_hex_or_text(model_hash),
        _felt_from_hex_or_text(proof_hash),
        int(timestamp) % FELT252_PRIME,
        len(outputs),
    ]
    payload.extend(outputs)
    meta = {
        "format": "native_kzg_placeholder_v1",
        "output_count": len(outputs),
        "fixed_point_scale": FIXED_POINT_SCALE,
    }
    return [hex(v) for v in payload], meta
