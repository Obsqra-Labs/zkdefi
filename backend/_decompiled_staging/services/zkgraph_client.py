# Source Generated with Decompyle++
# File: zkgraph_client.cpython-312.pyc (Python 3.12)

__doc__ = '\nZkGraph Client: Query attested on-chain intelligence from obsqra.fi zkRAG API\n\nThis client provides rate-limited, cached access to the obsqra proven index.\nAll methods fail-open (return local_only fallbacks on error).\n'
import logging
import os
import time
from typing import Optional, List, Dict, Any
from collections import deque
import httpx
from app.models.zkgraph import ZkGraphProvenance, ZkGraphResult, MarketContext, HistoricalPattern, StrategyMatch
logger = logging.getLogger(__name__)
from app.monitoring.metrics import update_zkgraph_cache_stats, update_zkgraph_rpm_usage, record_zkgraph_rate_limit

class ZkGraphClient:
    '''
    Singleton client for querying obsqra\'s zkRAG API
    
    Features:
    - Rate limiting: 10 requests per minute (sliding window)
    - TTL caching: 60s for market context, 300s for historical data
    - Fail-open: Returns source="local_only" on any error
    - Structured format: Always requests structured JSON responses
    '''
    _instance: Optional['ZkGraphClient'] = None
    
    def __init__(self):
        self.base_url = os.getenv('OBSQRA_PROVER_API_URL', 'http://localhost:8002/api/v1')
        self.enabled = os.getenv('ZKGRAPH_ENABLED', '').lower() == 'true'
        self.http_retries = max(0, int(os.getenv('ZKGRAPH_HTTP_RETRIES', '2')))
        self.retry_backoff_sec = max(0.1, float(os.getenv('ZKGRAPH_RETRY_BACKOFF_SEC', '0.4')))
        self.max_query_plan = max(1, int(os.getenv('ZKGRAPH_AGENT_QUERY_PLAN_MAX', '3')))
        self.default_pattern_limit = max(1, int(os.getenv('ZKGRAPH_PATTERN_LIMIT', '5')))
        self.default_strategy_limit = max(1, int(os.getenv('ZKGRAPH_STRATEGY_LIMIT', '5')))
        self.rate_limit_rpm = 10
        self.request_timestamps = deque(maxlen = self.rate_limit_rpm)
        self.market_context_cache = { }
        self.historical_cache = { }
        self.market_ttl = 60
        self.historical_ttl = 300
        self.client = httpx.AsyncClient(timeout = 30)
        if self.enabled:
            logger.info(f'''ZkGraphClient initialized: {self.base_url}''')
            return None
        logger.info('ZkGraphClient disabled (ZKGRAPH_ENABLED != true)')

    get_instance = (lambda cls = None: pass# WARNING: Decompyle incomplete
)()
    
    def _check_rate_limit(self = None):
        """Check if we're under rate limit (10 RPM)"""
        now = time.time()
        if self.request_timestamps and now - self.request_timestamps[0] > 60:
            self.request_timestamps.popleft()
            if self.request_timestamps and now - self.request_timestamps[0] > 60:
                continue
        if len(self.request_timestamps) >= self.rate_limit_rpm:
            logger.warning(f'''ZkGraph rate limit exceeded: {len(self.request_timestamps)} requests in last minute''')
            record_zkgraph_rate_limit()
            update_zkgraph_rpm_usage(len(self.request_timestamps), self.rate_limit_rpm)
            return False
        self.request_timestamps.append(now)
        update_zkgraph_rpm_usage(len(self.request_timestamps), self.rate_limit_rpm)
        return True

    
    def _get_cached(self = None, cache = None, key = None, ttl = ('cache', Dict, 'key', str, 'ttl', int, 'return', Optional[Any])):
        '''Get cached value if within TTL'''
        if key in cache:
            entry = cache[key]
            if time.time() - entry['timestamp'] < ttl:
                logger.debug(f'''Cache hit for {key}''')
                update_zkgraph_cache_stats('historical' if cache is self.historical_cache else 'market_context', True)
                return entry['data']
            del None[key]
        if cache is self.historical_cache:
            update_zkgraph_cache_stats('historical', False)
            return None
        None('market_context', False)

    
    def _set_cache(self = None, cache = None, key = None, data = ('cache', Dict, 'key', str, 'data', Any)):
        '''Set cached value with timestamp'''
        cache[key] = {
            'data': data,
            'timestamp': time.time() }

    
    async def _request_json(self = None, method = None, path = None, *, json_payload, params):
        '''Low-level JSON request helper with retries and fail-open behavior.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def _sleep_backoff(self = None, attempt = None):
        pass
    # WARNING: Decompyle incomplete

    
    async def _query_zkrag(self = None, query = None, format = None):
        '''
        Internal method to query obsqra zkRAG API

        Returns None on error (fail-open design)
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def query_market_context(self = None, pool_id = None):
        '''
        Get attested market context for a specific pool
        
        Returns MarketContext with source="local_only" on error (fail-open)
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def query_historical_patterns(self = None, pattern_type = None, limit = None):
        '''
        Get historical on-chain patterns from proven index
        
        Returns empty list on error (fail-open)
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def query_similar_strategies(self = None, strategy_id = None, limit = None):
        '''
        Get historically similar strategies from proven index
        
        Returns empty list on error (fail-open)
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def verify_provenance(self = None, fact_hash = None, response_hash = None, query_id = (None, None), response_text = ('fact_hash', str, 'response_hash', str, 'query_id', str | None, 'response_text', str | None, 'return', Dict[(str, Any)])):
        '''
        Verify a fact_hash + response_hash against obsqra registry
        '''
        pass
    # WARNING: Decompyle incomplete

    
    def _build_query_plan(self = None, prompt = None, pool_id = None, strategy_id = ('prompt', str, 'pool_id', str | None, 'strategy_id', str | None, 'return', list[str])):
        pass
    # WARNING: Decompyle incomplete

    
    def _pick_scan_circuits(self = None, prompt = None, scan_circuits = None):
        pass
    # WARNING: Decompyle incomplete

    
    async def _llm_synthesis(self = None, prompt = None, evidence = None):
        '''Optional concise synthesis using provider registry (Onyx/OpenAI/deterministic).'''
        pass
    # WARNING: Decompyle incomplete

    
    async def query_agent_report(self = None, prompt = None, *, pool_id, strategy_id, run_live_circuits, scan_circuits, scan_mode, llm_synthesis):
        '''
        Robust multi-source zkRAG agent report.

        Combines:
          - planned zkRAG retrieval queries
          - market context + patterns + strategy matches
          - circuit readiness + skill registry + ONNX runtime status
          - optional live circuit scan
          - optional LLM synthesis (Onyx/OpenAI with deterministic fallback)
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def get_capability_snapshot(self = None):
        '''Return a capability-focused snapshot (circuits, skills, providers, runtime).'''
        pass
    # WARNING: Decompyle incomplete

    
    async def health_check(self = None):
        '''
        Check zkGraph client health
        '''
        pass
    # WARNING: Decompyle incomplete



def get_zkgraph_client():
    '''Get singleton ZkGraphClient instance'''
    return ZkGraphClient.get_instance()

return None
# WARNING: Decompyle incomplete
