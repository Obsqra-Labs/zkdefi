#!/usr/bin/env bash
# Build docs-site and copy output to frontend/public/docs so the Next app serves docs at zkde.fi/docs.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
echo "Building docs-site..."
cd docs-site
npm run build
cd "$REPO_ROOT"
mkdir -p frontend/public/docs
echo "Copying docs build to frontend/public/docs..."
cp -r docs-site/docs/.vitepress/dist/* frontend/public/docs/
echo "Done. Docs are in frontend/public/docs (served at /docs)."
