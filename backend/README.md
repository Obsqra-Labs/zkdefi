# zkde.fi Backend

FastAPI backend for Capital OS — AI-driven capital allocation with verifiable risk analysis.

## Architecture

```
backend/
├── app/
│   ├── api/              # HTTP endpoints
│   │   └── routes/       # Route modules
│   ├── services/         # Business logic
│   ├── workers/          # Background workers
│   ├── websocket/        # WebSocket server
│   ├── events/           # Event Bus (pub/sub)
│   ├── models/           # Pydantic models
│   └── main.py           # FastAPI app entrypoint
├── data/                 # JSON persistence
├── tests/                # Test suite
└── requirements.txt      # Dependencies
```

## Quick Start

**1. Install dependencies:**
```bash
cd backend
pip install -r requirements.txt
```

**2. Configure environment:**
```bash
cp .env.example .env
# Edit .env with your values
```

**3. Start server:**
```bash
./start.sh
# Or manually:
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**4. Start workers:**
```bash
# Terminal 2: Market poller (updates every 60s)
python -m app.workers.market_poller

# Terminal 3: Position monitor (checks every 5min)
python -m app.workers.position_monitor
```

**5. Test:**
```bash
curl http://localhost:8000/health
# {"status":"ok","service":"zkdefi-backend"}
```

## Key Features

### Phase 6: Execution Wiring ✅
- **Oracle → Vault execution** - Approve recommendations with one click
- **Withdrawal flow** - Exit positions via `/api/v1/vault/withdraw`
- **Position monitoring** - Continuous health checks
- **Market data polling** - Fresh strategies every 60s

### Phase 7: Real-Time Infrastructure ✅
- **WebSocket server** - Push updates to frontend (`/ws/{address}`)
- **Event Bus** - Internal pub/sub for services
- **Notification service** - In-memory alerts
- **50x traffic reduction** - No more polling

## API Endpoints

### Strategies
- `POST /api/v1/strategies/opportunities` - Get ranked opportunities with zkML scoring
- `GET /api/v1/strategies` - List all strategies
- `GET /api/v1/strategies/{id}` - Get strategy details + history
- `GET /api/v1/strategies/recommendations` - Personalized recommendations
- `POST /api/v1/strategies/allocate` - AI allocation planning

### Vault
- `POST /api/v1/vault/execute` - Execute strategy deployment
- `POST /api/v1/vault/withdraw` - Withdraw funds (NEW!)
- `GET /api/v1/vault/positions/{address}` - Get user positions

### WebSocket
- `WS /ws/{address}` - Real-time updates (NEW!)

### Notifications
- `GET /api/v1/notifications` - List notifications (NEW!)
- `POST /api/v1/notifications/{id}/read` - Mark as read
- `GET /api/v1/notifications/unread-count` - Badge count

**Full API docs:** http://localhost:8000/docs (OpenAPI/Swagger)

## Services

**Core services** (see `app/services/README.md` for details):
- **Strategy Intelligence** - Genome computation, ranking
- **Oracle Recommendations** - Personalized actions
- **Market Surface** - Ekubo data aggregation
- **Proof Pipeline** - Execution proof generation
- **Vault Execute** - Capital deployment
- **Notification** - Alert management

## Workers

**Background workers** (see `app/workers/README.md` for details):
- **market_poller.py** - Poll Ekubo every 60s, update strategies
- **position_monitor.py** - Check positions every 5min, send alerts

## Real-Time Architecture

```
Workers (market_poller, position_monitor)
  ↓ Every 60s / 5min
Event Bus (internal pub/sub)
  ↓ publish events
WebSocket Manager
  ↓ broadcast to clients
Frontend (useWebSocket hook)
  ↓ auto-refresh UI
```

## Data Persistence

**Current:** JSON files + SQLite
- `data/strategies.json` - Persistent strategies
- `data/strategy_performance.json` - Performance snapshots
- `data/ledger.db` - SQLite ledger
- `data/orchestration_receipts.json` - Receipts

**Future:** PostgreSQL migration (Phase 8)

## Testing

**Run tests:**
```bash
cd backend
pytest
```

**Test specific module:**
```bash
pytest tests/test_oracle_api.py -v
```

**Test with coverage:**
```bash
pytest --cov=app --cov-report=html
```

## Deployment

**Production (PM2):**
```bash
pm2 start ecosystem.config.cjs
pm2 logs zkdefi-backend
```

**Docker:**
```bash
docker-compose up -d backend
docker-compose logs -f backend
```

**Environment variables:**
```bash
# Required
STARKNET_RPC_URL=http://localhost:5050
OBSQRA_PROVER_API_URL=http://localhost:8002/api/v1

# Optional
OPENAI_API_KEY=sk-...  # For AI allocation
PORT=8000
LOG_LEVEL=INFO
```

## Monitoring

**Health check:**
```bash
curl http://localhost:8000/health
```

**Worker status:**
```bash
pm2 logs market-poller
pm2 logs position-monitor
```

**WebSocket connections:**
```bash
curl http://localhost:8000/ws/health
```

## Troubleshooting

**Import errors:**
- Ensure PYTHONPATH includes backend directory
- Check all dependencies installed

**Port already in use:**
```bash
lsof -i :8000
kill -9 <PID>
```

**Workers not broadcasting:**
- Check Event Bus bridge activated (startup logs)
- Verify WebSocket Manager initialized
- Test with `wscat -c ws://localhost:8000/ws/0x123`

**Slow API responses:**
- Enable query logging
- Check for N+1 queries
- Profile with `cProfile`

## Development

**Hot reload:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Debug logging:**
```bash
LOG_LEVEL=DEBUG uvicorn app.main:app
```

**Interactive testing:**
```bash
python
>>> from app.services.strategy_intelligence_service import get_strategy_intelligence_service
>>> svc = get_strategy_intelligence_service()
>>> strategies = svc.rank_strategies("BALANCED", 10)
>>> print(strategies[0].genome.composite_score)
```

## Next Steps

**Phase 8: Production Readiness**
- PostgreSQL migration (off SQLite/JSON)
- Authentication middleware
- Rate limiting
- CI/CD pipeline
- Monitoring (Prometheus/Grafana)

See `docs/plans/` for detailed implementation plans.
