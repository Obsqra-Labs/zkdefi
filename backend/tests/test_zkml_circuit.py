"""
Tests for zkML Circuit - Mock zero-knowledge proof generation
"""

import pytest
from app.services.zkml_circuit import (
    zkMLCircuit,
    CircuitProof,
    ProofType,
    get_circuit,
)


class TestCircuitProofGeneration:
    """Test proof generation"""

    @pytest.fixture
    def circuit(self):
        """Create fresh circuit for each test"""
        return zkMLCircuit()

    @pytest.fixture
    def sample_pools(self):
        """Sample pools for testing"""
        return [
            {
                "pool_id": "ekubo_eth_usdc",
                "protocol": "Ekubo",
                "risk_score": 20,
            },
            {
                "pool_id": "vesu_usdc",
                "protocol": "Vesu",
                "risk_score": 10,
            },
        ]

    def test_allocation_proof_generation(self, circuit, sample_pools):
        """Test generating allocation proof"""
        proof = circuit.prove_allocation_valid(
            user_address="0x1234567890abcdef",
            pools=sample_pools,
            allocation_percentages={
                "ekubo_eth_usdc": 0.60,
                "vesu_usdc": 0.40,
            },
            risk_profile="balanced",
        )

        assert isinstance(proof, CircuitProof)
        assert proof.proof_type == ProofType.ALLOCATION_VALID
        assert proof.verified is True
        assert proof.proof_hash.startswith("0x")
        assert len(proof.proof_hash) == 66  # 0x + 64 hex chars

    def test_proof_deterministic(self, circuit, sample_pools):
        """Same inputs should generate same proof"""
        inputs = {
            "user_address": "0xtest",
            "allocation": {"ekubo_eth_usdc": 0.7, "vesu_usdc": 0.3},
            "risk_profile": "conservative",
        }

        proof1 = circuit.prove_allocation_valid(
            user_address=inputs["user_address"],
            pools=sample_pools,
            allocation_percentages=inputs["allocation"],
            risk_profile=inputs["risk_profile"],
        )

        proof2 = circuit.prove_allocation_valid(
            user_address=inputs["user_address"],
            pools=sample_pools,
            allocation_percentages=inputs["allocation"],
            risk_profile=inputs["risk_profile"],
        )

        assert proof1.proof_hash == proof2.proof_hash

    def test_proof_changed_when_inputs_change(self, circuit, sample_pools):
        """Different inputs should generate different proofs"""
        proof1 = circuit.prove_allocation_valid(
            user_address="0xuser1",
            pools=sample_pools,
            allocation_percentages={"ekubo_eth_usdc": 1.0},
            risk_profile="conservative",
        )

        proof2 = circuit.prove_allocation_valid(
            user_address="0xuser2",  # Different user
            pools=sample_pools,
            allocation_percentages={"ekubo_eth_usdc": 1.0},
            risk_profile="conservative",
        )

        assert proof1.proof_hash != proof2.proof_hash

    def test_allocation_invalid_sum(self, circuit, sample_pools):
        """Reject allocations that don't sum to 100%"""
        with pytest.raises(ValueError, match="sum to ~100%"):
            circuit.prove_allocation_valid(
                user_address="0xtest",
                pools=sample_pools,
                allocation_percentages={
                    "ekubo_eth_usdc": 0.40,
                    "vesu_usdc": 0.40,  # Sum = 80%
                },
                risk_profile="balanced",
            )

    def test_risk_assessment_proof(self, circuit):
        """Test risk assessment proof generation"""
        proof = circuit.prove_risk_assessment(
            pool_id="ekubo_eth_usdc",
            pool_metrics={
                "liquidity_usd": 500_000,
                "volume_24h": 2_000_000,
                "volatility": 0.15,
            },
            calculated_score=20,
        )

        assert proof.proof_type == ProofType.RISK_ASSESSMENT
        assert proof.verified is True
        assert "ekubo_eth_usdc" in proof.circuit_inputs["pool_id"]

    def test_pool_evaluation_proof(self, circuit):
        """Test pool evaluation proof"""
        proof = circuit.prove_pool_evaluation(
            pool_id="ekubo_eth_usdc",
            risk_score=20,
            user_profile="balanced",
            suitable_for_profile=True,
        )

        assert proof.proof_type == ProofType.POOL_EVALUATION
        assert proof.circuit_inputs["suitable"] is True
        assert proof.circuit_inputs["user_profile"] == "balanced"


class TestProofVerification:
    """Test proof verification"""

    @pytest.fixture
    def circuit(self):
        return zkMLCircuit()

    def test_verify_valid_proof(self, circuit):
        """Verify a valid proof"""
        proof = circuit.prove_allocation_valid(
            user_address="0xtest",
            pools=[],
            allocation_percentages={"pool_a": 1.0},
            risk_profile="conservative",
        )

        is_valid = circuit.verify_proof(proof.proof_hash)
        assert is_valid is True

    def test_verify_nonexistent_proof_format(self, circuit):
        """Verify that an invalid format is rejected"""
        invalid_proof = "0xinvalid"
        is_valid = circuit.verify_proof(invalid_proof)
        assert is_valid is False

    def test_verify_with_expected_inputs(self, circuit):
        """Verify proof with expected inputs"""
        proof = circuit.prove_allocation_valid(
            user_address="0xtest",
            pools=[],
            allocation_percentages={"pool_a": 1.0},
            risk_profile="conservative",
        )

        # Should pass with matching inputs
        is_valid = circuit.verify_proof(
            proof.proof_hash,
            expected_inputs=proof.circuit_inputs,
        )
        assert is_valid is True

        # Should fail with different inputs
        is_valid = circuit.verify_proof(
            proof.proof_hash,
            expected_inputs={"different": "input"},
        )
        assert is_valid is False

    def test_verify_valid_felt252_format(self, circuit):
        """Test that felt252 format is checked"""
        # Valid Starknet felt (0x + 64 hex chars)
        valid_felt = "0x" + "a" * 64
        assert circuit._verify_proof_hash_format(valid_felt) is True

        # Invalid: wrong length
        assert circuit._verify_proof_hash_format("0x" + "a" * 63) is False

        # Invalid: no 0x prefix
        assert circuit._verify_proof_hash_format("a" * 64) is False

        # Invalid: non-hex chars
        assert circuit._verify_proof_hash_format("0x" + "g" * 64) is False


class TestCircuitSingleton:
    """Test circuit singleton"""

    def test_singleton_instance(self):
        """get_circuit() returns same instance"""
        circuit1 = get_circuit()
        circuit2 = get_circuit()
        assert circuit1 is circuit2

    def test_proof_cache_persistence(self):
        """Proofs are cached across calls"""
        circuit = get_circuit()

        proof = circuit.prove_allocation_valid(
            user_address="0xcached",
            pools=[],
            allocation_percentages={"pool_a": 1.0},
            risk_profile="conservative",
        )

        # Proof should be in cache
        assert proof.proof_hash in circuit.proof_cache


class TestProofInputs:
    """Test that circuit inputs are properly recorded"""

    @pytest.fixture
    def circuit(self):
        return zkMLCircuit()

    def test_allocation_proof_stores_inputs(self, circuit):
        """Allocation proof stores all circuit inputs"""
        allocation = {"pool_a": 0.6, "pool_b": 0.4}
        pools = [{"pool_id": "pool_a"}, {"pool_id": "pool_b"}]

        proof = circuit.prove_allocation_valid(
            user_address="0xuser",
            pools=pools,
            allocation_percentages=allocation,
            risk_profile="balanced",
        )

        inputs = proof.circuit_inputs
        assert inputs["user_address"] == "0xuser"
        assert inputs["allocation"] == allocation
        assert inputs["risk_profile"] == "balanced"
        assert inputs["pools_evaluated"] == 2

    def test_risk_assessment_stores_metrics(self, circuit):
        """Risk assessment stores pool metrics"""
        metrics = {
            "liquidity_usd": 1_000_000,
            "volume_24h": 5_000_000,
            "volatility": 0.25,
        }

        proof = circuit.prove_risk_assessment(
            pool_id="ekubo_eth_usdc",
            pool_metrics=metrics,
            calculated_score=45,
        )

        inputs = proof.circuit_inputs
        assert inputs["metrics"] == metrics
        assert inputs["calculated_score"] == 45
        assert inputs["pool_id"] == "ekubo_eth_usdc"


class TestProofConsistency:
    """Test proof consistency over multiple calls"""

    @pytest.fixture
    def circuit(self):
        return zkMLCircuit()

    def test_multiple_proofs_unique(self, circuit):
        """Different allocations generate different proofs"""
        proofs = []

        for alloc_pct in [0.3, 0.5, 0.7]:
            proof = circuit.prove_allocation_valid(
                user_address="0xtest",
                pools=[],
                allocation_percentages={"pool_a": alloc_pct, "pool_b": 1.0 - alloc_pct},
                risk_profile="balanced",
            )
            proofs.append(proof)

        # All should be unique
        proof_hashes = [p.proof_hash for p in proofs]
        assert len(proof_hashes) == len(set(proof_hashes))

    def test_proof_timestamp_recorded(self, circuit):
        """Proof timestamp should be reasonable"""
        import time

        before = int(time.time())
        proof = circuit.prove_allocation_valid(
            user_address="0xtest",
            pools=[],
            allocation_percentages={"pool_a": 1.0},
            risk_profile="conservative",
        )
        after = int(time.time())

        assert before <= proof.timestamp <= after + 1
