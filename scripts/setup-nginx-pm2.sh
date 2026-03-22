#!/usr/bin/env bash
# Setup nginx + PM2 for zkde.fi (run from repo root).
# Requires: nginx, node, pm2, and backend Python venv (backend/venv, backend/.venv, or .venv_py311).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_TEMPLATE="$REPO_ROOT/nginx/zkde.fi.conf"
SHOWCASE_ARTIFACT="$REPO_ROOT/artifacts/hackathon_showcase/latest.html"
cd "$REPO_ROOT"

echo "=== zkde.fi nginx + PM2 setup ==="

ensure_showcase_artifact() {
  if [ -f "$SHOWCASE_ARTIFACT" ]; then
    return 0
  fi

  echo "    Seeding placeholder /test artifact at $SHOWCASE_ARTIFACT"
  mkdir -p "$(dirname "$SHOWCASE_ARTIFACT")"
  cat > "$SHOWCASE_ARTIFACT" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>zkde.fi test report pending</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
    main { max-width: 720px; }
    code { background: #f4f4f5; padding: 0.15rem 0.35rem; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>zkde.fi/test</h1>
    <p>The live report artifact has not been generated yet.</p>
    <p>Expected file: <code>artifacts/hackathon_showcase/latest.html</code></p>
    <p>Run <code>scripts/daily_live_research_build.sh</code> or <code>python3 scripts/hackathon_backend_showcase.py --emit-report</code> to publish a fresh report.</p>
  </main>
</body>
</html>
HTML
}

install_nginx_config() {
  local src="$1"
  local dst=""

  if [ ! -f "$src" ]; then
    echo "    Missing nginx template: $src"
    exit 1
  fi

  if [ -d /etc/nginx/conf.d ]; then
    dst="/etc/nginx/conf.d/zkde.fi.conf"
  elif [ -d /etc/nginx/sites-available ]; then
    dst="/etc/nginx/sites-available/zkdefi"
  else
    echo "    No supported nginx include path found. Copy $src manually."
    return 0
  fi

  local backup=""
  if sudo test -f "$dst"; then
    backup="${dst}.bak.$(date -u +%Y%m%d%H%M%S)"
    sudo cp "$dst" "$backup"
    echo "    Backed up existing nginx config to $backup"
  fi

  sudo install -m 0644 "$src" "$dst"

  if [ "$dst" = "/etc/nginx/sites-available/zkdefi" ] && [ -d /etc/nginx/sites-enabled ]; then
    sudo ln -sf /etc/nginx/sites-available/zkdefi /etc/nginx/sites-enabled/zkdefi
  fi

  sudo nginx -t
  sudo systemctl reload nginx
  echo "    Nginx reloaded from template: $src"
  echo "    /test will be served statically from: $SHOWCASE_ARTIFACT"
}

# 1. Build frontend so /_next/static (CSS/JS) exists (needs devDeps: tailwindcss, postcss)
echo "[1/4] Building frontend..."
cd "$REPO_ROOT/frontend"
npm ci 2>/dev/null || npm install
npm run build
cd "$REPO_ROOT"

# 2. Ensure /test has an artifact and install nginx config (optional; needs sudo)
if command -v nginx &>/dev/null; then
  echo "[2/4] Installing nginx config..."
  ensure_showcase_artifact
  install_nginx_config "$NGINX_TEMPLATE"
else
  echo "[2/4] Nginx not found; skipping. Install nginx and copy $NGINX_TEMPLATE manually."
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
echo "  Public explorer: https://zkde.fi/explorer/"
echo "  Public report:   https://zkde.fi/test"
echo ""
echo "  pm2 status | pm2 logs | pm2 restart all"
