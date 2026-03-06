# Source Generated with Decompyle++
# File: agent_orchestrator.cpython-312.pyc (Python 3.12)

'''
Agent Orchestrator — The brain that connects LLM reasoning to ZK circuit execution.

This is the core loop for identity-bound agents:
  1. Receive a goal (e.g., "optimize my portfolio yield")
  2. Ask the LLM to reason about which skills to use
  3. Execute chosen skills (ZK proofs) in sequence
  4. Feed results back to LLM for final decision
  5. Record performance and emit receipts

The orchestrator enforces identity binding:
  - Only the agent\'s bound LLM provider is used
  - Only the agent\'s bound skills can execute
  - All proofs are tied to the agent\'s identity commitment
'''
from __future__ import annotations
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any
from llm_provider_registry import get_llm_registry, LLMResponse
from agent_skill_service import get_skill_service
from receipt_service import ReceiptService
from agent_store import get_agent_store
from onchain_agent_service import get_onchain_agent_service
logger = logging.getLogger(__name__)
PROOF_TTL_SECONDS = 300
AgentConfig = <NODE:12>()
OrchestrationStep = <NODE:12>()
OrchestrationResult = <NODE:12>()
AGENT_SYSTEM_PROMPT = 'You are an identity-bound DeFi optimization agent on Starknet.\nYou have access to ZK circuit "skills" as tools. When you use a skill, it generates\na verifiable zero-knowledge proof on-chain.\n\nYour identity is bound to an NFT and your decisions build your on-chain reputation.\n\nWhen given a goal:\n1. Analyze what needs to happen\n2. Call the appropriate tools/skills\n3. Based on tool results, make a final recommendation\n\nAlways prefer verifiable (ZK-proven) decisions over unverified ones.\nBe specific about amounts, percentages, and reasoning.\n\nRespond in JSON format for structured decisions.'

class AgentOrchestrator:
    '''Orchestrates LLM reasoning + ZK skill execution for identity-bound agents.'''
    
    def __init__(self):
        self._registry = get_llm_registry()
        self._skill_service = get_skill_service()
        self._receipt_service = ReceiptService()
        self._store = get_agent_store()
        self._onchain = get_onchain_agent_service()
        for agent_id, provider_id in self._store.list_bindings().items():
            self._registry.bind_agent(agent_id, provider_id)

    
    def register_agent(self = None, config = None):
        '''Register an agent configuration — persisted to SQLite + minted on-chain.'''
        pass
    # WARNING: Decompyle incomplete

    
    def get_agent(self = None, agent_id = None):
        '''Get agent config from SQLite.'''
        row = self._store.get_agent(agent_id)
        if not row:
            return None
        return AgentConfig(agent_id = row['agent_id'], owner_address = row['owner_address'], name = row['name'], identity_commitment = row.get('identity_commitment', '0'), reputation_tier = row.get('reputation_tier', 0), bound_skills = row.get('bound_skills', []), llm_provider_id = row.get('llm_provider_id', 'onyx'), llm_model = row.get('llm_model'), active = row.get('active', True))

    
    def list_agents(self = None, owner = None):
        '''List all registered agents from SQLite.'''
        rows = self._store.list_agents(owner = owner)
    # WARNING: Decompyle incomplete

    
    def update_agent(self = None, agent_id = None, updates = None):
        '''Update an existing agent.  Returns True if the agent existed.'''
        ok = self._store.update_agent(agent_id, updates)
        if ok and 'llm_provider_id' in updates:
            pid = updates['llm_provider_id']
            config_hash = self._registry.bind_agent(agent_id, pid)
            self._store.save_binding(agent_id, pid, config_hash)
        return ok

    
    def delete_agent(self = None, agent_id = None):
        '''Delete an agent and all related data.  Returns True if the agent existed.'''
        return self._store.delete_agent(agent_id)

    
    async def execute_goal(self = None, agent_id = None, goal = None, context = (None,)):
        """Execute a goal using the agent's LLM + ZK skills pipeline.

        Flow:
          1. LLM Reasoning — decide which skills to invoke and with what parameters
          2. Skill Execution — run each skill (ZK proof generation)
          3. LLM Synthesis — give results back to LLM for final decision
        """
        pass
    # WARNING: Decompyle incomplete

    
    async def _llm_reasoning(self, agent = None, goal = None, context = None, tools = ('agent', 'AgentConfig', 'goal', 'str', 'context', 'dict[str, Any] | None', 'tools', 'list[dict[str, Any]]', 'return', 'OrchestrationStep')):
        '''Step 1: Ask LLM to reason about which skills to use.'''
        pass
    # WARNING: Decompyle incomplete

    
    async def _execute_skill_step(self = None, agent = None, skill_id = None, params = ('agent', 'AgentConfig', 'skill_id', 'str', 'params', 'dict[str, Any]', 'return', 'OrchestrationStep')):
        '''Step 2: Execute a single skill (ZK proof).

        Includes:
          - Identity binding check (skill must be bound to agent)
          - Proof generation via circuit_scanner
          - Proof TTL tagging (for staleness checks downstream)
        '''
        pass
    # WARNING: Decompyle incomplete

    
    async def _llm_synthesis(self, agent = None, goal = None, proof_results = None, context = ('agent', 'AgentConfig', 'goal', 'str', 'proof_results', 'list[dict[str, Any]]', 'context', 'dict[str, Any] | None', 'return', 'OrchestrationStep')):
        '''Step 3: Give proof results back to LLM for final decision.'''
        pass
    # WARNING: Decompyle incomplete

    
    def _build_reasoning_prompt(self = None, goal = None, context = None, tools = ('goal', 'str', 'context', 'dict[str, Any] | None', 'tools', 'list[dict[str, Any]]', 'return', 'str')):
        '''Build the reasoning prompt for the LLM.'''
        tool_descriptions = []
        for t in tools:
            fn = t.get('function', { })
            tool_descriptions.append(f'''- {fn.get('name')}: {fn.get('description')}''')
        if not context:
            context
        return json.dumps({
            'goal': goal,
            'available_tools': tool_descriptions,
            'context': { },
            'instruction': "Analyze the goal and decide which tools to invoke. Return JSON with 'skill_calls': [{'skill_id': '...', 'params': {...}}, ...]. Each skill_id should match one of the available tools (without the 'zk_' prefix)." })

    
    def _parse_skill_calls(self = None, reasoning_result = None):
        '''Parse skill invocation requests from LLM reasoning output.'''
        content = reasoning_result.get('content', '')
        parsed = json.loads(content)
        calls = parsed.get('skill_calls', [])
    # WARNING: Decompyle incomplete

    
    def _emit_receipt(self = None, result = None):
        '''Emit an orchestration receipt for audit trail.'''
        proof_hashes = []
        for step in result.steps:
            if not step.step_type == 'skill_execution':
                continue
            if not step.result:
                continue
            ph = step.result.get('proof_hash')
            if not ph:
                continue
            proof_hashes.append(ph)
        agent = self.get_agent(result.agent_id)
        owner = agent.owner_address if agent else 'unknown'
        import json as _json
        details = {
            'goal': result.goal,
            'steps': len(result.steps),
            'proofs_generated': len(proof_hashes),
            'all_pass': result.all_proofs_pass,
            'tokens_used': result.llm_tokens_used,
            'duration_ms': result.total_duration_ms,
            'proof_hashes': proof_hashes }
        self._receipt_service.append_proof_receipt(user_address = owner, proof_type = 'agent_orchestration', threshold_or_model = f'''agent:{result.agent_id}''', result = f'''{'pass' if result.all_proofs_pass else 'fail'}:{_json.dumps(details, separators = (',', ':'))}''', snapshot_hash = proof_hashes[0] if proof_hashes else None)
        return None
    # WARNING: Decompyle incomplete


_orchestrator: 'AgentOrchestrator | None' = None

def get_orchestrator():
    '''Get or create the global agent orchestrator.'''
    pass
# WARNING: Decompyle incomplete

