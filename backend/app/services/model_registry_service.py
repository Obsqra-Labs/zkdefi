import os
import json
from typing import Optional, Tuple
import hashlib
from datetime import datetime, timezone

class ModelRegistryService:
    """Service to manage model versioning on-chain via ModelRegistry contract"""
    
    def __init__(self):
        self.model_registry_address = os.getenv("MODEL_REGISTRY_ADDRESS", "0x0")
        self.rpc_url = os.getenv("STARKNET_RPC_URL", "")
        self.contract = None
        self.model_versions = {}  # In-memory cache of model versions
        
        # Register default model v0 on initialization
        default_model = {
            "name": "zkML Base Model v0",
            "type": "proof-gated-lp-agent",
            "description": "Base model for autonomous LP rebalancing with ZK proofs"
        }
        self.register_model_version(default_model, 0)
    
    def compute_model_hash(self, model_data: dict) -> str:
        """Compute hash of model configuration for on-chain registration"""
        model_json = json.dumps(model_data, sort_keys=True)
        hash_obj = hashlib.sha256(model_json.encode())
        return hash_obj.hexdigest()
    
    def register_model_version(self, model_data: dict, version: int) -> dict:
        """Register a new model version on-chain"""
        try:
            model_hash = self.compute_model_hash(model_data)
            
            # Convert hash to felt252 (use first 62 hex chars)
            hash_felt = int(model_hash[:62], 16)
            
            # Store in memory cache
            self.model_versions[version] = {
                "hash": model_hash,
                "hash_felt": hash_felt,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "model_data": model_data
            }
            
            # In production, this would call the contract via a signed transaction
            return {
                "status": "pending",
                "message": f"Model v{version} prepared for registration",
                "model_hash": model_hash,
                "model_hash_felt": hash_felt,
                "version": version,
                "on_chain": False,
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "version": version,
                "on_chain": False
            }
    
    def get_current_model_hash(self) -> str:
        """Get the current model hash from cache or on-chain"""
        if not self.model_versions:
            # Return a placeholder if no versions registered (should not happen due to default v0)
            return "0x" + "0" * 64
        
        max_version = max(self.model_versions.keys())
        return self.model_versions[max_version]["hash"]
    
    def get_model_by_version(self, version: int) -> Optional[str]:
        """Get model hash by version number"""
        if version not in self.model_versions:
            return None
        return self.model_versions[version]["hash"]


class AutonomousRebalancerConfig:
    """Configuration for autonomous rebalancer constraints"""
    
    def __init__(self):
        config_json = os.getenv(
            "REBALANCER_CONFIG",
            '{"apy_threshold": 5.0, "fee_tier_spread_bps": 50, "utilization_ratio_threshold": 0.8, "min_rebalance_interval_hours": 24}'
        )
        
        try:
            self.config = json.loads(config_json)
        except json.JSONDecodeError:
            # Fallback to defaults
            self.config = {
                "apy_threshold": 5.0,
                "fee_tier_spread_bps": 50,
                "utilization_ratio_threshold": 0.8,
                "min_rebalance_interval_hours": 24
            }
    
    @property
    def apy_threshold(self) -> float:
        """APY improvement threshold (%) to trigger rebalance"""
        return float(self.config.get("apy_threshold", 5.0))
    
    @property
    def fee_tier_spread_bps(self) -> int:
        """Fee tier spread in basis points to trigger rebalance"""
        return int(self.config.get("fee_tier_spread_bps", 50))
    
    @property
    def utilization_ratio_threshold(self) -> float:
        """Pool utilization ratio threshold to trigger rebalance"""
        return float(self.config.get("utilization_ratio_threshold", 0.8))
    
    @property
    def min_rebalance_interval_hours(self) -> int:
        """Minimum hours between rebalances"""
        return int(self.config.get("min_rebalance_interval_hours", 24))
    
    def should_rebalance(self, 
                         current_apy: float, 
                         potential_apy: float,
                         current_fee_tier: int,
                         optimal_fee_tier: int,
                         pool_utilization: float,
                         hours_since_last_rebalance: float) -> Tuple[bool, str]:
        """
        Determine if rebalance should trigger based on constraints
        
        Returns: (should_rebalance: bool, reason: str)
        """
        
        # Check APY improvement
        apy_improvement = potential_apy - current_apy
        if apy_improvement >= self.apy_threshold:
            return True, f"APY improvement: {apy_improvement:.2f}% (threshold: {self.apy_threshold}%)"
        
        # Check fee tier arbitrage
        fee_spread = abs(optimal_fee_tier - current_fee_tier)
        if fee_spread >= self.fee_tier_spread_bps:
            return True, f"Fee tier spread: {fee_spread} bps (threshold: {self.fee_tier_spread_bps} bps)"
        
        # Check pool utilization
        if pool_utilization >= self.utilization_ratio_threshold:
            return True, f"High utilization: {pool_utilization:.2%} (threshold: {self.utilization_ratio_threshold:.2%})"
        
        # Check minimum interval
        if hours_since_last_rebalance < self.min_rebalance_interval_hours:
            return False, f"Minimum interval not met: {hours_since_last_rebalance:.1f}h < {self.min_rebalance_interval_hours}h"
        
        return False, "No rebalance conditions met"
