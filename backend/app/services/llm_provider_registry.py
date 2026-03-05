"""
LLM Provider Registry — Manages multiple LLM backends for identity-bound agents.

Supports:
  - OpenAI-compatible APIs (GPT-4, GPT-3.5-turbo, Mistral, Llama via vLLM/Ollama)
  - Clawbot adapter (custom DeFi-specific model)
  - Deterministic fallback (always available, no API key needed)

Each agent can bind to a specific provider+model combination.
The registry handles routing, fallback, and usage tracking.
"""

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


class ProviderType(str, Enum):
    OPENAI_COMPATIBLE = "openai_compatible"
    CLAWBOT = "clawbot"
    DETERMINISTIC = "deterministic"


@dataclass
class LLMProviderConfig:
    """Configuration for an LLM provider."""
    provider_id: str
    provider_type: ProviderType
    name: str
    base_url: str                     # API endpoint
    api_key_env: str                  # Env var name for API key
    default_model: str                # Default model identifier
    max_tokens: int = 2048
    temperature: float = 0.2
    available_models: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)  # e.g., ["allocation", "risk", "rebalance"]
    cost_per_1k_tokens: float = 0.0   # For tracking
    active: bool = True

    @property
    def config_hash(self) -> str:
        """Deterministic hash for on-chain identity binding."""
        payload = json.dumps({
            "provider_id": self.provider_id,
            "provider_type": self.provider_type.value,
            "base_url": self.base_url,
            "default_model": self.default_model,
        }, sort_keys=True)
        return "0x" + hashlib.sha256(payload.encode()).hexdigest()[:32]


@dataclass
class LLMResponse:
    """Standardized response from any LLM provider."""
    content: str
    model: str
    provider_id: str
    usage: dict[str, int]        # {"prompt_tokens": N, "completion_tokens": N, "total_tokens": N}
    latency_ms: int
    fallback_from: str | None = None
    fallback_reason: str | None = None
    raw_response: dict[str, Any] | None = None


@dataclass
class ProviderUsageStats:
    """Track usage per provider."""
    total_requests: int = 0
    total_tokens: int = 0
    total_errors: int = 0
    avg_latency_ms: float = 0.0
    last_used: float = 0.0


class LLMProviderRegistry:
    """Registry of LLM providers with routing and fallback."""

    def __init__(self):
        self._providers: dict[str, LLMProviderConfig] = {}
        self._clients: dict[str, Any] = {}  # Lazy-initialized API clients
        self._usage: dict[str, ProviderUsageStats] = {}
        self._agent_bindings: dict[str, str] = {}  # agent_id → provider_id

        # Register built-in providers
        self._register_builtins()

    def _register_builtins(self):
        """Register the default set of providers."""
        onyx_base_url = (
            os.getenv("ONYX_API_URL")
            or os.getenv("CLAWBOT_API_URL")
            or os.getenv("LOCAL_LLM_URL")
            or "http://localhost:11434/v1"
        )
        onyx_model = (
            os.getenv("ONYX_MODEL")
            or os.getenv("CLAWBOT_MODEL")
            or os.getenv("LOCAL_LLM_MODEL")
            or os.getenv("OLLAMA_MODEL")
            or "mistral:7b"
        )

        # OpenAI GPT
        self.register_provider(LLMProviderConfig(
            provider_id="openai_gpt",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            name="OpenAI GPT",
            base_url="https://api.openai.com/v1",
            api_key_env="OPENAI_API_KEY",
            default_model="gpt-4o-mini",
            available_models=["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
            capabilities=["allocation", "risk", "rebalance", "analysis"],
            cost_per_1k_tokens=0.00015,
        ))

        # Clawbot — custom DeFi model
        self.register_provider(LLMProviderConfig(
            provider_id="clawbot",
            provider_type=ProviderType.CLAWBOT,
            name="Clawbot DeFi Agent",
            base_url=os.getenv("CLAWBOT_API_URL", "http://localhost:8090/v1"),
            api_key_env="CLAWBOT_API_KEY",
            default_model="clawbot-defi-v1",
            available_models=["clawbot-defi-v1"],
            capabilities=["allocation", "risk", "rebalance", "mev_detection", "arb_detection"],
            cost_per_1k_tokens=0.0,
        ))

        # Onyx — OpenAI-compatible endpoint (preferred naming over legacy clawbot)
        self.register_provider(LLMProviderConfig(
            provider_id="onyx",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            name="Onyx",
            base_url=onyx_base_url,
            api_key_env="ONYX_API_KEY",
            default_model=onyx_model,
            available_models=[onyx_model],
            capabilities=["allocation", "risk", "rebalance", "mev_detection", "arb_detection"],
            cost_per_1k_tokens=0.0,
        ))

        # Local Ollama/vLLM (OpenAI-compatible)
        self.register_provider(LLMProviderConfig(
            provider_id="local_llm",
            provider_type=ProviderType.OPENAI_COMPATIBLE,
            name="Local LLM (Ollama/vLLM)",
            base_url=os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1"),
            api_key_env="LOCAL_LLM_KEY",
            default_model="mistral:7b",
            available_models=["mistral:7b", "llama3:8b", "codellama:13b"],
            capabilities=["allocation", "risk"],
            cost_per_1k_tokens=0.0,
        ))

        # Deterministic fallback (always available)
        self.register_provider(LLMProviderConfig(
            provider_id="deterministic",
            provider_type=ProviderType.DETERMINISTIC,
            name="Deterministic Fallback",
            base_url="",
            api_key_env="",
            default_model="deterministic-v1",
            available_models=["deterministic-v1"],
            capabilities=["allocation", "risk"],
            cost_per_1k_tokens=0.0,
        ))

    def _resolve_api_key(self, config: LLMProviderConfig) -> str:
        """Resolve provider API key with backward-compatible aliases."""
        primary = os.getenv(config.api_key_env, "").strip() if config.api_key_env else ""
        if primary:
            return primary

        # Keep legacy clawbot/onyx configs interoperable.
        if config.provider_id == "onyx":
            return os.getenv("CLAWBOT_API_KEY", "").strip()
        if config.provider_id == "clawbot":
            return os.getenv("ONYX_API_KEY", "").strip()
        return ""

    def _requires_api_key(self, config: LLMProviderConfig) -> bool:
        if config.provider_type == ProviderType.DETERMINISTIC:
            return False
        # Local-style runtimes often run without auth.
        if config.provider_id in {"local_llm", "onyx", "clawbot"}:
            return False
        base_url = str(config.base_url or "").lower()
        if "localhost" in base_url or "127.0.0.1" in base_url:
            return False
        return bool(config.api_key_env)

    def _availability_reason(self, config: LLMProviderConfig) -> str | None:
        """Return a stable machine-readable reason when provider is unavailable."""
        if config.provider_type == ProviderType.DETERMINISTIC:
            return None

        if not str(config.base_url or "").strip():
            return "endpoint_not_configured"

        if self._requires_api_key(config) and not self._resolve_api_key(config):
            return f"missing_api_key:{config.api_key_env}"

        return None

    def _is_provider_available(self, config: LLMProviderConfig) -> bool:
        return self._availability_reason(config) is None

    def register_provider(self, config: LLMProviderConfig) -> None:
        """Register a new LLM provider."""
        self._providers[config.provider_id] = config
        self._usage[config.provider_id] = ProviderUsageStats()
        logger.info(f"Registered LLM provider: {config.name} ({config.provider_id})")

    def get_provider(self, provider_id: str) -> LLMProviderConfig | None:
        """Get provider config by ID."""
        return self._providers.get(provider_id)

    def list_providers(self) -> list[dict[str, Any]]:
        """List all registered providers with availability status."""
        result = []
        for pid, config in self._providers.items():
            availability_reason = self._availability_reason(config)
            result.append({
                "provider_id": pid,
                "name": config.name,
                "type": config.provider_type.value,
                "default_model": config.default_model,
                "available_models": config.available_models,
                "capabilities": config.capabilities,
                "available": availability_reason is None,
                "availability_reason": availability_reason,
                "active": config.active,
                "config_hash": config.config_hash,
                "usage": {
                    "total_requests": self._usage[pid].total_requests,
                    "total_tokens": self._usage[pid].total_tokens,
                    "avg_latency_ms": self._usage[pid].avg_latency_ms,
                },
            })
        return result

    def bind_agent(self, agent_id: str, provider_id: str) -> str:
        """Bind an agent to a specific LLM provider. Returns config_hash for on-chain storage."""
        if provider_id not in self._providers:
            raise ValueError(f"Unknown provider: {provider_id}")
        self._agent_bindings[agent_id] = provider_id
        return self._providers[provider_id].config_hash

    def get_agent_provider(self, agent_id: str) -> LLMProviderConfig | None:
        """Get the provider bound to an agent."""
        pid = self._agent_bindings.get(agent_id)
        if pid:
            return self._providers.get(pid)
        return None

    def _get_client(self, provider_id: str) -> tuple[Any | None, str | None]:
        """Lazy-initialize an OpenAI-compatible client."""
        if provider_id in self._clients:
            return self._clients[provider_id], None

        config = self._providers.get(provider_id)
        if not config:
            return None, "unknown_provider"

        if config.provider_type in (ProviderType.OPENAI_COMPATIBLE, ProviderType.CLAWBOT):
            try:
                from openai import OpenAI
                api_key = self._resolve_api_key(config) or "sk-placeholder"
                client = OpenAI(
                    api_key=api_key,
                    base_url=config.base_url,
                )
                self._clients[provider_id] = client
                return client, None
            except ImportError:
                logger.warning("openai package not installed")
                return None, "openai_package_missing"
            except Exception as exc:
                logger.warning("Failed to initialize provider client %s: %s", provider_id, exc)
                return None, f"client_init_failed:{type(exc).__name__}"

        return None, "unsupported_provider_type"

    async def chat_completion(
        self,
        provider_id: str,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict | None = None,
    ) -> LLMResponse:
        """Send a chat completion request to a specific provider."""
        config = self._providers.get(provider_id)
        if not config:
            raise ValueError(f"Unknown provider: {provider_id}")

        if config.provider_type == ProviderType.DETERMINISTIC:
            return self._deterministic_response(messages)

        availability_reason = self._availability_reason(config)
        if availability_reason is not None:
            logger.warning("Provider %s unavailable (%s), falling back to deterministic", provider_id, availability_reason)
            return self._deterministic_response(
                messages,
                fallback_from=provider_id,
                fallback_reason=availability_reason,
            )

        t0 = time.monotonic()
        model = model or config.default_model
        temperature = temperature if temperature is not None else config.temperature
        max_tokens = max_tokens or config.max_tokens

        client, client_error = self._get_client(provider_id)
        if not client:
            logger.warning(f"No client for {provider_id}, falling back to deterministic")
            return self._deterministic_response(
                messages,
                fallback_from=provider_id,
                fallback_reason=client_error or "client_unavailable",
            )

        try:
            import asyncio
            loop = asyncio.get_event_loop()

            kwargs: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if response_format:
                kwargs["response_format"] = response_format

            response = await loop.run_in_executor(
                None,
                lambda: client.chat.completions.create(**kwargs),
            )

            latency = int((time.monotonic() - t0) * 1000)
            content = response.choices[0].message.content
            usage = {
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                "total_tokens": response.usage.total_tokens if response.usage else 0,
            }

            # Update stats
            stats = self._usage[provider_id]
            stats.total_requests += 1
            stats.total_tokens += usage["total_tokens"]
            stats.avg_latency_ms = (
                (stats.avg_latency_ms * (stats.total_requests - 1) + latency)
                / stats.total_requests
            )
            stats.last_used = time.time()

            return LLMResponse(
                content=content,
                model=model,
                provider_id=provider_id,
                usage=usage,
                latency_ms=latency,
            )

        except Exception as exc:
            logger.error(f"LLM call failed for {provider_id}: {exc}")
            self._usage[provider_id].total_errors += 1
            # Fallback to deterministic
            reason = f"provider_error:{type(exc).__name__}"
            detail = str(exc).strip()
            if detail:
                reason = f"{reason}:{detail[:160]}"
            return self._deterministic_response(
                messages,
                fallback_from=provider_id,
                fallback_reason=reason,
            )

    async def agent_chat(
        self,
        agent_id: str,
        messages: list[dict[str, str]],
        **kwargs,
    ) -> LLMResponse:
        """Send a chat completion using the agent's bound provider."""
        pid = self._agent_bindings.get(agent_id, "onyx")
        return await self.chat_completion(pid, messages, **kwargs)

    def _deterministic_response(
        self,
        messages: list[dict[str, str]],
        fallback_from: str | None = None,
        fallback_reason: str | None = None,
    ) -> LLMResponse:
        """Generate a deterministic response based on message content."""
        last_msg = messages[-1]["content"] if messages else ""
        lower = last_msg.lower()

        # Match intent
        if "allocat" in lower or "portfolio" in lower:
            content = json.dumps({
                "allocation": {"vesu_lending": 0.40, "jediswap_lp": 0.30, "ekubo_lp": 0.30},
                "reasoning": "Balanced allocation: 40% lending for stability, 60% LP split for yield",
                "confidence": 0.75,
                "expected_apy": 0.12,
                "risk_assessment": "Moderate risk with lending as safety anchor",
            })
        elif "risk" in lower:
            content = json.dumps({
                "risk_score": 45,
                "risk_level": "moderate",
                "reasoning": "Portfolio shows moderate risk with adequate diversification",
                "recommendations": ["Consider increasing lending allocation", "Monitor IL on LP positions"],
            })
        elif "rebalance" in lower:
            content = json.dumps({
                "should_rebalance": True,
                "actions": [
                    {"from": "jediswap_lp", "to": "vesu_lending", "amount_pct": 10},
                ],
                "reasoning": "Slight overexposure to LP risk, shift 10% to lending",
            })
        else:
            content = json.dumps({
                "response": "Deterministic fallback: insufficient context for specific recommendation",
                "suggestion": "Provide portfolio details or ask about allocation/risk/rebalance",
            })

        return LLMResponse(
            content=content,
            model="deterministic-v1",
            provider_id="deterministic",
            usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            latency_ms=0,
            fallback_from=fallback_from,
            fallback_reason=fallback_reason,
        )


# Module-level singleton
_registry: LLMProviderRegistry | None = None


def get_llm_registry() -> LLMProviderRegistry:
    """Get or create the global LLM provider registry."""
    global _registry
    if _registry is None:
        _registry = LLMProviderRegistry()
    return _registry
