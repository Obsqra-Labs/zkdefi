#!/usr/bin/env python3
"""
Warm EZKL -> kzg_mpcheck bundle coverage across local model catalog.

For each model under backend/app/data/ezkl_models:
  1) attempts real EZKL proof generation + local verification
  2) warms/caches KZG bundle metadata via ProofPipeline real-proof path
  3) emits a JSON report with per-model status
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from math import prod
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.proof_pipeline import ProofPipeline  # noqa: E402
from app.services.ezkl_kzg_serializer import warm_kzg_bundle_cache_for_proof  # noqa: E402

DEFAULT_HISTORY_FILE = PROJECT_ROOT / "artifacts" / "hackathon_showcase" / "pathb_bundle_history.jsonl"
DEFAULT_NATIVE_KZG_BASE_URL = "http://127.0.0.1:8003"
DEFAULT_NATIVE_KZG_WALLET = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"


def _load_feature_count(model_dir: Path) -> int:
    settings_path = model_dir / "settings.json"
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
            shapes = settings.get("model_instance_shapes")
            if isinstance(shapes, list) and shapes:
                first_shape = shapes[0]
                if isinstance(first_shape, list) and first_shape:
                    dims = [int(x) for x in first_shape if int(x) > 0]
                    if dims:
                        if len(dims) > 1 and dims[0] == 1:
                            n = prod(dims[1:])
                        else:
                            n = prod(dims)
                        if n > 0:
                            return int(n)
        except Exception:
            pass

    meta_path = model_dir / "training_metadata.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            n = int(meta.get("n_features"))
            if n > 0:
                return n
        except Exception:
            pass
    return 8


def _probe_input(model_dir: Path) -> list[list[float]]:
    n = max(1, _load_feature_count(model_dir))
    return [[0.1 for _ in range(n)]]


def _probe_inputs(model_dir: Path) -> list[list[list[float]]]:
    widths: list[int] = [_load_feature_count(model_dir), 8, 16, 18, 32]
    seen: set[int] = set()
    rows: list[list[list[float]]] = []
    for n in widths:
        n = max(1, int(n))
        if n in seen:
            continue
        seen.add(n)
        rows.append([[0.1 for _ in range(n)]])
    return rows


def _probe_for_width(width: int) -> list[list[float]]:
    n = max(1, int(width))
    return [[0.1 for _ in range(n)]]


def _seeded_probe_value(
    seed: str,
    index: int,
    *,
    floor: float = 0.0,
    span: float = 1.0,
    precision: int = 6,
) -> float:
    digest = hashlib.sha256(f"{seed}:{index}".encode("utf-8")).digest()
    numerator = int.from_bytes(digest[:8], "big")
    denominator = float((1 << 64) - 1)
    value = float(floor) + (float(span) * (numerator / denominator if denominator else 0.0))
    return round(value, precision)


def _seeded_probe_matrix(
    seed: str,
    width: int,
    *,
    floor: float = 0.75,
    span: float = 4.25,
    precision: int = 6,
) -> list[list[float]]:
    count = max(1, int(width))
    return [[_seeded_probe_value(seed, idx, floor=floor, span=span, precision=precision) for idx in range(count)]]


def _payload_fingerprint(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _failure_action_hint(row: dict[str, Any]) -> str:
    err = str(row.get("error") or "").lower()
    extractor_err = str(row.get("kzg_extractor_error") or "").lower()
    if "dimensionality error" in err or "cannot reshape tensor" in err:
        return "check model_instance_shapes/training metadata and regenerate model artifacts for the expected input width"
    if "kzg.srs" in err or "vk.key" in err or "settings.json" in err:
        return "generate missing EZKL artifacts (vk.key, settings.json, kzg.srs) for this model"
    if "real_ezkl_unavailable_or_unverified" in err:
        return "run a model-specific real prove+verify once, then rerun warm-up to seed kzg_mpcheck_bundle"
    if extractor_err:
        return "fix KZG extractor wiring (bundle extractor cmd/artifacts) and rerun warm-up"
    return "inspect backend proof logs for this model and rerun warm-up"


def _parse_iso_utc(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _read_history_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                out.append(parsed)
    except Exception:
        return []
    return out


def _entry_coverage_ratio(entry: dict[str, Any]) -> float:
    ratio = entry.get("coverage_ratio")
    if ratio is not None:
        try:
            return float(ratio)
        except Exception:
            pass
    total = int(entry.get("models_total", 0) or 0)
    bundled = int(entry.get("models_with_bundle", 0) or 0)
    return (bundled / total) if total > 0 else 0.0


def _entry_model_set(entry: dict[str, Any], key: str) -> set[str]:
    rows = entry.get(key)
    if isinstance(rows, list):
        return {str(v).strip() for v in rows if str(v).strip()}
    return set()


def _append_history_snapshot(history_path: Path, snapshot: dict[str, Any]) -> None:
    history_path.parent.mkdir(parents=True, exist_ok=True)
    row_line = json.dumps(snapshot, sort_keys=True)
    last_line = ""
    if history_path.exists():
        try:
            with history_path.open("rb") as f:
                try:
                    f.seek(-2, 2)
                    while f.tell() > 0 and f.read(1) != b"\n":
                        f.seek(-2, 1)
                except OSError:
                    f.seek(0)
                last_line = f.readline().decode("utf-8", errors="replace").strip()
        except Exception:
            last_line = ""
    if row_line != last_line:
        with history_path.open("a", encoding="utf-8") as f:
            f.write(row_line + "\n")


async def _probe_native_kzg_onchain(
    *,
    base_url: str,
    wallet: str,
    model_name: str,
    input_data: list[list[float]],
    timeout_seconds: float,
) -> dict[str, Any]:
    try:
        import httpx
    except Exception as exc:  # pragma: no cover
        return {
            "attempted": True,
            "status": 0,
            "verified_on_chain": False,
            "can_execute": False,
            "error": f"httpx unavailable: {exc}",
        }

    width = 4
    if input_data and isinstance(input_data, list) and isinstance(input_data[0], list):
        width = max(1, len(input_data[0]))
    probe_seed = hashlib.sha256(f"{model_name}:{time.time_ns()}".encode("utf-8")).hexdigest()[:16]
    payload = {
        "user_address": wallet,
        "model_name": model_name,
        "input_data": _seeded_probe_matrix(f"{probe_seed}:{model_name}", width),
        "expected_model_hash": 0,
        "output_lower_bound": 0,
        "output_upper_bound": 10000,
        "execution_chain": "l3",
        "proof_mode": 1,
        "tier": 1,
        "action_type": "rebalance",
        "value_eth": _seeded_probe_value(f"{probe_seed}:{model_name}:value", 0, floor=2.1, span=0.375),
        "bridge_circuit": "EzklNativeKzg",
    }
    payload_fingerprint = _payload_fingerprint(payload)
    url = f"{base_url.rstrip('/')}/api/v1/zkdefi/proofs/ml-bridge"

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        try:
            resp = await client.post(url, json=payload)
            body = resp.json() if resp.content else {}
        except Exception as exc:
            return {
                "attempted": True,
                "status": 0,
                "verified_on_chain": False,
                "can_execute": False,
                "error": str(exc),
            }

    verification = body.get("verification") if isinstance(body, dict) else {}
    l3 = verification.get("l3") if isinstance(verification, dict) else {}
    bridge_proof = body.get("bridge_proof") if isinstance(body, dict) else {}
    return {
        "attempted": True,
        "probe_seed": probe_seed,
        "payload_fingerprint": payload_fingerprint,
        "status": int(resp.status_code),
        "verified_on_chain": bool(l3.get("verified_on_chain")),
        "can_execute": bool(body.get("can_execute")),
        "tx_hash": l3.get("tx_hash"),
        "mode": l3.get("mode"),
        "bridge_backend": bridge_proof.get("bridge_backend") if isinstance(bridge_proof, dict) else None,
        "bridge_compliant": bridge_proof.get("is_compliant") if isinstance(bridge_proof, dict) else None,
        "trust_mode": body.get("trust_mode") if isinstance(body, dict) else None,
        "failure_reason": verification.get("failure_reason") if isinstance(verification, dict) else None,
        "error": (body.get("detail") or body.get("error")) if isinstance(body, dict) else None,
    }


def _model_dirs(root: Path, patterns: list[str]) -> list[Path]:
    rows = [p for p in sorted(root.iterdir()) if p.is_dir()]
    if not patterns:
        return rows
    needles = [p.strip().lower() for p in patterns if p.strip()]
    if not needles:
        return rows
    out: list[Path] = []
    for row in rows:
        name = row.name.lower()
        if any(n in name for n in needles):
            out.append(row)
    return out


def _is_ezkl_proving_model(model_dir: Path) -> bool:
    required = ("vk.key", "settings.json", "kzg.srs")
    return all((model_dir / name).exists() for name in required)


async def _run(args: argparse.Namespace) -> int:
    models_root = BACKEND_ROOT / "app" / "data" / "ezkl_models"
    if not models_root.exists():
        print(f"models root missing: {models_root}")
        return 2

    selected = _model_dirs(models_root, args.model)
    if not args.include_non_ezkl:
        selected = [p for p in selected if _is_ezkl_proving_model(p)]
    if args.limit and args.limit > 0:
        selected = selected[: args.limit]
    if not selected:
        print("no matching model directories")
        return 2

    pipeline = ProofPipeline()
    started = time.monotonic()
    rows: list[dict[str, Any]] = []

    for model_dir in selected:
        model_name = model_dir.name
        t0 = time.monotonic()
        row: dict[str, Any] = {
            "model": model_name,
            "input_features": _load_feature_count(model_dir),
        }
        try:
            proof = None
            verified = False
            selected_probe: list[list[float]] | None = None
            attempted_feature_widths: list[int] = []
            for probe in _probe_inputs(model_dir):
                attempted_feature_widths.append(len(probe[0]))
                proof, verified = await pipeline._try_generate_real_ezkl_proof(
                    model_name=model_name,
                    input_data=probe,
                )
                if proof is not None and verified:
                    selected_probe = probe
                    row["selected_input_features"] = len(probe[0])
                    break
            row["attempted_feature_widths"] = attempted_feature_widths
            row["ezkl_verified"] = bool(verified)
            if proof is not None and verified:
                warm_meta = getattr(proof, "kzg_bundle_meta", None)
                if not isinstance(warm_meta, dict):
                    warm_meta = warm_kzg_bundle_cache_for_proof(
                        proof,
                        model_name=model_name,
                        model_dir=model_dir,
                    )
                row["kzg_bundle_present"] = bool(warm_meta.get("kzg_mpcheck_bundle_present"))
                row["kzg_bundle_source"] = warm_meta.get("kzg_bundle_injected_source") or warm_meta.get(
                    "kzg_mpcheck_bundle_source"
                )
                row["kzg_hint_felts"] = warm_meta.get("kzg_mpcheck_hint_felts")
                row["kzg_cached_path"] = warm_meta.get("kzg_bundle_cached_path")
                row["kzg_extractor_attempted"] = warm_meta.get("kzg_bundle_extractor_attempted")
                row["kzg_extractor_error"] = warm_meta.get("kzg_bundle_extractor_error")
                row["proof_hash"] = getattr(proof, "proof_hash", None)
            else:
                row["kzg_bundle_present"] = False
                row["error"] = "real_ezkl_unavailable_or_unverified"
            if (
                args.verify_onchain_native_kzg
                and row.get("ezkl_verified")
                and row.get("kzg_bundle_present")
            ):
                native_probe = await _probe_native_kzg_onchain(
                    base_url=args.base_url,
                    wallet=args.wallet,
                    model_name=model_name,
                    input_data=selected_probe or _probe_for_width(row.get("selected_input_features") or row["input_features"]),
                    timeout_seconds=args.request_timeout,
                )
                row["native_kzg_attempted"] = bool(native_probe.get("attempted"))
                row["native_kzg_status"] = native_probe.get("status")
                row["native_kzg_verified_on_chain"] = bool(native_probe.get("verified_on_chain"))
                row["native_kzg_can_execute"] = bool(native_probe.get("can_execute"))
                row["native_kzg_tx_hash"] = native_probe.get("tx_hash")
                row["native_kzg_mode"] = native_probe.get("mode")
                row["native_kzg_bridge_backend"] = native_probe.get("bridge_backend")
                row["native_kzg_bridge_compliant"] = native_probe.get("bridge_compliant")
                row["native_kzg_trust_mode"] = native_probe.get("trust_mode")
                row["native_kzg_failure_reason"] = native_probe.get("failure_reason") or native_probe.get("error")
        except Exception as exc:
            row["ezkl_verified"] = False
            row["kzg_bundle_present"] = False
            row["error"] = str(exc)
        row["duration_ms"] = int((time.monotonic() - t0) * 1000)
        rows.append(row)
        print(
            f"{model_name:20} verified={row.get('ezkl_verified')} "
            f"bundle={row.get('kzg_bundle_present')} "
            f"source={row.get('kzg_bundle_source') or '-'}"
        )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": int((time.monotonic() - started) * 1000),
        "models_total": len(rows),
        "models_verified": sum(1 for r in rows if r.get("ezkl_verified")),
        "models_with_bundle": sum(1 for r in rows if r.get("kzg_bundle_present")),
        "rows": rows,
    }
    models_total = int(report["models_total"])
    models_verified = int(report["models_verified"])
    models_with_bundle = int(report["models_with_bundle"])
    coverage_ratio = (models_with_bundle / models_total) if models_total > 0 else 0.0
    native_kzg_attempted_models = sorted(str(r.get("model") or "") for r in rows if r.get("native_kzg_attempted"))
    native_kzg_verified_models = sorted(str(r.get("model") or "") for r in rows if r.get("native_kzg_verified_on_chain"))
    native_kzg_receipt_models = sorted(str(r.get("model") or "") for r in rows if r.get("native_kzg_tx_hash"))

    verified_models = sorted(str(r.get("model") or "") for r in rows if r.get("ezkl_verified"))
    bundle_models = sorted(str(r.get("model") or "") for r in rows if r.get("kzg_bundle_present"))
    selected_models = sorted(str(p.name) for p in selected)

    history_path = Path(args.history_file).resolve()
    history_entries = _read_history_rows(history_path)
    previous_entry = history_entries[-1] if history_entries else None
    generated_at_dt = _parse_iso_utc(report.get("generated_at")) or datetime.now(timezone.utc)
    cutoff_dt = generated_at_dt - timedelta(hours=max(1, int(args.daily_delta_hours)))
    daily_baseline_entry = None
    for item in reversed(history_entries):
        item_dt = _parse_iso_utc(item.get("generated_at"))
        if item_dt and item_dt <= cutoff_dt:
            daily_baseline_entry = item
            break
    if daily_baseline_entry is None:
        current_date = generated_at_dt.date()
        for item in reversed(history_entries):
            item_dt = _parse_iso_utc(item.get("generated_at"))
            if item_dt and item_dt.date() < current_date:
                daily_baseline_entry = item
                break

    previous_cov = _entry_coverage_ratio(previous_entry) if isinstance(previous_entry, dict) else None
    daily_cov = _entry_coverage_ratio(daily_baseline_entry) if isinstance(daily_baseline_entry, dict) else None

    current_bundle_set = set(bundle_models)
    prev_bundle_set = _entry_model_set(previous_entry, "bundle_models") if isinstance(previous_entry, dict) else set()
    daily_bundle_set = _entry_model_set(daily_baseline_entry, "bundle_models") if isinstance(daily_baseline_entry, dict) else set()
    current_verified_set = set(verified_models)
    prev_verified_set = _entry_model_set(previous_entry, "verified_models") if isinstance(previous_entry, dict) else set()
    daily_verified_set = _entry_model_set(daily_baseline_entry, "verified_models") if isinstance(daily_baseline_entry, dict) else set()
    current_native_kzg_verified_set = set(native_kzg_verified_models)
    prev_native_kzg_verified_set = _entry_model_set(previous_entry, "native_kzg_verified_models") if isinstance(previous_entry, dict) else set()
    daily_native_kzg_verified_set = _entry_model_set(daily_baseline_entry, "native_kzg_verified_models") if isinstance(daily_baseline_entry, dict) else set()

    if daily_baseline_entry is None:
        daily_new_bundles = []
        daily_regressed_bundles = []
        daily_new_verified = []
        daily_regressed_verified = []
    else:
        daily_new_bundles = sorted(current_bundle_set - daily_bundle_set)
        daily_regressed_bundles = sorted(daily_bundle_set - current_bundle_set)
        daily_new_verified = sorted(current_verified_set - daily_verified_set)
        daily_regressed_verified = sorted(daily_verified_set - current_verified_set)

    cadence = {
        "history_file": str(history_path),
        "history_file_rel": str(history_path.relative_to(PROJECT_ROOT)) if history_path.is_relative_to(PROJECT_ROOT) else str(history_path),
        "history_entries_before_append": len(history_entries),
        "daily_delta_window_hours": max(1, int(args.daily_delta_hours)),
        "coverage_ratio": round(coverage_ratio, 8),
        "previous_run_generated_at": (previous_entry or {}).get("generated_at") if isinstance(previous_entry, dict) else None,
        "previous_run_coverage_ratio": (round(previous_cov, 8) if previous_cov is not None else None),
        "previous_run_delta_pct_points": (
            round((coverage_ratio - previous_cov) * 100.0, 2) if previous_cov is not None else None
        ),
        "daily_baseline_generated_at": (daily_baseline_entry or {}).get("generated_at") if isinstance(daily_baseline_entry, dict) else None,
        "daily_baseline_coverage_ratio": (round(daily_cov, 8) if daily_cov is not None else None),
        "daily_delta_pct_points": (
            round((coverage_ratio - daily_cov) * 100.0, 2) if daily_cov is not None else None
        ),
        "newly_bundled_models_since_previous_run": sorted(current_bundle_set - prev_bundle_set),
        "regressed_bundled_models_since_previous_run": sorted(prev_bundle_set - current_bundle_set),
        "newly_verified_models_since_previous_run": sorted(current_verified_set - prev_verified_set),
        "regressed_verified_models_since_previous_run": sorted(prev_verified_set - current_verified_set),
        "newly_bundled_models_since_daily_baseline": daily_new_bundles,
        "regressed_bundled_models_since_daily_baseline": daily_regressed_bundles,
        "newly_verified_models_since_daily_baseline": daily_new_verified,
        "regressed_verified_models_since_daily_baseline": daily_regressed_verified,
        "newly_native_kzg_verified_models_since_previous_run": sorted(current_native_kzg_verified_set - prev_native_kzg_verified_set),
        "regressed_native_kzg_verified_models_since_previous_run": sorted(prev_native_kzg_verified_set - current_native_kzg_verified_set),
        "newly_native_kzg_verified_models_since_daily_baseline": (
            [] if daily_baseline_entry is None else sorted(current_native_kzg_verified_set - daily_native_kzg_verified_set)
        ),
        "regressed_native_kzg_verified_models_since_daily_baseline": (
            [] if daily_baseline_entry is None else sorted(daily_native_kzg_verified_set - current_native_kzg_verified_set)
        ),
    }
    report["cadence"] = cadence
    report["native_kzg_onchain"] = {
        "enabled": bool(args.verify_onchain_native_kzg),
        "base_url": args.base_url if args.verify_onchain_native_kzg else None,
        "attempted_models": len(native_kzg_attempted_models),
        "verified_models": len(native_kzg_verified_models),
        "receipt_models": len(native_kzg_receipt_models),
        "attempted_model_names": native_kzg_attempted_models,
        "verified_model_names": native_kzg_verified_models,
        "receipt_model_names": native_kzg_receipt_models,
        "rows": [
            {
                "model": str(r.get("model") or ""),
                "status": r.get("native_kzg_status"),
                "verified_on_chain": bool(r.get("native_kzg_verified_on_chain")),
                "can_execute": bool(r.get("native_kzg_can_execute")),
                "tx_hash": r.get("native_kzg_tx_hash"),
                "mode": r.get("native_kzg_mode"),
                "bridge_backend": r.get("native_kzg_bridge_backend"),
                "bridge_compliant": r.get("native_kzg_bridge_compliant"),
                "trust_mode": r.get("native_kzg_trust_mode"),
                "failure_reason": r.get("native_kzg_failure_reason"),
            }
            for r in rows
            if r.get("native_kzg_attempted")
        ],
    }

    failed_rows = [r for r in rows if not r.get("kzg_bundle_present")]
    error_buckets: dict[str, int] = {}
    action_buckets: dict[str, int] = {}
    for r in failed_rows:
        key = str(r.get("error") or "unknown_error")
        error_buckets[key] = error_buckets.get(key, 0) + 1
        action = _failure_action_hint(r)
        action_buckets[action] = action_buckets.get(action, 0) + 1
    report["models_failed"] = len(failed_rows)
    report["failed_models"] = [
        {
            "model": str(r.get("model") or ""),
            "error": str(r.get("error") or "unknown_error"),
            "attempted_feature_widths": r.get("attempted_feature_widths") or [],
            "selected_input_features": r.get("selected_input_features"),
            "recommended_action": _failure_action_hint(r),
        }
        for r in failed_rows
    ]
    report["error_buckets"] = error_buckets
    report["action_buckets"] = action_buckets

    snapshot = {
        "generated_at": report.get("generated_at"),
        "models_total": models_total,
        "models_verified": models_verified,
        "models_with_bundle": models_with_bundle,
        "coverage_ratio": round(coverage_ratio, 8),
        "include_non_ezkl": bool(args.include_non_ezkl),
        "model_filters": [str(m) for m in (args.model or []) if str(m).strip()],
        "selected_models": selected_models,
        "verified_models": verified_models,
        "bundle_models": bundle_models,
        "native_kzg_attempted_models": native_kzg_attempted_models,
        "native_kzg_verified_models": native_kzg_verified_models,
        "native_kzg_receipt_models": native_kzg_receipt_models,
        "failed_models": sorted(str(r.get("model") or "") for r in failed_rows),
        "output_file": str(Path(args.output).resolve()),
    }
    _append_history_snapshot(history_path, snapshot)

    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nreport: {out_path}")
    print(
        f"summary: verified={report['models_verified']}/{report['models_total']} "
        f"bundle={report['models_with_bundle']}/{report['models_total']} "
        f"native_kzg={len(native_kzg_verified_models)}/{len(native_kzg_attempted_models) if native_kzg_attempted_models else 0} "
        f"failed={report['models_failed']}"
    )
    print(
        "cadence:",
        f"history={cadence.get('history_file_rel')}",
        f"entries_before={cadence.get('history_entries_before_append')}",
        f"daily_window_h={cadence.get('daily_delta_window_hours')}",
        f"daily_delta_pp={cadence.get('daily_delta_pct_points') if cadence.get('daily_delta_pct_points') is not None else 'n/a'}",
        f"new_bundles_24h={len(cadence.get('newly_bundled_models_since_daily_baseline') or [])}",
        f"regressions_24h={len(cadence.get('regressed_bundled_models_since_daily_baseline') or [])}",
        f"new_native_kzg_24h={len(cadence.get('newly_native_kzg_verified_models_since_daily_baseline') or [])}",
    )
    if failed_rows:
        print("failed models:")
        for r in failed_rows[:10]:
            print(
                f"  - {r.get('model')}: {r.get('error')} | "
                f"action={_failure_action_hint(r)}"
            )
        if len(failed_rows) > 10:
            print(f"  - ... {len(failed_rows) - 10} more")
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Warm KZG bundle coverage for local EZKL model catalog.",
    )
    parser.add_argument(
        "--model",
        action="append",
        default=[],
        help="Model name substring filter (repeatable).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional cap on number of models.",
    )
    parser.add_argument(
        "--output",
        default=str(PROJECT_ROOT / "artifacts" / "hackathon_showcase" / "pathb_bundle_warm.json"),
        help="Output JSON report path.",
    )
    parser.add_argument(
        "--history-file",
        default=str(DEFAULT_HISTORY_FILE),
        help="JSONL history path for per-run Path B coverage snapshots.",
    )
    parser.add_argument(
        "--daily-delta-hours",
        type=int,
        default=24,
        help="Window size in hours for daily coverage delta calculations (default: 24).",
    )
    parser.add_argument(
        "--include-non-ezkl",
        action="store_true",
        help="Include model folders without vk/settings/srs (off by default).",
    )
    parser.add_argument(
        "--min-coverage",
        type=float,
        default=None,
        help=(
            "Optional minimum bundle coverage ratio [0,1]. "
            "When set, script exits non-zero if models_with_bundle/models_total is below threshold."
        ),
    )
    parser.add_argument(
        "--verify-onchain-native-kzg",
        action="store_true",
        help="After warming a model bundle, call backend proofs/ml-bridge with bridge_circuit=EzklNativeKzg and record live L3 receipt status.",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_NATIVE_KZG_BASE_URL,
        help="Backend base URL used with --verify-onchain-native-kzg.",
    )
    parser.add_argument(
        "--wallet",
        default=DEFAULT_NATIVE_KZG_WALLET,
        help="Wallet address used with --verify-onchain-native-kzg.",
    )
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=120.0,
        help="HTTP timeout in seconds for --verify-onchain-native-kzg.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    rc = asyncio.run(_run(args))
    if rc != 0:
        return rc

    if args.min_coverage is None:
        return 0

    try:
        target = float(args.min_coverage)
    except Exception:
        print(f"invalid --min-coverage: {args.min_coverage}")
        return 2
    if target < 0.0 or target > 1.0:
        print(f"--min-coverage must be within [0,1], got {target}")
        return 2

    out_path = Path(args.output).resolve()
    try:
        report = json.loads(out_path.read_text())
    except Exception as exc:
        print(f"failed to read report for coverage gate: {out_path} ({exc})")
        return 2

    total = int(report.get("models_total", 0) or 0)
    bundled = int(report.get("models_with_bundle", 0) or 0)
    coverage = (bundled / total) if total > 0 else 0.0
    passes = (total > 0) and (coverage >= target)
    print(
        "coverage gate:",
        f"target={target:.2%}",
        f"actual={coverage:.2%}",
        f"models={bundled}/{total}",
        "PASS" if passes else "FAIL",
    )
    return 0 if passes else 1


if __name__ == "__main__":
    raise SystemExit(main())
