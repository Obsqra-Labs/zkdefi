"""
Dark pool proposal service -- commit-reveal for vault allocations.
Phase 1: AI generates proposal, service hashes it (commit).
Phase 2: Service reveals data on-chain, contract verifies hash match.
"""
import hashlib
import json
import secrets
from datetime import datetime, timezone


class VaultProposalService:
    def __init__(self):
        self._proposals: dict = {}

    def create_proposal(
        self, adapters: list, amounts: list, params: list | None = None
    ) -> dict:
        params = params or [[] for _ in adapters]
        salt = secrets.token_hex(32)
        raw = json.dumps(
            {"adapters": adapters, "amounts": amounts, "params": params, "salt": salt},
            sort_keys=True,
        )
        proposal_hash = hashlib.sha256(raw.encode()).hexdigest()
        record = {
            "proposal_hash": proposal_hash,
            "salt": salt,
            "adapters": adapters,
            "amounts": amounts,
            "params": params,
            "status": "committed",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self._proposals[proposal_hash] = record
        return record

    def verify_reveal(
        self,
        proposal_hash: str,
        adapters: list,
        amounts: list,
        params: list,
        salt: str,
    ) -> bool:
        raw = json.dumps(
            {"adapters": adapters, "amounts": amounts, "params": params, "salt": salt},
            sort_keys=True,
        )
        computed = hashlib.sha256(raw.encode()).hexdigest()
        return computed == proposal_hash

    def get_proposal(self, proposal_hash: str) -> dict | None:
        return self._proposals.get(proposal_hash)
