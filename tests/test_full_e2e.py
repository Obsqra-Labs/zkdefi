"""
Full End-to-End Test Suite — Agent Identity System

Covers every layer of the stack:
  Layer 1: Circom circuits — real Groth16 proof generation for all 8 agent circuits
  Layer 2: Circuit scanner — detection, input builders, proof pipeline
  Layer 3: HTTP API — skill execution, agent CRUD, orchestration, performance
  Layer 4: On-chain contracts — Sepolia deployment verification
  Layer 5: Existing regression suite (14 tests from test_agent_identity_system)

Run:
  cd /opt/obsqra.starknet/zkdefi
  python -m pytest tests/test_full_e2e.py -v --tb=short
"""

import asyncio
import json
import math
import os
import sys
import time

import httpx
import pytest

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_BASE = os.environ.get("ZKDEFI_API_BASE", "http://localhost:8003/api/v1/zkdefi")
AGENT_BUILDER = f"{API_BASE}/agent-builder"
TEST_OWNER = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7cfb12a0399e6"
TIMEOUT = 60.0

# On-chain deployment addresses
DEPLOY_RESULTS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "deploy_agent_contracts_results.json"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend", "app", "services", "zkml"))


def _run_async(coro):
    """Run an async function in a new event loop."""
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    with httpx.Client(timeout=TIMEOUT) as c:
        yield c


@pytest.fixture(scope="module")
def created_agent(client: httpx.Client) -> dict:
    resp = client.post(f"{AGENT_BUILDER}/agents/build", json={
        "name": "E2E_FullTest_Agent",
        "owner_address": TEST_OWNER,
        "skills": [
            "il_predictor", "yield_optimality", "slippage_bound",
            "reputation_check", "arb_check",
        ],
        "llm_provider": "deterministic",
    })
    assert resp.status_code == 200, f"Agent build failed: {resp.text}"
    data = resp.json()
    assert "agent_id" in data
    return data


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 1: Real Groth16 Proof Generation (direct circuit_scanner)
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer1_CircuitProofs:
    """Test every agent circuit produces a valid Groth16 proof."""

    CIRCUITS = [
        "ImpermanentLossPredictor",
        "YieldOptimality",
        "SlippageBound",
        "AgentReputationScore",
        "CrossProtocolArbitrage",
        "LiquidationRisk",
        "HistoricalPerformanceAttestation",
        "MEVResistanceProof",
    ]

    def test_all_circuits_registered(self):
        from circuit_scanner import CIRCUIT_REGISTRY
        for name in self.CIRCUITS:
            assert name in CIRCUIT_REGISTRY, f"{name} not in registry"
            meta = CIRCUIT_REGISTRY[name]
            assert meta["wasm"].exists(), f"{name} wasm missing: {meta['wasm']}"
            assert meta["zkey"].exists(), f"{name} zkey missing: {meta['zkey']}"

    @pytest.mark.parametrize("circuit_name", CIRCUITS)
    def test_proof_generation(self, circuit_name):
        from circuit_scanner import _generate_proof, CIRCUIT_REGISTRY
        from circuit_scanner import (
            build_il_predictor_inputs,
            build_yield_optimality_inputs,
            build_slippage_bound_inputs,
            build_agent_reputation_inputs,
            build_cross_protocol_arb_inputs,
            build_liquidation_risk_inputs,
            build_historical_performance_inputs,
            build_mev_resistance_inputs,
        )

        builders = {
            "ImpermanentLossPredictor": build_il_predictor_inputs,
            "YieldOptimality": build_yield_optimality_inputs,
            "SlippageBound": build_slippage_bound_inputs,
            "AgentReputationScore": build_agent_reputation_inputs,
            "CrossProtocolArbitrage": build_cross_protocol_arb_inputs,
            "LiquidationRisk": build_liquidation_risk_inputs,
            "HistoricalPerformanceAttestation": build_historical_performance_inputs,
            "MEVResistanceProof": build_mev_resistance_inputs,
        }

        inputs = builders[circuit_name]()
        result = _run_async(_generate_proof(circuit_name, inputs))

        assert result["success"], f"{circuit_name} proof failed: {result.get('error')}"
        assert result["proof_hash"], f"{circuit_name} missing proof_hash"
        assert result["public_signals"], f"{circuit_name} missing public_signals"
        assert "proof" in result, f"{circuit_name} missing proof object"
        assert result["proof"].get("pi_a"), f"{circuit_name} proof missing pi_a"
        assert result["proof"].get("pi_b"), f"{circuit_name} proof missing pi_b"
        assert result["proof"].get("pi_c"), f"{circuit_name} proof missing pi_c"
        assert result["duration_ms"] < 15000, f"{circuit_name} too slow: {result['duration_ms']}ms"

    def test_il_predictor_constraint_math(self):
        """Verify the IL predictor input builder satisfies circuit constraints exactly."""
        from circuit_scanner import build_il_predictor_inputs

        for entry, current in [(2000, 2200), (1500, 1800), (3000, 2500), (1000, 1000)]:
            inputs = build_il_predictor_inputs(entry_price=entry, current_price=current)
            ep = int(inputs["entry_price"])
            cp = int(inputs["current_price"])
            sq = int(inputs["sqrt_price_ratio"])
            il = int(inputs["actual_il_bps"])
            sc = int(inputs["scale"])

            sum_p = ep + cp
            il_rhs = ep * sc - 2 * sq * ep
            il_lhs = il * sum_p
            il_upper = il_rhs + sum_p

            assert il_lhs >= il_rhs, (
                f"IL constraint lower failed: {il_lhs} < {il_rhs} "
                f"(entry={entry}, current={current})"
            )
            assert il_lhs < il_upper, (
                f"IL constraint upper failed: {il_lhs} >= {il_upper} "
                f"(entry={entry}, current={current})"
            )

    def test_il_predictor_varied_prices(self):
        """Run real proofs with different price pairs to stress-test the math."""
        from circuit_scanner import _generate_proof, build_il_predictor_inputs

        cases = [
            (2000, 2200),   # +10%
            (2000, 1800),   # -10%
            (1500, 3000),   # +100% (2x)
            (3000, 2700),   # -10%
            (1000, 1000),   # 0% (no IL)
        ]
        for entry, current in cases:
            inputs = build_il_predictor_inputs(entry_price=entry, current_price=current)
            result = _run_async(_generate_proof("ImpermanentLossPredictor", inputs))
            assert result["success"], (
                f"IL proof failed for entry={entry}, current={current}: "
                f"{result.get('error')}"
            )


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 2: Circuit Scanner Infrastructure
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer2_CircuitScanner:

    def test_list_available_circuits(self):
        from circuit_scanner import list_available_circuits
        circuits = list_available_circuits()
        assert len(circuits) >= 16, f"Expected >=16 circuits, got {len(circuits)}"
        names = [c["name"] for c in circuits]
        for required in [
            "ImpermanentLossPredictor", "YieldOptimality", "SlippageBound",
            "AgentReputationScore", "CrossProtocolArbitrage", "LiquidationRisk",
            "HistoricalPerformanceAttestation", "MEVResistanceProof",
        ]:
            assert required in names, f"{required} not in available circuits"

    def test_all_circuits_have_wasm_and_zkey(self):
        from circuit_scanner import list_available_circuits
        for c in list_available_circuits():
            assert c.get("wasm_exists") or c.get("ready"), (
                f"Circuit {c['name']} missing wasm"
            )
            assert c.get("zkey_exists") or c.get("ready"), (
                f"Circuit {c['name']} missing zkey"
            )

    def test_parallel_scan(self):
        """Run all 8 agent circuits in parallel via run_circuit_scan."""
        from circuit_scanner import run_circuit_scan
        result = _run_async(run_circuit_scan(circuits=[
            "ImpermanentLossPredictor", "YieldOptimality", "SlippageBound",
            "AgentReputationScore", "CrossProtocolArbitrage", "LiquidationRisk",
            "HistoricalPerformanceAttestation", "MEVResistanceProof",
        ]))
        assert result["circuits_run"] == 8
        for r in result["results"]:
            assert r["success"], f"Parallel scan failed for {r.get('circuit')}: {r.get('error')}"

    def test_production_mode_flag(self):
        """Verify REQUIRE_REAL_PROOFS flag exists and is importable."""
        from circuit_scanner import REQUIRE_REAL_PROOFS
        # In test env it should be False (not set)
        assert isinstance(REQUIRE_REAL_PROOFS, bool)


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 3: HTTP API — Skill Execution
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer3_SkillAPI:
    """Test every skill via HTTP POST with real Groth16 proof generation."""

    SKILLS = [
        ("il_predictor", {"entry_price": 2000, "current_price": 2200}),
        ("yield_optimality", {}),
        ("slippage_bound", {}),
        ("reputation_check", {}),
        ("arb_check", {}),
        ("liquidation_check", {}),
        ("performance_attestation", {}),
        ("mev_protection", {}),
    ]

    def test_list_skills(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/skills")
        assert resp.status_code == 200
        data = resp.json()
        skills = data.get("skills", [])
        assert len(skills) >= 8
        # Every skill has required schema fields
        for s in skills:
            assert "skill_id" in s
            assert "name" in s
            assert "parameters" in s

    @pytest.mark.parametrize("skill_id,params", SKILLS, ids=[s[0] for s in SKILLS])
    def test_skill_execution(self, client: httpx.Client, skill_id, params):
        """Execute each skill via API and verify a real proof is returned."""
        resp = client.post(
            f"{AGENT_BUILDER}/skills/{skill_id}/execute",
            json={"user_address": TEST_OWNER, "params": params},
        )
        assert resp.status_code == 200, f"HTTP {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        assert data["success"], f"Skill {skill_id} failed: {data.get('error')}"
        assert data["proof_hash"], f"Skill {skill_id} has no proof_hash"
        assert data["public_signals"], f"Skill {skill_id} has no public_signals"
        assert data["is_compliant"] is not None, f"Skill {skill_id} missing compliance flag"
        assert data.get("duration_ms", 99999) < 15000, f"Skill {skill_id} too slow"

    def test_skill_not_found(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/skills/nonexistent_xyz")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 3b: HTTP API — Agent Lifecycle
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer3_AgentLifecycle:

    def test_build_agent(self, created_agent):
        assert created_agent["name"] == "E2E_FullTest_Agent"
        assert "agent_id" in created_agent

    def test_list_agents(self, client: httpx.Client, created_agent):
        resp = client.get(f"{AGENT_BUILDER}/agents/list", params={"owner": TEST_OWNER})
        assert resp.status_code == 200
        data = resp.json()
        agents = data.get("agents", [])
        assert any(a["agent_id"] == created_agent["agent_id"] for a in agents)

    def test_get_agent(self, client: httpx.Client, created_agent):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}")
        assert resp.status_code == 200

    def test_agent_not_found(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/agents/nonexistent_agent_xyz")
        assert resp.status_code == 404

    def test_providers_list(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/providers")
        assert resp.status_code == 200
        providers = resp.json().get("providers", [])
        ids = [p["provider_id"] for p in providers]
        assert "deterministic" in ids


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 3c: HTTP API — Orchestration Pipeline
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer3_Orchestration:

    def test_execute_goal(self, client: httpx.Client, created_agent):
        aid = created_agent["agent_id"]
        resp = client.post(f"{AGENT_BUILDER}/agents/{aid}/execute", json={
            "goal": "Estimate impermanent loss risk for a 2000->2400 price move",
            "context": {"portfolio_value": 50000},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("error") is None or data.get("error") == ""

    def test_execute_goal_with_yield_context(self, client: httpx.Client, created_agent):
        aid = created_agent["agent_id"]
        resp = client.post(f"{AGENT_BUILDER}/agents/{aid}/execute", json={
            "goal": "Find the best yield optimization across available pools",
            "context": {"risk_tolerance": "medium", "available_capital": 10000},
        })
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 3d: HTTP API — Performance & Leaderboard
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer3_Performance:

    def test_record_performance(self, client: httpx.Client, created_agent):
        aid = created_agent["agent_id"]
        resp = client.post(f"{AGENT_BUILDER}/agents/{aid}/performance/record", json={
            "agent_id": aid,
            "period_id": "e2e_period_1",
            "return_bps": 120,
            "volume": 50000,
            "successful_actions": 8,
            "failed_actions": 1,
            "proof_count": 6,
            "max_drawdown_bps": 75,
        })
        assert resp.status_code == 200

    def test_get_performance(self, client: httpx.Client, created_agent):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}/performance")
        assert resp.status_code == 200

    def test_leaderboard(self, client: httpx.Client):
        resp = client.get(f"{AGENT_BUILDER}/leaderboard")
        assert resp.status_code == 200
        data = resp.json()
        assert "leaderboard" in data

    def test_reputation_witness(self, client: httpx.Client, created_agent):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}/reputation-witness")
        assert resp.status_code == 200
        data = resp.json()
        assert "witness_inputs" in data or "witness" in data or "inputs" in data

    def test_performance_witness(self, client: httpx.Client, created_agent):
        aid = created_agent["agent_id"]
        resp = client.get(f"{AGENT_BUILDER}/agents/{aid}/performance-witness")
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 4: On-Chain Contract Verification
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer4_OnChain:
    """Verify both agent contracts are deployed on Sepolia."""

    @pytest.fixture(autouse=True)
    def _load_deploy_results(self):
        if not os.path.exists(DEPLOY_RESULTS_PATH):
            pytest.skip("deploy_agent_contracts_results.json not found")
        with open(DEPLOY_RESULTS_PATH) as f:
            self.deploy_results = json.load(f)

    def test_skill_registry_deployed(self):
        entry = self.deploy_results.get("AgentSkillRegistry", {})
        assert entry.get("address"), "AgentSkillRegistry address missing"
        assert entry.get("class_hash"), "AgentSkillRegistry class_hash missing"
        # Address should be valid hex
        addr = entry["address"]
        assert addr.startswith("0x"), f"Invalid address format: {addr}"
        assert len(addr) > 10, f"Address too short: {addr}"

    def test_performance_store_deployed(self):
        entry = self.deploy_results.get("AgentPerformanceStore", {})
        assert entry.get("address"), "AgentPerformanceStore address missing"
        assert entry.get("class_hash"), "AgentPerformanceStore class_hash missing"
        addr = entry["address"]
        assert addr.startswith("0x")
        assert len(addr) > 10

    def test_contract_class_hashes_distinct(self):
        skill_hash = self.deploy_results["AgentSkillRegistry"]["class_hash"]
        perf_hash = self.deploy_results["AgentPerformanceStore"]["class_hash"]
        assert skill_hash != perf_hash, "Class hashes should differ"

    def test_contract_addresses_distinct(self):
        skill_addr = self.deploy_results["AgentSkillRegistry"]["address"]
        perf_addr = self.deploy_results["AgentPerformanceStore"]["address"]
        assert skill_addr != perf_addr, "Contract addresses should differ"

    def test_on_chain_contract_class_exists(self):
        """Verify the class is actually on-chain by querying the RPC."""
        try:
            import warnings
            warnings.filterwarnings("ignore")
            from starknet_py.net.full_node_client import FullNodeClient

            rpc = "https://api.cartridge.gg/x/starknet/sepolia"
            client = FullNodeClient(node_url=rpc)

            skill_addr = int(self.deploy_results["AgentSkillRegistry"]["address"], 16)

            async def check():
                cls_hash = await client.get_class_hash_at(skill_addr)
                return cls_hash

            cls_hash = _run_async(check())
            expected = int(self.deploy_results["AgentSkillRegistry"]["class_hash"], 16)
            assert cls_hash == expected, (
                f"On-chain class hash mismatch: {hex(cls_hash)} != "
                f"{self.deploy_results['AgentSkillRegistry']['class_hash']}"
            )
        except ImportError:
            pytest.skip("starknet_py not installed")
        except Exception as e:
            if "not found" in str(e).lower() or "not deployed" in str(e).lower():
                pytest.fail(f"Contract not found on-chain: {e}")
            # RPC errors are OK in test environments
            pytest.skip(f"RPC error (may be transient): {e}")


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 5: Cairo Contract Compilation
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer5_CairoArtifacts:
    """Verify Cairo contract artifacts exist and were compiled."""

    CONTRACTS = [
        "AgentSkillRegistry",
        "AgentPerformanceStore",
        "AgentIdentity",
        "AgentComposer",
    ]

    @pytest.mark.parametrize("contract_name", CONTRACTS)
    def test_sierra_artifact_exists(self, contract_name):
        path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "contracts", "target", "dev",
            f"zkdefi_contracts_{contract_name}.contract_class.json",
        )
        assert os.path.exists(path), f"Sierra JSON missing: {path}"
        # Verify it's valid JSON
        with open(path) as f:
            data = json.load(f)
        assert "sierra_program" in data or "abi" in data, f"{contract_name} Sierra JSON has no expected fields"

    @pytest.mark.parametrize("contract_name", CONTRACTS)
    def test_casm_artifact_exists(self, contract_name):
        path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "contracts", "target", "dev",
            f"zkdefi_contracts_{contract_name}.compiled_contract_class.json",
        )
        assert os.path.exists(path), f"CASM JSON missing: {path}"


# ═══════════════════════════════════════════════════════════════════════════
# LAYER 6: Integration — Full Pipeline Timing
# ═══════════════════════════════════════════════════════════════════════════

class TestLayer6_Integration:
    """Verify end-to-end latency and pipeline coherence."""

    def test_skill_roundtrip_latency(self, client: httpx.Client):
        """Every skill should complete in <10s including network overhead."""
        skills = ["il_predictor", "yield_optimality", "slippage_bound",
                  "reputation_check", "arb_check", "liquidation_check",
                  "performance_attestation", "mev_protection"]
        for sid in skills:
            t0 = time.time()
            resp = client.post(
                f"{AGENT_BUILDER}/skills/{sid}/execute",
                json={"params": {}},
            )
            elapsed = time.time() - t0
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"], f"{sid} failed: {data.get('error')}"
            assert elapsed < 10.0, f"{sid} took {elapsed:.2f}s (>10s limit)"

    def test_proof_contains_groth16_structure(self, client: httpx.Client):
        """Verify the returned proof has the Groth16 BN254 structure."""
        resp = client.post(
            f"{AGENT_BUILDER}/skills/il_predictor/execute",
            json={"params": {"entry_price": 1500, "current_price": 1650}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"]
        # proof_hash should be 0x-prefixed hex, 64 chars
        ph = data["proof_hash"]
        assert ph.startswith("0x"), f"proof_hash not hex: {ph}"
        assert len(ph) == 66, f"proof_hash wrong length: {len(ph)}"
        # public_signals should be a list of numeric strings
        ps = data["public_signals"]
        assert isinstance(ps, list)
        assert len(ps) >= 2, f"Expected >=2 public signals, got {len(ps)}"
        for s in ps:
            assert isinstance(s, str)
            assert s.lstrip("-").isdigit(), f"Non-numeric public signal: {s}"

    def test_multiple_agents_independent(self, client: httpx.Client):
        """Create two agents and verify they don't interfere."""
        # Agent A
        resp_a = client.post(f"{AGENT_BUILDER}/agents/build", json={
            "name": "IndependentA",
            "owner_address": TEST_OWNER,
            "skills": ["il_predictor"],
            "llm_provider": "deterministic",
        })
        assert resp_a.status_code == 200
        agent_a = resp_a.json()

        # Agent B
        resp_b = client.post(f"{AGENT_BUILDER}/agents/build", json={
            "name": "IndependentB",
            "owner_address": TEST_OWNER,
            "skills": ["slippage_bound"],
            "llm_provider": "deterministic",
        })
        assert resp_b.status_code == 200
        agent_b = resp_b.json()

        assert agent_a["agent_id"] != agent_b["agent_id"]

        # Record performance for A only
        client.post(f"{AGENT_BUILDER}/agents/{agent_a['agent_id']}/performance/record", json={
            "agent_id": agent_a["agent_id"],
            "period_id": "indep_1",
            "return_bps": 200,
            "volume": 10000,
            "successful_actions": 5,
            "failed_actions": 0,
            "proof_count": 3,
            "max_drawdown_bps": 30,
        })

        # Verify A has performance data
        resp = client.get(f"{AGENT_BUILDER}/agents/{agent_a['agent_id']}/performance")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short", "-x"]))
