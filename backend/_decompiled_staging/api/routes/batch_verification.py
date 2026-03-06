# Source Generated with Decompyle++
# File: batch_verification.cpython-312.pyc (Python 3.12)

'''
Batch Verification API routes.

Exposes the BatchVerifier contract functionality via REST endpoints.
'''
from __future__ import annotations
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
logger = logging.getLogger(__name__)
router = APIRouter()

class QueueActionRequest(BaseModel):
    action_hash: 'str' = 'QueueActionRequest'


class SubmitBatchRequest(BaseModel):
    action_count: 'int' = 'SubmitBatchRequest'


class ChallengeRequest(BaseModel):
    fraud_proof_hash: 'str' = 'ChallengeRequest'

queue_action = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
submit_batch_proof = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
process_batch = (lambda : pass# WARNING: Decompyle incomplete
)()
challenge_action = (lambda req = None: pass# WARNING: Decompyle incomplete
)()
get_pending = (lambda : pass# WARNING: Decompyle incomplete
)()
get_batch_history = (lambda : pass# WARNING: Decompyle incomplete
)()
