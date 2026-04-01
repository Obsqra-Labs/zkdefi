from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.receipt_vault_service import ReceiptVaultService


@pytest.fixture()
def vault_service(tmp_path, monkeypatch) -> ReceiptVaultService:
    monkeypatch.setattr("app.services.receipt_vault_service.RECEIPT_VAULT_DB_PATH", tmp_path / "receipt_vault.db")
    monkeypatch.setenv("RECEIPTOS_REGISTRY_ADDRESS", "0x0544ef8cbf8bf1ac7987bc0d2bb211434d515fbe10bab65f36e0f761c79bbdff")
    monkeypatch.setenv("RECEIPTOS_ARCHIVE_ADDRESS", "0x012345")
    return ReceiptVaultService()


@pytest.mark.asyncio
async def test_register_passport_claim_uploads_and_persists_bundle(monkeypatch, vault_service):
    async def fake_upload_bundle(bundle):
        return {
            "cid": "bafybeigdyrzt5m6vaultreceipt000000000000000000000000000000000001",
            "ipfs_uri": "ipfs://bafybeigdyrzt5m6vaultreceipt000000000000000000000000000000000001",
            "gateway_url": "https://bafybeigdyrzt5m6vaultreceipt000000000000000000000000000000000001.ipfs.storacha.link/receipt-bundle.json",
        }

    async def fake_anchor(receipt_id, cid_hash):
        return {"receipt_id": receipt_id, "cid_hash": cid_hash, "tx_hash": "0xabc123"}

    async def fake_hash_cid(_cid):
        return "0xcafe"

    monkeypatch.setattr(vault_service, "_upload_bundle", fake_upload_bundle)
    monkeypatch.setattr(vault_service, "_anchor_cid", fake_anchor)
    monkeypatch.setattr(vault_service, "_hash_cid", fake_hash_cid)
    monkeypatch.setattr(vault_service, "_starkli_selector", lambda _name: "0x777")

    receipt = await vault_service.register_passport_claim(
        wallet_address="0xabc123",
        registry_receipt_id="15",
        tx_hash="0x999",
        policy_hash="0x123",
        tier="verified",
        claim_metadata={
            "tier_name": "verified",
            "reputation_score": 74,
            "gates": {"ekubo": True},
            "claimed_at": "2026-03-30T12:00:00+00:00",
        },
    )

    assert receipt["registry_receipt_id"] == "15"
    assert receipt["cid"] == "bafybeigdyrzt5m6vaultreceipt000000000000000000000000000000000001"
    assert receipt["bundle"]["action_type"] == "verification"
    assert receipt["bundle"]["policy_result"]["allowed"] is True
    assert receipt["bundle"]["proof_hashes"]["receipt_hash"].startswith("0x")


@pytest.mark.asyncio
async def test_register_portfolio_execution_issues_registry_and_stores_override_state(monkeypatch, vault_service):
    async def fake_issue_registry(*, policy_hash, weight):
        # policy_hash is now a Poseidon hash of (raw_policy_hash + execution_tx_hash + source_receipt_id)
        assert policy_hash.startswith("0x")
        assert len(policy_hash) > 4  # not trivially empty
        assert weight == 250
        return {"receipt_id": "88", "tx_hash": "0xregistry"}

    async def fake_upload_bundle(bundle):
        assert bundle["metadata"]["execution_tx_hash"] == "0xwallettx"
        return {
            "cid": "bafybeigdyrzt5m6portfolio000000000000000000000000000000000000002",
            "ipfs_uri": "ipfs://bafybeigdyrzt5m6portfolio000000000000000000000000000000000000002",
            "gateway_url": "https://bafybeigdyrzt5m6portfolio000000000000000000000000000000000000002.ipfs.storacha.link/receipt-bundle.json",
        }

    async def fake_anchor(receipt_id, cid_hash):
        assert receipt_id == "88"
        assert cid_hash == "0xbead"
        return {"receipt_id": "88", "cid_hash": cid_hash, "tx_hash": "0xanchor"}

    async def fake_hash_cid(_cid):
        return "0xbead"

    monkeypatch.setattr(vault_service, "_issue_registry_receipt", fake_issue_registry)
    monkeypatch.setattr(vault_service, "_upload_bundle", fake_upload_bundle)
    monkeypatch.setattr(vault_service, "_anchor_cid", fake_anchor)
    monkeypatch.setattr(vault_service, "_hash_cid", fake_hash_cid)
    monkeypatch.setattr(vault_service, "_starkli_selector", lambda _name: "0x777")

    source_receipt = {
        "receipt_id": "0xlocal",
        "timestamp": "2026-03-30T12:00:00+00:00",
        "action_type": "rebalance",
        "amount": 250,
        "metadata": {
            "status": "submitted",
            "gate": {
                "policy_hash": "0x123",
                "intent_hash": "0x456",
                "allowed": False,
                "workflow_mode": "manual",
                "override_mode": "manual",
                "reason_codes": ["fee_share_warning"],
                "constraint_results": [{"name": "FeeEfficiencyGuard"}],
                "swap_steps": [{"from_asset": "ETH", "to_asset": "USDC", "value_usd": 2.5}],
            },
            "execution": {
                "execution_adapter": "avnu",
            },
        },
    }

    receipt = await vault_service.register_portfolio_execution(
        owner_address="0xabc123",
        source_receipt=source_receipt,
        execution_tx_hash="0xwallettx",
    )

    assert receipt["registry_receipt_id"] == "88"
    assert receipt["source"] == "portfolio_execute"
    assert receipt["bundle"]["policy_result"]["gate_allowed_before_submission"] is False
    assert receipt["bundle"]["metadata"]["override_mode"] == "manual"


@pytest.mark.asyncio
async def test_verify_cid_returns_verified_when_bundle_anchor_and_registry_match(monkeypatch, vault_service):
    async def fake_upload_bundle(bundle):
        return {
            "cid": "bafybeigdyrzt5m6verify000000000000000000000000000000000000000003",
            "ipfs_uri": "ipfs://bafybeigdyrzt5m6verify000000000000000000000000000000000000000003",
            "gateway_url": "https://bafybeigdyrzt5m6verify000000000000000000000000000000000000000003.ipfs.storacha.link/receipt-bundle.json",
        }

    async def fake_anchor(receipt_id, cid_hash):
        return {"receipt_id": receipt_id, "cid_hash": cid_hash, "tx_hash": "0xabc123"}

    async def fake_hash_cid(_cid):
        return "0xcafe"

    monkeypatch.setattr(vault_service, "_upload_bundle", fake_upload_bundle)
    monkeypatch.setattr(vault_service, "_anchor_cid", fake_anchor)
    monkeypatch.setattr(vault_service, "_hash_cid", fake_hash_cid)
    monkeypatch.setattr(vault_service, "_starkli_selector", lambda _name: "0x777")

    stored = await vault_service.register_passport_claim(
        wallet_address="0xabc123",
        registry_receipt_id="22",
        tx_hash="0x999",
        policy_hash="0x123",
        tier="verified",
        claim_metadata={"claimed_at": "2026-03-30T12:00:00+00:00"},
    )
    bundle = stored["bundle"]

    async def fake_fetch_bundle(cid_or_url):
        return (
            "bafybeigdyrzt5m6verify000000000000000000000000000000000000000003",
            "https://bafybeigdyrzt5m6verify000000000000000000000000000000000000000003.ipfs.storacha.link/receipt-bundle.json",
            bundle,
        )

    def fake_starkli_call(_contract, entrypoint, *_calldata):
        if entrypoint == "get_cid_anchor":
            return "0xcafe"
        if entrypoint == "verify_receipt":
            return "0x1"
        if entrypoint == "get_receipt_policy_hash":
            return "0x123"
        raise AssertionError(f"Unexpected entrypoint {entrypoint}")

    monkeypatch.setattr(vault_service, "_fetch_bundle_by_cid", fake_fetch_bundle)
    monkeypatch.setattr(vault_service, "_starkli_call", fake_starkli_call)

    result = await vault_service.verify_cid("bafybeigdyrzt5m6verify000000000000000000000000000000000000000003")

    assert result["verified"] is True
    assert result["status"] == "VERIFIED"


@pytest.mark.asyncio
async def test_verify_cid_fails_when_bundle_receipt_hash_is_tampered(monkeypatch, vault_service):
    async def fake_upload_bundle(bundle):
        return {
            "cid": "bafybeigdyrzt5m6tampered00000000000000000000000000000000000000004",
            "ipfs_uri": "ipfs://bafybeigdyrzt5m6tampered00000000000000000000000000000000000000004",
            "gateway_url": "https://bafybeigdyrzt5m6tampered00000000000000000000000000000000000000004.ipfs.storacha.link/receipt-bundle.json",
        }

    async def fake_anchor(receipt_id, cid_hash):
        return {"receipt_id": receipt_id, "cid_hash": cid_hash, "tx_hash": "0xabc123"}

    async def fake_hash_cid(_cid):
        return "0xcafe"

    monkeypatch.setattr(vault_service, "_upload_bundle", fake_upload_bundle)
    monkeypatch.setattr(vault_service, "_anchor_cid", fake_anchor)
    monkeypatch.setattr(vault_service, "_hash_cid", fake_hash_cid)
    monkeypatch.setattr(vault_service, "_starkli_selector", lambda _name: "0x777")

    stored = await vault_service.register_passport_claim(
        wallet_address="0xabc123",
        registry_receipt_id="33",
        tx_hash="0x999",
        policy_hash="0x123",
        tier="verified",
        claim_metadata={"claimed_at": "2026-03-30T12:00:00+00:00"},
    )
    bundle = dict(stored["bundle"])
    proof_hashes = dict(bundle["proof_hashes"])
    proof_hashes["receipt_hash"] = "0xdeadbeef"
    bundle["proof_hashes"] = proof_hashes

    async def fake_fetch_bundle(cid_or_url):
        return (
            "bafybeigdyrzt5m6tampered00000000000000000000000000000000000000004",
            "https://bafybeigdyrzt5m6tampered00000000000000000000000000000000000000004.ipfs.storacha.link/receipt-bundle.json",
            bundle,
        )

    def fake_starkli_call(_contract, entrypoint, *_calldata):
        if entrypoint == "get_cid_anchor":
            return "0xcafe"
        if entrypoint == "verify_receipt":
            return "0x1"
        if entrypoint == "get_receipt_policy_hash":
            return "0x123"
        raise AssertionError(f"Unexpected entrypoint {entrypoint}")

    monkeypatch.setattr(vault_service, "_fetch_bundle_by_cid", fake_fetch_bundle)
    monkeypatch.setattr(vault_service, "_starkli_call", fake_starkli_call)

    result = await vault_service.verify_cid("bafybeigdyrzt5m6tampered00000000000000000000000000000000000000004")

    assert result["verified"] is False
    assert result["status"] == "FAILED"
    assert result["checks"]["receipt_hash_matches"] is False
