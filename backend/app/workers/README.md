# Workers

Background workers for continuous monitoring and data updates.

## Overview

Workers run independently from the main FastAPI application and provide:
- **Market data polling** (every 60s)
- **Position health monitoring** (every 5min)
- **Real-time updates** via WebSocket

## Workers

### 1. market_poller.py

**Purpose:** Poll market data and update strategy rankings.

**Features:**
- Fetches latest pool metrics from Ekubo every 60s
- Updates Strategy Intelligence Service with fresh data
- Tracks price history for realized volatility
- Broadcasts `strategy_update` events via WebSocket
- Detects significant market changes (APY spikes, TVL drains)

**Run:**
```bash
python -m app.workers.market_poller
```

**Logs:**
```
2026-03-05 12:00:00 [INFO] Market poller starting (poll interval: 60s)
2026-03-05 12:00:01 [INFO] Polling cycle: 15 opportunities
2026-03-05 12:00:02 [DEBUG] Updated strategy STRK/ETH: genome_composite=85.2
2026-03-05 12:00:03 [DEBUG] Broadcast strategy update for STRK/ETH
2026-03-05 12:00:04 [INFO] Poll cycle complete at 2026-03-05T12:00:04Z
```

**Configuration:**
```python
MarketPoller(poll_interval_seconds=60)  # Default 60s
```

---

### 2. position_monitor.py

**Purpose:** Monitor LP positions and alert on risk events.

**Features:**
- Checks all user positions every 5 minutes
- Detects:
  - Out-of-range LP positions
  - High impermanent loss (>5%)
  - APY drops (>50% below expected)
  - Low pool liquidity (<$10k TVL)
- Creates receipts for high-severity alerts
- Sends `alert` events via WebSocket

**Run:**
```bash
python -m app.workers.position_monitor
```

**Logs:**
```
2026-03-05 12:00:00 [INFO] Position monitor starting (poll interval: 300s)
2026-03-05 12:00:01 [INFO] Monitoring cycle: 5 users
2026-03-05 12:00:02 [INFO] Monitoring 3 positions for 0x123...
2026-03-05 12:00:03 [WARNING] [0x123...] Position out of range: price 1.25 outside [1.0, 1.2]
2026-03-05 12:00:04 [DEBUG] Sent alert to 0x123... via WebSocket
2026-03-05 12:00:05 [INFO] Monitoring cycle complete
```

**Configuration:**
```python
PositionMonitor(poll_interval_seconds=300)  # Default 5min
```

---

## Architecture

```
Workers
  ↓ update data / detect alerts
  ↓ publish events to Event Bus
Event Bus (internal pub/sub)
  ↓ forward to WebSocket Manager
WebSocket Manager
  ↓ broadcast() or send_to_user()
Frontend
  ↓ useWebSocket hook receives events
  ↓ auto-refresh UI
```

## Production Deployment

### PM2 (Recommended)

Add to `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    // ... existing apps ...
    {
      name: "market-poller",
      script: "python",
      args: "-m app.workers.market_poller",
      cwd: "./backend",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        PYTHONPATH: ".",
      },
    },
    {
      name: "position-monitor",
      script: "python",
      args: "-m app.workers.position_monitor",
      cwd: "./backend",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        PYTHONPATH: ".",
      },
    },
  ],
};
```

**Start:**
```bash
pm2 start ecosystem.config.cjs --only market-poller,position-monitor
```

**Monitor:**
```bash
pm2 logs market-poller
pm2 logs position-monitor
```

### Systemd

**Create service files:**

`/etc/systemd/system/zkdefi-market-poller.service`:
```ini
[Unit]
Description=zkde.fi Market Poller
After=network.target

[Service]
Type=simple
User=zkdefi
WorkingDirectory=/opt/zkdefi/backend
Environment="PYTHONPATH=."
ExecStart=/usr/bin/python3 -m app.workers.market_poller
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl enable zkdefi-market-poller
sudo systemctl start zkdefi-market-poller
sudo systemctl status zkdefi-market-poller
```

## Monitoring

**Health checks:**
- Workers log "Polling cycle complete" on success
- No logs for >2x poll interval = worker hung/crashed
- Use `pm2 monit` or systemd status to check

**Metrics to track:**
- Poll cycle duration (should be <5s)
- Number of strategies updated per cycle
- Number of alerts generated
- WebSocket broadcast success rate

## Troubleshooting

**Worker not starting:**
- Check `PYTHONPATH` is set correctly
- Verify dependencies installed (`pip install -r requirements.txt`)
- Check for import errors in logs

**No WebSocket events:**
- Verify Event Bus bridge is activated (check FastAPI startup logs)
- Ensure WebSocket Manager is initialized
- Check worker logs for "Broadcast" messages

**High CPU/memory:**
- Reduce poll frequency (increase `poll_interval_seconds`)
- Limit number of opportunities fetched (`limit` param)
- Check for memory leaks in price history tracking

## Development

**Run with debug logging:**
```bash
LOG_LEVEL=DEBUG python -m app.workers.market_poller
```

**Test without WebSocket:**
Comment out WebSocket broadcast in worker code to test data updates only.

**Simulate alerts:**
Create test positions with out-of-range prices to trigger alerts.
