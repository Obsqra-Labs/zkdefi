# Services

Core business logic services for Capital OS.

## Directory Structure

```
services/
├── Strategy Intelligence
│   ├── strategy_intelligence_service.py - Genome computation, strategy ranking
│   ├── strategy_repository.py - Persistent storage, performance tracking
│   └── oracle_recommendation_service.py - Personalized action recommendations
├── Market Data
│   ├── market_surface_service.py - Ekubo market aggregation
│   ├── ekubo_client.py - Ekubo SDK integration
│   ├── ekubo_yield_service.py - APY computation
│   └── pool_aggregator.py - Multi-pool aggregation
├── zkML & Proofs
│   ├── circuit_scanner.py - IL/Yield/Slippage circuit execution
│   ├── signal_pass_service.py - Signal computation
│   ├── proof_pipeline.py - Deposit/withdraw proof generation
│   ├── obsqra_prover_client.py - Connection to Stone prover
│   └── zkml/ - zkML circuit services
├── Execution
│   ├── vault_execute_service.py - Vault deposit/withdraw execution
│   ├── ekubo_executor.py - Ekubo LP deployment
│   └── vesu_avnu_integration.py - AVNU swaps, Vesu lending
├── Autonomous
│   ├── autonomous_agent.py - Agent execution logic
│   ├── autonomous_rebalancer.py - Rebalancing engine
│   └── autonomous_rebalancer_monitor.py - Monitoring
├── Privacy & Identity
│   ├── session_key_service.py - Session key management
│   ├── ledger_service.py - Private ledger
│   └── relayer_runner.py - Privacy relayer
└── Utilities
    ├── notification_service.py - User notifications
    ├── receipt_service.py - Audit receipts
    └── performance_tracker.py - Performance metrics
```

## Key Services

### Strategy Intelligence Service

**Purpose:** Compute genome factors and rank strategies.

**Key methods:**
- `create_or_update_strategy(pool_id, protocol, genome, ...)` - Create/update strategy
- `rank_strategies(user_profile, limit)` - Get top-ranked strategies
- `get_strategy(strategy_id)` - Get strategy details
- `get_strategy_history(strategy_id, limit)` - Get performance history

**Publishes events:**
- `strategy.created`
- `strategy.updated`

**Usage:**
```python
from app.services.strategy_intelligence_service import get_strategy_intelligence_service

svc = get_strategy_intelligence_service()
strategies = svc.rank_strategies(user_profile="BALANCED", limit=10)
```

### Oracle Recommendation Service

**Purpose:** Generate personalized action recommendations.

**Key methods:**
- `generate_recommendations(user_profile, current_allocation, limit)` - Get recommendations

**Logic:**
- If no allocation: Suggests 40%/35%/25% split across top 3 strategies
- If existing allocation: Suggests diversification into higher-scoring strategies

**Usage:**
```python
from app.services.oracle_recommendation_service import get_oracle_recommendation_service

svc = get_oracle_recommendation_service()
recs = svc.generate_recommendations(user_profile="BALANCED", limit=3)
```

### Market Surface Service

**Purpose:** Aggregate market opportunities from Ekubo.

**Key methods:**
- `get_market_surface(user_address, risk_profile, limit)` - Get opportunities with zkML scoring

**Integration:**
- Calls `pool_risk_evaluator` for 5-factor scoring
- Calls `signal_pass_service` for zkML circuit evaluation
- Returns opportunities with `zkml_risk_score`, `zkml_flags`, `zkml_signals`

### Proof Pipeline

**Purpose:** Generate execution proofs for vault operations.

**Key methods:**
- `generate_deposit_proofs(user_address, amount, protocol_id, constraints)` - Deposit proof
- `generate_withdraw_proofs(user_address, amount, protocol_id, constraints)` - Withdraw proof

**Connects to:**
- `obsqra_prover_client` for STARK proof generation
- Falls back to deterministic hash if prover unavailable

### Vault Execute Service

**Purpose:** Execute vault deposits and withdrawals.

**Key methods:**
- `execute_strategy_impl(request)` - Deploy capital to Ekubo LP
- `withdraw_from_vault(user_address, amount_wei, use_relayer)` - Withdraw funds

**Integration:**
- Generates proofs via `_generate_vault_proof()`
- Records receipts via `receipt_service`
- Updates ledger via `ledger_service`

### Notification Service

**Purpose:** In-memory notification store for user alerts.

**Key methods:**
- `create_notification(user_address, type, message, severity, metadata)`
- `get_notifications(user_address, limit, offset, unread_only)`
- `mark_as_read(notification_id, user_address)`
- `get_unread_count(user_address)`

**Integration:**
- Subscribes to Event Bus `alert.triggered` events
- Creates notifications for position alerts, proof completions
- Frontend fetches via `/api/v1/notifications`

## Service Communication

### Event Bus Pattern

Services publish events to Event Bus instead of directly calling each other:

```python
# Publisher (strategy_intelligence_service.py)
from app.events.bus import get_event_bus
from app.events.events import Events

bus = get_event_bus()
await bus.publish(Events.STRATEGY_UPDATED, {
    "strategy_id": strategy_id,
    "genome_composite": genome.composite_score,
})

# Subscriber (notification_service.py)
async def on_strategy_update(data):
    # React to strategy update
    pass

await bus.subscribe(Events.STRATEGY_UPDATED, on_strategy_update)
```

### Benefits

- **Decoupling:** Services don't depend on each other
- **Extensibility:** Add new subscribers without modifying publishers
- **Testing:** Mock event bus in tests
- **Real-time:** Events automatically forwarded to WebSocket

## Testing Services

**Unit test example:**
```python
import pytest
from app.services.strategy_intelligence_service import get_strategy_intelligence_service

@pytest.mark.asyncio
async def test_create_strategy():
    svc = get_strategy_intelligence_service()
    
    strategy = svc.create_or_update_strategy(
        pool_id="STRK/ETH",
        protocol="ekubo",
        genome=GenomeFactors(...),
    )
    
    assert strategy.strategy_id
    assert strategy.genome.composite_score > 0
```

## Performance

**Singleton pattern:** All services use singleton instances via `get_*_service()`.

**Benefits:**
- Shared state across requests
- No re-initialization overhead
- Consistent configuration

**Caveats:**
- Not thread-safe (use async locks if needed)
- State persists across requests (clean up properly)

## Best Practices

1. **Use get_*_service() functions** - Don't instantiate directly
2. **Publish events** - Let Event Bus notify other services
3. **Handle errors gracefully** - Log and return error responses, don't crash
4. **Log at INFO level** - Critical actions only (not per-request spam)
5. **Add type hints** - Use Pydantic models for complex data
