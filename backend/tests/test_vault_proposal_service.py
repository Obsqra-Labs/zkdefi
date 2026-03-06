import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.vault_proposal_service import VaultProposalService


def test_create_proposal():
    svc = VaultProposalService()
    proposal = svc.create_proposal(
        adapters=["0xEKUBO", "0xLEND"],
        amounts=[500, 300],
        params=[[], []],
    )
    assert "proposal_hash" in proposal
    assert "salt" in proposal
    assert proposal["status"] == "committed"


def test_reveal_matches_commit():
    svc = VaultProposalService()
    p = svc.create_proposal(["0xA"], [100], [[]])
    verified = svc.verify_reveal(
        proposal_hash=p["proposal_hash"],
        adapters=["0xA"],
        amounts=[100],
        params=[[]],
        salt=p["salt"],
    )
    assert verified is True


def test_reveal_wrong_salt_fails():
    svc = VaultProposalService()
    p = svc.create_proposal(["0xA"], [100], [[]])
    verified = svc.verify_reveal(
        proposal_hash=p["proposal_hash"],
        adapters=["0xA"],
        amounts=[100],
        params=[[]],
        salt="wrong_salt",
    )
    assert verified is False


def test_get_proposal():
    svc = VaultProposalService()
    p = svc.create_proposal(["0xA"], [100])
    retrieved = svc.get_proposal(p["proposal_hash"])
    assert retrieved is not None
    assert retrieved["proposal_hash"] == p["proposal_hash"]
