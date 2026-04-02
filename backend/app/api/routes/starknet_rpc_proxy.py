"""
Starknet mainnet RPC proxy — eliminates CORS issues for frontend read calls.

The frontend cannot call third-party RPC providers directly due to CORS.
This endpoint proxies JSON-RPC calls through our own backend (same origin).
"""

from __future__ import annotations

import logging
import os

import httpx
from fastapi import APIRouter, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["starknet-rpc"])

UPSTREAM_RPC = os.getenv(
    "STARKNET_RPC_URL_MAINNET",
    "https://rpc.starknet.lava.build",
)

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


@router.post("/starknet-rpc")
async def starknet_rpc_proxy(request: Request) -> Response:
    """Forward a JSON-RPC request to the Starknet mainnet RPC."""
    body = await request.body()
    client = _get_client()
    try:
        upstream = await client.post(
            UPSTREAM_RPC,
            content=body,
            headers={"Content-Type": "application/json"},
        )
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type="application/json",
        )
    except httpx.HTTPError as exc:
        logger.warning("RPC proxy error: %s", exc)
        return Response(
            content=b'{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"RPC proxy upstream error"}}',
            status_code=502,
            media_type="application/json",
        )
