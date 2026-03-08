#!/usr/bin/env bash

set -euo pipefail

readonly NO_TOUCH_PREFIXES=(
  "frontend/src/components/zkdefi/TradeDesk/"
  "frontend/src/components/zkdefi/mission-control/"
  "frontend/src/components/zkdefi/oracle/"
  "frontend/src/app/agent/"
)

collect_changed_files() {
  if [[ "$#" -gt 0 ]]; then
    printf "%s\n" "$@"
    return
  fi

  if [[ -n "${BASE_SHA:-}" && -n "${HEAD_SHA:-}" ]]; then
    git diff --name-only "${BASE_SHA}" "${HEAD_SHA}"
    return
  fi

  if [[ -n "${BASE_REF:-}" ]]; then
    git diff --name-only "origin/${BASE_REF}...HEAD"
    return
  fi

  {
    git diff --name-only --cached
    git diff --name-only
  } | sort -u
}

mapfile -t changed_files < <(collect_changed_files "$@" | sed '/^[[:space:]]*$/d' | sort -u)

if [[ "${#changed_files[@]}" -eq 0 ]]; then
  echo "No changed files found for conflict-safe guard."
  exit 0
fi

violations=()
for path in "${changed_files[@]}"; do
  for prefix in "${NO_TOUCH_PREFIXES[@]}"; do
    if [[ "$path" == "$prefix"* ]]; then
      violations+=("$path")
      break
    fi
  done
done

if [[ "${#violations[@]}" -gt 0 ]]; then
  echo "Conflict-safe guard failed. No-touch paths were modified:"
  for path in "${violations[@]}"; do
    echo "  - $path"
  done
  exit 1
fi

echo "Conflict-safe guard passed."
