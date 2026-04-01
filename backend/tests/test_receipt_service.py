"""
Tests for ReceiptService — in-memory receipt lifecycle.
Covers create, confirm, query, proof receipt append, pool filter.
"""
from __future__ import annotations

import pytest

from app.services.receipt_service import ReceiptService


@pytest.fixture
def svc():
    svc = ReceiptService()
    # Clear receipts table for test isolation (SQLite-backed service)
    import sqlite3
    with svc._db_lock, svc._db_connect() as conn:
        conn.execute("DELETE FROM receipts")
    return svc


# ---------------------------------------------------------------------------
# create_receipt
# ---------------------------------------------------------------------------

class TestCreateReceipt:
    @pytest.mark.asyncio
    async def test_creates_receipt_with_required_fields(self, svc: ReceiptService):
        r = await svc.create_receipt(
            user_address="0xAlice",
            constraints_hash="0xCH",
            proof_hash="0xPH",
            action_type="deposit",
            protocol_id=1,
            amount=1000,
        )
        assert r["receipt_id"].startswith("0x")
        assert r["user"] == "0xAlice"
        assert r["action_type"] == "deposit"
        assert r["on_chain"] is False

    @pytest.mark.asyncio
    async def test_receipt_stored_in_memory(self, svc: ReceiptService):
        r = await svc.create_receipt(
            user_address="0xBob",
            constraints_hash="0xCH",
            proof_hash="0xPH",
            action_type="withdraw",
            protocol_id=2,
            amount=500,
        )
        stored = await svc.get_receipt(r["receipt_id"])
        assert stored is not None
        assert stored["user"] == "0xBob"

    @pytest.mark.asyncio
    async def test_user_receipts_normalised_lowercase(self, svc: ReceiptService):
        await svc.create_receipt("0xAlice", "0x", "0x", "deposit", 1, 100)
        await svc.create_receipt("0xALICE", "0x", "0x", "withdraw", 1, 50)
        receipts = await svc.get_user_receipts("0xalice")
        assert len(receipts) == 2


# ---------------------------------------------------------------------------
# confirm_receipt
# ---------------------------------------------------------------------------

class TestConfirmReceipt:
    @pytest.mark.asyncio
    async def test_confirms_and_adds_tx_hash(self, svc: ReceiptService):
        r = await svc.create_receipt(
            "0xA",
            "0x",
            "0x",
            "deposit",
            1,
            10,
            metadata={"source": "execution_gate_v1", "stage": "execute", "status": "ready_to_sign"},
        )
        result = await svc.confirm_receipt(r["receipt_id"], "0xTX123")
        assert result["status"] == "submitted"
        stored = await svc.get_receipt(r["receipt_id"])
        assert stored["on_chain"] is True
        assert stored["tx_hash"] == "0xTX123"
        assert stored["metadata"]["status"] == "submitted"
        assert stored["metadata"]["execution"]["tx_status"] == "submitted"

    @pytest.mark.asyncio
    async def test_confirm_nonexistent_is_noop(self, svc: ReceiptService):
        result = await svc.confirm_receipt("0xDOESNOTEXIST", "0xTX")
        assert result["status"] == "missing"  # no-op but returns shape


# ---------------------------------------------------------------------------
# append_proof_receipt
# ---------------------------------------------------------------------------

class TestAppendProofReceipt:
    def test_appends_with_pool_id(self, svc: ReceiptService):
        r = svc.append_proof_receipt(
            user_address="0xAlice",
            proof_type="pool_safety",
            threshold_or_model="risk_score <= 30",
            result="safe",
            pool_id="ekubo_eth_usdc",
        )
        assert r["receipt_id"].startswith("0x")
        assert r["proof_type"] == "pool_safety"
        assert r["pool_id"] == "ekubo_eth_usdc"

    def test_get_receipts_by_pool(self, svc: ReceiptService):
        svc.append_proof_receipt("0xA", "pool_safety", "x", "y", pool_id="pool1")
        svc.append_proof_receipt("0xB", "risk_score", "x", "y", pool_id="pool2")
        svc.append_proof_receipt("0xC", "pool_safety", "x", "y", pool_id="pool1")
        assert len(svc.get_receipts_by_pool("pool1")) == 2
        assert len(svc.get_receipts_by_pool("pool2")) == 1
        assert len(svc.get_receipts_by_pool("nope")) == 0


# ---------------------------------------------------------------------------
# generate_constraints_hash
# ---------------------------------------------------------------------------

class TestConstraintsHash:
    @pytest.mark.asyncio
    async def test_deterministic(self, svc: ReceiptService):
        h1 = await svc.generate_constraints_hash(1000, 50, 3600)
        h2 = await svc.generate_constraints_hash(1000, 50, 3600)
        assert h1 == h2
        assert h1.startswith("0x")

    @pytest.mark.asyncio
    async def test_different_inputs_produce_different_hashes(self, svc: ReceiptService):
        h1 = await svc.generate_constraints_hash(1000, 50, 3600)
        h2 = await svc.generate_constraints_hash(2000, 50, 3600)
        assert h1 != h2
