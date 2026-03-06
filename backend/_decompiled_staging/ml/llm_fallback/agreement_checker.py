# Source Generated with Decompyle++
# File: agreement_checker.cpython-312.pyc (Python 3.12)

'''
LLM Agreement Checker — verifiable safety net for AI agent decisions.

Runs both the Onyx LLM AND the deterministic fallback model on every agent skill
execution. If they disagree, the action is flagged/blocked and an EZKL proof
of the fallback model\'s decision can be generated.

This is the "verifiable AI guardrail" — even if the LLM is compromised,
a proved-correct deterministic model must agree before funds move.
'''
from __future__ import annotations
import logging
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any
logger = logging.getLogger(__name__)
REQUIRE_AGREEMENT = os.getenv('REQUIRE_LLM_AGREEMENT', '').lower() in ('1', 'true', 'yes')
LOG_DISAGREEMENTS = os.getenv('LOG_LLM_DISAGREEMENTS', 'true').lower() in ('1', 'true', 'yes')
AgreementResult = <NODE:12>()

class AgreementChecker:
    '''
    Checks agreement between LLM and deterministic fallback model.

    Usage:
        checker = get_agreement_checker()
        result = await checker.check("zk_risk_score", inputs, "execute")
        if result.action_blocked:
            # Don\'t execute — LLM and fallback disagree
    '''
    
    def __init__(self = None):
        get_fallback_model = get_fallback_model
        import app.ml.llm_fallback.fallback_model
        self.fallback = get_fallback_model()
        self._disagreement_count = 0
        self._total_checks = 0

    
    async def check(self = None, skill_name = None, skill_inputs = None, llm_decision = None, *, generate_proof):
        '''
        Compare LLM decision against the fallback model.

        Args:
            skill_name: Agent skill being executed.
            skill_inputs: Inputs to the skill circuit.
            llm_decision: What the Onyx LLM decided ("execute"/"reject"/"defer_to_human").
            generate_proof: If True and disagreement, generate EZKL proof of fallback.

        Returns:
            AgreementResult with agreement status and optional proof.
        '''
        pass
    # WARNING: Decompyle incomplete

    stats = (lambda self = None: if self._total_checks > 0:
{
'total_checks': self._total_checks,
'disagreements': self._disagreement_count,
'agreement_rate': (self._total_checks - self._disagreement_count) / self._total_checks,
'require_agreement': REQUIRE_AGREEMENT }{
'total_checks': None,
'disagreements': self._total_checks,
'agreement_rate': self._disagreement_count,
'require_agreement': REQUIRE_AGREEMENT })()
    
    def _normalize_decision(self = None, decision = None):
        '''Normalize LLM output to one of: execute, reject, defer_to_human.'''
        d = decision.strip().lower()
        if d in ('execute', 'approve', 'proceed', 'allow', 'yes'):
            return 'execute'
        if d in ('reject', 'deny', 'block', 'no', 'stop'):
            return 'reject'
        return 'defer_to_human'

    
    def _decisions_compatible(self = None, llm = None, fallback = None):
        '''
        Check if two decisions are compatible.

        Compatible pairs:
          - Both execute
          - Both reject
          - Either defers to human (partial agreement, not flagged)
          - LLM rejects but fallback says execute (conservative LLM is fine)

        Incompatible:
          - LLM says execute but fallback says reject (dangerous!)
        '''
        if llm == fallback:
            return True
        if fallback == 'defer_to_human' or llm == 'defer_to_human':
            return True
        if llm == 'reject' and fallback == 'execute':
            return True
        return False

    
    async def _generate_disagreement_proof(self = None, skill_name = None, skill_inputs = None, fallback_result = ('skill_name', 'str', 'skill_inputs', 'dict[str, Any]', 'fallback_result', 'Any', 'return', 'dict[str, Any] | None')):
        """Generate EZKL proof of the fallback model's decision."""
        pass
    # WARNING: Decompyle incomplete

    
    async def _log_disagreement(self, skill_name = None, llm_decision = None, fallback_result = None, blocked = ('skill_name', 'str', 'llm_decision', 'str', 'fallback_result', 'Any', 'blocked', 'bool', 'return', 'None')):
        '''Log disagreement to the decision event store.'''
        pass
    # WARNING: Decompyle incomplete


_checker: 'AgreementChecker | None' = None

def get_agreement_checker():
    pass
# WARNING: Decompyle incomplete

