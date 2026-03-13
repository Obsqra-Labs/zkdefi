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
GATE_BRIDGE_ONLY="${SHOWCASE_GATE_BRIDGE_ONLY:-true}"
REQUIRE_NOIR_LANE="${SHOWCASE_REQUIRE_NOIR_LANE:-true}"
WARM_BOOTSTRAP_KNOWN_MODELS="${SHOWCASE_WARM_BOOTSTRAP_KNOWN_MODELS:-true}"
WARM_BOOTSTRAP_FORCE="${SHOWCASE_WARM_BOOTSTRAP_FORCE:-false}"
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
  echo "showcase_warm_bootstrap_known_models=$WARM_BOOTSTRAP_KNOWN_MODELS"
  echo "showcase_warm_bootstrap_force=$WARM_BOOTSTRAP_FORCE"

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
  if SHOWCASE_BASE_URL="$BASE_URL" \
    SHOWCASE_TIMEOUT_SECONDS="$TIMEOUT" \
    PATHB_WARM_MIN_COVERAGE="$MIN_COVERAGE" \
    SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS="$MAX_ATTEMPTS" \
    SHOWCASE_WARM_VERIFY_ONCHAIN_NATIVE_KZG="${SHOWCASE_WARM_VERIFY_ONCHAIN_NATIVE_KZG:-true}" \
    SHOWCASE_WARM_EXECUTION_CHAIN="${SHOWCASE_WARM_EXECUTION_CHAIN:-dual}" \
    SHOWCASE_WARM_BOOTSTRAP_KNOWN_MODELS="$WARM_BOOTSTRAP_KNOWN_MODELS" \
    SHOWCASE_WARM_BOOTSTRAP_FORCE="$WARM_BOOTSTRAP_FORCE" \
    SHOWCASE_GATE_BRIDGE_ONLY="$GATE_BRIDGE_ONLY" \
    SHOWCASE_REQUIRE_NOIR_LANE="$REQUIRE_NOIR_LANE" \
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
