# Phase 4 Implementation Plan

**Scope:** Archive Compression + Multi-Instance Nonce Coordination + Advanced Analytics  
**Effort:** ~7.5 hours total  
**Parallelizable:** Yes (3 independent workstreams)

---

## Workstream 4.1: Archive Compression (2 hours)

### Objective
Compress old archived events to reduce disk usage by 80%.

### Implementation
1. **New service:** `backend/app/services/archive_compression.py`
   - `compress_archive_events()` - compresses events older than 30 days
   - `decompress_archive_event()` - decompresses on query
   - Uses zlib compression (built-in, no deps)

2. **Update ExecutionStore:**
   - Add `compressed_at` field to archive table
   - `is_compressed` boolean flag
   - Decompress on retrieval if needed

3. **Add compression worker:**
   - Runs after archival worker (every 24h)
   - Compresses events 30+ days old
   - Stores as BLOB with metadata

### Expected Results
- Archive table size: ~500MB → ~100MB (80% reduction)
- Transparent to queries (automatic decompression)
- Zero performance impact for recent events

---

## Workstream 4.2: Multi-Instance Nonce Coordination (3 hours)

### Objective
Enable multi-instance deployments with coordinated nonce management.

### Implementation
1. **New service:** `backend/app/services/redis_nonce_manager.py`
   - Connects to Redis (configurable URL)
   - `get_nonce(address)` - atomic increment
   - `set_nonce(address, value)` - override if needed
   - TTL: 1 hour per nonce entry

2. **Update RelayerClient:**
   - Use Redis nonce manager instead of in-process cache
   - Fallback to HTTP `/nonce/{address}` if Redis unavailable
   - Automatic retry with exponential backoff

3. **Update main.py:**
   - Initialize Redis manager on startup
   - Handle connection failures gracefully

### Expected Results
- Multiple backend instances can safely submit transactions
- No nonce collisions even with 10+ instances
- Seamless failover if Redis unavailable

---

## Workstream 4.3: Advanced Analytics (2.5 hours)

### Objective
Dashboard endpoints for real-time system metrics and insights.

### Implementation
1. **New endpoint:** `GET /api/v1/zkdefi/oracle/analytics/summary`
   - Total executions (24h, 7d, 30d)
   - Success rates by adapter
   - Average confirmation time
   - Top adapters by volume
   - Error distribution

2. **New endpoint:** `GET /api/v1/zkdefi/oracle/analytics/performance`
   - P50/P95/P99 latencies
   - Execution rate (execs/min)
   - Archive growth rate
   - Database health trend

3. **New endpoint:** `GET /api/v1/zkdefi/oracle/analytics/timeline`
   - Hourly aggregates for the last 7 days
   - Execution counts, success rates
   - For charting/dashboards

### Expected Results
- Real-time system metrics
- Performance trending
- Bottleneck identification
- SLA monitoring

---

## Execution Strategy

### Phase 4.1 (Archive Compression)
- Day 1: Design compression format
- Implement compression service
- Test with large archives
- Verify 80% reduction

### Phase 4.2 (Multi-Instance Coordination)
- Day 2: Design Redis key schema
- Implement nonce manager
- Update RelayerClient
- Test multi-instance scenarios

### Phase 4.3 (Advanced Analytics)
- Day 3: Query design for analytics
- Implement analytics service
- Add REST endpoints
- Verify accuracy with real data

---

## Testing Strategy

### Unit Tests
- Archive compression/decompression
- Redis nonce manager (with mock Redis)
- Analytics query accuracy

### Integration Tests
- Multi-instance nonce coordination
- Archive compression with archival worker
- Analytics with real execution data

### Performance Tests
- Compression ratio achieved
- Redis latency at scale
- Analytics query performance

---

## Deployment Checklist

- [ ] Phase 4.1: Archive compression tested with 1M+ events
- [ ] Phase 4.2: Multi-instance tested with 5+ instances
- [ ] Phase 4.3: Analytics endpoints verified accurate
- [ ] All tests passing
- [ ] Zero linter errors
- [ ] Documentation complete
- [ ] Backward compatibility verified

---

## Git Commits Expected

- `feat: Phase 4.1 - Archive Compression (zlib)`
- `feat: Phase 4.2 - Redis Nonce Manager for Multi-Instance`
- `feat: Phase 4.3 - Advanced Analytics Dashboard Endpoints`
- `docs: Phase 4 Complete - Production Optimization Ready`

---

## Ready to Execute?

Proceeding with all three workstreams in parallel.
