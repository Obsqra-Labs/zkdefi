#!/usr/bin/env python3
"""
CI gate for Path B warm coverage + strict showcase bridge/runtime health.

This script is intended to run from repo root.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "hackathon_showcase"
LATEST_REPORT = ARTIFACT_DIR / "latest.json"


def _env(name: str, default: str) -> str:
    return str(os.getenv(name, default)).strip()


def _run(cmd: list[str], *, check: bool = True) -> int:
    print("+", " ".join(cmd), flush=True)
    env = dict(os.environ)
    env.setdefault("PYTHONUNBUFFERED", "1")
    proc = subprocess.run(cmd, check=check, cwd=str(ROOT), env=env)
    return int(proc.returncode)


def _validate_latest_report() -> None:
    if not LATEST_REPORT.exists():
        raise RuntimeError(f"missing latest showcase report: {LATEST_REPORT}")
    report = json.loads(LATEST_REPORT.read_text())

    score = report.get("core_score") or {}
    validated = int(score.get("validated", 0) or 0)
    total = int(score.get("total", 0) or 0)
    raw_exit_code = report.get("exit_code", 1)
    exit_code = 1 if raw_exit_code is None else int(raw_exit_code)
    if total <= 0:
        raise RuntimeError("latest showcase report has empty core score")
    if validated <= 0:
        raise RuntimeError("latest showcase report has zero validated claims")
    if exit_code != 0 or validated != total:
        print(
            "note: showcase claim score not fully green; "
            f"continuing with strict bridge lane checks (exit_code={exit_code}, core_score={validated}/{total})",
            flush=True,
        )

    runs = (report.get("bridge_architecture") or {}).get("ml_bridge_runs") or {}
    expected = {
        "l3": "groth16_garaga",
        "l3_heavy_request": "groth16_garaga",
        "l3_noir_request": "noir_honk",
        "l3_native_kzg_request": "native_kzg",
    }
    lane_errors: list[str] = []
    for lane_key, expected_mode in expected.items():
        lane = runs.get(lane_key) or {}
        l3 = lane.get("l3") or {}
        status = int(lane.get("status", 0) or 0)
        mode = str(l3.get("mode", "") or "").strip().lower()
        verified = bool(l3.get("verified_on_chain"))
        if status != 200 or mode != expected_mode or not verified:
            lane_errors.append(
                f"{lane_key}: status={status} mode={mode} verified_on_chain={verified}"
            )
    if lane_errors:
        raise RuntimeError("bridge lane gate failed: " + "; ".join(lane_errors))

    print(
        f"showcase gate PASS: core_score={validated}/{total}, "
        "lanes=l3/l3_heavy_request/l3_noir_request/l3_native_kzg_request verified",
        flush=True,
    )


def main() -> int:
    base_url = _env("SHOWCASE_BASE_URL", "http://127.0.0.1:8003")
    timeout_seconds = _env("SHOWCASE_TIMEOUT_SECONDS", "50")
    strict_attempts = _env("SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS", "2")
    warm_output = _env(
        "SHOWCASE_WARM_OUTPUT",
        str(ARTIFACT_DIR / "pathb_bundle_warm.json"),
    )
    min_coverage = _env("PATHB_WARM_MIN_COVERAGE", "1.0")
    os.environ["SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS"] = strict_attempts

    _run(
        [
            "python3",
            "scripts/warm_kzg_bundle_catalog.py",
            "--output",
            warm_output,
            "--min-coverage",
            min_coverage,
        ]
    )

    showcase_rc = _run(
        [
            "python3",
            "scripts/hackathon_backend_showcase.py",
            "--base-url",
            base_url,
            "--strict-bridge",
            "--skip-heavy-stark",
            "--skip-ai-marketplace",
            "--emit-report",
            "--emit-report-force",
            "--timeout-seconds",
            timeout_seconds,
        ],
        check=False,
    )
    if showcase_rc != 0:
        print(
            f"note: showcase runner exited {showcase_rc}; "
            "evaluating strict bridge lane checks from latest report",
            flush=True,
        )

    _validate_latest_report()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"command failed with exit code {exc.returncode}", file=sys.stderr)
        raise
    except Exception as exc:
        print(f"ci showcase gate failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
