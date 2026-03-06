from pathlib import Path


def test_contract_includes_model_bridge_binding_guards():
    contract_path = Path(__file__).resolve().parents[2] / "contracts" / "src" / "proof_gated_yield_agent.cairo"
    source = contract_path.read_text(encoding="utf-8")

    assert "fn execute_with_ml_proof(" in source
    assert "ezkl_proof_hash: felt252" in source
    assert "bridge_timestamp: felt252" in source
    assert "Bridge commitment mismatch" in source
    assert "Model hash missing" in source
    assert "Output commitment missing" in source
