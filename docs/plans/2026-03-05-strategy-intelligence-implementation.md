# Strategy Intelligence Service + Poseidon Bridge Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Date:** 2026-03-05  
**Goal:** Real intelligence for Capital OS (persistent strategies, genome computation, performance tracking) + fix Poseidon bridge

---

## Task 1: Fix Poseidon Bridge

**Issue:** subprocess can't find node_modules because CWD isn't circuits/ dir

**Fix in** `backend/app/services/zkml/circuit_scanner.py` **line 487:**

```python
bridge_dir = _POSEIDON_BRIDGE.parent
result = subprocess.run(
    ["node", _POSEIDON_BRIDGE.name],
    input=payload,
    capture_output=True,
    text=True,
    timeout=10,
    cwd=str(bridge_dir),  # ADD THIS
)
```

**Verify:**
```bash
cd backend && python3 -c "from app.services.zkml.circuit_scanner import _poseidon_commitment; print(_poseidon_commitment(123, 456))"
```

---

## Task 2: Strategy Data Models

**Create** `backend/app/models/strategy.py`:
- `GenomeFactors`: yield/risk/volatility/liquidity/efficiency scores (0-100)
- `Strategy`: persistent entity with genome + metadata
- `PerformanceSnapshot`: historical tracking

---

## Task 3: Strategy Repository

**Create** `backend/app/services/strategy_repository.py`:
- JSON storage in `backend/data/strategies.json`
- `save_strategy()`, `get_strategy()`, `list_strategies()`
- `record_performance()` append-only history
- Content-addressable IDs: `sha256(pool_id|protocol|tokens|fee_tier)`

---

## Task 4: Strategy Intelligence Service

**Create** `backend/app/services/strategy_intelligence_service.py`:
- `compute_genome()`: normalize raw metrics to 0-100 factors
- `create_or_update_strategy()`: persist with genome
- `rank_strategies()`: sort by composite score + risk filtering

---

## Task 5: Wire into /opportunities

**Modify** `backend/app/api/routes/strategies.py`:
- Use `intelligence_svc.create_or_update_strategy()` in scoring loop
- Replace heuristic scoring with genome composite score
- Auto-track performance on every update

---

## Task 6: Add GET /strategies APIs

**Add to** `strategies.py`:
- `GET /strategies?protocol=&min_tvl=&user_profile=` → list ranked
- `GET /strategies/{id}` → detail + performance history

---

## Task 7: Frontend Uses Backend Intelligence

**Modify** `frontend/src/components/zkdefi/oracle/OracleGenomeTab.tsx`:
- Fetch from `GET /strategies` (not `/opportunities`)
- Use `genome_factors` from backend (not frontend calc)
- Fallback to frontend calc for demo mode only

---

## Success Criteria

✅ Poseidon bridge works (zkML circuits generate real proofs)  
✅ Strategies persist with content-addressable IDs  
✅ Genome factors computed in backend (not frontend)  
✅ Performance history tracked automatically  
✅ Ranking uses composite intelligence score

