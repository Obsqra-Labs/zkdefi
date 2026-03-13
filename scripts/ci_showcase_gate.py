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
PATHA_LATEST = ARTIFACT_DIR / "patha_latest.json"


def _env(name: str, default: str) -> str:
    return str(os.getenv(name, default)).strip()


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, "true" if default else "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _run(cmd: list[str], *, check: bool = True) -> int:
    print("+", " ".join(cmd), flush=True)
    env = dict(os.environ)
    env.setdefault("PYTHONUNBUFFERED", "1")
    proc = subprocess.run(cmd, check=check, cwd=str(ROOT), env=env)
    return int(proc.returncode)


def _validate_warm_report(path: Path) -> None:
    if not path.exists():
        raise RuntimeError(f"missing Path B warm report: {path}")
    report = json.loads(path.read_text())
    native = report.get("native_kzg_onchain") or {}
    if not isinstance(native, dict) or not native.get("enabled"):
        return

    attempted = int(native.get("attempted_models", 0) or 0)
    verified = int(native.get("verified_models", 0) or 0)
    l3_receipts = int(native.get("l3_receipt_models", 0) or 0)
    strict_abi = int(native.get("strict_abi_models", 0) or 0)
    strict_binding = int(native.get("strict_binding_models", 0) or 0)
    execution_chain = str(native.get("execution_chain") or "").strip().lower()

    if attempted <= 0:
        raise RuntimeError("Path B native_kzg_onchain enabled but attempted_models=0")
    if not (verified == attempted == l3_receipts == strict_abi == strict_binding):
        raise RuntimeError(
            "Path B native KZG gate failed: "
            f"attempted={attempted} verified={verified} "
            f"l3_receipts={l3_receipts} strict_abi={strict_abi} strict_binding={strict_binding}"
        )

    if execution_chain == "dual":
        l2_receipts = int(native.get("l2_receipt_models", 0) or 0)
        mirrored = int(native.get("mirrored_models", 0) or 0)
        if not (l2_receipts == attempted == mirrored):
            raise RuntimeError(
                "Path B dual native KZG mirror gate failed: "
                f"attempted={attempted} l2_receipts={l2_receipts} mirrored={mirrored}"
            )


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
    expected_required = {
        "l3": "groth16_garaga",
        "l3_heavy_request": "groth16_garaga",
        "l3_native_kzg_request": "native_kzg",
    }
    noir_required = _env_bool("SHOWCASE_REQUIRE_NOIR_LANE", False)
    if noir_required:
        expected_required["l3_noir_request"] = "noir_honk"
    else:
        lane = runs.get("l3_noir_request") or {}
        l3 = lane.get("l3") or {}
        status = int(lane.get("status", 0) or 0)
        mode = str(l3.get("mode", "") or "").strip().lower()
        verified = bool(l3.get("verified_on_chain"))
        if not (status == 200 and mode == "noir_honk" and verified):
            print(
                "note: noir lane degraded but non-blocking "
                f"(status={status} mode={mode} verified_on_chain={verified}); "
                "set SHOWCASE_REQUIRE_NOIR_LANE=true to enforce",
                flush=True,
            )
    lane_errors: list[str] = []
    for lane_key, expected_mode in expected_required.items():
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

    if noir_required:
        if not PATHA_LATEST.exists():
            raise RuntimeError(f"missing Path A latest artifact: {PATHA_LATEST}")
        patha = json.loads(PATHA_LATEST.read_text())
        if not isinstance(patha, dict):
            raise RuntimeError("Path A latest artifact is not a JSON object")
        patha_status = int(patha.get("status", 0) or 0)
        patha_mode = str(patha.get("l3_mode", "") or "").strip().lower()
        patha_verified = bool(patha.get("l3_verified_on_chain"))
        patha_tx_hash = str(patha.get("l3_tx_hash", "") or "").strip()
        if not (patha_status == 200 and patha_mode == "noir_honk" and patha_verified and patha_tx_hash):
            raise RuntimeError(
                "Path A artifact gate failed: "
                f"status={patha_status} mode={patha_mode} "
                f"verified_on_chain={patha_verified} tx_hash_present={bool(patha_tx_hash)}"
            )

    native_receipt = (report.get("bridge_architecture") or {}).get("native_kzg_live_receipt") or {}
    if not isinstance(native_receipt, dict):
        native_receipt = {}
    native_marker = str(native_receipt.get("kzg_trailer_marker") or "").strip().lower()
    native_line_source = str(native_receipt.get("kzg_line_source") or "").strip().lower()
    native_precomputed_lines = int(native_receipt.get("kzg_precomputed_lines", 0) or 0)
    native_verifier_state = native_receipt.get("l3_verifier_state") or {}
    strict_binding_observed = bool(
        isinstance(native_verifier_state, dict)
        and native_verifier_state.get("strict_binding_observed")
    )
    if not (
        native_marker == "kzg_mpcheck_v3"
        and native_precomputed_lines > 0
        and native_line_source in {"provided", "garaga_precompute_lines_2f"}
        and strict_binding_observed
    ):
        raise RuntimeError(
            "native KZG strict v3 gate failed: "
            f"marker={native_marker or '-'} "
            f"line_source={native_line_source or '-'} "
            f"precomputed_lines={native_precomputed_lines} "
            f"strict_binding_observed={strict_binding_observed}"
        )

    lanes_text = "/".join(expected_required.keys())
    print(
        f"showcase gate PASS: core_score={validated}/{total}, "
        f"lanes={lanes_text} verified",
        flush=True,
    )


def main() -> int:
    base_url = _env("SHOWCASE_BASE_URL", "http://127.0.0.1:8003")
    timeout_seconds = _env("SHOWCASE_TIMEOUT_SECONDS", "50")
    strict_attempts = _env("SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS", "2")
    bridge_only = _env_bool("SHOWCASE_GATE_BRIDGE_ONLY", False)
    warm_output = _env(
        "SHOWCASE_WARM_OUTPUT",
        str(ARTIFACT_DIR / "pathb_bundle_warm.json"),
    )
    min_coverage = _env("PATHB_WARM_MIN_COVERAGE", "1.0")
    warm_verify_onchain_native_kzg = _env_bool("SHOWCASE_WARM_VERIFY_ONCHAIN_NATIVE_KZG", True)
    warm_execution_chain = _env("SHOWCASE_WARM_EXECUTION_CHAIN", "dual")
    warm_request_timeout = _env("SHOWCASE_WARM_REQUEST_TIMEOUT_SECONDS", "180")
    os.environ["SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS"] = strict_attempts

    warm_cmd = [
        "python3",
        "scripts/warm_kzg_bundle_catalog.py",
        "--output",
        warm_output,
        "--min-coverage",
        min_coverage,
    ]
    if warm_verify_onchain_native_kzg:
        warm_cmd.extend(
            [
                "--verify-onchain-native-kzg",
                "--native-kzg-execution-chain",
                warm_execution_chain,
                "--base-url",
                base_url,
                "--request-timeout",
                warm_request_timeout,
            ]
        )
    _run(warm_cmd)
    _validate_warm_report(Path(warm_output))

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
        ]
        + (["--bridge-only"] if bridge_only else []),
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
