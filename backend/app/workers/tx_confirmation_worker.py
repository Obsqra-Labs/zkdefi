"""
Transaction Confirmation Worker.

Background worker that polls relayer for transaction confirmations.
Updates execution status: pending → confirmed → settled
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.services.relayer_client import get_relayer_client
from app.services.json_store import JsonStore

logger = logging.getLogger(__name__)


class TxConfirmationWorker:
    """Background worker to poll relayer for transaction confirmations."""
    
    def __init__(
        self,
        poll_interval: int = 5,  # Check every 5 seconds
        max_age_hours: int = 24,  # Stop polling after 24 hours
    ):
        """
        Initialize confirmation worker.
        
        Args:
            poll_interval: Seconds between polls
            max_age_hours: Max age before stopping polls
        """
        self.poll_interval = poll_interval
        self.max_age_hours = max_age_hours
        self._execution_history = JsonStore("execution_history")
        self._relayer = get_relayer_client()
        self.running = False
    
    async def start(self):
        """Start the confirmation polling loop."""
        self.running = True
        logger.info(f"TxConfirmationWorker started (poll interval: {self.poll_interval}s)")
        
        while self.running:
            try:
                await self._poll_pending_executions()
            except Exception as e:
                logger.error(f"Error in confirmation poll cycle: {e}")
            
            await asyncio.sleep(self.poll_interval)
    
    async def stop(self):
        """Stop the confirmation polling loop."""
        self.running = False
        logger.info("TxConfirmationWorker stopping")
    
    async def _poll_pending_executions(self):
        """Check all pending executions for confirmation."""
        try:
            # Get all pending executions
            all_executions = self._execution_history.get("executions", [])
            if not isinstance(all_executions, list):
                all_executions = []
            
            pending_count = 0
            confirmed_count = 0
            
            for execution in all_executions:
                if execution.get("status") not in ["pending", "submitted"]:
                    continue
                
                tx_hash = execution.get("tx_hash")
                if not tx_hash:
                    continue
                
                # Check if too old (stop polling)
                try:
                    submitted_at = datetime.fromisoformat(
                        execution.get("submitted_at", "")
                    )
                    age_hours = (datetime.now(timezone.utc) - submitted_at).total_seconds() / 3600
                    
                    if age_hours > self.max_age_hours:
                        # Too old, skip polling
                        continue
                except (ValueError, AttributeError):
                    continue
                
                pending_count += 1
                
                # Poll relayer for status
                try:
                    status_result = await self._relayer.get_tx_status(tx_hash)
                    new_status = status_result.get("status")
                    
                    # Update if changed
                    if new_status != execution.get("status"):
                        execution["status"] = new_status
                        execution["last_checked"] = datetime.now(timezone.utc).isoformat()
                        
                        if new_status == "confirmed":
                            execution["confirmed_at"] = status_result.get("confirmed_at")
                            execution["block_number"] = status_result.get("block_number")
                            confirmed_count += 1
                            logger.info(
                                f"Tx confirmed: {tx_hash[:16]}... "
                                f"(block: {status_result.get('block_number')})"
                            )
                        elif new_status == "failed":
                            logger.warning(f"Tx failed: {tx_hash[:16]}...")
                        
                        # Persist update
                        self._execution_history.set(
                            execution.get("id"),
                            execution,
                        )
                
                except Exception as e:
                    logger.debug(f"Failed to check tx {tx_hash[:16]}...: {e}")
            
            if pending_count > 0:
                logger.debug(
                    f"Poll cycle: {pending_count} pending, "
                    f"{confirmed_count} newly confirmed"
                )
            
        except Exception as e:
            logger.error(f"Error polling executions: {e}")


# Singleton instance
_worker: Optional[TxConfirmationWorker] = None


def get_confirmation_worker() -> TxConfirmationWorker:
    """Get or create singleton TxConfirmationWorker."""
    global _worker
    if _worker is None:
        _worker = TxConfirmationWorker(poll_interval=5, max_age_hours=24)
    return _worker
