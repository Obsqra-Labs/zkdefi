# ShieldedPool Contract Deployment

**Date:** February 3, 2026  
**Status:** Ready for manual deployment

---

## Summary

The `ShieldedPool` contract is the unified private allocation pool that:
- Hides deposit/withdrawal amounts (commitment-based)
- Supports Conservative/Neutral/Aggressive pools
- Integrates relayer for private withdrawals to fresh addresses
- Distinguishes human-signed (no execution proof) vs agent (execution proof required)

---

## Artifacts

| File | Path | Size |
|------|------|------|
| Sierra JSON | `contracts/target/dev/zkdefi_contracts_ShieldedPool.contract_class.json` | 455 KB |
| CASM JSON | `contracts/target/dev/zkdefi_contracts_ShieldedPool.compiled_contract_class.json` | 330 KB |

---

## Constructor Arguments (6 parameters)

The `ShieldedPool` contract requires these constructor arguments in order:

| # | Parameter | Value |
|---|-----------|-------|
| 1 | `garaga_verifier` | `0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37` |
| 2 | `fact_registry` | `0x4ce7851f00b6c3289674841fd7a1b96b6fd41ed1edc248faccd672c26371b8c` |
| 3 | `session_manager` | `0x01c0edf8ff269921d3840ccb954bbe6790bb21a2c09abcfe83ea14c682931d68` |
| 4 | `reputation_registry` | `0x0276979a6b7341d7b3bdf157669c4e3b04886cfb5b5816cd5f82a9cd855a0092` |
| 5 | `token` | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| 6 | `admin` | `0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d` |

---

## Deployment Method: Manual via Voyager

CLI deployment is blocked due to RPC version incompatibility (all CLI tools require v0.10.0, all public RPCs provide v0.7-v0.8).

### Step 1: Declare Contract

1. Go to **https://sepolia.voyager.online/**
2. Connect wallet (Argent X or Braavos)
3. Click **"Tools"** → **"Declare Contract"**
4. Upload files:
   - Sierra: `zkdefi_contracts_ShieldedPool.contract_class.json`
   - CASM: `zkdefi_contracts_ShieldedPool.compiled_contract_class.json`
5. Sign and submit transaction
6. Wait for confirmation and note the **class hash**

### Step 2: Deploy Contract

1. After declaration, click **"Deploy"**
2. Enter constructor arguments in order:
   ```
   0x06d0cb7a48b48c5b6ca70f856d249caccea90f506ad7596a6838502fe3aa6d37
   0x4ce7851f00b6c3289674841fd7a1b96b6fd41ed1edc248faccd672c26371b8c
   0x01c0edf8ff269921d3840ccb954bbe6790bb21a2c09abcfe83ea14c682931d68
   0x0276979a6b7341d7b3bdf157669c4e3b04886cfb5b5816cd5f82a9cd855a0092
   0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
   0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
   ```
3. Sign and submit
4. Note the deployed **contract address**

### Step 3: Update Environment

After deployment, update:

**Backend** (`backend/.env`):
```
SHIELDED_POOL_ADDRESS=0x<DEPLOYED_ADDRESS>
```

**Frontend** (`frontend/.env.local`):
```
NEXT_PUBLIC_SHIELDED_POOL_ADDRESS=0x<DEPLOYED_ADDRESS>
```

### Step 4: Restart Services

```bash
# Restart backend
pkill -f "uvicorn.*8003"
cd /opt/obsqra.starknet/zkdefi/backend
nohup /usr/local/bin/uvicorn app.main:app --host 0.0.0.0 --port 8003 &

# Rebuild and restart frontend
cd /opt/obsqra.starknet/zkdefi/frontend
npm run build
pm2 restart zkdefi-frontend
```

---

## Current Status

| Component | Status |
|-----------|--------|
| Contract Built | ✅ |
| Backend Endpoints | ✅ Working |
| Frontend UI | ✅ Built |
| Contract Deployed | ❌ Manual deployment needed |
| Environment Vars | ❌ Needs update after deploy |

---

## Alternative: Use Existing ConfidentialTransfer

Until `ShieldedPool` is deployed, the frontend can fallback to `ConfidentialTransfer`:

```
NEXT_PUBLIC_SHIELDED_POOL_ADDRESS=0x032f230ac10fc3eafb4c3efa88c3e9ab31c23ef042c66466f6be49cf0498d840
```

This provides the same privacy features but without pool allocation support.
