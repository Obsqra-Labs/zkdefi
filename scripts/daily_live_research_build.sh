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
STRICT_EXIT="${DAILY_BUILD_STRICT_EXIT:-false}"
BUILD_RC=0

{
  echo "== Obsqra Labs Live Research Daily Build =="
  echo "timestamp_utc=$STAMP"
  echo "base_url=$BASE_URL"
  echo "timeout_seconds=$TIMEOUT"
  echo "pathb_warm_min_coverage=$MIN_COVERAGE"
  echo "strict_bridge_max_attempts=$MAX_ATTEMPTS"

  cd "$ROOT_DIR"
  if SHOWCASE_BASE_URL="$BASE_URL" \
    SHOWCASE_TIMEOUT_SECONDS="$TIMEOUT" \
    PATHB_WARM_MIN_COVERAGE="$MIN_COVERAGE" \
    SHOWCASE_STRICT_BRIDGE_MAX_ATTEMPTS="$MAX_ATTEMPTS" \
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
