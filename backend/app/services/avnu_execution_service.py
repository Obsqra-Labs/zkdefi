"""AVNU swap quote + build helpers for wallet execution."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from app.services.ekubo_config import EKUBO_MAINNET_CHAIN_ID

logger = logging.getLogger(__name__)

AVNU_API_BASE = os.getenv("AVNU_API_BASE", "https://starknet.api.avnu.fi").rstrip("/")


def _parse_int_any(value: Any, default: int = 0) -> int:
    try:
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return default
            return int(raw, 16) if raw.startswith("0x") else int(raw)
        return int(str(value))
    except Exception:
        return default


def _normalize_address(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    if raw.startswith("0x"):
        return raw
    return f"0x{raw}"


def _normalize_calls(calls: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for call in calls or []:
        if not isinstance(call, dict):
            continue
        contract_address = _normalize_address(str(call.get("contractAddress") or call.get("contract_address") or ""))
        entrypoint = str(call.get("entrypoint") or "")
        calldata = [str(item) for item in (call.get("calldata") or [])]
        if not contract_address or not entrypoint:
            continue
        normalized.append(
            {
                "contract_address": contract_address,
                "entrypoint": entrypoint,
                "calldata": calldata,
            }
        )
    return normalized


async def fetch_avnu_quotes(
    *,
    token_in: str,
    token_out: str,
    amount_in_wei: int,
    taker_address: str,
    chain_id: str,
) -> list[dict[str, Any]]:
    if chain_id != EKUBO_MAINNET_CHAIN_ID:
        raise ValueError("AVNU execution helper currently supports Starknet mainnet only.")
    params = {
        "sellTokenAddress": _normalize_address(token_in),
        "buyTokenAddress": _normalize_address(token_out),
        "sellAmount": hex(max(0, int(amount_in_wei))),
        "takerAddress": _normalize_address(taker_address),
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{AVNU_API_BASE}/swap/v3/quotes", params=params)
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


def pick_best_avnu_quote(quotes: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, int]:
    best_quote: dict[str, Any] | None = None
    best_out = 0
    for quote in quotes:
        out_amount = _parse_int_any(quote.get("buyAmount"), 0)
        if out_amount > best_out:
            best_out = out_amount
            best_quote = quote
    return best_quote, best_out


async def build_avnu_swap_execution(
    *,
    token_in: str,
    token_out: str,
    amount_in_wei: int,
    taker_address: str,
    slippage_bps: int,
    chain_id: str,
) -> dict[str, Any]:
    try:
        quotes = await fetch_avnu_quotes(
            token_in=token_in,
            token_out=token_out,
            amount_in_wei=amount_in_wei,
            taker_address=taker_address,
            chain_id=chain_id,
        )
    except Exception as exc:
        logger.warning("AVNU quote fetch failed: %s", exc)
        return {
            "venue": "avnu",
            "wallet_calls": [],
            "expected_out": 0,
            "error": str(exc),
        }

    best_quote, best_out = pick_best_avnu_quote(quotes)
    if not best_quote or best_out <= 0:
        return {
            "venue": "avnu",
            "wallet_calls": [],
            "expected_out": 0,
            "error": "No AVNU liquidity for this pair.",
        }

    payload = {
        "quoteId": str(best_quote.get("quoteId") or ""),
        "takerAddress": _normalize_address(taker_address),
        "slippage": max(0.0, min(1.0, float(max(0, slippage_bps)) / 10_000.0)),
        "includeApprove": True,
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(f"{AVNU_API_BASE}/swap/v3/build", json=payload)
            response.raise_for_status()
            build_payload = response.json()
    except Exception as exc:
        logger.warning("AVNU build failed: %s", exc)
        return {
            "venue": "avnu",
            "wallet_calls": [],
            "expected_out": best_out,
            "error": str(exc),
        }

    wallet_calls = _normalize_calls(build_payload.get("calls"))
    if not wallet_calls:
        return {
            "venue": "avnu",
            "wallet_calls": [],
            "expected_out": best_out,
            "error": "AVNU build returned no executable calls.",
        }

    route_names = []
    for route in best_quote.get("routes") or []:
        if isinstance(route, dict) and route.get("name"):
            route_names.append(str(route["name"]))

    return {
        "venue": "avnu",
        "wallet_calls": wallet_calls,
        "expected_out": best_out,
        "quote_id": best_quote.get("quoteId"),
        "route": route_names,
        "raw_quote": best_quote,
        "raw_build": build_payload,
        "error": None,
    }
