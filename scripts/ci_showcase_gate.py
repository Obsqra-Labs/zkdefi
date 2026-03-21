#!/usr/bin/env python3
"""
CI gate for Path B warm coverage + strict showcase bridge/runtime health.

This script is intended to run from repo root.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts" / "hackathon_showcase"
LATEST_REPORT = ARTIFACT_DIR / "latest.json"
PATHA_LATEST = ARTIFACT_DIR / "patha_latest.json"
PATHB_LATEST = ARTIFACT_DIR / "pathb_latest.json"
PATHC_LATEST = ARTIFACT_DIR / "pathc_latest.json"


def _env(name: str, default: str) -> str:
    return str(os.getenv(name, default)).strip()


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, "true" if default else "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _parse_iso_datetime(raw: object) -> datetime | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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


def _validate_pathc_artifact() -> None:
    if not _env_bool("SHOWCASE_REQUIRE_PATHC_LIVE", False):
        return
    if not PATHC_LATEST.exists():
        raise RuntimeError(f"missing Path C latest artifact: {PATHC_LATEST}")
    pathc = json.loads(PATHC_LATEST.read_text())
    if not isinstance(pathc, dict):
        raise RuntimeError("Path C latest artifact is not a JSON object")

    l1_receipt = pathc.get("l1_receipt") or {}
    if not isinstance(l1_receipt, dict):
        l1_receipt = {}
    l2_last = pathc.get("l2_last") or {}
    if not isinstance(l2_last, dict):
        l2_last = {}

    tx_hash = str(pathc.get("tx_hash", "") or "").strip()
    model_hash = str(pathc.get("model_hash", "") or "").strip()
    used_nonce = pathc.get("used_nonce")
    l1_status = int(l1_receipt.get("status", 0) or 0)
    l2_verified = bool(
        pathc.get("l2_verified")
        or pathc.get("l2_verified_on_l2")
        or l2_last.get("verified")
        or l2_last.get("verified_on_l2")
    )
    checked_at = (
        _parse_iso_datetime(pathc.get("last_checked_at"))
        or _parse_iso_datetime(pathc.get("generated_at"))
        or datetime.fromtimestamp(PATHC_LATEST.stat().st_mtime, tz=timezone.utc)
    )
    max_age_hours = float(_env("SHOWCASE_PATHC_MAX_AGE_HOURS", "36"))
    age_hours = max(0.0, (datetime.now(timezone.utc) - checked_at).total_seconds() / 3600.0)

    if not (tx_hash and model_hash and used_nonce is not None and l1_status == 1 and l2_verified):
        raise RuntimeError(
            "Path C artifact gate failed: "
            f"tx_hash_present={bool(tx_hash)} model_hash_present={bool(model_hash)} "
            f"used_nonce_present={used_nonce is not None} l1_status={l1_status} "
            f"l2_verified={l2_verified}"
        )
    if age_hours > max_age_hours:
        raise RuntimeError(
            "Path C freshness gate failed: "
            f"age_hours={age_hours:.2f} max_age_hours={max_age_hours:.2f}"
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
    bridge_only = _env_bool("SHOWCASE_GATE_BRIDGE_ONLY", False)
    expected_required = {
        "l3": "groth16_garaga",
        "l3_native_kzg_request": "native_kzg",
    }
    if not bridge_only:
        expected_required["l3_heavy_request"] = "groth16_garaga"
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

    recursive = report.get("recursive_ezkl_paths") or {}
    if not isinstance(recursive, dict):
        recursive = {}
    recursive_signals = recursive.get("signals") or {}
    if not isinstance(recursive_signals, dict) or not bool(recursive_signals.get("path_b_live_verified")):
        raise RuntimeError("Path B recursive stage gate failed: path_b_live_verified=false")
    path_rows = recursive.get("path_rows") or []
    if not isinstance(path_rows, list):
        path_rows = []
    pathb_row = next(
        (
            row for row in path_rows
            if isinstance(row, dict) and str(row.get("path", "")).strip().lower().startswith("path b")
        ),
        {},
    )
    pathb_status = str(pathb_row.get("status", "") or "").strip().lower()
    if pathb_status != "implemented_live":
        raise RuntimeError(f"Path B recursive stage gate failed: status={pathb_status or '-'}")
    if not PATHB_LATEST.exists():
        raise RuntimeError(f"missing Path B latest artifact: {PATHB_LATEST}")
    pathb = json.loads(PATHB_LATEST.read_text())
    if not isinstance(pathb, dict):
        raise RuntimeError("Path B latest artifact is not a JSON object")
    pathb_live_verified = bool(pathb.get("live_verified"))
    pathb_execution_chain = str(pathb.get("execution_chain", "") or "").strip().lower()
    pathb_attempted = int(pathb.get("attempted_models", 0) or 0)
    pathb_verified = int(pathb.get("verified_models", 0) or 0)
    pathb_l3_receipts = int(pathb.get("l3_receipt_models", 0) or 0)
    pathb_l2_receipts = int(pathb.get("l2_receipt_models", 0) or 0)
    pathb_mirrored = int(pathb.get("mirrored_models", 0) or 0)
    pathb_strict_abi = int(pathb.get("strict_abi_models", 0) or 0)
    pathb_strict_binding = int(pathb.get("strict_binding_models", 0) or 0)
    verifier_runtime = pathb.get("verifier_runtime") or {}
    if not isinstance(verifier_runtime, dict):
        verifier_runtime = {}
    if not (
        pathb_live_verified
        and pathb_attempted > 0
        and pathb_verified == pathb_attempted
        and pathb_l3_receipts == pathb_attempted
        and pathb_strict_abi == pathb_attempted
        and pathb_strict_binding == pathb_attempted
        and bool(verifier_runtime.get("required_methods_ok"))
        and str(verifier_runtime.get("address", "") or "").strip()
    ):
        raise RuntimeError(
            "Path B artifact gate failed: "
            f"live_verified={pathb_live_verified} "
            f"attempted={pathb_attempted} verified={pathb_verified} "
            f"l3_receipts={pathb_l3_receipts} strict_abi={pathb_strict_abi} "
            f"strict_binding={pathb_strict_binding} "
            f"verifier_ready={bool(verifier_runtime.get('required_methods_ok'))} "
            f"address_present={bool(str(verifier_runtime.get('address', '') or '').strip())}"
        )
    if pathb_execution_chain == "dual" and not (
        pathb_l2_receipts == pathb_attempted and pathb_mirrored == pathb_attempted
    ):
        raise RuntimeError(
            "Path B dual artifact gate failed: "
            f"attempted={pathb_attempted} l2_receipts={pathb_l2_receipts} mirrored={pathb_mirrored}"
        )

    _validate_pathc_artifact()

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
    warm_bootstrap_known_models = _env_bool("SHOWCASE_WARM_BOOTSTRAP_KNOWN_MODELS", False)
    warm_bootstrap_force = _env_bool("SHOWCASE_WARM_BOOTSTRAP_FORCE", False)
    skip_heavy_stark = _env_bool("SHOWCASE_GATE_SKIP_HEAVY_STARK", False)
    skip_ai_marketplace = _env_bool("SHOWCASE_GATE_SKIP_AI_MARKETPLACE", False)
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
    if warm_bootstrap_known_models:
        warm_cmd.append("--bootstrap-known-models")
    if warm_bootstrap_force:
        warm_cmd.append("--bootstrap-force")
    _run(warm_cmd)
    _validate_warm_report(Path(warm_output))

    showcase_cmd = [
        "python3",
        "scripts/hackathon_backend_showcase.py",
        "--base-url",
        base_url,
        "--strict-bridge",
        "--emit-report",
        "--emit-report-force",
        "--timeout-seconds",
        timeout_seconds,
    ]
    if skip_heavy_stark:
        showcase_cmd.append("--skip-heavy-stark")
    if skip_ai_marketplace:
        showcase_cmd.append("--skip-ai-marketplace")
    if bridge_only:
        showcase_cmd.append("--bridge-only")

    showcase_rc = _run(showcase_cmd, check=False)
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
