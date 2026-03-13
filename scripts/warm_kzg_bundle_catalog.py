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
import json
import sys
import time
from datetime import datetime, timezone
from math import prod
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.proof_pipeline import ProofPipeline  # noqa: E402
from app.services.ezkl_kzg_serializer import warm_kzg_bundle_cache_for_proof  # noqa: E402


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
            attempted_feature_widths: list[int] = []
            for probe in _probe_inputs(model_dir):
                attempted_feature_widths.append(len(probe[0]))
                proof, verified = await pipeline._try_generate_real_ezkl_proof(
                    model_name=model_name,
                    input_data=probe,
                )
                if proof is not None and verified:
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

    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print(f"\nreport: {out_path}")
    print(
        f"summary: verified={report['models_verified']}/{report['models_total']} "
        f"bundle={report['models_with_bundle']}/{report['models_total']}"
    )
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
