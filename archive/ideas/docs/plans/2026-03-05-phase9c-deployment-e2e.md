# Phase 9C: Deployment & E2E Testing

**Created:** March 5, 2026  
**Status:** Ready to Execute  
**Duration:** ~2 hours  
**Prerequisites:** Phase 8 + 9A + 9B complete

---

## Objective

Deploy Phase 8 contracts to Sepolia, configure the full stack, and run end-to-end tests to verify the complete provenance chain works in production.

---

## Success Criteria

1. ✅ All Phase 8 contracts deployed to Sepolia
2. ✅ Contract addresses configured in backend/frontend
3. ✅ End-to-end test: deposit → proof → receipt → provenance display
4. ✅ zkGraph integration verified in production
5. ✅ Performance monitoring established

---

## Tasks

### Task 1: Deploy ObsqraFactRegistry

**Goal:** Deploy ERC-8004 fact registry for proof storage

**Steps:**
1. Compile contract: `cd contracts && scarb build`
2. Declare class: `starkli declare target/dev/zkdefi_contracts_ObsqraFactRegistry.contract_class.json`
3. Deploy contract: `starkli deploy <class_hash> <admin_address>`
4. Verify on Voyager: Check contract at deployed address
5. Save address to `.env`

**Verification:**
```bash
# Check contract deployed
starkli call <contract_address> get_admin
# Should return admin address
```

---

### Task 2: Deploy ReceiptRegistry

**Goal:** Deploy on-chain receipt storage

**Steps:**
1. Deploy contract: `starkli deploy <class_hash> <admin_address>`
2. Authorize VaultController: `starkli invoke <receipt_registry> set_authorized_caller <vault_controller> 1`
3. Verify authorization: `starkli call <receipt_registry> is_authorized_caller <vault_controller>`
4. Save address to `.env`

**Verification:**
```bash
# Check admin
starkli call <receipt_registry> get_admin

# Check authorization
starkli call <receipt_registry> is_authorized_caller <vault_controller>`
# Should return 1 (true)
```

---

### Task 3: Update VaultController

**Goal:** Configure VaultController with new registries

**Steps:**
1. Call `set_fact_registry`: `starkli invoke <vault_controller> set_fact_registry <fact_registry>`
2. Call `set_receipt_registry`: `starkli invoke <vault_controller> set_receipt_registry <receipt_registry>`
3. Verify configuration: Check both getters
4. Update contract ABI in backend if needed

**Verification:**
```bash
# Check fact registry
starkli call <vault_controller> get_fact_registry

# Check receipt registry
starkli call <vault_controller> get_receipt_registry
```

---

### Task 4: Configure Backend

**Goal:** Update backend with deployed addresses

**Steps:**
1. Update `backend/.env`:
```bash
FACT_REGISTRY_ADDRESS=0x...
RECEIPT_REGISTRY_ADDRESS=0x...
VAULT_CONTROLLER_ADDRESS=0x6c5b17eab7f20da1ab69e98db6f3f63cbcefa28992a17787883c76dd13498d1
```

2. Update contract ABIs if changed:
   - Copy ABIs from `contracts/target/dev/` to `backend/app/contracts/abis/`
   - Verify ABI format matches starknet.py expectations

3. Restart backend:
```bash
pm2 restart zkdefi-backend
pm2 logs zkdefi-backend --lines 50
```

**Verification:**
```bash
# Check backend can load contracts
curl http://localhost:8003/api/v1/health

# Check contract integration service
curl -X POST http://localhost:8003/api/v1/vault/test_contract_connection \
  -H "Content-Type: application/json" \
  -d '{"user_address": "0x123..."}'
```

---

### Task 5: Configure Frontend

**Goal:** Update frontend with deployed addresses

**Steps:**
1. Update `frontend/.env.local`:
```bash
NEXT_PUBLIC_FACT_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_RECEIPT_REGISTRY_ADDRESS=0x...
```

2. Restart frontend:
```bash
cd frontend && npm run build && pm2 restart zkdefi-frontend
```

3. Verify no console errors in browser

**Verification:**
- Open https://zkde.fi/agent?v=vault
- Check browser console for errors
- Verify contract addresses loaded

---

### Task 6: End-to-End Test - Shielded Deposit

**Goal:** Test full deposit flow with proof + receipt

**Test Flow:**
```
User deposits 1 STRK via shielded pool
  ↓
Backend generates Groth16 proof
  ↓
Backend submits proof to FactRegistry
  ↓
Backend calls VaultController.execute_proposal_with_proof()
  ↓
VaultController verifies proof
  ↓
ReceiptRegistry creates on-chain receipt
  ↓
Frontend displays receipt with proof_hash
  ↓
User clicks proof_hash → Voyager → sees on-chain fact
```

**Steps:**
1. Connect wallet to https://zkde.fi/agent?v=vault
2. Navigate to "Private Yield" tab
3. Select "Nullifier Set" privacy method
4. Deposit 1 STRK
5. Wait for proof generation (~15s)
6. Transaction submitted, wait for confirmation
7. Check backend logs: Should see proof submission + receipt creation
8. Refresh UI: Should see commitment in "Your Commitments"
9. Click commitment → Should show receipt details with proof_hash
10. Click proof_hash → Opens Voyager → Verify fact exists

**Verification:**
```bash
# Check backend logs for proof submission
pm2 logs zkdefi-backend | grep "proof_hash"

# Check receipt created
curl http://localhost:8003/api/v1/ledger/receipts/<user_address>
# Should return array with new receipt

# Verify on-chain via Voyager
# Visit: https://sepolia.voyager.online/contract/<receipt_registry>
# Call: get_user_receipt_count(<user_address>)
# Should return count >= 1
```

---

### Task 7: End-to-End Test - Agent Allocation

**Goal:** Test agent recommendation with zkGraph provenance

**Test Flow:**
```
User requests allocation via Oracle
  ↓
LLM queries zkGraph for market context
  ↓
LLM returns recommendation with zkrag_provenance
  ↓
User accepts recommendation
  ↓
Backend generates execution proof
  ↓
Backend submits to FactRegistry + VaultController
  ↓
Receipt created with proof_hash
  ↓
Frontend displays provenance chain
  ↓
User verifies: decision → proof → fact_hash → blocks
```

**Steps:**
1. Navigate to https://zkde.fi/agent?v=oracle
2. Check zkGraphWidget shows "Available" with green status
3. Click "Get Recommendations"
4. LLM should return allocation with `zkrag_provenance`
5. Check provenance shows `fact_hash`, `block_range`, `merkle_root`
6. Accept recommendation
7. Wait for proof generation + execution
8. Check receipt created in backend logs
9. Verify provenance display in UI
10. Click `block_range` → Opens Voyager → Verify blocks exist

**Verification:**
```bash
# Check zkGraph health
curl http://localhost:8003/api/v1/zkdefi/zkgraph/health
# Should show available: true

# Check LLM recommendation includes provenance
curl -X POST http://localhost:8003/api/v1/strategies/allocate \
  -H "Content-Type: application/json" \
  -d '{"user_address": "0x...", "capital_usd": 1000}' | jq '.zkrag_provenance'
# Should return provenance object

# Check fact_hash on-chain
# Visit Voyager, search fact_hash in FactRegistry
```

---

### Task 8: Performance Monitoring

**Goal:** Establish monitoring for production

**Metrics to Track:**

1. **zkGraph Client:**
   - Cache hit rate (target: >80%)
   - API latency (target: <500ms)
   - Rate limit usage (target: <8/10 RPM)
   - Fail-open count (alerts if >5/hour)

2. **Proof Generation:**
   - Average proof time (target: <15s for Groth16)
   - Proof verification success rate (target: 100%)
   - FactRegistry submission success (target: 100%)

3. **Receipt Creation:**
   - Average gas cost (target: <150K)
   - Receipt creation success rate (target: 100%)
   - On-chain query latency (target: <2s)

4. **Frontend:**
   - Page load time (target: <3s)
   - zkGraphWidget render time (target: <100ms)
   - WebSocket connection stability (target: >99% uptime)

**Implementation:**
1. Add Prometheus metrics to backend:
```python
# In backend/app/main.py
from prometheus_client import Counter, Histogram, Gauge

zkgraph_requests = Counter('zkgraph_requests_total', 'Total zkGraph requests')
zkgraph_cache_hits = Counter('zkgraph_cache_hits_total', 'zkGraph cache hits')
proof_generation_time = Histogram('proof_generation_seconds', 'Proof generation time')
receipt_creation_success = Counter('receipt_creation_success_total', 'Receipt creations')
```

2. Add logging for critical paths:
```python
logger.info("zkGraph query", extra={
    "pool_id": pool_id,
    "source": result.source,
    "cache_hit": cache_hit,
    "latency_ms": latency_ms
})
```

3. Set up alerts (Grafana/AlertManager):
- zkGraph down for >10 minutes
- Proof generation failure rate >5%
- Receipt creation failure rate >1%
- zkGraph rate limit exceeded

**Verification:**
```bash
# Check metrics endpoint
curl http://localhost:8003/metrics

# Should see zkgraph_* and proof_* metrics
```

---

## Rollback Plan

If deployment fails:

1. **Contract deployment fails:**
   - Keep using old VaultController without proof verification
   - Set `ZKGRAPH_ENABLED=false` to disable zkGraph
   - System continues with local data only

2. **Proof verification fails:**
   - Revert VaultController to previous version
   - Clear fact_registry address
   - Receipts continue to work (no proof_hash)

3. **Receipt creation fails:**
   - Disable receipt creation in VaultController
   - Proofs still verified, just no on-chain receipt

4. **zkGraph fails:**
   - Already fail-open, no action needed
   - Verify `source="local_only"` appears in responses

---

## Success Checklist

Before marking Phase 9C complete:

- [ ] ObsqraFactRegistry deployed and verified
- [ ] ReceiptRegistry deployed and verified
- [ ] VaultController configured with registries
- [ ] Backend configured with addresses
- [ ] Frontend configured with addresses
- [ ] Shielded deposit E2E test passes
- [ ] Agent allocation E2E test passes
- [ ] zkGraph provenance displays correctly
- [ ] Voyager links work for all explorer references
- [ ] Performance monitoring established

---

## Time Estimates

- Task 1-3 (Contract deployment): 30 minutes
- Task 4-5 (Configuration): 15 minutes
- Task 6-7 (E2E testing): 45 minutes
- Task 8 (Monitoring): 20 minutes

**Total:** ~2 hours

---

**Next:** Phase 10 (Private DAO Governance)
