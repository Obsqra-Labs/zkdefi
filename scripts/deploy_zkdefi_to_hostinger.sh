#!/bin/bash
# Deploy zkde.fi frontend on this VPS (Hostinger = VPS provider; this machine hosts zkde.fi).
# Run from zkdefi/ directory.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_NAME="zkdefi-frontend-${TIMESTAMP}.tar.gz"

echo "Deploying zkde.fi (this VPS)"
echo "============================="
echo ""

# Check if we're in the right directory
if [ ! -d "$FRONTEND_DIR" ]; then
    echo "Error: frontend/ directory not found"
    echo "   Run this script from the zkdefi/ directory"
    exit 1
fi

# Build docs and copy to frontend/public/docs
DOCS_SITE_DIR="$SCRIPT_DIR/docs-site"
if [ -d "$DOCS_SITE_DIR" ]; then
    echo "Building docs-site for /docs route..."
    cd "$DOCS_SITE_DIR"
    npm ci --silent 2>/dev/null || npm install --silent
    npm run build
    
    # Copy built docs to frontend/public/docs
    rm -rf "$FRONTEND_DIR/public/docs"
    mkdir -p "$FRONTEND_DIR/public/docs"
    cp -r "$DOCS_SITE_DIR/docs/.vitepress/dist/"* "$FRONTEND_DIR/public/docs/"
    echo "Docs copied to frontend/public/docs"
else
    echo "Warning: docs-site/ not found, skipping docs build"
fi

# Create deployment archive (NEXT_PUBLIC_* are baked in at build time; set NEXT_PUBLIC_API_URL before npm run build when building on server)
echo "Creating deployment archive..."
cd "$FRONTEND_DIR"

# Exclude build artifacts and dependencies
tar --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='.env.local' \
    --exclude='*.log' \
    --exclude='.DS_Store' \
    -czf "$ARCHIVE_NAME" \
    .

echo "Archive created: $ARCHIVE_NAME"
echo "   Size: $(du -h "$ARCHIVE_NAME" | cut -f1)"
echo ""

# Move archive to zkdefi root for easy access
mv "$ARCHIVE_NAME" "$SCRIPT_DIR/"
ARCHIVE_PATH="$SCRIPT_DIR/$ARCHIVE_NAME"

echo "📍 Archive location: $ARCHIVE_PATH"
echo ""
echo "=================================="
echo "Deploy on this machine (VPS):"
echo "=================================="
echo ""
echo "  cd $FRONTEND_DIR"
echo "  # Set env (NEXT_PUBLIC_* are baked in at build time):"
echo "  export NEXT_PUBLIC_API_URL=https://starknet.obsqra.fi   # or your API base"
echo "  npm ci && npm run build && npm start   # or use pm2/systemd"
echo ""
echo "Or use the archive to copy frontend source elsewhere; build there with env set."
echo ""
echo "Archive: $ARCHIVE_PATH"
