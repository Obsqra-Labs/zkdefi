"""
Orchestration Service - Ties all Phase 4A and zkML 5/5 components together
This is the central hub that connects:
- Rebalancer decisions → Audit trail
- Position creation → Audit trail + model versioning
- Transfers → Audit trail + verification
- Dashboard display → Real audit data
"""

from datetime import datetime
from typing import Dict, Optional
from enum import Enum

from app.services.model_registry_service import ModelRegistryService
from app.services.autonomous_rebalancer_monitor import AutonomousRebalancerMonitor, RebalancePosition
from app.services.audit_trail_service import AuditTrailService


class PositionStatus(str, Enum):
    """Position lifecycle status"""
    CREATED = "created"
    ACTIVE = "active"
    REBALANCED = "rebalanced"
    CLOSED = "closed"


class Position:
    """Represents a user's LP position"""
    
    def __init__(self, position_id: str, user_address: str, token_a: str, token_b: str, 
                 amount: float, fee_tier: int, created_tx_hash: str):
        self.position_id = position_id
        self.user_address = user_address
        self.token_a = token_a
        self.token_b = token_b
        self.amount = amount
        self.fee_tier = fee_tier
        self.created_tx_hash = created_tx_hash
        self.status = PositionStatus.CREATED
        self.created_at = datetime.now(timezone.utc)
        self.current_apy = 0.0
        self.rebalance_count = 0
        self.total_fees_earned = 0.0


class Orchestrator:
    """Central orchestration service - connects all Phase 4A & zkML systems"""
    
    def __init__(self):
        self.model_registry = ModelRegistryService()
        self.rebalancer = AutonomousRebalancerMonitor()
        self.audit_trail = AuditTrailService()
        
        # Positions tracked by this orchestrator
        self.positions: Dict[str, Position] = {}
    
    def create_position(self, user_address: str, token_a: str, token_b: str, 
                       amount: float, fee_tier: int, tx_hash: str) -> Position:
        """
        Create a new LP position and record it in audit trail
        Ties together: position creation → model versioning → audit logging
        """
        # Generate position ID
        position_id = f"pos_{len(self.positions) + 1}_{int(datetime.now(timezone.utc).timestamp())}"
        
        # Create position object
        position = Position(position_id, user_address, token_a, token_b, amount, fee_tier, tx_hash)
        self.positions[position_id] = position
        
        # Get current model version & hash
        current_model = self.model_registry.get_current_model_hash()
        
        # Record in audit trail - ties to model version
        audit_entry = self.audit_trail.record_position_created(
            position_id=position_id,
            user_address=user_address,
            token_a=token_a,
            token_b=token_b,
            amount=amount,
            fee_tier=fee_tier,
            model_version=0,  # Default to v0
            model_hash=current_model
        )
        
        # Mark as verified with transaction hash
        self.audit_trail.verify_entry(audit_entry, tx_hash)
        
        # Update position status
        position.status = PositionStatus.ACTIVE
        
        return position
    
    def evaluate_position_for_rebalance(self, position_id: str, current_apy: float,
                                       optimal_apy: float, optimal_fee_tier: int,
                                       pool_utilization: float) -> Dict:
        """
        Evaluate if a position should rebalance
        Ties together: rebalancer logic → decision recording → audit trail
        """
        if position_id not in self.positions:
            return {"error": "Position not found"}
        
        position = self.positions[position_id]
        position.current_apy = current_apy
        
        # Evaluate with rebalancer
        rebalance_position = RebalancePosition(
            position_id=position_id,
            current_apy=current_apy,
            optimal_apy=optimal_apy,
            current_fee_tier=position.fee_tier,
            optimal_fee_tier=optimal_fee_tier,
            pool_utilization=pool_utilization,
            last_rebalance_time=position.created_at
        )
        
        # Check if should rebalance (async)
        import asyncio
        loop = asyncio.new_event_loop()
        should_rebalance, reason, details = loop.run_until_complete(
            self.rebalancer.monitor_position(rebalance_position)
        )
        
        result = {
            "position_id": position_id,
            "should_rebalance": should_rebalance,
            "reason": reason,
            "metrics": details,
        }
        
        # If should rebalance, record decision in audit trail
        if should_rebalance:
            current_model = self.model_registry.get_current_model_hash()
            
            # Record the rebalance decision
            audit_entry = self.audit_trail.record_rebalance_decision(
                position_id=position_id,
                user_address=position.user_address,
                current_apy=current_apy,
                optimal_apy=optimal_apy,
                current_fee_tier=position.fee_tier,
                optimal_fee_tier=optimal_fee_tier,
                pool_utilization=pool_utilization,
                trigger_reason=reason,
                model_version=0,
                model_hash=current_model
            )
            
            # Update position metrics
            position.rebalance_count += 1
            position.status = PositionStatus.REBALANCED
            position.fee_tier = optimal_fee_tier
            
            result["audit_entry_id"] = audit_entry.decision_id
            result["audit_verified"] = audit_entry.verified
        
        return result
    
    def execute_transfer(self, from_address: str, to_address: str, amount_hidden: bool = True) -> Dict:
        """
        Execute confidential transfer and record in audit trail
        Ties together: transfer execution → decision recording → audit trail
        """
        transfer_id = f"xfer_{int(datetime.now(timezone.utc).timestamp())}"
        current_model = self.model_registry.get_current_model_hash()
        
        # Record transfer in audit trail
        audit_entry = self.audit_trail.record_transfer_executed(
            transfer_id=transfer_id,
            from_address=from_address,
            to_address=to_address,
            amount_hidden=amount_hidden,
            model_version=0,
            model_hash=current_model
        )
        
        return {
            "transfer_id": transfer_id,
            "status": "executed",
            "audit_entry_id": audit_entry.decision_id,
            "amount_hidden": amount_hidden,
            "from": from_address[:10] + "..." if len(from_address) > 10 else from_address,
            "to": to_address[:10] + "..." if len(to_address) > 10 else to_address,
        }
    
    def get_position_status(self, position_id: str) -> Dict:
        """Get full status of a position including audit history"""
        if position_id not in self.positions:
            return {"error": "Position not found"}
        
        position = self.positions[position_id]
        audit_entries = self.audit_trail.get_position_audit_trail(position_id)
        
        return {
            "position_id": position_id,
            "user": position.user_address,
            "pair": f"{position.token_a}/{position.token_b}",
            "amount": position.amount,
            "fee_tier": position.fee_tier,
            "current_apy": position.current_apy,
            "status": position.status.value,
            "rebalance_count": position.rebalance_count,
            "total_fees_earned": position.total_fees_earned,
            "created_at": position.created_at.isoformat(),
            "audit_history_entries": len(audit_entries),
            "audit_decisions": [
                {
                    "decision_id": e.decision_id,
                    "type": e.decision_type.value,
                    "timestamp": e.timestamp,
                    "reason": e.trigger_reason,
                }
                for e in audit_entries
            ]
        }
    
    def get_dashboard_data(self) -> Dict:
        """
        Get comprehensive dashboard data
        Ties together all metrics: positions, decisions, compliance
        """
        stats = self.audit_trail.get_statistics()
        compliance = self.audit_trail.get_compliance_report()
        
        return {
            "positions_tracked": len(self.positions),
            "total_decisions_recorded": stats["total_decisions"],
            "verified_decisions": stats["verified_decisions"],
            "rebalances_triggered": sum(p.rebalance_count for p in self.positions.values()),
            "total_fees_earned": sum(p.total_fees_earned for p in self.positions.values()),
            "average_apy": sum(p.current_apy for p in self.positions.values()) / max(1, len(self.positions)),
            "compliance_status": compliance["zkml_completion"],
            "decision_types": stats["decision_types"],
            "positions": [
                {
                    "position_id": p.position_id,
                    "pair": f"{p.token_a}/{p.token_b}",
                    "apy": p.current_apy,
                    "status": p.status.value,
                    "rebalances": p.rebalance_count,
                }
                for p in self.positions.values()
            ],
            "recent_decisions": self.audit_trail.get_recent_decisions(limit=5),
        }
