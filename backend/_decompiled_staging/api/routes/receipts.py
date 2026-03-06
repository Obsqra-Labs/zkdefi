# Source Generated with Decompyle++
# File: receipts.cpython-312.pyc (Python 3.12)

'''
Receipts API Routes

Exposes the on-chain receipt indexer endpoint consumed by useReceiptAggregator
on the frontend. Returns proof receipts with reconciliation-ready fields
(tx_hash, fact_hash, proof_type, action, result, timestamp).
'''
from fastapi import APIRouter
from app.services.receipt_service import get_receipt_service
router = APIRouter(prefix = '/receipts', tags = [
    'receipts'])
get_on_chain_receipts = (lambda address = None: pass# WARNING: Decompyle incomplete
)()
