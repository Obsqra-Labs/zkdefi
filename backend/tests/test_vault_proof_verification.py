"""
Test: VaultController requires valid STARK proof before executing proposal
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from app.services.vault_execute_service import execute_vault_allocation


@pytest.mark.asyncio
async def test_vault_execution_generates_proof():
    """
    Test that vault allocation generates a STARK proof before execution
    """
    # Mock proof generation
    mock_proof = {
        "fact_hash": "0x123abc",
        "proof_data": "0xdeadbeef",
        "security_bits": 128,
    }
    
    with patch('app.services.proof_pipeline.generate_vault_allocation_proof', new_callable=AsyncMock) as mock_gen_proof:
        mock_gen_proof.return_value = mock_proof
        
        # Mock contract calls
        with patch('app.services.vault_execute_service._submit_proof_to_registry', new_callable=AsyncMock):
            with patch('app.services.vault_execute_service._call_vault_controller_with_proof', new_callable=AsyncMock) as mock_call_contract:
                mock_call_contract.return_value = "0xtxhash"
                
                # Execute allocation
                result = await execute_vault_allocation(
                    user_address="0x123",
                    allocations=[],
                    deposit_amount=1000000000000000000,  # 1 ETH
                )
                
                # Verify proof was generated
                mock_gen_proof.assert_called_once()
                
                # Verify proof was submitted to registry
                assert result["proof_hash"] == mock_proof["fact_hash"]
                assert result["verified_on_chain"] == True


@pytest.mark.asyncio
async def test_vault_rejects_execution_without_proof():
    """
    Test that VaultController rejects execution if proof is not verified
    """
    with patch('app.services.proof_pipeline.generate_vault_allocation_proof', side_effect=Exception("Proof generation failed")):
        with pytest.raises(Exception) as exc_info:
            await execute_vault_allocation(
                user_address="0x123",
                allocations=[],
                deposit_amount=1000000000000000000,
            )
        
        assert "Proof generation failed" in str(exc_info.value)


def test_proof_hash_stored_in_receipt():
    """
    Test that proof hash is stored in execution receipt
    """
    from app.services.receipt_service import get_receipt_service
    
    receipt_svc = get_receipt_service()
    
    # Create a receipt with proof hash
    receipt = receipt_svc.create_receipt(
        user_address="0x123",
        action_type="vault_allocation",
        amount=1000000000000000000,
        metadata={
            "proof_hash": "0xabc123",
            "security_bits": 128,
            "verified_on_chain": True,
        }
    )
    
    # Verify proof hash is in receipt
    assert receipt["metadata"]["proof_hash"] == "0xabc123"
    assert receipt["metadata"]["verified_on_chain"] == True
    assert receipt["metadata"]["security_bits"] == 128


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
