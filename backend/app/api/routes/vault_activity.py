from fastapi import APIRouter, Query
import httpx
import asyncio
import json
import os
from pathlib import Path

router = APIRouter(prefix="/vault", tags=["vault"])

BASE = os.getenv("BACKEND_SELF_URL", "http://127.0.0.1:8003")
DATA_DIR = Path(__file__).resolve().parents[3] / "data"


@router.get("/activity/{address}")
async def get_vault_activity(address: str, limit: int = Query(50, le=200)):
    """Aggregate vault activity from ledger, receipts, rebalance logs, yield events."""
    paths = [
        f"/api/v1/zkdefi/ledger/entries/{address}",
        f"/api/v1/zkdefi/receipts/{address}",
        f"/api/v1/zkdefi/rebalancer/history/{address}",
        f"/api/v1/zkdefi/private-yield/positions/{address}",
    ]
    source_labels = ["ledger", "receipt", "rebalance", "yield"]

    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        tasks = [client.get(p) for p in paths]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    entries: list[dict] = []
    for i, resp in enumerate(responses):
        if isinstance(resp, Exception):
            continue
        if resp.status_code != 200:
            continue
        try:
            data = resp.json()
        except Exception:
            continue
        source = source_labels[i]
        items: list = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            for key in ("entries", "receipts", "history", "positions", "data"):
                if isinstance(data.get(key), list):
                    items = data[key]
                    break
            if not items and not any(isinstance(v, list) for v in data.values()):
                items = [data]

        for item in items:
            if not isinstance(item, dict):
                continue
            entries.append(_normalize(item, source))

    entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return {"activity": entries[:limit]}


def _normalize(item: dict, source: str) -> dict:
    return {
        "type": source,
        "description": (
            item.get("description")
            or item.get("action")
            or item.get("reason")
            or source
        ),
        "method": item.get("method", item.get("privacy_mode", "")),
        "timestamp": (
            item.get("timestamp")
            or item.get("created_at")
            or item.get("time")
            or ""
        ),
        "hashes": {
            "tx": item.get("tx_hash", item.get("transaction_hash", "")),
            "commitment": item.get("commitment", item.get("commitment_hash", "")),
            "nullifier": item.get("nullifier", ""),
            "proof": item.get("proof_hash", item.get("proof", "")),
        },
        "asset": item.get("asset", item.get("token", "STRK")),
        "amount": str(item.get("amount", item.get("value", ""))),
    }


@router.get("/yield-chart")
async def get_yield_chart(days: int = Query(30, le=90)):
    """
    Return cumulative yield time-series derived from market snapshots.
    Each point: { date, cumulative_yield, apy_bps }.
    """
    snap_path = DATA_DIR / "market_snapshots.json"
    try:
        raw = json.loads(snap_path.read_text())
    except Exception:
        return {"points": []}

    snapshots = raw.get("snapshots", [])
    if not snapshots:
        return {"points": []}

    from datetime import datetime, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    points: list[dict] = []
    cumulative = 0.0

    for snap in snapshots:
        dt_str = snap.get("datetime", "")
        if not dt_str:
            continue
        try:
            dt = datetime.fromisoformat(dt_str)
        except ValueError:
            continue
        if dt < cutoff:
            continue

        ekubo_apy_bps = snap.get("ekubo", {}).get("apy_bps", 0)
        jedi_apy_bps = snap.get("jediswap", {}).get("apy_bps", 0)
        blended_bps = int(ekubo_apy_bps * 0.6 + jedi_apy_bps * 0.4)

        interval_hours = 12
        daily_yield = (blended_bps / 10000) / 365
        period_yield = daily_yield * (interval_hours / 24)
        cumulative += period_yield * 100

        points.append({
            "date": dt_str[:10],
            "timestamp": dt_str,
            "cumulative_yield": round(cumulative, 3),
            "apy_bps": blended_bps,
        })

    return {"points": points}
