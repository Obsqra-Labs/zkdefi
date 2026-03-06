# Batch 1: Security Fixes

## 1A. Restrict CORS Origins ✅

**File**: `backend/app/main.py`  
**Before**: `allow_origins=["*"]` with `allow_credentials=True`  
**After**: Origin list driven by `CORS_ALLOWED_ORIGINS` env var, falling back to:
- **Production** (`APP_ENV=production`): `https://zkde.fi`, `https://www.zkde.fi`, `https://app.zkde.fi`
- **Development**: `http://localhost:3000`, `http://localhost:3001`, `http://127.0.0.1:3000`

## 1B. Auth Middleware Created ✅

**New file**: `backend/app/middleware/auth.py`

Two dependency functions:
- `require_wallet_owner` — reads `X-Wallet-Address` header, matches against `user_address` in path or JSON body. Returns 401 if missing, 403 if mismatch.
- `require_admin` — reads `X-Admin-Key` header, matches `ADMIN_API_KEY` env var. In dev mode without key set, allows with warning. In production, blocks.

## 1C. Auth Applied to Destructive Endpoints ✅

| Endpoint | File | Auth Guard |
|----------|------|------------|
| `PUT /policy/vault/{user_address}` | `routes/policy.py` | `require_wallet_owner` |
| `POST /policy/reset/{user_address}` | `routes/policy.py` | `require_admin` |
| `POST /merkle/reset` | `routes/full_privacy.py` | `require_admin` |
| `POST /autonomous/start` | `rebalancer.py` | `require_wallet_owner` |
| `POST /autonomous/stop` | `rebalancer.py` | `require_wallet_owner` |
| `POST /autonomous/pause/{user_address}` | `rebalancer.py` | `require_wallet_owner` |
| `POST /autonomous/resume/{user_address}` | `rebalancer.py` | `require_wallet_owner` |
| `GET /autonomous/all` | `rebalancer.py` | `require_admin` |
| `DELETE /agents/{agent_id}` | `routes/agents.py` | `require_wallet_owner` |

## 1D. Frontend .env Fixes ✅

- `.env.local`: Changed port from `8000` to `8003` to match actual backend
- `.env.production.local`: Changed empty string to `https://zkde.fi`

## Verification

```bash
python -c "from app.middleware.auth import require_wallet_owner, require_admin; print('OK')"
# All auth imports OK
# Policy routes: 5, Full privacy routes: 19, Rebalancer routes: 14, Agents routes: 10
```
