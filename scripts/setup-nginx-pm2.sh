#!/usr/bin/env bash
# Setup nginx + PM2 for zkde.fi (run from repo root).
# Requires: nginx, node, pm2, and backend Python venv (backend/venv, backend/.venv, or .venv_py311).

set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== zkde.fi nginx + PM2 setup ==="

# 1. Build frontend so /_next/static (CSS/JS) exists (needs devDeps: tailwindcss, postcss)
echo "[1/4] Building frontend..."
cd "$REPO_ROOT/frontend"
npm ci 2>/dev/null || npm install
npm run build
cd "$REPO_ROOT"

# 2. Install nginx config (optional; needs sudo)
if command -v nginx &>/dev/null; then
  echo "[2/4] Installing nginx config..."
  if [ -d /etc/nginx/sites-available ]; then
    sudo cp -n "$REPO_ROOT/nginx.conf" /etc/nginx/sites-available/zkdefi
    [ -L /etc/nginx/sites-enabled/zkdefi ] || sudo ln -sf /etc/nginx/sites-available/zkdefi /etc/nginx/sites-enabled/zkdefi
    sudo nginx -t && sudo systemctl reload nginx
    echo "    Nginx reloaded. Site: zkde.fi"
  else
    echo "    Nginx sites-available not found. Copy nginx.conf to your nginx conf.d or include path and reload."
  fi
else
  echo "[2/4] Nginx not found; skipping. Install nginx and copy nginx.conf manually."
fi

# 3. PM2: use ecosystem.config.cjs (backend via start.sh so venv works)
echo "[3/4] Starting PM2 apps..."
if ! command -v pm2 &>/dev/null; then
  echo "    pm2 not found. Install: npm i -g pm2"
  exit 1
fi

# Ensure backend start.sh is executable
chmod +x "$REPO_ROOT/backend/start.sh" 2>/dev/null || true

pm2 delete all 2>/dev/null || true
cd "$REPO_ROOT"
pm2 start ecosystem.config.cjs

# 4. Save PM2 process list (use 'pm2 startup' once to enable on reboot)
echo "[4/4] Saving PM2 process list..."
pm2 save
echo ""
echo "=== Done ==="
echo "  Frontend: http://127.0.0.1:3001"
echo "  Backend:  http://127.0.0.1:8003"
echo "  With nginx: http://zkde.fi"
echo ""
echo "  pm2 status | pm2 logs | pm2 restart all"
