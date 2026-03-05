"""
Agent Orchestrator — The brain that connects LLM reasoning to ZK circuit execution.

This is the core loop for identity-bound agents:
  1. Receive a goal (e.g., "optimize my portfolio yield")
  2. Ask the LLM to reason about which skills to use
  3. Execute chosen skills (ZK proofs) in sequence
  4. Feed results back to LLM for final decision
  5. Record performance and emit receipts

The orchestrator enforces identity binding:
  - Only the agent's bound LLM provider is used
  - Only the agent's bound skills can execute
  - All proofs are tied to the agent's identity commitment
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from .llm_provider_registry import get_llm_registry, LLMResponse
from .agent_skill_service import get_skill_service
from .receipt_service import ReceiptService
from .agent_store import get_agent_store
from .onchain_agent_service import get_onchain_agent_service

logger = logging.getLogger(__name__)

# Proof TTL — proofs older than this are considered stale
PROOF_TTL_SECONDS = 300  # 5 minutes


@dataclass
class AgentConfig:
    """In-memory agent configuration (mirrors on-chain AgentMetadata)."""
    agent_id: str
    owner_address: str
    name: str
    identity_commitment: str
    reputation_tier: int = 0
    bound_skills: list[str] = field(default_factory=list)
    llm_provider_id: str = "onyx"
    llm_model: str | None = None
    active: bool = True


@dataclass
class OrchestrationStep:
    """A single step in the orchestration pipeline."""
    step_type: str   # "llm_reasoning", "skill_execution", "llm_synthesis"
    skill_id: str | None = None
    input_params: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    duration_ms: int = 0
    success: bool = False


@dataclass
class OrchestrationResult:
    """Full result of an orchestration run."""
    agent_id: str
    goal: str
    steps: list[OrchestrationStep] = field(default_factory=list)
    final_decision: dict[str, Any] | None = None
    total_duration_ms: int = 0
    all_proofs_pass: bool = False
    llm_tokens_used: int = 0
    error: str | None = None
    llm_provider_used: str = "unknown"
    llm_fallback_reason: str | None = None


AGENT_SYSTEM_PROMPT = """You are an identity-bound DeFi optimization agent on Starknet.
You have access to ZK circuit "skills" as tools. When you use a skill, it generates
a verifiable zero-knowledge proof on-chain.

Your identity is bound to an NFT and your decisions build your on-chain reputation.

When given a goal:
1. Analyze what needs to happen
2. Call the appropriate tools/skills
3. Based on tool results, make a final recommendation

Always prefer verifiable (ZK-proven) decisions over unverified ones.
Be specific about amounts, percentages, and reasoning.

Respond in JSON format for structured decisions."""


class AgentOrchestrator:
    """Orchestrates LLM reasoning + ZK skill execution for identity-bound agents."""

    def __init__(self):
        self._registry = get_llm_registry()
        self._skill_service = get_skill_service()
        self._receipt_service = ReceiptService()
        self._store = get_agent_store()
        self._onchain = get_onchain_agent_service()
        # Load LLM bindings from DB into registry on startup
        for agent_id, provider_id in self._store.list_bindings().items():
            self._registry.bind_agent(agent_id, provider_id)

    def register_agent(self, config: AgentConfig) -> dict:
        """Register an agent configuration — persisted to SQLite + minted on-chain."""
        # Persist to SQLite
        self._store.save_agent({
            "agent_id": config.agent_id,
            "owner_address": config.owner_address,
            "name": config.name,
            "identity_commitment": config.identity_commitment,
            "reputation_tier": config.reputation_tier,
            "bound_skills": config.bound_skills,
            "llm_provider_id": config.llm_provider_id,
            "llm_model": config.llm_model,
            "active": config.active,
        })
        # Bind to LLM provider (in-memory + persisted)
        config_hash = self._registry.bind_agent(config.agent_id, config.llm_provider_id)
        self._store.save_binding(config.agent_id, config.llm_provider_id, config_hash)
        logger.info(f"Registered agent {config.name} ({config.agent_id}) "
                    f"with {len(config.bound_skills)} skills, LLM: {config.llm_provider_id}")

        # Mint on-chain (fire-and-forget via asyncio)
        onchain_result = {"minted": False}
        if self._onchain.available:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor() as pool:
                        mint_result = pool.submit(
                            lambda: asyncio.run(self._onchain.mint_agent(
                                name=config.name,
                                identity_commitment=config.identity_commitment,
                                model_ids=[config.llm_model or "onyx-defi-v1"],
                            ))
                        ).result(timeout=60)
                else:
                    mint_result = loop.run_until_complete(self._onchain.mint_agent(
                        name=config.name,
                        identity_commitment=config.identity_commitment,
                        model_ids=[config.llm_model or "onyx-defi-v1"],
                    ))
                onchain_result = mint_result
                if mint_result.get("success"):
                    logger.info(f"Agent minted on-chain: {mint_result.get('tx_hash')}")
                else:
                    logger.warning(f"On-chain mint failed (non-blocking): {mint_result.get('error')}")
            except Exception as exc:
                logger.warning(f"On-chain mint error (non-blocking): {exc}")
                onchain_result = {"minted": False, "error": str(exc)}
        else:
            logger.info("On-chain minting skipped — service not available")

        return {"config_hash": config_hash, "onchain": onchain_result}

    def get_agent(self, agent_id: str) -> AgentConfig | None:
        """Get agent config from SQLite."""
        row = self._store.get_agent(agent_id)
        if not row:
            return None
        return AgentConfig(
            agent_id=row["agent_id"],
            owner_address=row["owner_address"],
            name=row["name"],
            identity_commitment=row.get("identity_commitment", "0"),
            reputation_tier=row.get("reputation_tier", 0),
            bound_skills=row.get("bound_skills", []),
            llm_provider_id=row.get("llm_provider_id", "onyx"),
            llm_model=row.get("llm_model"),
            active=row.get("active", True),
        )

    def list_agents(self, owner: str | None = None) -> list[dict[str, Any]]:
        """List all registered agents from SQLite."""
        rows = self._store.list_agents(owner=owner)
        return [
            {
                "agent_id": r["agent_id"],
                "name": r["name"],
                "owner": r["owner_address"],
                "tier": r.get("reputation_tier", 0),
                "skills": r.get("bound_skills", []),
                "llm_provider": r.get("llm_provider_id", "onyx"),
                "active": r.get("active", True),
                "created_at": r.get("created_at"),
            }
            for r in rows
        ]

    def update_agent(self, agent_id: str, updates: dict[str, Any]) -> bool:
        """Update an existing agent.  Returns True if the agent existed."""
        ok = self._store.update_agent(agent_id, updates)
        # If LLM provider changed, re-bind
        if ok and "llm_provider_id" in updates:
            pid = updates["llm_provider_id"]
            config_hash = self._registry.bind_agent(agent_id, pid)
            self._store.save_binding(agent_id, pid, config_hash)
        return ok

    def delete_agent(self, agent_id: str) -> bool:
        """Delete an agent and all related data.  Returns True if the agent existed."""
        return self._store.delete_agent(agent_id)

    async def execute_goal(
        self,
        agent_id: str,
        goal: str,
        context: dict[str, Any] | None = None,
    ) -> OrchestrationResult:
        """Execute a goal using the agent's LLM + ZK skills pipeline.

        Flow:
          1. LLM Reasoning — decide which skills to invoke and with what parameters
          2. Skill Execution — run each skill (ZK proof generation)
          3. LLM Synthesis — give results back to LLM for final decision
        """
        t0 = time.monotonic()
        result = OrchestrationResult(agent_id=agent_id, goal=goal)

        agent = self.get_agent(agent_id)
        if not agent:
            result.error = f"Agent not found: {agent_id}"
            return result

        if not agent.active:
            result.error = f"Agent is deactivated: {agent_id}"
            return result

        # Get available tools for this agent
        tools = self._skill_service.get_skill_tools_for_llm(agent.bound_skills)

        try:
            # ── Step 1: LLM Reasoning ──────────────────────────────────
            reasoning_step = await self._llm_reasoning(agent, goal, context, tools)
            result.steps.append(reasoning_step)
            result.llm_tokens_used += reasoning_step.result.get("tokens_used", 0) if reasoning_step.result else 0

            # Track which provider actually ran
            if reasoning_step.result:
                provider_used = str(reasoning_step.result.get("provider_id") or "")
                if provider_used:
                    result.llm_provider_used = provider_used

                fallback_reason = reasoning_step.result.get("fallback_reason")
                fallback_from = reasoning_step.result.get("fallback_from")
                if fallback_reason:
                    if fallback_from:
                        result.llm_fallback_reason = f"{fallback_from}: {fallback_reason}"
                    else:
                        result.llm_fallback_reason = str(fallback_reason)
                else:
                    # Backward-compatible fallback inference for older responses.
                    model_used = reasoning_step.result.get("model", "")
                    if model_used == "deterministic-v1" and agent.llm_provider_id != "deterministic":
                        result.llm_fallback_reason = f"Fell back from {agent.llm_provider_id}"

            if not reasoning_step.success:
                result.error = f"LLM reasoning failed: {reasoning_step.result}"
                result.total_duration_ms = int((time.monotonic() - t0) * 1000)
                return result

            # Parse skill invocations from LLM response
            skill_calls = self._parse_skill_calls(reasoning_step.result)

            # ── Step 2: Execute Skills ─────────────────────────────────
            proof_results = []
            all_pass = True

            for call in skill_calls:
                skill_step = await self._execute_skill_step(
                    agent, call["skill_id"], call["params"]
                )
                result.steps.append(skill_step)
                proof_results.append(skill_step.result)

                if not skill_step.success:
                    all_pass = False

            result.all_proofs_pass = all_pass

            # ── Step 3: LLM Synthesis ──────────────────────────────────
            synthesis_step = await self._llm_synthesis(
                agent, goal, proof_results, context
            )
            result.steps.append(synthesis_step)
            result.llm_tokens_used += synthesis_step.result.get("tokens_used", 0) if synthesis_step.result else 0

            # Extract final decision
            if synthesis_step.success and synthesis_step.result:
                result.final_decision = synthesis_step.result.get("decision")

        except Exception as exc:
            logger.error(f"Orchestration error for agent {agent_id}: {exc}")
            result.error = str(exc)

        result.total_duration_ms = int((time.monotonic() - t0) * 1000)

        # Emit receipt
        self._emit_receipt(result)

        return result

    async def _llm_reasoning(
        self,
        agent: AgentConfig,
        goal: str,
        context: dict[str, Any] | None,
        tools: list[dict[str, Any]],
    ) -> OrchestrationStep:
        """Step 1: Ask LLM to reason about which skills to use."""
        step = OrchestrationStep(step_type="llm_reasoning")
        t0 = time.monotonic()

        messages = [
            {"role": "system", "content": AGENT_SYSTEM_PROMPT},
            {"role": "user", "content": self._build_reasoning_prompt(goal, context, tools)},
        ]

        try:
            response: LLMResponse = await self._registry.agent_chat(
                agent.agent_id, messages, model=agent.llm_model
            )
            step.result = {
                "content": response.content,
                "model": response.model,
                "provider_id": response.provider_id,
                "fallback_from": response.fallback_from,
                "fallback_reason": response.fallback_reason,
                "tokens_used": response.usage.get("total_tokens", 0),
            }
            step.success = True
        except Exception as exc:
            step.result = {"error": str(exc)}
            step.success = False

        step.duration_ms = int((time.monotonic() - t0) * 1000)
        return step

    async def _execute_skill_step(
        self,
        agent: AgentConfig,
        skill_id: str,
        params: dict[str, Any],
    ) -> OrchestrationStep:
        """Step 2: Execute a single skill (ZK proof).

        Includes:
          - Identity binding check (skill must be bound to agent)
          - Proof generation via circuit_scanner
          - Proof TTL tagging (for staleness checks downstream)
        """
        step = OrchestrationStep(
            step_type="skill_execution",
            skill_id=skill_id,
            input_params=params,
        )

        # Verify agent has this skill bound
        if agent.bound_skills and skill_id not in agent.bound_skills:
            step.result = {"error": f"Skill {skill_id} not bound to agent"}
            step.success = False
            return step

        user_addr = int(agent.owner_address, 16) if agent.owner_address.startswith("0x") else 0

        proof_result = await self._skill_service.execute_skill(
            skill_id, params, user_address=user_addr
        )

        # Tag proof with timestamp for TTL enforcement
        proof_result["proof_generated_at"] = time.time()
        proof_result["proof_ttl_seconds"] = PROOF_TTL_SECONDS

        step.result = proof_result
        step.success = proof_result.get("success", False)
        step.duration_ms = proof_result.get("duration_ms", 0)
        return step

    async def _llm_synthesis(
        self,
        agent: AgentConfig,
        goal: str,
        proof_results: list[dict[str, Any]],
        context: dict[str, Any] | None,
    ) -> OrchestrationStep:
        """Step 3: Give proof results back to LLM for final decision."""
        step = OrchestrationStep(step_type="llm_synthesis")
        t0 = time.monotonic()

        proof_summary = []
        now = time.time()
        for pr in proof_results:
            if pr:
                # Check proof staleness
                generated_at = pr.get("proof_generated_at", now)
                ttl = pr.get("proof_ttl_seconds", PROOF_TTL_SECONDS)
                is_stale = (now - generated_at) > ttl

                proof_summary.append({
                    "skill": pr.get("skill_id", "unknown"),
                    "passed": pr.get("is_compliant"),
                    "proof_hash": pr.get("proof_hash"),
                    "success": pr.get("success"),
                    "stale": is_stale,
                })

        messages = [
            {"role": "system", "content": AGENT_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({
                "goal": goal,
                "proof_results": proof_summary,
                "context": context,
                "instruction": "Based on the ZK proof results, provide your final decision as JSON with keys: "
                              "'action' (what to do), 'confidence' (0-1), 'reasoning' (why), "
                              "'verified_claims' (list of what was proven).",
            })},
        ]

        try:
            response: LLMResponse = await self._registry.agent_chat(
                agent.agent_id, messages, model=agent.llm_model
            )

            # Try to parse as JSON
            try:
                decision = json.loads(response.content)
            except json.JSONDecodeError:
                decision = {"raw_response": response.content}

            step.result = {
                "decision": decision,
                "model": response.model,
                "provider_id": response.provider_id,
                "fallback_from": response.fallback_from,
                "fallback_reason": response.fallback_reason,
                "tokens_used": response.usage.get("total_tokens", 0),
            }
            step.success = True
        except Exception as exc:
            step.result = {"error": str(exc)}
            step.success = False

        step.duration_ms = int((time.monotonic() - t0) * 1000)
        return step

    def _build_reasoning_prompt(
        self,
        goal: str,
        context: dict[str, Any] | None,
        tools: list[dict[str, Any]],
    ) -> str:
        """Build the reasoning prompt for the LLM."""
        tool_descriptions = []
        for t in tools:
            fn = t.get("function", {})
            tool_descriptions.append(f"- {fn.get('name')}: {fn.get('description')}")

        return json.dumps({
            "goal": goal,
            "available_tools": tool_descriptions,
            "context": context or {},
            "instruction": "Analyze the goal and decide which tools to invoke. "
                          "Return JSON with 'skill_calls': [{'skill_id': '...', 'params': {...}}, ...]. "
                          "Each skill_id should match one of the available tools (without the 'zk_' prefix).",
        })

    def _parse_skill_calls(self, reasoning_result: dict[str, Any]) -> list[dict[str, Any]]:
        """Parse skill invocation requests from LLM reasoning output."""
        content = reasoning_result.get("content", "")

        try:
            parsed = json.loads(content)
            calls = parsed.get("skill_calls", [])
            if isinstance(calls, list):
                return [
                    {"skill_id": c.get("skill_id", ""), "params": c.get("params", {})}
                    for c in calls
                    if isinstance(c, dict)
                ]
        except (json.JSONDecodeError, AttributeError):
            pass

        # Fallback: try to extract from text
        logger.warning("Could not parse skill_calls from LLM output, using defaults")
        return [{"skill_id": "risk_score", "params": {}}]

    def _emit_receipt(self, result: OrchestrationResult) -> None:
        """Emit an orchestration receipt for audit trail."""
        try:
            proof_hashes = []
            for step in result.steps:
                if step.step_type == "skill_execution" and step.result:
                    ph = step.result.get("proof_hash")
                    if ph:
                        proof_hashes.append(ph)

            agent = self.get_agent(result.agent_id)
            owner = agent.owner_address if agent else "unknown"

            import json as _json
            details = {
                "goal": result.goal,
                "steps": len(result.steps),
                "proofs_generated": len(proof_hashes),
                "all_pass": result.all_proofs_pass,
                "tokens_used": result.llm_tokens_used,
                "duration_ms": result.total_duration_ms,
                "proof_hashes": proof_hashes,
            }

            self._receipt_service.append_proof_receipt(
                user_address=owner,
                proof_type="agent_orchestration",
                threshold_or_model=f"agent:{result.agent_id}",
                result=f"{'pass' if result.all_proofs_pass else 'fail'}:{_json.dumps(details, separators=(',', ':'))}",
                snapshot_hash=proof_hashes[0] if proof_hashes else None,
            )
        except Exception as exc:
            logger.error(f"Failed to emit receipt: {exc}")


# Module-level singleton
_orchestrator: AgentOrchestrator | None = None


def get_orchestrator() -> AgentOrchestrator:
    """Get or create the global agent orchestrator."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = AgentOrchestrator()
    return _orchestrator
