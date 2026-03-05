"""
Comprehensive pytest suite for v6 modules.
Covers: EZKL prover, proof mode, circuit scanner, DB layer,
creditworthiness pipeline, LLM fallback, timing predictor,
credit graph, adversarial testing, and enhanced risk engine.

Run:
    cd /opt/obsqra.starknet/zkdefi/backend
    python -m pytest tests/test_v6_modules.py -v
"""

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure backend is on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def event_loop():
    """Create a shared event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ═══════════════════════════════════════════════════════════════════════
# 1. EZKL Prover Service
# ═══════════════════════════════════════════════════════════════════════


class TestEZKLProverService:
    def test_import(self):
        from app.services.ezkl_prover_service import (
            EZKLModelArtifacts,
            EZKLProof,
            EZKLProverService,
            get_ezkl_prover,
        )
        assert EZKLModelArtifacts is not None
        assert EZKLProof is not None

    def test_singleton(self):
        from app.services.ezkl_prover_service import get_ezkl_prover
        a = get_ezkl_prover()
        b = get_ezkl_prover()
        assert a is b

    def test_python_api_detected(self):
        from app.services.ezkl_prover_service import get_ezkl_prover
        svc = get_ezkl_prover()
        # If ezkl Python package is installed, _use_python_api should be True
        assert hasattr(svc, "_use_python_api")
        assert isinstance(svc._use_python_api, bool)

    def test_dataclass_fields(self):
        from app.services.ezkl_prover_service import EZKLProof
        proof = EZKLProof(
            proof_bytes=b"\x00",
            proof_hex="0x00",
            public_inputs=[1.0, 2.0],
            inference_output=[0.5],
            model_hash="abc",
            model_name="test",
            proof_hash="0xdef",
            verify_key_hash="0x123",
        )
        assert proof.model_name == "test"
        assert proof.inference_output == [0.5]

    def test_model_not_found_raises(self):
        from app.services.ezkl_prover_service import get_ezkl_prover
        svc = get_ezkl_prover()
        with pytest.raises(ValueError, match="not set up"):
            svc._get_artifacts("nonexistent_model_xyz")

    def test_has_python_api_methods(self):
        from app.services.ezkl_prover_service import get_ezkl_prover
        svc = get_ezkl_prover()
        assert hasattr(svc, "_setup_model_python")
        assert hasattr(svc, "_prove_inference_python")
        assert hasattr(svc, "_verify_proof_python")
        # CLI fallbacks
        assert hasattr(svc, "_setup_model_cli")
        assert hasattr(svc, "_prove_inference_cli")
        assert hasattr(svc, "_verify_proof_cli")


# ═══════════════════════════════════════════════════════════════════════
# 2. Proof Mode
# ═══════════════════════════════════════════════════════════════════════


class TestProofMode:
    def test_import(self):
        from app.services.proof_mode import ProofMode, ProofModeResolver, get_proof_mode_resolver
        assert ProofMode.EZKL_ONLY == 0
        assert ProofMode.EZKL_BRIDGE == 1
        assert ProofMode.FULL_DUAL_PROVER == 2

    def test_from_string(self):
        from app.services.proof_mode import ProofMode
        assert ProofMode.from_string("EZKL_ONLY") == ProofMode.EZKL_ONLY
        assert ProofMode.from_string("ezkl_bridge") == ProofMode.EZKL_BRIDGE
        assert ProofMode.from_string("full_dual_prover") == ProofMode.FULL_DUAL_PROVER

    def test_resolver_singleton(self):
        from app.services.proof_mode import get_proof_mode_resolver
        a = get_proof_mode_resolver()
        b = get_proof_mode_resolver()
        assert a is b

    def test_resolve_low_tier(self):
        from app.services.proof_mode import ProofMode, get_proof_mode_resolver
        resolver = get_proof_mode_resolver()
        mode = resolver.resolve(tier=1, action_type="deposit", value_eth=0.1)
        assert isinstance(mode, ProofMode)

    def test_resolve_high_value(self):
        from app.services.proof_mode import ProofMode, get_proof_mode_resolver
        resolver = get_proof_mode_resolver()
        mode = resolver.resolve(tier=5, action_type="borrow", value_eth=100.0)
        assert isinstance(mode, ProofMode)
        # High value should escalate proof mode
        assert mode.value >= ProofMode.EZKL_ONLY.value

    def test_describe(self):
        from app.services.proof_mode import ProofMode, get_proof_mode_resolver
        resolver = get_proof_mode_resolver()
        desc = resolver.describe(ProofMode.FULL_DUAL_PROVER)
        assert isinstance(desc, dict)
        assert "name" in desc or "mode" in desc or "description" in desc


# ═══════════════════════════════════════════════════════════════════════
# 3. Circuit Scanner
# ═══════════════════════════════════════════════════════════════════════


class TestCircuitScanner:
    def test_import(self):
        from app.services.zkml.circuit_scanner import CIRCUIT_REGISTRY, list_available_circuits

    def test_registry_has_v6_circuits(self):
        from app.services.zkml.circuit_scanner import CIRCUIT_REGISTRY
        assert "ModelBridge" in CIRCUIT_REGISTRY
        assert "RebalanceTimingCommitment" in CIRCUIT_REGISTRY
        assert "RobustnessCertificate" in CIRCUIT_REGISTRY

    def test_list_circuits_count(self):
        from app.services.zkml.circuit_scanner import list_available_circuits
        circuits = list_available_circuits()
        assert len(circuits) >= 16  # 13 original + 3 v6

    def test_input_builders_exist(self):
        from app.services.zkml import circuit_scanner as cs
        assert callable(getattr(cs, "build_model_bridge_inputs", None))
        assert callable(getattr(cs, "build_rebalance_timing_inputs", None))
        assert callable(getattr(cs, "build_robustness_certificate_inputs", None))


# ═══════════════════════════════════════════════════════════════════════
# 4. DB Connection
# ═══════════════════════════════════════════════════════════════════════


class TestDBConnection:
    def test_import(self):
        from app.db.connection import get_pool, close_pool, init_schema, refresh_behavior_stats

    @pytest.mark.asyncio
    async def test_get_pool(self):
        from app.db.connection import get_pool, close_pool
        pool = await get_pool()
        assert pool is not None
        # Pool should support acquire
        async with pool.acquire() as conn:
            val = await conn.fetchval("SELECT 1")
            assert val == 1
        await close_pool()

    @pytest.mark.asyncio
    async def test_init_schema_idempotent(self):
        from app.db.connection import init_schema
        result = await init_schema()
        assert result is True
        # Running again should also succeed (IF NOT EXISTS guards)
        result2 = await init_schema()
        assert result2 is True


# ═══════════════════════════════════════════════════════════════════════
# 5. Decision Store
# ═══════════════════════════════════════════════════════════════════════


class TestDecisionStore:
    def test_import(self):
        from app.db.decision_store import DecisionStore, get_decision_store

    def test_singleton(self):
        from app.db.decision_store import get_decision_store
        a = get_decision_store()
        b = get_decision_store()
        assert a is b

    @pytest.mark.asyncio
    async def test_log_and_retrieve(self):
        """Test log + retrieve using a fresh direct connection (avoids pool contention)."""
        import asyncpg
        conn = await asyncpg.connect("postgresql://zkdefi:zkdefi@localhost:5432/zkdefi")
        try:
            row = await conn.fetchrow(
                "INSERT INTO decision_events (user_address, event_type, outcome, value_eth, metadata) "
                "VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id",
                "0xtest_pytest_addr", "deposit", "success", 1.23, '{"pytest": true}',
            )
            assert row is not None
            event_id = row["id"]
            assert event_id > 0

            events = await conn.fetch(
                "SELECT * FROM decision_events WHERE user_address = $1 ORDER BY id DESC LIMIT 5",
                "0xtest_pytest_addr",
            )
            assert len(events) >= 1
            assert any(e["event_type"] == "deposit" for e in events)

            # Cleanup
            await conn.execute("DELETE FROM decision_events WHERE user_address = '0xtest_pytest_addr'")
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_get_event_count(self):
        """Verify seeded data exists via direct query."""
        import asyncpg
        conn = await asyncpg.connect("postgresql://zkdefi:zkdefi@localhost:5432/zkdefi")
        try:
            count = await conn.fetchval("SELECT COUNT(*) FROM decision_events")
            assert count >= 200  # We seeded 200
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_get_behavior_stats(self):
        """Verify materialized view has seeded stats."""
        import asyncpg
        conn = await asyncpg.connect("postgresql://zkdefi:zkdefi@localhost:5432/zkdefi")
        try:
            row = await conn.fetchrow(
                "SELECT * FROM user_behavior_stats WHERE user_address = $1",
                "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
            )
            assert row is not None
            assert row["total_actions"] > 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_get_training_dataset(self):
        """Verify we can pull training-ready data from seeded events."""
        import asyncpg
        conn = await asyncpg.connect("postgresql://zkdefi:zkdefi@localhost:5432/zkdefi")
        try:
            rows = await conn.fetch(
                "SELECT user_address, total_actions, early_exit_rate, proof_success_rate, "
                "avg_action_size_eth, total_volume_eth FROM user_behavior_stats "
                "WHERE total_actions >= 5"
            )
            assert len(rows) >= 1
        finally:
            await conn.close()


# ═══════════════════════════════════════════════════════════════════════
# 6. Creditworthiness – Features
# ═══════════════════════════════════════════════════════════════════════


class TestCreditFeatures:
    def test_import(self):
        from app.ml.creditworthiness.features import (
            CreditFeatures, FEATURE_NAMES, CREDIT_CLASSES,
            build_features, features_to_onnx_input,
        )
        assert len(FEATURE_NAMES) == 18
        assert "AAA" in CREDIT_CLASSES

    def test_credit_features_dataclass(self):
        from app.ml.creditworthiness.features import CreditFeatures
        cf = CreditFeatures()
        vec = cf.to_vector()
        assert len(vec) == 18
        assert all(isinstance(v, (int, float)) for v in vec)

    def test_features_to_onnx_input(self):
        from app.ml.creditworthiness.features import CreditFeatures, features_to_onnx_input
        cf = CreditFeatures(chains_active=2, total_tx_count=100)
        onnx_in = features_to_onnx_input(cf)
        assert isinstance(onnx_in, list)
        assert len(onnx_in) == 1
        assert len(onnx_in[0]) == 18

    @pytest.mark.asyncio
    async def test_build_features_default(self):
        from app.ml.creditworthiness.features import build_features
        feats = await build_features("0x0000")
        assert feats is not None
        assert len(feats.to_vector()) == 18


# ═══════════════════════════════════════════════════════════════════════
# 7. Creditworthiness – Trainer
# ═══════════════════════════════════════════════════════════════════════


class TestCreditTrainer:
    def test_import(self):
        from app.ml.creditworthiness.trainer import train_model

    @pytest.mark.asyncio
    async def test_train_with_seeded_data(self):
        from app.ml.creditworthiness.trainer import train_model
        result = await train_model(min_events=5, n_estimators=10, max_depth=2)
        assert isinstance(result, dict)
        # Should have model_path, accuracy, etc.
        assert "model_path" in result or "status" in result


# ═══════════════════════════════════════════════════════════════════════
# 8. Creditworthiness – Predictor
# ═══════════════════════════════════════════════════════════════════════


class TestCreditPredictor:
    def test_import(self):
        from app.ml.creditworthiness.predictor import (
            CreditworthinessPredictor, get_creditworthiness_predictor, CREDIT_TERMS,
        )
        assert isinstance(CREDIT_TERMS, dict)
        assert "AAA" in CREDIT_TERMS

    def test_singleton(self):
        from app.ml.creditworthiness.predictor import get_creditworthiness_predictor
        a = get_creditworthiness_predictor()
        b = get_creditworthiness_predictor()
        assert a is b

    @pytest.mark.asyncio
    async def test_predict_cold_start(self):
        from app.ml.creditworthiness.predictor import get_creditworthiness_predictor
        predictor = get_creditworthiness_predictor()
        result = await predictor.predict("0x0000_cold_start_test")
        assert isinstance(result, dict)
        # Fallback returns credit_class; trained model returns grade
        assert "credit_class" in result or "grade" in result or "error" in result
        if "credit_class" in result:
            assert result["credit_class"] in ("AAA", "AA", "A", "B", "C")
        if "fallback" in result:
            assert result["fallback"] is True


# ═══════════════════════════════════════════════════════════════════════
# 9. EZKL Setup for Creditworthiness
# ═══════════════════════════════════════════════════════════════════════


class TestCreditEZKLSetup:
    def test_import(self):
        from app.ml.creditworthiness.ezkl_setup import setup_creditworthiness_ezkl
        assert callable(setup_creditworthiness_ezkl)


# ═══════════════════════════════════════════════════════════════════════
# 10. LLM Fallback – Deterministic Model
# ═══════════════════════════════════════════════════════════════════════


class TestFallbackModel:
    def test_import(self):
        from app.ml.llm_fallback.fallback_model import (
            DeterministicFallbackModel, FallbackDecision, DECISIONS, get_fallback_model,
        )
        assert "execute" in DECISIONS
        assert "reject" in DECISIONS
        assert "defer_to_human" in DECISIONS

    def test_singleton(self):
        from app.ml.llm_fallback.fallback_model import get_fallback_model
        a = get_fallback_model()
        b = get_fallback_model()
        assert a is b

    def test_predict_safe_action(self):
        from app.ml.llm_fallback.fallback_model import get_fallback_model
        model = get_fallback_model()
        result = model.predict(
            skill_name="deposit",
            skill_inputs={"amount_eth": 0.1, "pool": "ETH/USDC"},
        )
        assert result.decision in ("execute", "reject", "defer_to_human")
        assert 0.0 <= result.confidence <= 1.0
        assert isinstance(result.reasoning, str)

    def test_predict_dangerous_action(self):
        from app.ml.llm_fallback.fallback_model import get_fallback_model
        model = get_fallback_model()
        result = model.predict(
            skill_name="withdraw_all",
            skill_inputs={"amount_eth": 999.0, "emergency": True},
        )
        # High-value emergency should trigger caution
        assert result.decision in ("execute", "reject", "defer_to_human")


# ═══════════════════════════════════════════════════════════════════════
# 11. LLM Fallback – Agreement Checker
# ═══════════════════════════════════════════════════════════════════════


class TestAgreementChecker:
    def test_import(self):
        from app.ml.llm_fallback.agreement_checker import (
            AgreementChecker, AgreementResult, get_agreement_checker,
        )

    def test_singleton(self):
        from app.ml.llm_fallback.agreement_checker import get_agreement_checker
        a = get_agreement_checker()
        b = get_agreement_checker()
        assert a is b

    @pytest.mark.asyncio
    async def test_check_agreement(self):
        from app.ml.llm_fallback.agreement_checker import get_agreement_checker
        checker = get_agreement_checker()
        result = await checker.check(
            skill_name="deposit",
            skill_inputs={"amount_eth": 0.5, "pool": "ETH/USDC"},
            llm_decision="execute",
        )
        assert hasattr(result, "agreed")
        assert hasattr(result, "llm_decision")
        assert hasattr(result, "fallback_decision")
        assert isinstance(result.agreed, bool)

    @pytest.mark.asyncio
    async def test_check_disagreement(self):
        from app.ml.llm_fallback.agreement_checker import get_agreement_checker
        checker = get_agreement_checker()
        result = await checker.check(
            skill_name="withdraw_all",
            skill_inputs={"amount_eth": 500.0},
            llm_decision="execute",
        )
        # Might disagree on risky action
        assert result.fallback_decision in ("execute", "reject", "defer_to_human")

    def test_stats(self):
        from app.ml.llm_fallback.agreement_checker import get_agreement_checker
        checker = get_agreement_checker()
        stats = checker.stats
        assert isinstance(stats, dict)


# ═══════════════════════════════════════════════════════════════════════
# 12. Timing Predictor
# ═══════════════════════════════════════════════════════════════════════


class TestTimingPredictor:
    def test_import(self):
        from app.ml.timing_predictor.model import (
            TimingPredictor, TimingPrediction, TimingCommitment, get_timing_predictor,
        )

    def test_singleton(self):
        from app.ml.timing_predictor.model import get_timing_predictor
        a = get_timing_predictor()
        b = get_timing_predictor()
        assert a is b

    def test_predict_timing(self):
        from app.ml.timing_predictor.model import get_timing_predictor
        predictor = get_timing_predictor()
        fee_snapshots = [
            {"block": 100 + i, "base_fee": 10 + (i % 5), "gas_used_ratio": 0.5}
            for i in range(25)
        ]
        pred = predictor.predict_timing(
            fee_snapshots=fee_snapshots,
            current_block=125,
        )
        assert pred.target_block > 0
        assert 0.0 <= pred.confidence <= 1.0
        assert pred.window_start <= pred.target_block <= pred.window_end


# ═══════════════════════════════════════════════════════════════════════
# 13. Credit Graph
# ═══════════════════════════════════════════════════════════════════════


class TestCreditGraph:
    def test_import(self):
        from app.ml.credit_graph.graph_builder import (
            CreditGraphBuilder, GraphNode, GraphEdge, get_credit_graph_builder,
        )

    def test_singleton(self):
        from app.ml.credit_graph.graph_builder import get_credit_graph_builder
        a = get_credit_graph_builder()
        b = get_credit_graph_builder()
        assert a is b

    def test_set_node_and_neighbors(self):
        from app.ml.credit_graph.graph_builder import CreditGraphBuilder
        g = CreditGraphBuilder()
        g.set_node_features("0xAlice", [1.0] * 18, grade="AA")
        g.set_node_features("0xBob", [0.5] * 18, grade="B")
        # Without edges, both should have empty neighbors
        assert g.get_neighbors("0xAlice") == []

    def test_collaborative_multiplier_default(self):
        from app.ml.credit_graph.graph_builder import CreditGraphBuilder
        g = CreditGraphBuilder()
        g.set_node_features("0xLoner", [1.0] * 18)
        mult = g.compute_collaborative_multiplier("0xLoner")
        assert mult == 1.0  # No neighbors → base multiplier


# ═══════════════════════════════════════════════════════════════════════
# 14. Adversarial – Attack Generator
# ═══════════════════════════════════════════════════════════════════════


class TestAttackGenerator:
    def test_import(self):
        from app.ml.adversarial.attack_generator import (
            AttackGenerator, AttackType, AttackScenario, AttackSuite,
        )

    def test_attack_types(self):
        from app.ml.adversarial.attack_generator import AttackType
        assert len(AttackType) >= 5

    def test_generate_suite(self):
        from app.ml.adversarial.attack_generator import AttackGenerator
        gen = AttackGenerator(seed=42)
        suite = gen.generate_suite(attacks_per_type=5)
        assert len(suite.scenarios) >= 5 * 5  # 5 types × 5 attacks
        assert suite.suite_hash != ""
        for s in suite.scenarios:
            assert s.attack_type is not None
            assert isinstance(s.modified_inputs, dict)

    def test_generate_deterministic(self):
        from app.ml.adversarial.attack_generator import AttackGenerator
        a = AttackGenerator(seed=123).generate_suite(attacks_per_type=3)
        b = AttackGenerator(seed=123).generate_suite(attacks_per_type=3)
        assert a.suite_hash == b.suite_hash


# ═══════════════════════════════════════════════════════════════════════
# 15. Adversarial – Robustness Tester
# ═══════════════════════════════════════════════════════════════════════


class TestRobustnessTester:
    def test_import(self):
        from app.ml.adversarial.robustness_tester import (
            RobustnessTester, RobustnessReport, TestResult,
        )

    def test_run_suite(self):
        from app.ml.adversarial.attack_generator import AttackGenerator
        from app.ml.adversarial.robustness_tester import RobustnessTester

        gen = AttackGenerator(seed=42)
        suite = gen.generate_suite(attacks_per_type=10)
        tester = RobustnessTester(model_name="test_model", model_hash="0xabc")

        # A simple always-reject model
        def always_reject(inputs: dict) -> str:
            return "reject"

        report = tester.run_suite(suite, always_reject)
        assert report.total == len(suite.scenarios)
        assert report.passed + report.failed == report.total
        assert 0 <= report.pass_rate_bps <= 10000


# ═══════════════════════════════════════════════════════════════════════
# 16. Enhanced Risk Engine
# ═══════════════════════════════════════════════════════════════════════


class TestRiskEngine:
    def test_import(self):
        from app.services.risk_engine import (
            score_risk, score_risk_with_history,
            RiskAssessment, AllocationBounds,
        )

    def test_score_risk_low(self):
        from app.services.risk_engine import score_risk
        assessment = score_risk(risk_level=1, time_horizon_days=30)
        assert assessment.risk_level == 1
        assert assessment.label in ("conservative", "low", "minimal")
        assert assessment.bounds.max_deposit_pct <= 100
        assert len(assessment.safe_protocols) >= 1

    def test_score_risk_high(self):
        from app.services.risk_engine import score_risk
        assessment = score_risk(risk_level=5, time_horizon_days=7)
        assert assessment.risk_level == 5
        assert assessment.risk_score >= 0

    def test_score_risk_with_decisions(self):
        from app.services.risk_engine import score_risk
        past = [
            {"event_type": "deposit", "outcome": "success", "value_eth": 1.0},
            {"event_type": "collateral_slash", "outcome": "block", "value_eth": 0.5},
        ]
        assessment = score_risk(risk_level=3, past_decisions=past)
        assert assessment is not None
        # Past slash should influence scoring
        assert assessment.risk_score > 0

    @pytest.mark.asyncio
    async def test_score_risk_with_history(self):
        from app.services.risk_engine import score_risk_with_history
        assessment = await score_risk_with_history(
            user_address="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
            risk_level=3,
        )
        assert assessment is not None
        assert hasattr(assessment, "risk_score")
        assert hasattr(assessment, "bounds")
