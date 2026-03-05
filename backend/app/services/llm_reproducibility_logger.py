"""
LLM Reproducibility Logging — records every LLM call's inputs, outputs,
and parameters for deterministic replay and audit.

Every LLM decision that affects fund movements is logged with:
  - Full prompt (system + user messages)
  - Model, temperature, seed, max_tokens
  - Raw response text
  - Parsed decision
  - Deterministic fallback model agreement
  - Proof pipeline result
  - SHA-256 hash of (prompt + response) for integrity verification

Stored in append-only JSON log files for audit trail.
When combined with the deterministic fallback MLP proof, this ensures:
  1. The LLM decision is recorded
  2. The fallback model agreed (and this agreement is EZKL-proven)
  3. The inputs can be replayed for verification
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

LOG_DIR = Path(__file__).resolve().parents[2] / "data" / "llm_logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class LLMCallRecord:
    """A single LLM call with full reproducibility data."""
    call_id: str
    timestamp: int
    # LLM configuration
    model: str                      # e.g., "gpt-4-turbo", "claude-3-opus"
    provider: str                   # e.g., "openai", "anthropic", "local"
    temperature: float
    seed: int | None
    max_tokens: int
    top_p: float
    # Inputs
    system_prompt: str
    user_prompt: str
    context_data: dict[str, Any]    # Structured context (pool data, user data, etc.)
    # Outputs
    raw_response: str
    parsed_decision: str            # "execute" | "reject" | "defer_to_human"
    confidence: float
    reasoning: str
    # Fallback agreement
    fallback_decision: str
    fallback_agreed: bool
    # Proof
    skill_name: str
    proof_hash: str
    # Integrity
    input_hash: str                 # SHA-256(system_prompt + user_prompt + context)
    output_hash: str                # SHA-256(raw_response)
    combined_hash: str              # SHA-256(input_hash + output_hash)
    # Performance
    latency_ms: float
    token_count_prompt: int
    token_count_response: int


class LLMReproducibilityLogger:
    """
    Append-only logger for LLM decisions with full reproducibility data.

    Every call is recorded with enough information to:
    1. Replay the exact same prompt to the same model
    2. Verify the fallback model agreed
    3. Trace back to the proof pipeline result
    """

    def __init__(self):
        self._log_file = LOG_DIR / f"llm_log_{datetime.utcnow().strftime('%Y%m%d')}.jsonl"
        self._records: list[LLMCallRecord] = []
        self._call_counter = 0

    def _next_call_id(self) -> str:
        self._call_counter += 1
        return f"llm_{int(time.time())}_{self._call_counter}"

    def _compute_hashes(
        self,
        system_prompt: str,
        user_prompt: str,
        context: dict,
        response: str,
    ) -> tuple[str, str, str]:
        """Compute integrity hashes for the call."""
        input_data = f"{system_prompt}\n{user_prompt}\n{json.dumps(context, sort_keys=True)}"
        input_hash = hashlib.sha256(input_data.encode()).hexdigest()
        output_hash = hashlib.sha256(response.encode()).hexdigest()
        combined_hash = hashlib.sha256(f"{input_hash}{output_hash}".encode()).hexdigest()
        return input_hash, output_hash, combined_hash

    def log_call(
        self,
        model: str,
        provider: str,
        system_prompt: str,
        user_prompt: str,
        raw_response: str,
        parsed_decision: str,
        *,
        temperature: float = 0.0,
        seed: int | None = None,
        max_tokens: int = 1024,
        top_p: float = 1.0,
        context_data: dict | None = None,
        confidence: float = 0.0,
        reasoning: str = "",
        fallback_decision: str = "",
        fallback_agreed: bool = False,
        skill_name: str = "",
        proof_hash: str = "",
        latency_ms: float = 0.0,
        token_count_prompt: int = 0,
        token_count_response: int = 0,
    ) -> LLMCallRecord:
        """
        Record an LLM call with full reproducibility data.

        Should be called after every LLM inference that affects fund movements.
        """
        context = context_data or {}
        input_hash, output_hash, combined_hash = self._compute_hashes(
            system_prompt, user_prompt, context, raw_response,
        )

        record = LLMCallRecord(
            call_id=self._next_call_id(),
            timestamp=int(time.time()),
            model=model,
            provider=provider,
            temperature=temperature,
            seed=seed,
            max_tokens=max_tokens,
            top_p=top_p,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            context_data=context,
            raw_response=raw_response,
            parsed_decision=parsed_decision,
            confidence=confidence,
            reasoning=reasoning,
            fallback_decision=fallback_decision,
            fallback_agreed=fallback_agreed,
            skill_name=skill_name,
            proof_hash=proof_hash,
            input_hash=input_hash,
            output_hash=output_hash,
            combined_hash=combined_hash,
            latency_ms=latency_ms,
            token_count_prompt=token_count_prompt,
            token_count_response=token_count_response,
        )

        self._records.append(record)
        self._persist(record)

        logger.info(
            "LLM call logged: %s model=%s decision=%s fallback_agreed=%s hash=%s",
            record.call_id, model, parsed_decision, fallback_agreed,
            combined_hash[:12],
        )

        return record

    def _persist(self, record: LLMCallRecord) -> None:
        """Append record to daily JSONL log file."""
        try:
            # Rotate log file if date changed
            today = datetime.utcnow().strftime('%Y%m%d')
            if today not in str(self._log_file):
                self._log_file = LOG_DIR / f"llm_log_{today}.jsonl"

            with open(self._log_file, "a") as f:
                # Don't log full prompts to disk by default (privacy)
                minimal = asdict(record)
                if os.getenv("LLM_LOG_FULL_PROMPTS", "").lower() not in ("true", "1"):
                    minimal["system_prompt"] = f"[{len(record.system_prompt)} chars]"
                    minimal["user_prompt"] = f"[{len(record.user_prompt)} chars]"
                    minimal["raw_response"] = f"[{len(record.raw_response)} chars]"
                f.write(json.dumps(minimal, default=str) + "\n")
        except Exception as e:
            logger.warning("Failed to persist LLM log: %s", e)

    def get_recent_calls(self, limit: int = 50) -> list[dict]:
        """Get recent LLM calls (summary only)."""
        return [
            {
                "call_id": r.call_id,
                "timestamp": r.timestamp,
                "model": r.model,
                "decision": r.parsed_decision,
                "fallback_agreed": r.fallback_agreed,
                "combined_hash": r.combined_hash[:16] + "...",
                "latency_ms": r.latency_ms,
            }
            for r in self._records[-limit:]
        ]

    def get_call_by_id(self, call_id: str) -> LLMCallRecord | None:
        """Retrieve a specific call record."""
        for r in reversed(self._records):
            if r.call_id == call_id:
                return r
        return None

    def get_disagreements(self) -> list[dict]:
        """Get all calls where the LLM and fallback model disagreed."""
        return [
            {
                "call_id": r.call_id,
                "timestamp": r.timestamp,
                "model": r.model,
                "llm_decision": r.parsed_decision,
                "fallback_decision": r.fallback_decision,
                "skill": r.skill_name,
            }
            for r in self._records
            if not r.fallback_agreed
        ]

    def get_stats(self) -> dict:
        """Get summary statistics."""
        if not self._records:
            return {"total_calls": 0}

        total = len(self._records)
        agreements = sum(1 for r in self._records if r.fallback_agreed)
        decisions = {}
        for r in self._records:
            decisions[r.parsed_decision] = decisions.get(r.parsed_decision, 0) + 1

        return {
            "total_calls": total,
            "agreement_rate": round(agreements / total, 3) if total else 0,
            "disagreements": total - agreements,
            "decision_distribution": decisions,
            "unique_models": list(set(r.model for r in self._records)),
            "avg_latency_ms": round(
                sum(r.latency_ms for r in self._records) / total, 1
            ) if total else 0,
        }


# ── Singleton ─────────────────────────────────────────────────────────
_logger_instance: LLMReproducibilityLogger | None = None


def get_llm_logger() -> LLMReproducibilityLogger:
    global _logger_instance
    if _logger_instance is None:
        _logger_instance = LLMReproducibilityLogger()
    return _logger_instance
