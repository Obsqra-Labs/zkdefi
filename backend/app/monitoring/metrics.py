"""
Prometheus metrics for zkDeFi Capital OS

Tracks:
- zkGraph client performance
- Proof generation
- Receipt creation
- API performance
"""

from prometheus_client import Counter, Histogram, Gauge, Info
from functools import wraps
import time
from typing import Callable, Any
import logging

logger = logging.getLogger(__name__)

# ==============================================================================
# zkGraph Metrics
# ==============================================================================

zkgraph_requests_total = Counter(
    'zkgraph_requests_total',
    'Total zkGraph API requests',
    ['endpoint', 'source']  # source: zkrag or local_only
)

zkgraph_cache_hits_total = Counter(
    'zkgraph_cache_hits_total',
    'zkGraph cache hits',
    ['cache_type']  # market_context or historical
)

zkgraph_cache_misses_total = Counter(
    'zkgraph_cache_misses_total',
    'zkGraph cache misses',
    ['cache_type']
)

zkgraph_latency_seconds = Histogram(
    'zkgraph_latency_seconds',
    'zkGraph API latency',
    ['endpoint'],
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
)

zkgraph_rate_limit_hits_total = Counter(
    'zkgraph_rate_limit_hits_total',
    'zkGraph rate limit exceeded count'
)

zkgraph_errors_total = Counter(
    'zkgraph_errors_total',
    'zkGraph API errors',
    ['error_type']
)

zkgraph_rpm_usage = Gauge(
    'zkgraph_rpm_usage',
    'Current RPM usage out of limit'
)

# ==============================================================================
# Proof Generation Metrics
# ==============================================================================

proof_generation_total = Counter(
    'proof_generation_total',
    'Total proofs generated',
    ['proof_type', 'status']  # proof_type: risk, anomaly, execution; status: success, failure
)

proof_generation_duration_seconds = Histogram(
    'proof_generation_duration_seconds',
    'Proof generation time',
    ['proof_type'],
    buckets=(1.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0)
)

proof_verification_total = Counter(
    'proof_verification_total',
    'Total proof verifications',
    ['status']  # success or failure
)

fact_registry_submissions_total = Counter(
    'fact_registry_submissions_total',
    'FactRegistry proof submissions',
    ['status']
)

# ==============================================================================
# Receipt Metrics
# ==============================================================================

receipt_creation_total = Counter(
    'receipt_creation_total',
    'Total on-chain receipts created',
    ['action_type', 'status']  # action_type: deposit, withdraw, allocate; status: success, failure
)

receipt_creation_duration_seconds = Histogram(
    'receipt_creation_duration_seconds',
    'Receipt creation time (including tx confirmation)',
    buckets=(1.0, 5.0, 10.0, 30.0, 60.0, 120.0)
)

receipt_gas_cost = Histogram(
    'receipt_gas_cost',
    'Gas cost for receipt creation',
    buckets=(50000, 100000, 150000, 200000, 300000, 500000)
)

# ==============================================================================
# API Metrics
# ==============================================================================

api_request_total = Counter(
    'api_request_total',
    'Total API requests',
    ['method', 'endpoint', 'status']
)

api_request_duration_seconds = Histogram(
    'api_request_duration_seconds',
    'API request duration',
    ['method', 'endpoint'],
    buckets=(0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0)
)

websocket_connections = Gauge(
    'websocket_connections',
    'Active WebSocket connections'
)

websocket_messages_total = Counter(
    'websocket_messages_total',
    'WebSocket messages sent',
    ['event_type']
)

# ==============================================================================
# Business Metrics
# ==============================================================================

active_commitments = Gauge(
    'active_commitments',
    'Number of active privacy vault commitments'
)

total_vault_value_usd = Gauge(
    'total_vault_value_usd',
    'Total value locked in vaults (USD)'
)

agent_actions_total = Counter(
    'agent_actions_total',
    'Agent-initiated actions',
    ['action_type']  # rebalance, allocation, withdrawal
)

# ==============================================================================
# System Info
# ==============================================================================

app_info = Info('app_info', 'Application information')
app_info.info({
    'version': '1.0.0',
    'environment': 'production',
    'phase': '9C',
})

# ==============================================================================
# Decorators for Easy Instrumentation
# ==============================================================================

def track_zkgraph_request(endpoint: str):
    """Decorator to track zkGraph requests"""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            start_time = time.time()
            source = "unknown"
            error_type = None
            
            try:
                result = await func(*args, **kwargs)
                source = getattr(result, 'source', 'zkrag')
                return result
            except Exception as e:
                error_type = type(e).__name__
                zkgraph_errors_total.labels(error_type=error_type).inc()
                raise
            finally:
                duration = time.time() - start_time
                zkgraph_requests_total.labels(endpoint=endpoint, source=source).inc()
                zkgraph_latency_seconds.labels(endpoint=endpoint).observe(duration)
                
        return wrapper
    return decorator

def track_proof_generation(proof_type: str):
    """Decorator to track proof generation"""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            start_time = time.time()
            status = "failure"
            
            try:
                result = await func(*args, **kwargs)
                status = "success"
                return result
            except Exception:
                raise
            finally:
                duration = time.time() - start_time
                proof_generation_total.labels(proof_type=proof_type, status=status).inc()
                proof_generation_duration_seconds.labels(proof_type=proof_type).observe(duration)
                
        return wrapper
    return decorator

def track_receipt_creation(action_type: str):
    """Decorator to track receipt creation"""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            start_time = time.time()
            status = "failure"
            gas_used = 0
            
            try:
                result = await func(*args, **kwargs)
                status = "success"
                gas_used = getattr(result, 'gas_used', 0)
                return result
            except Exception:
                raise
            finally:
                duration = time.time() - start_time
                receipt_creation_total.labels(action_type=action_type, status=status).inc()
                receipt_creation_duration_seconds.observe(duration)
                if gas_used > 0:
                    receipt_gas_cost.observe(gas_used)
                
        return wrapper
    return decorator

# ==============================================================================
# Manual Metric Updates
# ==============================================================================

def update_zkgraph_cache_stats(cache_type: str, hit: bool):
    """Update zkGraph cache stats"""
    if hit:
        zkgraph_cache_hits_total.labels(cache_type=cache_type).inc()
    else:
        zkgraph_cache_misses_total.labels(cache_type=cache_type).inc()

def update_zkgraph_rpm_usage(current: int, limit: int):
    """Update current RPM usage"""
    zkgraph_rpm_usage.set(current)

def record_zkgraph_rate_limit():
    """Record rate limit hit"""
    zkgraph_rate_limit_hits_total.inc()

def update_websocket_connections(count: int):
    """Update active WebSocket connection count"""
    websocket_connections.set(count)

def record_websocket_message(event_type: str):
    """Record WebSocket message sent"""
    websocket_messages_total.labels(event_type=event_type).inc()

def update_vault_stats(commitments: int, tvl_usd: float):
    """Update vault statistics"""
    active_commitments.set(commitments)
    total_vault_value_usd.set(tvl_usd)

def record_agent_action(action_type: str):
    """Record agent-initiated action"""
    agent_actions_total.labels(action_type=action_type).inc()

# ==============================================================================
# Logging Helper
# ==============================================================================

def log_metric_event(metric_name: str, labels: dict, value: Any):
    """Log significant metric events"""
    logger.info(f"Metric: {metric_name}", extra={
        "metric": metric_name,
        "labels": labels,
        "value": value,
    })
