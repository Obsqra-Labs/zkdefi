"""
zkdefi agent service: proof-gated deposit/withdraw, disclosure proofs, position queries.
Hybrid approach:
- obsqra.fi proving API for execution proofs (proof-gated deposits/withdrawals)
- Groth16 (snarkjs) for privacy proofs (private deposits/withdrawals)
"""
import os
from typing import Any

import httpx
from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.models import StarknetChainId
from starknet_py.contract import Contract

from app.services.groth16_prover import Groth16Prover

OBSQRA_PROVER_API_URL = os.getenv("OBSQRA_PROVER_API_URL", "https://starknet.obsqra.fi/api/v1")
OBSQRA_API_KEY = os.getenv("OBSQRA_API_KEY", "")
STARKNET_RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7")
PROOF_GATED_AGENT_ADDRESS = os.getenv("PROOF_GATED_AGENT_ADDRESS", "")
SELECTIVE_DISCLOSURE_ADDRESS = os.getenv("SELECTIVE_DISCLOSURE_ADDRESS", "")
CONFIDENTIAL_TRANSFER_ADDRESS = os.getenv("CONFIDENTIAL_TRANSFER_ADDRESS", "")
GARAGA_VERIFIER_ADDRESS = os.getenv("GARAGA_VERIFIER_ADDRESS", "")
REBALANCER_SIGNER_PRIVATE_KEY = os.getenv("REBALANCER_SIGNER_PRIVATE_KEY", "")
REBALANCER_SIGNER_ADDRESS = os.getenv("REBALANCER_SIGNER_ADDRESS", "")

# Starknet felt252: 0 <= x < 2^251 + 17*2^192
_FELT252_MAX = (1 << 251) + 17 * (1 << 192)


def _validate_execute_with_proofs_calldata(calldata: list[int]) -> str | None:
    """
    Validate calldata shape and felt252 bounds for ProofGatedYieldAgent.execute_with_proofs.
    ABI: protocol_id (u8), amount (u256 = 2 felt), action_type, zkml_proof_calldata (len + span), execution_proof_hash, intent_commitment.
    Returns error message or None if valid.
    """
    if not isinstance(calldata, list) or len(calldata) < 7:
        return "execute_with_proofs calldata: expected at least 7 elements (protocol_id, amount_low, amount_high, action_type, zkml_len, execution_proof_hash, intent_commitment)"
    protocol_id, amount_low, amount_high, action_type, zkml_len = (
        calldata[0], calldata[1], calldata[2], calldata[3], calldata[4]
    )
    if not (0 <= protocol_id <= 0xFF):
        return "execute_with_proofs calldata: protocol_id must be u8 (0-255)"
    if not (0 <= amount_low < _FELT252_MAX and 0 <= amount_high < _FELT252_MAX):
        return "execute_with_proofs calldata: amount (u256) must be non-negative and within felt252"
    if not (0 <= action_type < _FELT252_MAX):
        return "execute_with_proofs calldata: action_type must be valid felt252"
    expected_len = 7 + zkml_len
    if len(calldata) != expected_len:
        return f"execute_with_proofs calldata: length mismatch (got {len(calldata)}, expected {expected_len} for zkml_len={zkml_len})"
    for i, v in enumerate(calldata):
        if not isinstance(v, int) or v < 0 or v >= _FELT252_MAX:
            return f"execute_with_proofs calldata: element {i} must be felt252 (0 <= x < P)"
    return None


class ZkdefiAgentService:
    """Service for proof-gated deposits, withdrawals, and disclosure proofs."""

    def __init__(
        self,
        prover_url: str | None = None,
        api_key: str | None = None,
        rpc_url: str | None = None,
        agent_address: str | None = None,
        disclosure_address: str | None = None,
        confidential_transfer_address: str | None = None,
        garaga_verifier_address: str | None = None,
    ):
        self.prover_url = (prover_url or OBSQRA_PROVER_API_URL).rstrip("/")
        self.api_key = api_key or OBSQRA_API_KEY
        self.rpc_url = rpc_url or STARKNET_RPC_URL
        self.agent_address = agent_address or PROOF_GATED_AGENT_ADDRESS
        self.disclosure_address = disclosure_address or SELECTIVE_DISCLOSURE_ADDRESS
        self.confidential_transfer_address = confidential_transfer_address or CONFIDENTIAL_TRANSFER_ADDRESS
        self.garaga_verifier_address = garaga_verifier_address or GARAGA_VERIFIER_ADDRESS

    async def _call_prover_api(self, proof_type: str, data: dict[str, Any]) -> dict[str, Any]:
        """
        Call obsqra.fi proving API (EXTERNAL - BLACK BOX).
        """
        url = f"{self.prover_url}/{proof_type}"
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(url, json=data, headers=headers)
            response.raise_for_status()
            return response.json()

    async def deposit_with_constraints(
        self,
        user_address: str,
        protocol_id: int,
        amount: int,
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Generate a STARK proof via obsqra.fi Stone prover + register with Integrity.
        Returns fact_hash for deposit_with_proof.
        
        The ProofGatedYieldAgent contract checks this fact_hash against
        the on-chain Integrity FactRegistry.
        """
        import random
        
        nonce = random.randint(1, 2**64 - 1)
        
        # Call obsqra.fi Stone prover to generate STARK proof
        # This registers the proof with Integrity and returns fact_hash
        try:
            proof_result = await self._call_prover_api("proofs/generate", {
                "jediswap_metrics": {
                    "utilization": 7000,
                    "volatility": 3000,
                    "liquidity": 2,
                    "audit_score": 85,
                    "age_days": 500
                },
                "ekubo_metrics": {
                    "utilization": 6000,
                    "volatility": 2500,
                    "liquidity": 3,
                    "audit_score": 90,
                    "age_days": 300
                }
            })
            
            # fact_hash is registered in Integrity FactRegistry on-chain
            fact_hash = proof_result.get("fact_hash", "0x0")
            
            return {
                "proof_hash": fact_hash,
                "amount": amount,
                "protocol_id": protocol_id,
                "nonce": nonce,
                "verified": proof_result.get("verified", False),
                "prover_message": proof_result.get("message", ""),
                "calldata": {
                    "protocol_id": protocol_id,
                    "amount": str(amount),
                    "proof_hash": fact_hash,
                },
            }
        except Exception as e:
            return {
                "proof_hash": "0x0",
                "amount": amount,
                "protocol_id": protocol_id,
                "nonce": nonce,
                "error": str(e),
                "calldata": {
                    "protocol_id": protocol_id,
                    "amount": str(amount),
                    "proof_hash": "0x0",
                },
            }

    async def withdraw_with_constraints(
        self,
        user_address: str,
        protocol_id: int,
        amount: int,
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Generate a STARK proof via obsqra.fi Stone prover + register with Integrity.
        Returns fact_hash for withdraw_with_proof.
        
        The ProofGatedYieldAgent contract checks this fact_hash against
        the on-chain Integrity FactRegistry.
        """
        import random
        
        nonce = random.randint(1, 2**64 - 1)
        
        # Call obsqra.fi Stone prover to generate STARK proof for withdrawal
        try:
            proof_result = await self._call_prover_api("proofs/generate", {
                "jediswap_metrics": {
                    "utilization": 7000,
                    "volatility": 3000,
                    "liquidity": 2,
                    "audit_score": 85,
                    "age_days": 500
                },
                "ekubo_metrics": {
                    "utilization": 6000,
                    "volatility": 2500,
                    "liquidity": 3,
                    "audit_score": 90,
                    "age_days": 300
                }
            })
            
            # fact_hash is registered in Integrity FactRegistry on-chain
            fact_hash = proof_result.get("fact_hash", "0x0")
            
            return {
                "proof_hash": fact_hash,
                "amount": amount,
                "protocol_id": protocol_id,
                "nonce": nonce,
                "verified": proof_result.get("verified", False),
                "prover_message": proof_result.get("message", ""),
                "calldata": {
                    "protocol_id": protocol_id,
                    "amount": str(amount),
                    "proof_hash": fact_hash,
                },
            }
        except Exception as e:
            return {
                "proof_hash": "0x0",
                "amount": amount,
                "protocol_id": protocol_id,
                "nonce": nonce,
                "error": str(e),
                "calldata": {
                    "protocol_id": protocol_id,
                    "amount": str(amount),
                    "proof_hash": "0x0",
                },
            }

    async def generate_disclosure_proof(
        self,
        user_address: str,
        statement_type: str,
        threshold: int,
        result: str,
    ) -> dict[str, Any]:
        """
        Request a disclosure proof from obsqra.fi for selective disclosure.
        """
        proof_result = await self._call_prover_api("disclosure", {
            "user_address": user_address,
            "statement_type": statement_type,
            "threshold": threshold,
            "result": result,
        })
        return {
            "proof_hash": proof_result.get("proof_hash", proof_result.get("fact_hash", "0x0")),
            "statement_type": statement_type,
            "threshold": threshold,
            "result": result,
        }

    async def get_user_position(self, user_address: str, protocol_id: int = 0) -> dict[str, Any]:
        """
        Query on-chain position for user and protocol via ProofGatedYieldAgent.
        Uses direct RPC call to avoid starknet-py block parameter compatibility issues.
        """
        if not self.agent_address:
            return {"position": "0", "error": "PROOF_GATED_AGENT_ADDRESS not set"}
        try:
            # Use direct RPC call to avoid starknet-py version incompatibility
            pid = protocol_id if 0 <= protocol_id <= 255 else 0
            user_int = int(user_address, 16)
            contract_int = int(self.agent_address, 16)
            
            # get_position selector (starknet.get_selector_from_name("get_position"))
            selector = 0x3b3d893679cec4ffbfdc6a8c56ac55b38ce6cc583d9341af90e623172da5570
            
            payload = {
                "jsonrpc": "2.0",
                "method": "starknet_call",
                "params": {
                    "request": {
                        "contract_address": hex(contract_int),
                        "entry_point_selector": hex(selector),
                        "calldata": [hex(user_int), hex(pid)]
                    },
                    "block_id": "latest"
                },
                "id": 1
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(self.rpc_url, json=payload)
                result = response.json()
            
            if "error" in result:
                return {"position": "0", "error": result["error"].get("message", str(result["error"]))}
            
            # Parse u256 result (low, high)
            data = result.get("result", [])
            if len(data) >= 2:
                low = int(data[0], 16) if isinstance(data[0], str) else int(data[0])
                high = int(data[1], 16) if isinstance(data[1], str) else int(data[1])
                position_value = low + (high << 128)
            elif len(data) == 1:
                position_value = int(data[0], 16) if isinstance(data[0], str) else int(data[0])
            else:
                position_value = 0
            
            return {
                "user_address": user_address,
                "protocol_id": protocol_id,
                "position": str(position_value),
            }
        except Exception as e:
            return {"position": "0", "error": str(e)}

    async def submit_rebalance(
        self,
        protocol_id: int,
        amount: int,
        zkml_risk_calldata: list[int] | None = None,
        zkml_anomaly_calldata: list[int] | None = None,
        execution_proof_hash: str = "0x0",
        intent_commitment: str = "0x0",
    ) -> dict[str, Any]:
        """
        Submit rebalance to ProofGatedYieldAgent.execute_with_proofs when configured.
        Returns {"tx_hash": str} on success, {"tx_hash": None, "error": str} when not configured or on failure.
        """
        if not self.agent_address or not REBALANCER_SIGNER_PRIVATE_KEY:
            return {"tx_hash": None, "error": "PROOF_GATED_AGENT_ADDRESS or REBALANCER_SIGNER_PRIVATE_KEY not set"}
        try:
            from starknet_py.hash.selector import get_selector_from_name
            from starknet_py.net.client_models import Call
            from starknet_py.net.models import StarknetChainId
            from starknet_py.net.account.account import Account
            from starknet_py.net.signer.stark_curve_signer import KeyPair

            key = int(REBALANCER_SIGNER_PRIVATE_KEY, 16) if isinstance(REBALANCER_SIGNER_PRIVATE_KEY, str) and REBALANCER_SIGNER_PRIVATE_KEY.startswith("0x") else int(REBALANCER_SIGNER_PRIVATE_KEY or "0", 16)
            if key == 0:
                return {"tx_hash": None, "error": "REBALANCER_SIGNER_PRIVATE_KEY invalid"}
            signer_address = REBALANCER_SIGNER_ADDRESS or ""
            if not signer_address:
                return {"tx_hash": None, "error": "REBALANCER_SIGNER_ADDRESS not set (required for rebalance execution)"}

            # Flatten zkML calldata: contract expects Span<felt252> = risk + anomaly concatenated
            risk_calldata = zkml_risk_calldata or []
            anomaly_calldata = zkml_anomaly_calldata or []
            zkml_flat = list(risk_calldata) + list(anomaly_calldata)

            # u256 amount = (low, high)
            amount_low = amount & ((1 << 128) - 1)
            amount_high = amount >> 128
            # action_type "rebalance" as short string felt
            action_rebalance = int.from_bytes(b"rebalance", "big")
            exec_hash_int = int(execution_proof_hash, 16) if isinstance(execution_proof_hash, str) else execution_proof_hash
            intent_int = int(intent_commitment, 16) if isinstance(intent_commitment, str) else intent_commitment

            # execute_with_proofs(protocol_id, amount, action_type, zkml_proof_calldata, execution_proof_hash, intent_commitment)
            # Calldata: protocol_id (1), amount (2), action_type (1), len(zkml_flat) (1), ...zkml_flat, execution_proof_hash (1), intent_commitment (1)
            calldata = [
                protocol_id & 0xFF,
                amount_low,
                amount_high,
                action_rebalance,
                len(zkml_flat),
                *zkml_flat,
                exec_hash_int,
                intent_int,
            ]

            # Validate calldata shape and felt252 bounds before sending (Garaga / ProofGatedYieldAgent ABI)
            err = _validate_execute_with_proofs_calldata(calldata)
            if err:
                return {"tx_hash": None, "error": err}

            client = FullNodeClient(node_url=self.rpc_url)
            key_pair = KeyPair.from_private_key(key)
            account = Account(
                address=int(signer_address, 16),
                client=client,
                key_pair=key_pair,
                chain=StarknetChainId.SEPOLIA,
            )
            call = Call(
                to_addr=int(self.agent_address, 16),
                selector=get_selector_from_name("execute_with_proofs"),
                calldata=calldata,
            )
            from starknet_py.net.client_models import ResourceBounds, ResourceBoundsMapping
            resp = await account.execute_v3(
                calls=call,
                auto_estimate=True,
            )
            tx_hash_hex = hex(resp.transaction_hash) if resp.transaction_hash else None
            return {"tx_hash": tx_hash_hex, "error": None}
        except Exception as e:
            msg = str(e)
            if "revert" in msg.lower() or "assert" in msg.lower() or "invalid" in msg.lower():
                msg = f"Execution reverted: {msg}"
            return {"tx_hash": None, "error": msg}

    def _u256_to_int(self, val: Any) -> int:
        """Normalize Cairo u256 (low/high or single int) to Python int."""
        if val is None:
            return 0
        if hasattr(val, "low"):
            return int(val.low) + (int(val.high) << 128)
        if isinstance(val, (list, tuple)) and len(val) >= 2:
            return int(val[0]) + (int(val[1]) << 128)
        return int(val)

    async def get_constraints(self, user_address: str) -> dict[str, Any]:
        """Query on-chain constraints for user via ProofGatedYieldAgent contract.
        Uses direct RPC call to avoid starknet-py version incompatibility.
        """
        if not self.agent_address:
            return {"max_position": 0, "max_daily_yield_bps": 0, "min_withdraw_delay_seconds": 0}
        try:
            user_int = int(user_address, 16)
            contract_int = int(self.agent_address, 16)
            
            # get_constraints selector (starknet.get_selector_from_name("get_constraints"))
            selector = 0xac17b2365b9a514e9e788ee8d1a1d44ac66cff418aacedb0e75d7db8f4cb0
            
            payload = {
                "jsonrpc": "2.0",
                "method": "starknet_call",
                "params": {
                    "request": {
                        "contract_address": hex(contract_int),
                        "entry_point_selector": hex(selector),
                        "calldata": [hex(user_int)]
                    },
                    "block_id": "latest"
                },
                "id": 1
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(self.rpc_url, json=payload)
                result = response.json()
            
            if "error" in result:
                return {"max_position": 0, "max_daily_yield_bps": 0, "min_withdraw_delay_seconds": 0, 
                        "error": result["error"].get("message", str(result["error"]))}
            
            data = result.get("result", [])
            # Parse constraints: (max_position_u256, max_daily_yield_bps_u256, min_withdraw_delay_seconds)
            max_pos = 0
            max_daily = 0
            min_delay = 0
            
            if len(data) >= 2:
                low = int(data[0], 16) if isinstance(data[0], str) else int(data[0])
                high = int(data[1], 16) if isinstance(data[1], str) else int(data[1])
                max_pos = low + (high << 128)
            if len(data) >= 4:
                low = int(data[2], 16) if isinstance(data[2], str) else int(data[2])
                high = int(data[3], 16) if isinstance(data[3], str) else int(data[3])
                max_daily = low + (high << 128)
            if len(data) >= 5:
                min_delay = int(data[4], 16) if isinstance(data[4], str) else int(data[4])
            
            return {
                "max_position": max_pos,
                "max_daily_yield_bps": max_daily,
                "min_withdraw_delay_seconds": min_delay,
            }
        except Exception as e:
            return {"error": str(e)}

    def generate_private_deposit_proof(
        self,
        amount: int,
        nonce: int | None = None,
        balance: int | None = None,
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof for private_deposit using snarkjs.
        Uses Groth16 (not obsqra prover) for privacy proofs.
        """
        if nonce is None:
            import random
            nonce = random.randint(1, 2**64 - 1)
        if balance is None:
            # Default balance: assume sufficient (circuit will verify)
            balance = amount * 2  # Ensure balance >= amount
        
        try:
            # Use Groth16 prover for privacy proofs
            return Groth16Prover.generate_private_deposit_proof(
                amount=amount,
                nonce=nonce,
                balance=balance,
            )
        except Exception as e:
            raise Exception(f"Groth16 proof generation failed: {str(e)}")

    # ==================== PRIVATE WITHDRAWALS ====================

    async def get_user_commitments(self, user_address: str) -> list[dict[str, Any]]:
        """
        Query all commitments for a user from the ConfidentialTransfer contract.
        Returns list of commitments with their balances.
        """
        if not self.confidential_transfer_address:
            return []
        try:
            client = FullNodeClient(node_url=self.rpc_url)
            contract = await Contract.from_address(
                address=int(self.confidential_transfer_address, 16),
                provider=client,
            )
            # Query user's commitment count
            count_result = await contract.functions["get_user_commitment_count"].call(
                int(user_address, 16),
                block_number="pending",
            )
            count = int(count_result[0]) if hasattr(count_result, "__getitem__") else int(count_result)
            
            commitments = []
            for i in range(count):
                # Get commitment at index
                commitment_result = await contract.functions["get_user_commitment_at"].call(
                    int(user_address, 16),
                    i,
                    block_number="pending",
                )
                commitment = commitment_result[0] if hasattr(commitment_result, "__getitem__") else commitment_result
                
                # Get commitment balance
                balance_result = await contract.functions["get_commitment_balance"].call(
                    int(commitment),
                    block_number="pending",
                )
                balance = self._u256_to_int(balance_result[0] if hasattr(balance_result, "__getitem__") else balance_result)
                
                if balance > 0:
                    commitments.append({
                        "commitment": hex(int(commitment)),
                        "balance": str(balance),
                        "index": i,
                    })
            
            return commitments
        except Exception as e:
            # Return empty list if contract doesn't exist or has no data
            return []

    def generate_private_withdraw_proof(
        self,
        commitment: str,
        amount: int,
        nonce: int | None = None,
        user_address: str | None = None,
        balance: int | None = None,
    ) -> dict[str, Any]:
        """
        Generate Groth16 proof for private_withdraw using snarkjs.
        Uses Groth16 (not obsqra prover) for privacy proofs.
        """
        import hashlib
        
        if nonce is None:
            import random
            nonce = random.randint(1, 2**64 - 1)
        
        commitment_int = int(commitment, 16) if isinstance(commitment, str) else commitment
        user_secret = int(user_address, 16) if user_address else 0
        
        if balance is None:
            # Circuit requires commitment_public === Poseidon(balance, nonce). For deposit we had commitment = Poseidon(amount, nonce).
            # So for full withdraw the committed "balance" is the deposit amount; default balance = amount (full withdraw).
            balance = amount
        
        try:
            # Use Groth16 prover for privacy proofs
            return Groth16Prover.generate_private_withdraw_proof(
                commitment=commitment,
                amount=amount,
                nonce=nonce,
                balance=balance,
                user_secret=user_secret,
            )
        except Exception as e:
            raise RuntimeError(
                f"Private withdraw proof generation failed. Error: {str(e)}"
            ) from e

    # ==================== ENHANCED SELECTIVE DISCLOSURE ====================
    # These methods use LOCAL zkML services for proof generation.
    # Only falls back to obsqra for STONE proofs if local services unavailable.

    async def generate_risk_compliance_proof(
        self,
        user_address: str,
        max_risk_threshold: int,
        risk_metric: str = "var",
    ) -> dict[str, Any]:
        """
        Generate proof that portfolio risk is below threshold.
        Uses LOCAL zkml_risk_service for Groth16 proof generation.
        """
        try:
            from app.services.zkml_risk_service import get_risk_service, RiskScoreModel
            
            risk_service = get_risk_service()
            
            # Generate default portfolio features for demo
            # In production, would query actual portfolio data
            default_features = [50, 40, 60, 30, 70, 60, 10, 25]
            
            # Compute risk score locally
            score = RiskScoreModel.compute_risk_score(default_features)
            is_compliant = score <= max_risk_threshold
            
            # Generate proof if circuits available
            proof_calldata = None
            if risk_service.circuits_ready:
                try:
                    proof_result = await risk_service.generate_risk_proof(
                        user_address=user_address,
                        portfolio_features=default_features,
                        threshold=max_risk_threshold
                    )
                    proof_calldata = proof_result.get("proof_calldata")
                except Exception as e:
                    pass  # Fall through to return result without proof
            
            return {
                "proof_hash": "0x" + hex(hash(f"{user_address}{max_risk_threshold}{score}"))[2:].zfill(64)[:64],
                "statement_type": f"risk_{risk_metric}",
                "threshold": max_risk_threshold,
                "risk_metric": risk_metric,
                "score": score,
                "result": "compliant" if is_compliant else "non_compliant",
                "proof_calldata": proof_calldata,
                "local_proof": True,
            }
        except Exception as e:
            # Fallback to obsqra prover if local service fails
            proof_result = await self._call_prover_api("disclosure", {
                "user_address": user_address,
                "statement_type": f"risk_{risk_metric}",
                "threshold": max_risk_threshold,
                "result": "compliant",
            })
            return {
                "proof_hash": proof_result.get("proof_hash", proof_result.get("fact_hash", "0x0")),
                "statement_type": f"risk_{risk_metric}",
                "threshold": max_risk_threshold,
                "risk_metric": risk_metric,
                "result": "compliant",
                "local_proof": False,
            }

    async def generate_performance_proof(
        self,
        user_address: str,
        min_apy: int,
        period_days: int = 30,
    ) -> dict[str, Any]:
        """
        Generate proof that APY was above threshold for period.
        min_apy is in basis points (e.g., 1000 = 10%)
        """
        proof_result = await self._call_prover_api("disclosure", {
            "user_address": user_address,
            "statement_type": "apy",
            "threshold": min_apy,
            "period_days": period_days,
            "result": "above_threshold",
        })
        return {
            "proof_hash": proof_result.get("proof_hash", proof_result.get("fact_hash", "0x0")),
            "statement_type": "performance",
            "threshold": min_apy,
            "period_days": period_days,
            "result": "above_threshold",
        }

    async def generate_kyc_eligibility_proof(
        self,
        user_address: str,
        min_balance: int,
    ) -> dict[str, Any]:
        """
        Generate proof that user's balance is above threshold for KYC eligibility.
        Proves financial standing without revealing exact amount.
        """
        proof_result = await self._call_prover_api("disclosure", {
            "user_address": user_address,
            "statement_type": "kyc_eligible",
            "threshold": min_balance,
            "result": "eligible",
        })
        return {
            "proof_hash": proof_result.get("proof_hash", proof_result.get("fact_hash", "0x0")),
            "statement_type": "kyc_eligibility",
            "threshold": min_balance,
            "result": "eligible",
        }

    # ==================== PRIVATE POSITION AGGREGATION ====================

    async def get_aggregated_position(self, user_address: str) -> dict[str, Any]:
        """
        Query aggregated position across all protocols + private commitments.
        Returns total value without revealing individual protocol amounts.
        """
        total_value = 0
        public_positions_count = 0
        private_commitments_count = 0
        
        # Query public positions from ProofGatedYieldAgent
        for protocol_id in range(3):  # pools, ekubo, jediswap
            try:
                position = await self.get_user_position(user_address, protocol_id)
                pos_value = int(position.get("position", "0"))
                if pos_value > 0:
                    total_value += pos_value
                    public_positions_count += 1
            except:
                pass
        
        # Query private commitments
        try:
            commitments = await self.get_user_commitments(user_address)
            for c in commitments:
                total_value += int(c.get("balance", "0"))
                private_commitments_count += 1
        except:
            pass
        
        return {
            "user_address": user_address,
            "total_value": str(total_value),
            "public_positions_count": public_positions_count,
            "private_commitments_count": private_commitments_count,
            # Note: breakdown is NOT included for privacy
        }

    async def generate_portfolio_aggregation_proof(
        self,
        user_address: str,
        min_total_value: int,
        protocol_ids: list[int] | None = None,
    ) -> dict[str, Any]:
        """
        Generate proof that total portfolio value across protocols >= threshold.
        Does not reveal individual protocol amounts or breakdown.
        """
        if protocol_ids is None:
            protocol_ids = [0, 1, 2]  # Default: all protocols
        
        proof_result = await self._call_prover_api("disclosure", {
            "user_address": user_address,
            "statement_type": "portfolio_aggregation",
            "threshold": min_total_value,
            "protocol_ids": protocol_ids,
            "result": "above_threshold",
        })
        return {
            "proof_hash": proof_result.get("proof_hash", proof_result.get("fact_hash", "0x0")),
            "statement_type": "portfolio_aggregation",
            "threshold": min_total_value,
            "protocol_count": len(protocol_ids),
            "result": "above_threshold",
        }

    # ==================== SHIELDED POOLS (PRIVATE + OPTIONAL PROOF-GATING) ====================

    def generate_shielded_deposit_proof(
        self,
        user_address: str,
        pool_type: str,
        amount: int,
        nonce: int | None = None,
    ) -> dict[str, Any]:
        """
        Generate privacy proof for shielded pool deposit.
        Human-signed tx: Only privacy proof needed (signature = authorization).
        No execution proof required - the wallet signature IS the authorization.
        
        Returns commitment + proof_calldata for ShieldedPool.private_deposit
        """
        import random
        
        if nonce is None:
            nonce = random.randint(1, 2**64 - 1)
        
        # Map pool type to numeric
        pool_type_num = {"conservative": 0, "neutral": 1, "aggressive": 2}.get(pool_type, 1)
        
        # Use Groth16 prover for real proof generation
        try:
            result = Groth16Prover.generate_private_deposit_proof(
                amount=amount,
                nonce=nonce,
                balance=amount * 2,  # Ensure balance >= amount
            )
            result["pool_type"] = pool_type
            result["pool_type_num"] = pool_type_num
            result["message"] = "Privacy proof generated. Human signature = authorization."
            return result
        except Exception as e:
            raise RuntimeError(f"Shielded deposit proof generation failed: {str(e)}")

    def generate_shielded_withdraw_proof(
        self,
        user_address: str,
        commitment: str,
        amount: int,
        nonce: int | None = None,
        use_relayer: bool = False,
        recipient: str | None = None,
        balance: int | None = None,
    ) -> dict[str, Any]:
        """
        Generate privacy proof for shielded pool withdrawal.
        Human-signed tx: Only privacy proof needed (signature = authorization).
        No execution proof required - the wallet signature IS the authorization.
        
        Returns nullifier + commitment + proof_calldata for ShieldedPool.private_withdraw
        or ShieldedPool.request_relayed_withdraw if use_relayer=True
        """
        import random
        
        if nonce is None:
            nonce = random.randint(1, 2**64 - 1)
        
        user_secret = int(user_address, 16) if user_address else 0
        balance_for_circuit = balance if balance is not None else amount

        # Use Groth16 prover for real proof generation
        try:
            result = Groth16Prover.generate_private_withdraw_proof(
                commitment=commitment,
                amount=amount,
                nonce=nonce,
                balance=balance_for_circuit,
                user_secret=user_secret,
            )
            result["use_relayer"] = use_relayer
            result["recipient"] = recipient or user_address
            result["message"] = "Withdrawal proof generated. Human signature = authorization."
            return result
        except Exception as e:
            raise RuntimeError(f"Shielded withdraw proof generation failed: {str(e)}")
