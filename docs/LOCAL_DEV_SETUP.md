# Local Development Setup Guide

## Current Status

The zkdefi application has been successfully set up for local development with both backend and frontend running and properly configured.

### Running Services

#### Backend (uvicorn on port 8003)
- **Status**: ✅ Running and healthy
- **Health Check**: `curl http://127.0.0.1:8003/health`
- **API Base**: `http://127.0.0.1:8003/api/v1/zkdefi/`
- **Process**: uvicorn app.main:app running at 127.0.0.1:8003

**Working Endpoints:**
- `GET /api/v1/zkdefi/snapshot-forecaster/windows` → 200
- `GET /api/v1/zkdefi/ledger/notes/{address}` → 200
- `GET /api/v1/zkdefi/ekubo/positions` → 200
- All other zkdefi API endpoints

#### Frontend (Next.js dev server on port 3001)
- **Status**: ✅ Running and responsive
- **URL**: `http://127.0.0.1:3001`
- **Process**: Next.js dev server on port 3001 with `.env.local` configuration
- **Configuration**: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8003`

**Pages:**
- `/agent` - Main application page (requires wallet connection)
- `/zkdefi/forecaster` - Forecaster page
- `/privacy` - Privacy features page

### Configuration Files

```
frontend/.env.local
├─ NEXT_PUBLIC_API_URL=http://127.0.0.1:8003
```

This local environment variable overrides `.env.production` which points to `https://zkde.fi`.

## Starting the Application

### Prerequisites
- Backend already running on port 8003
- Python virtual environment activated: `/opt/obsqra.starknet/zkdefi/.venv_py311`
- Node.js/npm available

### Start Frontend Dev Server
```bash
cd /opt/obsqra.starknet/zkdefi/frontend
npm run dev
# Output: ▲ Next.js 14.2.35 - Local: http://localhost:3001
```

### Verify Backend
```bash
curl http://127.0.0.1:8003/health
# Output: {"status":"ok","service":"zkdefi-backend"}
```

### Test API Connectivity
```bash
curl http://127.0.0.1:8003/api/v1/zkdefi/snapshot-forecaster/windows
# Output: {"windows":[],"count":0}
```

## Architecture

```
┌─────────────────────────────────────┐
│  Frontend (Next.js Dev Server)      │
│  http://127.0.0.1:3001             │
│  .env.local: API_URL=127.0.0.1:8003│
└──────────────────┬──────────────────┘
                   │
                   │ fetch() via apiUrl()
                   │
┌──────────────────▼──────────────────┐
│  Backend (FastAPI/uvicorn)          │
│  http://127.0.0.1:8003             │
│  - Snapshot Forecaster              │
│  - Ledger Service                   │
│  - Ekubo LP Positions               │
│  - Mission Control                  │
│  - Privacy Pools                    │
└─────────────────────────────────────┘
```

## API Client Configuration

The frontend uses a centralized API client (`frontend/src/lib/api/client.ts`):

```typescript
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "/api").replace(/\/$/, "");

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const resolvedUrl = apiUrl(path);
  // ... fetches from NEXT_PUBLIC_API_URL/path
}
```

When `NEXT_PUBLIC_API_URL=http://127.0.0.1:8003`:
- `apiUrl("/api/v1/zkdefi/snapshot-forecaster/windows")` 
- → `http://127.0.0.1:8003/api/v1/zkdefi/snapshot-forecaster/windows`

## Troubleshooting

### Frontend Shows "Connect Wallet"
This is expected behavior. The agent page requires a Starknet wallet connection to display the main interface.

### API Endpoints Return 404
**Check:**
1. Backend is running: `curl http://127.0.0.1:8003/health`
2. Frontend has correct `.env.local`: `grep NEXT_PUBLIC_API_URL frontend/.env.local`
3. Routes are mounted in backend: Check `backend/app/main.py` for router includes

### CORS Issues
The backend has CORS middleware configured to accept all origins:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Next.js Development Notes

- Hot reload is enabled in dev mode
- Environment variables from `.env.local` are loaded at build time
- Requests to `/api/...` paths that don't match Next.js route handlers return 404 (expected)
- Actual API calls go directly to the backend via `apiUrl()` helper, not through Next.js

## Production vs Development

| Aspect | Development | Production |
|--------|-------------|-----------|
| Frontend URL | http://127.0.0.1:3001 | https://zkde.fi |
| Backend URL | http://127.0.0.1:8003 | https://zkde.fi/api |
| Env Config | `.env.local` | `.env.production` |
| API_URL | 127.0.0.1:8003 | https://zkde.fi |

**Note:** Production deployment at zkde.fi currently has misconfigured API endpoints and should be redeployed with the latest code and proper configuration.
