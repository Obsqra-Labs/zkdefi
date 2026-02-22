# Frontend Domain Setup - zkde.fi

## Current State
- **MVP Frontend:** Deployed at `localhost:3000/mvp`
- **Backend API:** Running on `localhost:8003`
- **Desired:** Accessible at `zkde.fi/mvp`

## What You Need to Do

### Option 1: Update DNS + Reverse Proxy (5 mins)
If you own/control `zkde.fi` domain:

1. Update DNS to point to your server IP:
   ```
   zkde.fi    A    <YOUR_SERVER_IP>
   ```

2. Setup Nginx reverse proxy on port 80/443:
   ```nginx
   server {
       listen 80;
       server_name zkde.fi;
       
       location / {
           proxy_pass http://localhost:3000;
       }
       
       location /api/ {
           proxy_pass http://localhost:8003;
       }
   }
   ```

3. Restart Nginx:
   ```bash
   sudo systemctl restart nginx
   ```

   Then visit: `https://zkde.fi/mvp`

### Option 2: Update Frontend to Use New Domain (2 mins)
If using Vercel/hosting:

1. Frontend env var:
   ```
   REACT_APP_API_URL=https://zkde.fi/api
   ```

2. Redeploy frontend

3. Update backend CORS:
   ```python
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["https://zkde.fi", "https://www.zkde.fi"],
       ...
   )
   ```

### Option 3: Local Testing with /etc/hosts (1 min)
To test locally without DNS:

```bash
# Add to /etc/hosts
127.0.0.1    zkde.fi
```

Then visit: `http://zkde.fi:3000/mvp`

## What's Ready to Display

Once domain is set up, users will see:

### GET `/api/v1/positions/user/{address}`
```json
[
  {
    "position_id": "pos_0_04457",
    "pair": "ETH/USDC",
    "liquidity": 15.8,
    "amount0": 0.5,
    "amount1": 1000,
    "value_usd": 1666.67,
    "current_apy": 27.5,
    "is_active": true,
    "created_at": "2026-02-18T01:23:07.002141"
  }
]
```

### GET `/api/v1/positions/portfolio/{address}`
```json
{
  "user_address": "0x123abc456def",
  "total_principal": 5000.01,
  "total_current_value": 5000.01,
  "total_accumulated_yield": 6780.84,
  "total_daily_yield": 376.71,
  "portfolio_apy": 27.67,
  "num_positions": 3,
  "positions": [...]
}
```

### POST `/api/v1/positions/{position_id}/collect-fees`
```json
{
  "position_id": "pos_0_04457",
  "fees_collected": {
    "token0": 0.036,
    "token1": 0.09
  },
  "tx_hash": "0xffffff...",
  "status": "pending"
}
```

## Quick Action

**Fastest path:** 
1. Tell me your server IP
2. I'll generate Nginx config
3. You add DNS record + reload Nginx
4. Then visit `zkde.fi/mvp` immediately

What would you like to do?
