import pytest

from app.services.prover_integrations import StoneProverClient


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _AsyncClient:
    def __init__(self, response):
        self._response = response
        self.last_kwargs = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, *args, **kwargs):  # noqa: ANN002, ANN003
        self.last_kwargs = kwargs
        return self._response


@pytest.mark.asyncio
async def test_verify_proof_on_chain_preserves_tx_hash(monkeypatch):
    response = _Response(
        200,
        {
            "verified": True,
            "chain": "starknet-sepolia",
            "block_number": 123,
            "error": None,
            "source": "mirrored_from_l3",
            "tx_hash": "0xabc123",
        },
    )

    monkeypatch.setattr(
        "app.services.prover_integrations.httpx.AsyncClient",
        lambda timeout: _AsyncClient(response),
    )

    client = StoneProverClient(base_url="http://example.test")
    result = await client.verify_proof_on_chain("0x1")

    assert result["verified"] is True
    assert result["source"] == "mirrored_from_l3"
    assert result["tx_hash"] == "0xabc123"


@pytest.mark.asyncio
async def test_verify_proof_on_chain_passes_verification_policy(monkeypatch):
    response = _Response(
        200,
        {
            "verified": True,
            "chain": "starknet-sepolia",
            "block_number": 123,
            "error": None,
            "source": "l2_registry",
            "tx_hash": "0xabc123",
            "verification_policy": "both",
            "verification_backend": "obsqra",
            "obsqra_verified": True,
            "integrity_verified": False,
        },
    )
    async_client = _AsyncClient(response)

    monkeypatch.setattr(
        "app.services.prover_integrations.httpx.AsyncClient",
        lambda timeout: async_client,
    )

    client = StoneProverClient(base_url="http://example.test", l2_verification_policy="both")
    result = await client.verify_proof_on_chain("0x1")

    assert async_client.last_kwargs["params"]["verification_policy"] == "both"
    assert result["verification_policy"] == "both"
    assert result["verification_backend"] == "obsqra"
    assert result["obsqra_verified"] is True
    assert result["integrity_verified"] is False
