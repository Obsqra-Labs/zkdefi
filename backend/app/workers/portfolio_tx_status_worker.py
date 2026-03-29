"""
Portfolio Tx Status Worker.

Polls wallet-signed execution receipts and updates tx status in metadata.
This keeps the /portfolio receipt timeline accurate even if the frontend
is not actively polling.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.services.receipt_service import get_receipt_service

logger = logging.getLogger(__name__)


class PortfolioTxStatusWorker:
    def __init__(
        self,
        poll_interval: int = 20,
        max_age_hours: int = 48,
    ) -> None:
        self.poll_interval = poll_interval
        self.max_age_hours = max_age_hours
        self._receipt_service = get_receipt_service()
        self.running = False

    async def start(self) -> None:
        self.running = True
        logger.info("PortfolioTxStatusWorker started (poll interval: %ss)", self.poll_interval)

        while self.running:
            try:
                await self._poll_receipts()
            except Exception as exc:
                logger.warning("PortfolioTxStatusWorker poll failed: %s", exc)
            await asyncio.sleep(self.poll_interval)

    async def stop(self) -> None:
        self.running = False
        logger.info("PortfolioTxStatusWorker stopping")

    async def _poll_receipts(self) -> None:
        receipts = await self._receipt_service.get_recent_receipts_with_tx_hash(limit=250)
        now = datetime.now(timezone.utc)
        for receipt in receipts:
            metadata = receipt.get("metadata") if isinstance(receipt.get("metadata"), dict) else None
            if not metadata or metadata.get("source") != "execution_gate_v1":
                continue
            if metadata.get("stage") != "execute":
                continue
            execution_meta = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
            status = str(execution_meta.get("tx_status") or "").lower()
            if status in {"accepted", "confirmed", "rejected"}:
                continue
            checked_at = execution_meta.get("tx_checked_at")
            if isinstance(checked_at, str):
                try:
                    last = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
                    if (now - last).total_seconds() < self.poll_interval:
                        continue
                except ValueError:
                    pass
            timestamp = receipt.get("timestamp")
            if isinstance(timestamp, str):
                try:
                    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                    if (now - parsed).total_seconds() > self.max_age_hours * 3600:
                        continue
                except ValueError:
                    pass
            tx_hash = str(receipt.get("tx_hash") or "").strip()
            if not tx_hash:
                continue
            network_id = execution_meta.get("execution_chain") or "starknet_mainnet"
            tx_status = await self._fetch_tx_status(tx_hash, network_id)
            execution_meta = {
                **execution_meta,
                "tx_status": tx_status,
                "tx_checked_at": now.isoformat(),
            }
            lifecycle_status = {
                "accepted": "accepted",
                "confirmed": "confirmed",
                "rejected": "failed",
            }.get(tx_status, "submitted")
            metadata = {**metadata, "status": lifecycle_status, "execution": execution_meta}
            await self._receipt_service.update_receipt_metadata(receipt.get("receipt_id"), metadata)

    async def _fetch_tx_status(self, tx_hash: str, network_id: str) -> str:
        import os

        rpc_url = os.getenv("EXECUTOR_RPC_URL_MAINNET") if network_id == "starknet_mainnet" else None
        rpc_url = rpc_url or os.getenv("STARKNET_RPC_URL")
        if not rpc_url:
            return "unknown"
        payload = {
            "jsonrpc": "2.0",
            "method": "starknet_getTransactionStatus",
            "params": [tx_hash],
            "id": 1,
        }
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(rpc_url, json=payload)
                resp.raise_for_status()
                data = resp.json().get("result", {})
        except Exception:
            return "unknown"

        finality = str(data.get("finality_status") or "").upper()
        execution = str(data.get("execution_status") or "").upper()
        if execution in {"REJECTED", "REVERTED"} or finality == "REJECTED":
            return "rejected"
        if finality == "ACCEPTED_ON_L1":
            return "confirmed"
        if finality == "ACCEPTED_ON_L2":
            return "accepted"
        if finality == "RECEIVED":
            return "received"
        return "pending"


_worker: Optional[PortfolioTxStatusWorker] = None


def get_portfolio_tx_status_worker() -> PortfolioTxStatusWorker:
    global _worker
    if _worker is None:
        _worker = PortfolioTxStatusWorker(poll_interval=20, max_age_hours=48)
    return _worker
