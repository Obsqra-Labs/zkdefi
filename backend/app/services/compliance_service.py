"""
Compliance Profile Service

Generates and manages compliance proofs (productized selective disclosure).
Users can register compliance proofs and share with auditors/protocols.
"""
import hashlib
from datetime import datetime, timedelta
from typing import Any

from app.services.zkdefi_agent_service import ZkdefiAgentService


class ComplianceService:
    """
    Service for managing compliance profiles.
    """
    
    # Profile types
    PROFILE_TYPES = {
        "kyc": "KYC Eligibility",
        "risk": "Risk Compliance",
        "performance": "Performance Proof",
        "aggregation": "Portfolio Aggregation"
    }
    
    def __init__(self):
        self.agent_service = ZkdefiAgentService()
        
        # In-memory profile tracking
        self._profiles: dict[str, dict] = {}
        self._user_profiles: dict[str, list[str]] = {}
        self._user_profile_by_type: dict[str, dict[str, str]] = {}
    
    async def register_profile(
        self,
        user_address: str,
        profile_type: str,  # 'kyc', 'risk', 'performance', 'aggregation'
        statement_hash: str,
        proof_hash: str,
        threshold: int,
        result: str,  # 'above', 'below', 'eligible'
        validity_days: int = 30
    ) -> dict[str, Any]:
        """
        Register a new compliance profile.
        """
        if profile_type not in self.PROFILE_TYPES:
            raise ValueError(f"Invalid profile type: {profile_type}")
        
        timestamp = datetime.utcnow()
        expiry = timestamp + timedelta(days=validity_days)
        
        # Generate profile ID
        profile_id = "0x" + hashlib.sha256(
            f"{user_address}{profile_type}{statement_hash}{timestamp.isoformat()}".encode()
        ).hexdigest()[:64]
        
        profile = {
            "profile_id": profile_id,
            "user": user_address,
            "profile_type": profile_type,
            "profile_type_name": self.PROFILE_TYPES[profile_type],
            "statement_hash": statement_hash,
            "proof_hash": proof_hash,
            "threshold": threshold,
            "result": result,
            "timestamp": timestamp.isoformat(),
            "expiry": expiry.isoformat(),
            "is_active": True,
            "on_chain": False
        }
        
        # Store locally
        self._profiles[profile_id] = profile
        
        if user_address not in self._user_profiles:
            self._user_profiles[user_address] = []
        self._user_profiles[user_address].append(profile_id)
        
        # Update latest profile of type
        if user_address not in self._user_profile_by_type:
            self._user_profile_by_type[user_address] = {}
        self._user_profile_by_type[user_address][profile_type] = profile_id
        
        return profile
    
    async def confirm_profile(
        self,
        profile_id: str,
        tx_hash: str
    ) -> dict[str, Any]:
        """
        Confirm profile was registered on-chain.
        """
        if profile_id in self._profiles:
            self._profiles[profile_id]["on_chain"] = True
            self._profiles[profile_id]["tx_hash"] = tx_hash
        
        return {
            "profile_id": profile_id,
            "tx_hash": tx_hash,
            "status": "confirmed"
        }
    
    async def revoke_profile(
        self,
        profile_id: str,
        user_address: str
    ) -> dict[str, Any]:
        """
        Revoke a compliance profile.
        """
        if profile_id not in self._profiles:
            raise ValueError("Profile not found")
        
        profile = self._profiles[profile_id]
        
        if profile["user"] != user_address:
            raise ValueError("Not profile owner")
        
        profile["is_active"] = False
        profile["revoked_at"] = datetime.utcnow().isoformat()
        
        return {
            "profile_id": profile_id,
            "status": "revoked"
        }
    
    async def get_profile(self, profile_id: str) -> dict[str, Any] | None:
        """Get profile by ID."""
        return self._profiles.get(profile_id)
    
    async def get_user_profiles(self, user_address: str) -> list[dict[str, Any]]:
        """Get all profiles for a user."""
        profile_ids = self._user_profiles.get(user_address, [])
        profiles = [self._profiles[pid] for pid in profile_ids if pid in self._profiles]
        
        # Check expiry
        now = datetime.utcnow()
        for profile in profiles:
            expiry = datetime.fromisoformat(profile["expiry"])
            profile["is_expired"] = now > expiry
            profile["is_valid"] = profile["is_active"] and not profile["is_expired"]
        
        return profiles
    
    async def has_valid_profile(
        self,
        user_address: str,
        profile_type: str
    ) -> dict[str, Any]:
        """
        Check if user has a valid profile of the given type.
        """
        if user_address not in self._user_profile_by_type:
            return {"has_valid": False, "reason": "No profiles"}
        
        if profile_type not in self._user_profile_by_type[user_address]:
            return {"has_valid": False, "reason": f"No {profile_type} profile"}
        
        profile_id = self._user_profile_by_type[user_address][profile_type]
        profile = self._profiles.get(profile_id)
        
        if not profile:
            return {"has_valid": False, "reason": "Profile not found"}
        
        if not profile["is_active"]:
            return {"has_valid": False, "reason": "Profile revoked"}
        
        expiry = datetime.fromisoformat(profile["expiry"])
        if datetime.utcnow() > expiry:
            return {"has_valid": False, "reason": "Profile expired"}
        
        return {
            "has_valid": True,
            "profile_id": profile_id,
            "profile_type": profile_type,
            "result": profile["result"],
            "expiry": profile["expiry"]
        }
    
    async def generate_kyc_proof(
        self,
        user_address: str,
        is_eligible: bool
    ) -> dict[str, Any]:
        """
        Generate KYC eligibility proof.
        Returns simulated proof data (actual implementation would use zkML).
        """
        statement_hash = "0x" + hashlib.sha256(
            f"kyc_eligibility_{user_address}".encode()
        ).hexdigest()[:64]
        
        proof_hash = "0x" + hashlib.sha256(
            f"kyc_proof_{user_address}_{is_eligible}".encode()
        ).hexdigest()[:64]
        
        return {
            "profile_type": "kyc",
            "statement_hash": statement_hash,
            "proof_hash": proof_hash,
            "result": "eligible" if is_eligible else "ineligible",
            "threshold": 0,
            "proof_method": "sha256_commitment"
        }
    
    async def generate_risk_compliance_proof(
        self,
        user_address: str,
        risk_score: int,
        threshold: int
    ) -> dict[str, Any]:
        """
        Generate risk compliance proof.
        Proves risk_score <= threshold without revealing actual score.
        """
        raise RuntimeError(
            "Risk compliance proof not yet implemented. "
            "Requires zkML risk service integration."
        )
    
    async def generate_performance_proof(
        self,
        user_address: str,
        actual_yield: int,
        threshold: int
    ) -> dict[str, Any]:
        """
        Generate performance proof.
        Proves yield >= threshold without revealing actual yield.
        """
        raise RuntimeError(
            "Performance proof not yet implemented. "
            "Requires zkML performance tracking integration."
        )

    async def generate_aggregation_proof(
        self,
        user_address: str,
        total_value: int,
        threshold: int
    ) -> dict[str, Any]:
        """
        Generate portfolio aggregation proof.
        Proves total_value >= threshold without revealing breakdown.
        """
        raise RuntimeError(
            "Aggregation proof not yet implemented. "
            "Requires zkML aggregation circuit integration."
        )


# Singleton instance
_compliance_service: ComplianceService | None = None


def get_compliance_service() -> ComplianceService:
    """Get or create the compliance service singleton."""
    global _compliance_service
    if _compliance_service is None:
        _compliance_service = ComplianceService()
    return _compliance_service
