# zkde.fi Deployment Status

## ✅ Completed

### DNS Configuration
- **Domain:** zkde.fi
- **Pointing to:** 5.181.218.40 (this server)
- **Updated:** January 30, 2026
- **Status:** DNS update submitted to Hostinger (propagation in progress, ~5-30 minutes)

### Nginx Configuration
- **Config file:** `/etc/nginx/conf.d/zkde.fi.conf`
- **Status:** ✅ Created and loaded
- **Routes:**
  - `zkde.fi/` → Frontend (localhost:3001)
  - `zkde.fi/api/v1/zkdefi` → Backend (localhost:8003)

### Server Details
- **IPv4:** 5.181.218.40
- **IPv6:** 2a02:4780:2d:7754::1
- **Nginx:** Running and tested

## 🔄 Next Steps (Before Hackathon)

### 1. Start Services
```bash
cd /opt/obsqra.starknet/zkdefi
./start_zkdefi_services.sh
```

This will:
- Start frontend on port 3001
- Start backend on port 8003
- Run in background with logs

### 2. Verify Services
```bash
# Check if running
ps aux | grep -E '(next-server|uvicorn)'

# Test locally
curl http://localhost:3001
curl http://localhost:8003/api/v1/zkdefi/health

# Test via domain (after DNS propagates)
curl http://zkde.fi
```

### 3. SSL Certificate (Optional, After DNS Propagates)
```bash
# Install certbot if not present
sudo dnf install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d zkde.fi -d www.zkde.fi

# Nginx will auto-reload with HTTPS
```

### 4. Environment Variables
Ensure these are set for backend:
```bash
export STARKNET_RPC_URL="https://starknet-sepolia.public.blastapi.io"
export OBSQRA_PROVER_API_URL="<your_prover_url>"
export OBSQRA_API_KEY="<your_api_key>"
export PROOF_GATED_AGENT_ADDRESS="<contract_address>"
export SELECTIVE_DISCLOSURE_ADDRESS="<contract_address>"
export GARAGA_VERIFIER_ADDRESS="<contract_address>"
export CONFIDENTIAL_TRANSFER_ADDRESS="<contract_address>"
```

Or create `/opt/obsqra.starknet/zkdefi/backend/.env` with these values.

## 📋 Checklist for Hackathon Launch

- [x] DNS updated to point to this server
- [x] Nginx config created and loaded
- [ ] Frontend and backend services started
- [ ] Environment variables configured
- [ ] Test zkde.fi loads landing page
- [ ] Test wallet connection (Argent/Braavos Sepolia)
- [ ] Test backend API endpoints
- [ ] SSL certificate installed (optional for demo, but recommended)
- [ ] Contracts deployed on Sepolia
- [ ] Video recorded with demo

## 🔍 Troubleshooting

### DNS not resolving yet?
DNS propagation can take 5-30 minutes. Check with:
```bash
dig zkde.fi +short
# Should show: 5.181.218.40
```

### Services not accessible?
```bash
# Check Nginx status
sudo systemctl status nginx

# Check if ports are listening
ss -tulpn | grep -E '(3001|8003)'

# Check logs
tail -f /tmp/zkdefi-frontend.log
tail -f /tmp/zkdefi-backend.log
tail -f /var/log/nginx/zkde.fi.error.log
```

### Firewall blocking?
```bash
# Check firewall
sudo firewall-cmd --list-all

# If needed, allow HTTP/HTTPS
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 📝 Notes

- Frontend: Next.js 14 with React, Tailwind CSS, Starknet React
- Backend: FastAPI with Python 3.10+
- Frontend log: `/tmp/zkdefi-frontend.log`
- Backend log: `/tmp/zkdefi-backend.log`
- Nginx logs: `/var/log/nginx/zkde.fi.{access,error}.log`

## 🎯 Launch Command (When Ready)

```bash
cd /opt/obsqra.starknet/zkdefi && ./start_zkdefi_services.sh
```

Then visit http://zkde.fi (or https://zkde.fi after SSL setup).
