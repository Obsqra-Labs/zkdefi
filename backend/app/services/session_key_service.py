"""
Session Key Service

Manages session keys for proof-gated autonomous agent execution.
Session key = limited delegation + proof requirement.
"""
import os
import hashlib
from typing import Any
from datetime import datetime, timedelta

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.contract import Contract

STARKNET_RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia.public.blastapi.io")
SESSION_KEY_MANAGER_ADDRESS = os.getenv("SESSION_KEY_MANAGER_ADDRESS", "")


class SessionKeyService:
    """
    Service for managing session keys.
    """
    
    def __init__(
        self,
        rpc_url: str | None = None,
        manager_address: str | None = None
    ):
        self.rpc_url = rpc_url or STARKNET_RPC_URL
        self.manager_address = manager_address or SESSION_KEY_MANAGER_ADDRESS
        
        # In-memory session tracking (for development)
        self._sessions: dict[str, dict] = {}
    
    async def generate_session_request(
        self,
        owner_address: str,
        session_key_address: str,
        max_position: int,
        allowed_protocols: list[str],
        duration_hours: int = 24
    ) -> dict[str, Any]:
        """
        Generate a session key grant request.
        Returns calldata for the wallet to sign.
        """
        # Convert protocols to bitmap
        protocol_bitmap = 0
        protocol_map = {"pools": 1, "ekubo": 2, "jediswap": 4}
        for protocol in allowed_protocols:
            protocol_bitmap |= protocol_map.get(protocol.lower(), 0)
        
        # Calculate duration in seconds
        duration_seconds = duration_hours * 3600
        
        # Generate session ID (preview - actual ID generated on-chain)
        session_id = self._generate_session_id(
            owner_address,
            session_key_address,
            max_position,
            protocol_bitmap
        )
        
        # Create calldata for grant_session
        calldata = {
            "session_key": session_key_address,
            "max_position": str(max_position),
            "allowed_protocols": protocol_bitmap,
            "duration_seconds": duration_seconds
        }
        
        # Store session locally (for development tracking)
        self._sessions[session_id] = {
            "owner": owner_address,
            "session_key": session_key_address,
            "max_position": max_position,
            "allowed_protocols": allowed_protocols,
            "protocol_bitmap": protocol_bitmap,
            "duration_hours": duration_hours,
            "duration_seconds": duration_seconds,
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": (datetime.utcnow() + timedelta(hours=duration_hours)).isoformat(),
            "is_active": True,
            "pending_grant": True  # Not yet on-chain
        }
        
        return {
            "session_id": session_id,
            "owner_address": owner_address,
            "session_key_address": session_key_address,
            "max_position": max_position,
            "allowed_protocols": allowed_protocols,
            "protocol_bitmap": protocol_bitmap,
            "duration_hours": duration_hours,
            "duration_seconds": duration_seconds,
            "calldata": calldata,
            "contract_address": self.manager_address,
            "entrypoint": "grant_session"
        }
    
    async def confirm_session_grant(
        self,
        session_id: str,
        tx_hash: str
    ) -> dict[str, Any]:
        """
        Confirm that a session was granted on-chain.
        """
        if session_id in self._sessions:
            self._sessions[session_id]["pending_grant"] = False
            self._sessions[session_id]["tx_hash"] = tx_hash
        
        return {
            "session_id": session_id,
            "tx_hash": tx_hash,
            "status": "confirmed"
        }
    
    async def revoke_session(
        self,
        session_id: str,
        owner_address: str
    ) -> dict[str, Any]:
        """
        Generate revocation calldata.
        """
        # Verify ownership
        if session_id in self._sessions:
            if self._sessions[session_id]["owner"] != owner_address:
                raise ValueError("Not session owner")
            
            # Mark as pending revocation
            self._sessions[session_id]["pending_revoke"] = True
        
        return {
            "session_id": session_id,
            "calldata": {
                "session_id": session_id
            },
            "contract_address": self.manager_address,
            "entrypoint": "revoke_session"
        }
    
    async def confirm_session_revoke(
        self,
        session_id: str,
        tx_hash: str
    ) -> dict[str, Any]:
        """
        Confirm that a session was revoked on-chain.
        """
        if session_id in self._sessions:
            self._sessions[session_id]["is_active"] = False
            self._sessions[session_id]["pending_revoke"] = False
            self._sessions[session_id]["revoke_tx_hash"] = tx_hash
        
        return {
            "session_id": session_id,
            "tx_hash": tx_hash,
            "status": "revoked"
        }
    
    async def list_user_sessions(
        self,
        owner_address: str
    ) -> list[dict[str, Any]]:
        """
        List all sessions for a user.
        """
        sessions = []
        for session_id, session in self._sessions.items():
            if session["owner"] == owner_address:
                # Check if expired
                expires_at = datetime.fromisoformat(session["expires_at"])
                is_expired = datetime.utcnow() > expires_at
                
                sessions.append({
                    "session_id": session_id,
                    "session_key": session["session_key"],
                    "max_position": session["max_position"],
                    "allowed_protocols": session["allowed_protocols"],
                    "duration_hours": session["duration_hours"],
                    "created_at": session["created_at"],
                    "expires_at": session["expires_at"],
                    "is_active": session["is_active"] and not is_expired,
                    "is_expired": is_expired,
                    "pending_grant": session.get("pending_grant", False),
                    "pending_revoke": session.get("pending_revoke", False)
                })
        
        return sessions
    
    async def validate_session(
        self,
        session_id: str,
        protocol_id: int,
        amount: int
    ) -> dict[str, Any]:
        """
        Validate if an action is allowed under a session.
        """
        if session_id not in self._sessions:
            return {
                "is_valid": False,
                "reason": "Session not found"
            }
        
        session = self._sessions[session_id]
        
        # Check if active
        if not session["is_active"]:
            return {
                "is_valid": False,
                "reason": "Session is not active"
            }
        
        # Check if expired
        expires_at = datetime.fromisoformat(session["expires_at"])
        if datetime.utcnow() > expires_at:
            return {
                "is_valid": False,
                "reason": "Session has expired"
            }
        
        # Check protocol
        protocol_names = ["pools", "ekubo", "jediswap"]
        if protocol_id >= len(protocol_names):
            return {
                "is_valid": False,
                "reason": "Invalid protocol ID"
            }
        
        protocol_name = protocol_names[protocol_id]
        if protocol_name not in [p.lower() for p in session["allowed_protocols"]]:
            return {
                "is_valid": False,
                "reason": f"Protocol {protocol_name} not allowed"
            }
        
        # Check amount
        if session["max_position"] > 0 and amount > session["max_position"]:
            return {
                "is_valid": False,
                "reason": f"Amount {amount} exceeds max position {session['max_position']}"
            }
        
        return {
            "is_valid": True,
            "session_id": session_id,
            "protocol_name": protocol_name,
            "amount": amount,
            "remaining_time_seconds": int((expires_at - datetime.utcnow()).total_seconds())
        }
    
    def _generate_session_id(
        self,
        owner: str,
        session_key: str,
        max_position: int,
        protocol_bitmap: int
    ) -> str:
        """
        Generate a unique session ID.
        """
        data = f"{owner}{session_key}{max_position}{protocol_bitmap}{datetime.utcnow().isoformat()}"
        return "0x" + hashlib.sha256(data.encode()).hexdigest()[:64]


# Singleton instance
_session_service: SessionKeyService | None = None


def get_session_service() -> SessionKeyService:
    """Get or create the session service singleton."""
    global _session_service
    if _session_service is None:
        _session_service = SessionKeyService()
    return _session_service
