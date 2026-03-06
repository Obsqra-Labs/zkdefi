# Source Generated with Decompyle++
# File: zkgraph.cpython-312.pyc (Python 3.12)

'''
zkGraph API Routes: Query attested on-chain intelligence
'''
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging
import json
from app.services.zkgraph_client import ZkGraphClient
from app.services.receipt_service import get_receipt_service
router = APIRouter()
logger = logging.getLogger(__name__)

class VerifyProvenanceRequest(BaseModel):
    response_hash: str = 'VerifyProvenanceRequest'
    query_id: str | None = None
    response_text: str | None = None


class ZkRAGAgentQueryRequest(BaseModel):
    prompt: str = 'ZkRAGAgentQueryRequest'
    user_address: str | None = None
    pool_id: str | None = None
    strategy_id: str | None = None
    run_live_circuits: bool = False
    scan_mode: str = 'signal'
    scan_circuits: list[str] | None = None
    llm_synthesis: bool = True

get_zkgraph_health = (lambda : pass# WARNING: Decompyle incomplete
)()
get_market_context = (lambda pool_id = None: pass# WARNING: Decompyle incomplete
)()
get_historical_patterns = (lambda pattern_type = None, limit = None: pass# WARNING: Decompyle incomplete
)()
get_similar_strategies = (lambda strategy_id = None, limit = None: pass# WARNING: Decompyle incomplete
)()
verify_provenance = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
get_agent_capabilities = (lambda : pass# WARNING: Decompyle incomplete
)()
zk_rag_agent_query = (lambda request = None: pass# WARNING: Decompyle incomplete
)()
