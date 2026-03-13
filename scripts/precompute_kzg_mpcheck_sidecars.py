#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"

import sys

sys.path.insert(0, str(BACKEND_ROOT))

from app.services.ezkl_kzg_serializer import _build_bn254_dynamic_mpcheck_artifacts  # type: ignore
from app.services.ezkl_kzg_serializer import _parse_g1_point  # type: ignore
from app.services.ezkl_kzg_serializer import _parse_g2_point  # type: ignore


def _entry_bundle(entry: Any) -> dict[str, Any] | None:
    if isinstance(entry, dict) and isinstance(entry.get("kzg_mpcheck_bundle"), dict):
        return entry["kzg_mpcheck_bundle"]
    if isinstance(entry, dict):
        return entry
    return None


def _has_complete_dynamic_artifacts(bundle: dict[str, Any]) -> bool:
    hint_felts = bundle.get("mpcheck_hint_felts") or bundle.get("hint_felts") or []
    line_felts = (
        bundle.get("precomputed_line_felts")
        or bundle.get("mpcheck_line_felts")
        or bundle.get("line_felts")
        or []
    )
    if not isinstance(hint_felts, (list, tuple)) or not hint_felts:
        return False
    if not isinstance(line_felts, (list, tuple)) or not line_felts:
        return False
    if len(line_felts) % 4 != 0:
        return False
    declared_count = bundle.get("line_count")
    if declared_count not in (None, "", 0, "0"):
        try:
            if int(declared_count) != len(line_felts) // 4:
                return False
        except Exception:
            return False
    if str(bundle.get("hint_error") or "").strip():
        return False
    if str(bundle.get("line_error") or "").strip():
        return False
    return True


def _update_bundle(bundle: dict[str, Any]) -> tuple[bool, str]:
    pair0 = _parse_g1_point(bundle.get("pair0") or bundle.get("p1"))
    pair1 = _parse_g1_point(bundle.get("pair1") or bundle.get("p2"))
    g2_pair0 = _parse_g2_point(bundle.get("g2_pair0"))
    g2_pair1 = _parse_g2_point(bundle.get("g2_pair1"))
    if not pair0 or not pair1 or not g2_pair0 or not g2_pair1:
        return False, "missing_pairs"

    hint, lines, error = _build_bn254_dynamic_mpcheck_artifacts(pair0, pair1, g2_pair0, g2_pair1)
    if not hint or not lines:
        return False, error or "artifact_build_failed"

    bundle["mpcheck_hint_felts"] = [str(v) for v in hint]
    bundle["precomputed_line_felts"] = [str(v) for v in lines]
    bundle["line_count"] = len(lines) // 4
    bundle["dynamic_artifact_source"] = "precompute_kzg_mpcheck_sidecars"
    bundle["hint_error"] = ""
    bundle["line_error"] = ""
    return True, ""


def _process_file(path: Path, *, force: bool = False) -> tuple[int, int, int]:
    obj = json.loads(path.read_text())
    updated = 0
    skipped = 0
    total = 0

    if isinstance(obj, dict):
        for _, raw_entry in obj.items():
            bundle = _entry_bundle(raw_entry)
            if bundle is None:
                continue
            total += 1
            if not force and _has_complete_dynamic_artifacts(bundle):
                skipped += 1
                continue
            ok, _ = _update_bundle(bundle)
            if ok:
                updated += 1

    path.write_text(json.dumps(obj, indent=2) + "\n")
    return updated, skipped, total


def main() -> int:
    parser = argparse.ArgumentParser(description="Precompute native KZG MPCheck hint + lines into model sidecars.")
    parser.add_argument(
        "--models",
        nargs="*",
        default=["yield_forecast", "creditworthiness", "anomaly_detector"],
        help="Model directories under backend/app/data/ezkl_models",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Recompute artifacts even when sidecars already contain complete hint + line data.",
    )
    args = parser.parse_args()

    models_root = BACKEND_ROOT / "app" / "data" / "ezkl_models"
    grand_total = 0
    grand_updated = 0
    grand_skipped = 0
    for model in args.models:
        path = models_root / model / "kzg_mpcheck_bundle.json"
        if not path.exists():
            print(f"{model}: missing {path}")
            continue
        updated, skipped, total = _process_file(path, force=bool(args.force))
        grand_total += total
        grand_updated += updated
        grand_skipped += skipped
        print(f"{model}: updated {updated}/{total} entries (skipped {skipped})")

    print(f"done: updated {grand_updated}/{grand_total} entries (skipped {grand_skipped})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
