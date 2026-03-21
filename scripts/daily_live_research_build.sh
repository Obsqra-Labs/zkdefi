#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="$ROOT_DIR/artifacts/hackathon_showcase"
LOG_DIR="$ARTIFACT_DIR/daily_logs"
mkdir -p "$LOG_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/live-research-$STAMP.log"

BASE_URL="${SHOWCASE_BASE_URL:-http://127.0.0.1:8003}"
TIMEOUT="${SHOWCASE_TIMEOUT_SECONDS:-50}"
MIN_COVERAGE="${PATHB_WARM_MIN_COVERAGE:-1.0}"
MAX_ATTEMPTS="${SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS:-2}"
PRECOMPUTE_SIDECARS="${PATHB_PRECOMPUTE_SIDECARS:-true}"
PRECOMPUTE_MODELS="${PATHB_PRECOMPUTE_MODELS:-yield_forecast creditworthiness anomaly_detector llm_fallback timing_predictor}"
GATE_BRIDGE_ONLY="${SHOWCASE_GATE_BRIDGE_ONLY:-false}"
REQUIRE_NOIR_LANE="${SHOWCASE_REQUIRE_NOIR_LANE:-true}"
REQUIRE_PATHC_LIVE="${SHOWCASE_REQUIRE_PATHC_LIVE:-true}"
PATHC_MAX_AGE_HOURS="${SHOWCASE_PATHC_MAX_AGE_HOURS:-36}"
PATHC_PAYLOAD_JSON="${PATHC_PAYLOAD_JSON:-}"
PATHC_REFRESH_EXISTING="${PATHC_REFRESH_EXISTING:-true}"
PATHC_CAPTURE_ROTATING_MODEL="${PATHC_CAPTURE_ROTATING_MODEL:-false}"
PATHC_ROTATE_MODELS="${PATHC_ROTATE_MODELS:-creditworthiness yield_forecast anomaly_detector llm_fallback timing_predictor}"
PARENT_BASE_URL="${PARENT_BASE_URL:-http://127.0.0.1:8002}"
WARM_BOOTSTRAP_KNOWN_MODELS="${SHOWCASE_WARM_BOOTSTRAP_KNOWN_MODELS:-true}"
WARM_BOOTSTRAP_FORCE="${SHOWCASE_WARM_BOOTSTRAP_FORCE:-false}"
GATE_SKIP_HEAVY_STARK="${SHOWCASE_GATE_SKIP_HEAVY_STARK:-false}"
GATE_SKIP_AI_MARKETPLACE="${SHOWCASE_GATE_SKIP_AI_MARKETPLACE:-false}"
STRICT_EXIT="${DAILY_BUILD_STRICT_EXIT:-false}"
BUILD_RC=0

{
  echo "== Obsqra Labs Live Research Daily Build =="
  echo "timestamp_utc=$STAMP"
  echo "base_url=$BASE_URL"
  echo "timeout_seconds=$TIMEOUT"
  echo "pathb_warm_min_coverage=$MIN_COVERAGE"
  echo "strict_bridge_max_attempts=$MAX_ATTEMPTS"
  echo "pathb_precompute_sidecars=$PRECOMPUTE_SIDECARS"
  echo "pathb_precompute_models=$PRECOMPUTE_MODELS"
  echo "showcase_gate_bridge_only=$GATE_BRIDGE_ONLY"
  echo "showcase_require_noir_lane=$REQUIRE_NOIR_LANE"
  echo "showcase_require_pathc_live=$REQUIRE_PATHC_LIVE"
  echo "showcase_pathc_max_age_hours=$PATHC_MAX_AGE_HOURS"
  echo "pathc_payload_json=${PATHC_PAYLOAD_JSON:-<unset>}"
  echo "pathc_refresh_existing=$PATHC_REFRESH_EXISTING"
  echo "pathc_capture_rotating_model=$PATHC_CAPTURE_ROTATING_MODEL"
  echo "pathc_rotate_models=$PATHC_ROTATE_MODELS"
  echo "parent_base_url=$PARENT_BASE_URL"
  echo "showcase_warm_bootstrap_known_models=$WARM_BOOTSTRAP_KNOWN_MODELS"
  echo "showcase_warm_bootstrap_force=$WARM_BOOTSTRAP_FORCE"
  echo "showcase_gate_skip_heavy_stark=$GATE_SKIP_HEAVY_STARK"
  echo "showcase_gate_skip_ai_marketplace=$GATE_SKIP_AI_MARKETPLACE"

  cd "$ROOT_DIR"
  if [[ "$PRECOMPUTE_SIDECARS" == "true" ]]; then
    IFS=' ' read -r -a PRECOMPUTE_MODELS_ARR <<< "$PRECOMPUTE_MODELS"
    if python3 scripts/precompute_kzg_mpcheck_sidecars.py --models "${PRECOMPUTE_MODELS_ARR[@]}"; then
      echo "pathb_precompute_status=PASS"
    else
      echo "pathb_precompute_status=WARN"
      echo "pathb_precompute_warning=sidecar_precompute_failed_continuing_to_gate"
    fi
  else
    echo "pathb_precompute_status=SKIP"
  fi
  if [[ -n "$PATHC_PAYLOAD_JSON" && -f "$PATHC_PAYLOAD_JSON" ]]; then
    if PARENT_BASE_URL="$PARENT_BASE_URL" \
      python3 scripts/capture_pathc_live_receipt.py \
        --payload-json "$PATHC_PAYLOAD_JSON" \
        --parent-base-url "$PARENT_BASE_URL"; then
      echo "pathc_refresh_status=PASS"
      echo "pathc_refresh_mode=capture"
    else
      echo "pathc_refresh_status=WARN"
      echo "pathc_refresh_mode=capture"
      echo "pathc_refresh_warning=live_capture_failed_continuing_to_gate"
    fi
  elif [[ "$PATHC_CAPTURE_ROTATING_MODEL" == "true" ]]; then
    mapfile -t PATHC_ROTATE_CANDIDATES < <(
      PATHC_ROTATE_MODELS="$PATHC_ROTATE_MODELS" ARTIFACT_DIR="$ARTIFACT_DIR" python3 - <<'PY'
import json
import os
from pathlib import Path

models = [m.strip() for m in os.getenv("PATHC_ROTATE_MODELS", "").split() if m.strip()]
artifact_dir = Path(os.getenv("ARTIFACT_DIR", "."))
history_path = artifact_dir / "pathc_history.jsonl"
latest_seen = {}
if history_path.exists():
    for raw in history_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if not isinstance(row, dict):
            continue
        model = str(row.get("resolved_model_name") or row.get("source_model_name") or "").strip()
        generated_at = str(row.get("generated_at") or "").strip()
        if model and generated_at:
            latest_seen[model] = max(generated_at, str(latest_seen.get(model) or ""))
ordered = sorted(
    models,
    key=lambda model: (
        1 if model in latest_seen else 0,
        str(latest_seen.get(model) or ""),
        model,
    ),
)
for model in ordered:
    print(model)
PY
    )
    PATHC_SELECTED_MODEL=""
    PATHC_FAILED_MODELS=()
    for candidate in "${PATHC_ROTATE_CANDIDATES[@]}"; do
      [[ -n "$candidate" ]] || continue
      if PARENT_BASE_URL="$PARENT_BASE_URL" \
        python3 scripts/capture_pathc_live_receipt.py \
          --model-name "$candidate" \
          --parent-base-url "$PARENT_BASE_URL"; then
        PATHC_SELECTED_MODEL="$candidate"
        break
      fi
      PATHC_FAILED_MODELS+=("$candidate")
    done
    if [[ -n "$PATHC_SELECTED_MODEL" ]]; then
        echo "pathc_refresh_status=PASS"
        echo "pathc_refresh_mode=rotate_model"
        echo "pathc_refresh_model=$PATHC_SELECTED_MODEL"
        if [[ "${#PATHC_FAILED_MODELS[@]}" -gt 0 ]]; then
          echo "pathc_refresh_failed_models=${PATHC_FAILED_MODELS[*]}"
        fi
    else
      echo "pathc_refresh_status=WARN"
      echo "pathc_refresh_mode=rotate_model"
      echo "pathc_refresh_warning=no_rotating_model_capture_succeeded"
      if [[ "${#PATHC_FAILED_MODELS[@]}" -gt 0 ]]; then
        echo "pathc_refresh_failed_models=${PATHC_FAILED_MODELS[*]}"
      fi
    fi
  elif [[ "$PATHC_REFRESH_EXISTING" == "true" && -f "$ARTIFACT_DIR/pathc_latest.json" ]]; then
    if PARENT_BASE_URL="$PARENT_BASE_URL" \
      python3 scripts/capture_pathc_live_receipt.py \
        --refresh-artifact "$ARTIFACT_DIR/pathc_latest.json" \
        --parent-base-url "$PARENT_BASE_URL"; then
      echo "pathc_refresh_status=PASS"
      echo "pathc_refresh_mode=refresh_existing"
    else
      echo "pathc_refresh_status=WARN"
      echo "pathc_refresh_mode=refresh_existing"
      echo "pathc_refresh_warning=refresh_existing_failed_continuing_to_gate"
    fi
  else
    echo "pathc_refresh_status=SKIP"
  fi
  if SHOWCASE_BASE_URL="$BASE_URL" \
    SHOWCASE_TIMEOUT_SECONDS="$TIMEOUT" \
    PATHB_WARM_MIN_COVERAGE="$MIN_COVERAGE" \
    SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS="$MAX_ATTEMPTS" \
    SHOWCASE_WARM_VERIFY_ONCHAIN_NATIVE_KZG="${SHOWCASE_WARM_VERIFY_ONCHAIN_NATIVE_KZG:-true}" \
    SHOWCASE_WARM_EXECUTION_CHAIN="${SHOWCASE_WARM_EXECUTION_CHAIN:-dual}" \
    SHOWCASE_WARM_BOOTSTRAP_KNOWN_MODELS="$WARM_BOOTSTRAP_KNOWN_MODELS" \
    SHOWCASE_WARM_BOOTSTRAP_FORCE="$WARM_BOOTSTRAP_FORCE" \
    SHOWCASE_GATE_BRIDGE_ONLY="$GATE_BRIDGE_ONLY" \
    SHOWCASE_GATE_SKIP_HEAVY_STARK="$GATE_SKIP_HEAVY_STARK" \
    SHOWCASE_GATE_SKIP_AI_MARKETPLACE="$GATE_SKIP_AI_MARKETPLACE" \
    SHOWCASE_REQUIRE_NOIR_LANE="$REQUIRE_NOIR_LANE" \
    SHOWCASE_REQUIRE_PATHC_LIVE="$REQUIRE_PATHC_LIVE" \
    SHOWCASE_PATHC_MAX_AGE_HOURS="$PATHC_MAX_AGE_HOURS" \
    python3 scripts/ci_showcase_gate.py; then
    BUILD_RC=0
    echo "daily_build_status=PASS"
  else
    BUILD_RC=$?
    echo "daily_build_status=WARN"
    echo "daily_build_warning=one_or_more_strict_lanes_failed_or_timed_out"
  fi
  echo "daily_build_rc=$BUILD_RC"
  echo "latest_html=$ARTIFACT_DIR/latest.html"
  echo "latest_json=$ARTIFACT_DIR/latest.json"
} 2>&1 | tee "$LOG_FILE"

if [[ "$STRICT_EXIT" == "true" ]] && [[ "$BUILD_RC" -ne 0 ]]; then
  exit "$BUILD_RC"
fi
exit 0
