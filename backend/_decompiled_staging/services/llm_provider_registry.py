# Source Generated with Decompyle++
# File: llm_provider_registry.cpython-312.pyc (Python 3.12)

'''
LLM Provider Registry — Manages multiple LLM backends for identity-bound agents.

Supports:
  - OpenAI-compatible APIs (GPT-4, GPT-3.5-turbo, Mistral, Llama via vLLM/Ollama)
  - Clawbot adapter (custom DeFi-specific model)
  - Deterministic fallback (always available, no API key needed)

Each agent can bind to a specific provider+model combination.
The registry handles routing, fallback, and usage tracking.
'''
from __future__ import annotations
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional
logger = logging.getLogger(__name__)

class ProviderType(Enum, str):
    OPENAI_COMPATIBLE = 'openai_compatible'
    CLAWBOT = 'clawbot'
    DETERMINISTIC = 'deterministic'

LLMProviderConfig = <NODE:12>()
LLMResponse = <NODE:12>()
ProviderUsageStats = <NODE:12>()

class LLMProviderRegistry:
    '''Registry of LLM providers with routing and fallback.'''
    
    def __init__(self):
        self._providers = { }
        self._clients = { }
        self._usage = { }
        self._agent_bindings = { }
        self._register_builtins()

    
    def _register_builtins(self):
        '''Register the default set of providers.'''
        if not os.getenv('ONYX_API_URL'):
            os.getenv('ONYX_API_URL')
            if not os.getenv('CLAWBOT_API_URL'):
                os.getenv('CLAWBOT_API_URL')
                if not os.getenv('LOCAL_LLM_URL'):
                    os.getenv('LOCAL_LLM_URL')
        onyx_base_url = 'http://localhost:11434/v1'
        if not os.getenv('ONYX_MODEL'):
            os.getenv('ONYX_MODEL')
            if not os.getenv('CLAWBOT_MODEL'):
                os.getenv('CLAWBOT_MODEL')
                if not os.getenv('LOCAL_LLM_MODEL'):
                    os.getenv('LOCAL_LLM_MODEL')
                    if not os.getenv('OLLAMA_MODEL'):
                        os.getenv('OLLAMA_MODEL')
        onyx_model = 'mistral:7b'
        self.register_provider(LLMProviderConfig(provider_id = 'openai_gpt', provider_type = ProviderType.OPENAI_COMPATIBLE, name = 'OpenAI GPT', base_url = 'https://api.openai.com/v1', api_key_env = 'OPENAI_API_KEY', default_model = 'gpt-4o-mini', available_models = [
            'gpt-4o-mini',
            'gpt-4o',
            'gpt-4-turbo',
            'gpt-3.5-turbo'], capabilities = [
            'allocation',
            'risk',
            'rebalance',
            'analysis'], cost_per_1k_tokens = 0.00015))
        self.register_provider(LLMProviderConfig(provider_id = 'clawbot', provider_type = ProviderType.CLAWBOT, name = 'Clawbot DeFi Agent', base_url = os.getenv('CLAWBOT_API_URL', 'http://localhost:8090/v1'), api_key_env = 'CLAWBOT_API_KEY', default_model = 'clawbot-defi-v1', available_models = [
            'clawbot-defi-v1'], capabilities = [
            'allocation',
            'risk',
            'rebalance',
            'mev_detection',
            'arb_detection'], cost_per_1k_tokens = 0))
        self.register_provider(LLMProviderConfig(provider_id = 'onyx', provider_type = ProviderType.OPENAI_COMPATIBLE, name = 'Onyx', base_url = onyx_base_url, api_key_env = 'ONYX_API_KEY', default_model = onyx_model, available_models = [
            onyx_model], capabilities = [
            'allocation',
            'risk',
            'rebalance',
            'mev_detection',
            'arb_detection'], cost_per_1k_tokens = 0))
        self.register_provider(LLMProviderConfig(provider_id = 'local_llm', provider_type = ProviderType.OPENAI_COMPATIBLE, name = 'Local LLM (Ollama/vLLM)', base_url = os.getenv('LOCAL_LLM_URL', 'http://localhost:11434/v1'), api_key_env = 'LOCAL_LLM_KEY', default_model = 'mistral:7b', available_models = [
            'mistral:7b',
            'llama3:8b',
            'codellama:13b'], capabilities = [
            'allocation',
            'risk'], cost_per_1k_tokens = 0))
        self.register_provider(LLMProviderConfig(provider_id = 'deterministic', provider_type = ProviderType.DETERMINISTIC, name = 'Deterministic Fallback', base_url = '', api_key_env = '', default_model = 'deterministic-v1', available_models = [
            'deterministic-v1'], capabilities = [
            'allocation',
            'risk'], cost_per_1k_tokens = 0))

    
    def _resolve_api_key(self = None, config = None):
        '''Resolve provider API key with backward-compatible aliases.'''
        primary = os.getenv(config.api_key_env, '').strip() if config.api_key_env else ''
        if primary:
            return primary
        if None.provider_id == 'onyx':
            return os.getenv('CLAWBOT_API_KEY', '').strip()
        if None.provider_id == 'clawbot':
            return os.getenv('ONYX_API_KEY', '').strip()

    
    def _requires_api_key(self = None, config = None):
        if config.provider_type == ProviderType.DETERMINISTIC:
            return False
        if config.provider_id in frozenset({'onyx', 'clawbot', 'local_llm'}):
            return False
        if not config.base_url:
            config.base_url
        base_url = str('').lower()
        if 'localhost' in base_url or '127.0.0.1' in base_url:
            return False
        return bool(config.api_key_env)

    
    def _availability_reason(self = None, config = None):
        '''Return a stable machine-readable reason when provider is unavailable.'''
        if config.provider_type == ProviderType.DETERMINISTIC:
            return None
        if not config.base_url:
            config.base_url
        if not str('').strip():
            return 'endpoint_not_configured'
        if not self._requires_api_key(config) and self._resolve_api_key(config):
            return f'''missing_api_key:{config.api_key_env}'''

    
    def _is_provider_available(self = None, config = None):
        return self._availability_reason(config) is None

    
    def register_provider(self = None, config = None):
        '''Register a new LLM provider.'''
        self._providers[config.provider_id] = config
        self._usage[config.provider_id] = ProviderUsageStats()
        logger.info(f'''Registered LLM provider: {config.name} ({config.provider_id})''')

    
    def get_provider(self = None, provider_id = None):
        '''Get provider config by ID.'''
        return self._providers.get(provider_id)

    
    def list_providers(self = None):
        '''List all registered providers with availability status.'''
        result = []
        for pid, config in self._providers.items():
            availability_reason = self._availability_reason(config)
            result.append({
                'provider_id': pid,
                'name': config.name,
                'type': config.provider_type.value,
                'default_model': config.default_model,
                'available_models': config.available_models,
                'capabilities': config.capabilities,
                'available': availability_reason is None,
                'availability_reason': availability_reason,
                'active': config.active,
                'config_hash': config.config_hash,
                'usage': {
                    'total_requests': self._usage[pid].total_requests,
                    'total_tokens': self._usage[pid].total_tokens,
                    'avg_latency_ms': self._usage[pid].avg_latency_ms } })
        return result

    
    def bind_agent(self = None, agent_id = None, provider_id = None):
        '''Bind an agent to a specific LLM provider. Returns config_hash for on-chain storage.'''
        if provider_id not in self._providers:
            raise ValueError(f'''Unknown provider: {provider_id}''')
        self._agent_bindings[agent_id] = provider_id
        return self._providers[provider_id].config_hash

    
    def get_agent_provider(self = None, agent_id = None):
        '''Get the provider bound to an agent.'''
        pid = self._agent_bindings.get(agent_id)
        if pid:
            return self._providers.get(pid)

    
    def _get_client(self = None, provider_id = None):
        '''Lazy-initialize an OpenAI-compatible client.'''
        if provider_id in self._clients:
            return (self._clients[provider_id], None)
        config = None._providers.get(provider_id)
        if not config:
            return (None, 'unknown_provider')
        if config.provider_type in (ProviderType.OPENAI_COMPATIBLE, ProviderType.CLAWBOT):
            OpenAI = OpenAI
            import openai
            if not self._resolve_api_key(config):
                self._resolve_api_key(config)
            api_key = 'sk-placeholder'
            client = OpenAI(api_key = api_key, base_url = config.base_url)
            self._clients[provider_id] = client
            return (client, None)
    # WARNING: Decompyle incomplete

    
    async def chat_completion(self, provider_id, messages = None, model = None, temperature = None, max_tokens = (None, None, None, None), response_format = ('provider_id', 'str', 'messages', 'list[dict[str, str]]', 'model', 'str | None', 'temperature', 'float | None', 'max_tokens', 'int | None', 'response_format', 'dict | None', 'return', 'LLMResponse')):
        '''Send a chat completion request to a specific provider.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def agent_chat(self = None, agent_id = None, messages = None, **kwargs):
        """Send a chat completion using the agent's bound provider."""
        pass
    # WARNING: Decompyle incomplete

    
    def _deterministic_response(self = None, messages = None, fallback_from = None, fallback_reason = (None, None)):
        '''Generate a deterministic response based on message content.'''
        last_msg = messages[-1]['content'] if messages else ''
        lower = last_msg.lower()
        if 'allocat' in lower or 'portfolio' in lower:
            content = json.dumps({
                'allocation': {
                    'vesu_lending': 0.4,
                    'jediswap_lp': 0.3,
                    'ekubo_lp': 0.3 },
                'reasoning': 'Balanced allocation: 40% lending for stability, 60% LP split for yield',
                'confidence': 0.75,
                'expected_apy': 0.12,
                'risk_assessment': 'Moderate risk with lending as safety anchor' })
        elif 'risk' in lower:
            content = json.dumps({
                'risk_score': 45,
                'risk_level': 'moderate',
                'reasoning': 'Portfolio shows moderate risk with adequate diversification',
                'recommendations': [
                    'Consider increasing lending allocation',
                    'Monitor IL on LP positions'] })
        elif 'rebalance' in lower:
            content = json.dumps({
                'should_rebalance': True,
                'actions': [
                    {
                        'from': 'jediswap_lp',
                        'to': 'vesu_lending',
                        'amount_pct': 10 }],
                'reasoning': 'Slight overexposure to LP risk, shift 10% to lending' })
        else:
            content = json.dumps({
                'response': 'Deterministic fallback: insufficient context for specific recommendation',
                'suggestion': 'Provide portfolio details or ask about allocation/risk/rebalance' })
        return LLMResponse(content = content, model = 'deterministic-v1', provider_id = 'deterministic', usage = {
            'prompt_tokens': 0,
            'completion_tokens': 0,
            'total_tokens': 0 }, latency_ms = 0, fallback_from = fallback_from, fallback_reason = fallback_reason)


_registry: 'LLMProviderRegistry | None' = None

def get_llm_registry():
    '''Get or create the global LLM provider registry.'''
    pass
# WARNING: Decompyle incomplete

