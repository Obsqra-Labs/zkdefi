#!/bin/bash
# Start zkde.fi services (frontend + backend)
# Nginx will route zkde.fi to these services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo "🚀 Starting zkde.fi services"
echo "=============================="
echo ""

# Check if services are already running
if pgrep -f "next-server.*3001" > /dev/null; then
    echo "⚠️  Frontend already running on port 3001"
else
    echo "📦 Starting frontend (Next.js on port 3001)..."
    cd "$FRONTEND_DIR"
    
    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo "   Installing dependencies..."
        npm install
    fi
    
    # Start in background
    nohup npm run dev > /tmp/zkdefi-frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo "   ✅ Frontend started (PID: $FRONTEND_PID)"
    echo "   Logs: /tmp/zkdefi-frontend.log"
fi

if pgrep -f "uvicorn.*8003" > /dev/null; then
    echo "⚠️  Backend already running on port 8003"
else
    echo "🐍 Starting backend (FastAPI on port 8003)..."
    cd "$BACKEND_DIR"
    
    # Check if venv exists
    if [ ! -d ".venv" ]; then
        echo "   Creating virtual environment..."
        python3 -m venv .venv
        source .venv/bin/activate
        pip install -r requirements.txt
    else
        source .venv/bin/activate
    fi
    
    # Start in background
    nohup uvicorn app.main:app --host 0.0.0.0 --port 8003 > /tmp/zkdefi-backend.log 2>&1 &
    BACKEND_PID=$!
    echo "   ✅ Backend started (PID: $BACKEND_PID)"
    echo "   Logs: /tmp/zkdefi-backend.log"
fi

echo ""
echo "=============================="
echo "✅ zkde.fi services running!"
echo "=============================="
echo ""
echo "Services:"
echo "  Frontend: http://localhost:3001"
echo "  Backend:  http://localhost:8003"
echo "  Public:   http://zkde.fi (after DNS propagates)"
echo ""
echo "Check status:"
echo "  ps aux | grep -E '(next-server|uvicorn)'"
echo ""
echo "View logs:"
echo "  tail -f /tmp/zkdefi-frontend.log"
echo "  tail -f /tmp/zkdefi-backend.log"
echo ""
echo "Stop services:"
echo "  pkill -f 'next-server.*3001'"
echo "  pkill -f 'uvicorn.*8003'"
echo ""
