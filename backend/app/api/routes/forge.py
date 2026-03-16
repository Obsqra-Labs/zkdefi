"""
StarkForge / zkSyslog Explorer API Routes

Search-first proof-aware explorer surface. Provides:
- GET  /forge/                  Explorer homepage (HTML)
- GET  /forge/feed              Latest proof-backed receipts/events (JSON)
- GET  /forge/search            Unified resolver across chain + proof objects (JSON)
- GET  /forge/detail/{obj_type}/{obj_id}  Shared detail view (HTML or JSON)
- GET  /forge/lane/{lane_id}    Lane-specific page (HTML, filtered feed)
- GET  /forge/status            Compact system status strip (JSON)
- GET  /forge/paths             Explorer API self-description (JSON); lists all paths to follow end-to-end.

This is the first public surface of StarkForge (the proving fabric).
Feed, search, and detail responses include detail_href or href so APIs link; follow Relationships on detail pages to traverse receipt → fact → proof job → model → transaction → block.
zkSyslog is the searchable evidence log and proof-aware explorer within it.

The explorer is self-contained: it reads only from backend services and APIs
(receipt_service, ProofService, system_metrics_service, etc.). It does not depend
on the hackathon_backend_showcase script or its generated HTML. That script is
a reference for which data paths and evidence an explorer needs to be comprehensive;
the explorer implements those paths directly here.
"""

from __future__ import annotations

import logging
import os
import re
import time
from html import escape
from typing import Any, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

_FORGE_RPC_TIMEOUT = 10.0
_FORGE_RPC_URL = os.getenv("STARKNET_RPC_URL", "https://starknet-sepolia-rpc.publicnode.com")

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/forge", tags=["forge"])

# ── Helpers ─────────────────────────────────────────────────────────────


def _ts() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _classify_query(q: str) -> str:
    """Heuristic classifier for search queries."""
    q = q.strip()
    if not q:
        return "empty"
    if re.fullmatch(r"0x[0-9a-fA-F]{50,}", q):
        return "tx_hash"
    if re.fullmatch(r"0x[0-9a-fA-F]{40,}", q):
        return "address"
    if re.fullmatch(r"0x[0-9a-fA-F]{10,}", q):
        return "hash"
    if re.fullmatch(r"\d+", q):
        return "block_number"
    if re.fullmatch(r"[0-9a-fA-F]{8,}", q):
        return "hash"
    return "text"


async def _get_receipt_service():
    """Lazy import receipt service."""
    try:
        from app.services.receipt_service import get_receipt_service
        return get_receipt_service()
    except Exception:
        return None


async def _get_proof_stats() -> dict[str, Any]:
    """Fetch proof stats from the proofs service."""
    try:
        from app.services.proof_service import ProofService
        svc = ProofService()
        return await svc.get_stats()
    except Exception:
        return {}


async def _get_system_health() -> dict[str, Any]:
    """Fetch basic system health."""
    try:
        from app.services.system_metrics_service import get_system_health
        return await get_system_health()
    except Exception:
        return {"status": "unknown"}


async def _rpc(method: str, params: dict[str, Any]) -> dict[str, Any] | None:
    """Single JSON-RPC call to configured Starknet RPC. Returns None on any error."""
    try:
        async with httpx.AsyncClient(timeout=_FORGE_RPC_TIMEOUT) as client:
            r = await client.post(
                _FORGE_RPC_URL.rstrip("/"),
                json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1},
            )
            data = r.json()
            err = data.get("error")
            if err:
                logger.debug("RPC %s error: %s", method, err)
                return None
            return data.get("result")
    except Exception as e:
        logger.debug("RPC %s failed: %s", method, e)
        return None


async def _get_tx_receipt(tx_hash: str) -> dict[str, Any] | None:
    """Fetch transaction receipt by hash via RPC."""
    result = await _rpc("starknet_getTransactionReceipt", {"transaction_hash": tx_hash})
    return result if isinstance(result, dict) else None


async def _get_block(block_id: Any) -> dict[str, Any] | None:
    """Fetch block by number or 'latest'. block_id: int or 'latest'."""
    if block_id == "latest":
        params: dict[str, Any] = {"block_id": "latest"}
    else:
        try:
            num = int(block_id)
            params = {"block_id": {"block_number": num}}
        except (TypeError, ValueError):
            return None
    result = await _rpc("starknet_getBlockWithTxHashes", params)
    return result if isinstance(result, dict) else None


def _list_proofs_for_search(limit: int = 50) -> list[dict[str, Any]]:
    """List proof records from pipeline cache for search results."""
    try:
        from app.services.proof_pipeline import get_proof_pipeline
        pipeline = get_proof_pipeline()
        out: list[dict[str, Any]] = []
        for v in pipeline._cache.values():
            c_hash = v.get("commitment_hash") or (v.get("bridge_proof") or {}).get("proof_hash") or (v.get("ezkl_proof") or {}).get("proof_hash")
            if not c_hash:
                continue
            ep = v.get("ezkl_proof") or {}
            out.append({
                "id": str(c_hash),
                "proof_type": ep.get("model_name") or "proof",
                "model_name": ep.get("model_name", ""),
                "verified": bool((v.get("verification") or {}).get("l3", {}).get("verified_on_chain")),
            })
            if len(out) >= limit:
                break
        return out
    except Exception:
        return []


def _list_models_for_search(limit: int = 50) -> list[dict[str, Any]]:
    """List model names from ezkl_models dir for search results."""
    try:
        from pathlib import Path
        base = Path(__file__).resolve().parents[3]
        models_dir = base / "data" / "ezkl_models"
        if not models_dir.exists():
            return []
        out: list[dict[str, Any]] = []
        for d in sorted(models_dir.iterdir()):
            if d.is_dir():
                out.append({"id": d.name, "name": d.name, "ready": (d / "network.compiled").exists() and (d / "pk.key").exists()})
            if len(out) >= limit:
                break
        return out
    except Exception:
        return []


async def _get_proof_record(proof_hash: str) -> dict[str, Any] | None:
    """Fetch proof record by commitment/bridge/ezkl proof hash from proof pipeline."""
    try:
        from app.services.proof_pipeline import get_proof_pipeline
        pipeline = get_proof_pipeline()
        for v in pipeline._cache.values():
            if v.get("commitment_hash") == proof_hash:
                return v
            for key in ("bridge_proof", "ezkl_proof"):
                sub = v.get(key) or {}
                if isinstance(sub, dict) and sub.get("proof_hash") == proof_hash:
                    return v
        return None
    except Exception:
        return None


async def _get_model_info(model_id: str) -> dict[str, Any] | None:
    """Resolve model by name from ezkl_models dir."""
    try:
        from pathlib import Path
        base = Path(__file__).resolve().parents[3]
        models_dir = base / "data" / "ezkl_models"
        if not models_dir.exists():
            return None
        for d in sorted(models_dir.iterdir()):
            if d.is_dir() and d.name == model_id:
                onnx = list(d.glob("*.onnx"))
                compiled = (d / "network.compiled").exists()
                pk = (d / "pk.key").exists()
                vk = (d / "vk.key").exists()
                srs = (d / "kzg.srs").exists()
                meta = {}
                meta_path = d / "training_metadata.json"
                if meta_path.exists():
                    import json
                    try:
                        meta = json.loads(meta_path.read_text())
                    except Exception:
                        pass
                return {
                    "name": d.name,
                    "onnx": bool(onnx),
                    "compiled": compiled,
                    "proving_key": pk,
                    "verification_key": vk,
                    "srs": srs,
                    "ready": bool(onnx and compiled and pk and vk),
                    "accuracy": meta.get("accuracy"),
                    "final_loss": meta.get("final_loss"),
                }
        return None
    except Exception:
        return None


# ── Endpoints ───────────────────────────────────────────────────────────


@router.get("/status", summary="Compact system status for explorer strip")
async def forge_status() -> dict[str, Any]:
    """Returns a compact status snapshot for the explorer status bar."""
    health = await _get_system_health()
    proof_stats = await _get_proof_stats()

    receipt_svc = await _get_receipt_service()
    receipt_count = 0
    if receipt_svc:
        try:
            receipts = await receipt_svc.get_receipts()
            receipt_count = len(receipts) if receipts else 0
        except Exception:
            pass

    return {
        "generated_at": _ts(),
        "service": "starkforge-zksyslog",
        "health": health.get("status", "unknown") if isinstance(health, dict) else "unknown",
        "receipt_count": receipt_count,
        "proof_stats": {
            "total": proof_stats.get("total_proofs", 0),
            "verified": proof_stats.get("verified_proofs", 0),
            "pending": proof_stats.get("pending_proofs", 0),
        } if proof_stats else {},
        "lanes": {
            "groth16_modelbridge": True,
            "noir_honk": True,
            "native_kzg": True,
            "stark_integrity": True,
        },
    }


@router.get("/feed", summary="Latest proof-backed receipts/events feed")
async def forge_feed(
    limit: int = Query(default=50, ge=1, le=200),
    scope: Optional[str] = Query(default=None, description="Filter: receipts, proofs, all"),
    lane: Optional[str] = Query(default=None, description="Filter by proving lane (proof_type match)"),
) -> dict[str, Any]:
    """Returns the latest proof-backed receipts/events for the explorer feed. Optional lane filters by proof_type."""
    items: list[dict[str, Any]] = []

    receipt_svc = await _get_receipt_service()
    if receipt_svc and scope in (None, "all", "receipts"):
        try:
            raw = await receipt_svc.get_receipts()
            if raw:
                for r in raw[-limit * 2]:  # fetch extra if filtering by lane
                    if not isinstance(r, dict):
                        continue
                    proof_type = str(r.get("proof_type", "") or "").lower()
                    if lane and lane.lower() not in proof_type:
                        continue
                    rid = r.get("tx_hash", r.get("id", ""))
                    items.append({
                        "type": "receipt",
                        "id": rid,
                        "action": r.get("action", "unknown"),
                        "proof_type": r.get("proof_type", ""),
                        "result": r.get("result", ""),
                        "timestamp": r.get("timestamp", ""),
                        "fact_hash": r.get("fact_hash", ""),
                        "source": "on-chain" if r.get("tx_hash") else "runtime",
                        "detail_href": f"detail/receipt/{quote(str(rid), safe='')}",
                    })
        except Exception as e:
            logger.warning("forge feed receipt fetch: %s", e)

    # Sort by timestamp desc, take limit
    items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    items = items[:limit]

    return {
        "generated_at": _ts(),
        "count": len(items),
        "scope": scope or "all",
        "lane": lane,
        "items": items,
        "paths": {
            "self": "feed",
            "search": "search",
            "detail": "detail/{type}/{id}",
            "status": "status",
            "health": "health",
            "proving": "proving",
        },
    }


@router.get("/search", summary="Unified resolver for chain + proof objects")
async def forge_search(
    q: str = Query(default="", description="Search query; empty returns recent items by scope"),
    scope: Optional[str] = Query(default=None, description="Filter by type: receipts, proofs, contracts, facts, models, txs, or all"),
    limit: int = Query(25, ge=1, le=100, description="Page size for results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> dict[str, Any]:
    """
    Unified resolver across chain objects and proof/evidence objects.
    Empty q returns recent items by scope; non-empty q filters by text match.
    Use limit/offset for pagination; has_more indicates another page.
    """
    q = (q or "").strip()
    qtype = _classify_query(q) if q else "scope_only"
    results: dict[str, list[dict[str, Any]]] = {
        "receipts": [],
        "proofs": [],
        "contracts": [],
        "facts": [],
        "models": [],
        "entities": [],
    }

    search_receipts = scope in (None, "all", "receipts", "txs")
    if search_receipts:
        receipt_svc = await _get_receipt_service()
        if receipt_svc:
            try:
                raw = await receipt_svc.get_receipts()
                if raw:
                    for r in raw:
                        if not isinstance(r, dict):
                            continue
                        searchable = " ".join(str(v) for v in r.values()).lower()
                        if q:
                            if q.lower() not in searchable:
                                continue
                        rid = r.get("tx_hash", r.get("id", ""))
                        results["receipts"].append({
                                "id": rid,
                                "action": r.get("action", ""),
                                "proof_type": r.get("proof_type", ""),
                                "timestamp": r.get("timestamp", ""),
                                "source": "on-chain" if r.get("tx_hash") else "runtime",
                                "detail_href": f"detail/receipt/{quote(str(rid), safe='')}",
                            })
                    if scope == "txs":
                        results["receipts"] = [x for x in results["receipts"] if x.get("id", "").startswith("0x")]
                    full_count = len(results["receipts"])
                    results["receipts"] = results["receipts"][offset: offset + limit]
                else:
                    full_count = 0
            except Exception:
                full_count = 0
        else:
            full_count = 0
    else:
        full_count = 0

    if scope in (None, "all", "proofs"):
        for p in _list_proofs_for_search(50):
            s = " ".join(str(v) for v in p.values()).lower()
            if q and q.lower() not in s:
                continue
            results["proofs"].append({"id": p["id"], "proof_type": p.get("proof_type", ""), "model_name": p.get("model_name", ""), "verified": p.get("verified", False), "detail_href": f"detail/proof_job/{quote(str(p['id']), safe='')}"})
        results["proofs"] = results["proofs"][offset: offset + limit]

    if scope in (None, "all", "models"):
        for m in _list_models_for_search(50):
            s = (m.get("name") or m.get("id") or "").lower()
            if q and q.lower() not in s:
                continue
            results["models"].append({"id": m["id"], "name": m.get("name", m["id"]), "ready": m.get("ready", False), "detail_href": f"detail/model/{quote(str(m['id']), safe='')}"})
        results["models"] = results["models"][offset: offset + limit]

    if scope in (None, "all", "contracts") and q and re.fullmatch(r"0x[0-9a-fA-F]{40,}", q.strip()):
        addr = q.strip()
        results["contracts"].append({"id": addr, "address": addr, "detail_href": f"detail/contract/{quote(addr, safe='')}"})
        results["contracts"] = results["contracts"][offset: offset + limit]

    if scope in (None, "all", "facts"):
        rs = await _get_receipt_service()
        if rs:
            try:
                raw_f = await rs.get_receipts()
                seen_f = set()
                for r in (raw_f or []):
                    if not isinstance(r, dict):
                        continue
                    fh = r.get("fact_hash")
                    if not fh or fh in seen_f:
                        continue
                    seen_f.add(fh)
                    if q and q.lower() not in str(fh).lower():
                        continue
                    results["facts"].append({"id": str(fh), "fact_hash": str(fh), "detail_href": f"detail/fact/{quote(str(fh), safe='')}"})
                results["facts"] = results["facts"][offset: offset + limit]
            except Exception:
                pass

    if scope and scope != "all":
        if scope == "txs":
            allowed = {"receipts"}
        else:
            allowed = {scope}
        results = {k: (v if k in allowed else []) for k, v in results.items()}

    total = sum(len(v) for v in results.values())
    has_more = full_count > offset + limit if search_receipts and scope in (None, "all", "receipts", "txs") else False
    return {
        "generated_at": _ts(),
        "query": q,
        "query_type": qtype,
        "scope": scope or "all",
        "total_results": total,
        "offset": offset,
        "limit": limit,
        "has_more": has_more,
        "results": results,
        "paths": {
            "self": "search",
            "feed": "feed",
            "detail": "detail/{type}/{id}",
            "status": "status",
        },
    }


def _render_detail_html(
    obj_type: str,
    obj_id: str,
    payload: dict[str, Any],
) -> str:
    """Render the shared 3-pane detail layout (Summary, Verification Timeline, Relationships) as HTML."""
    summary = payload.get("summary") or {}
    timeline = payload.get("verification_timeline") or []
    relationships = payload.get("relationships") or []

    summary_rows = "".join(
        f'<div class="kv"><span>{escape(str(k))}</span><strong class="mono">{escape(str(v))}</strong></div>'
        for k, v in summary.items()
    )
    timeline_rows = "".join(
        f'<div class="result-item">'
        f'<span>{escape(str(t.get("stage", "")))}</span> '
        f'<span class="badge badge-{"onchain" if t.get("status") == "complete" else "runtime"}">{escape(str(t.get("status", "")))}</span> '
        f'<span class="muted">{escape(str(t.get("source", "")))}</span>'
        f'</div>'
        for t in timeline
    )
    def _rel_row(r: dict) -> str:
        rel_id = str(r.get("id", ""))
        label = escape(str(r.get("label", rel_id)))
        if rel_id and r.get("type"):
            rel_type = str(r.get("type", ""))
            href = f"detail/{quote(rel_type, safe='')}/{quote(rel_id, safe='')}"
            return f'<div class="result-item"><a href="{href}"><code>{escape(rel_id[:20])}{"…" if len(rel_id) > 20 else ""}</code></a> — {label}</div>'
        return f'<div class="result-item"><code>{escape(rel_id)}</code> — {label}</div>'

    rel_rows = "".join(_rel_row(r) for r in relationships) if relationships else '<p class="muted">No linked items.</p>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(obj_type)} {escape(obj_id[:24])}{"…" if len(obj_id) > 24 else ""} — zkSyslog</title>
<style>
:root {{ --bg:#090b12; --panel:#0f131d; --line:#2a3040; --text:#f4f7ff; --muted:#7a8699; --emerald:#10b981; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: "Inter", sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 20px; }}
.mono {{ font-family: "JetBrains Mono", monospace; font-size: 12px; word-break: break-all; }}
a {{ color: var(--emerald); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.container {{ max-width: 1000px; margin: 0 auto; }}
h1 {{ font-size: 18px; margin-bottom: 8px; }}
nav {{ margin-bottom: 16px; font-size: 13px; }}
.breadcrumb {{ font-size: 12px; color: var(--muted); }}
.breadcrumb a {{ color: var(--emerald); }}
.breadcrumb-sep {{ margin: 0 6px; color: var(--muted); }}
.breadcrumb-id {{ font-size: 11px; word-break: break-all; }}
.detail-panes {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }}
.pane {{ background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }}
.pane h3 {{ font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 12px; }}
.kv {{ display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid rgba(42,48,64,0.6); font-size: 13px; }}
.kv span {{ color: var(--muted); }}
.result-item {{ padding: 6px 0; border-bottom: 1px solid rgba(42,48,64,0.5); font-size: 13px; }}
.badge {{ font-size: 10px; padding: 2px 6px; border-radius: 4px; }}
.badge-onchain {{ background: rgba(16,185,129,.2); color: var(--emerald); }}
.badge-runtime {{ background: rgba(122,134,153,.2); color: var(--muted); }}
</style>
</head>
<body>
<div class="container">
<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../..">zkSyslog</a> <span class="breadcrumb-sep">→</span> <span>{escape(obj_type)}</span> <span class="breadcrumb-sep">→</span> <code class="breadcrumb-id">{escape(obj_id[:32])}{"…" if len(obj_id) > 32 else ""}</code></nav>
<h1>{escape(obj_type)} detail</h1>
<p class="muted" style="font-size:12px">{escape(obj_id)}</p>
<div class="detail-panes">
  <div class="pane">
    <h3>Summary</h3>
    <div>{summary_rows or "<p class=\"muted\">No fields.</p>"}</div>
  </div>
  <div class="pane">
    <h3>Verification Timeline</h3>
    <div>{timeline_rows or "<p class=\"muted\">No stages.</p>"}</div>
  </div>
  <div class="pane">
    <h3>Relationships</h3>
    <div>{rel_rows}</div>
  </div>
</div>
</div>
</body>
</html>"""


@router.get(
    "/detail/{obj_type}/{obj_id}",
    summary="Shared detail view for any explorer object",
)
async def forge_detail(
    request: Request,
    obj_type: str,
    obj_id: str,
) -> Any:
    """
    Returns the shared 3-pane explorer structure for any object.
    HTML when Accept includes text/html, JSON otherwise.
    """
    summary: dict[str, Any] = {
        "type": obj_type,
        "id": obj_id,
        "status": "unknown",
        "source": "runtime",
    }
    timeline: list[dict[str, Any]] = []
    relationships: list[dict[str, Any]] = []

    if obj_type == "receipt":
        receipt_svc = await _get_receipt_service()
        if receipt_svc:
            try:
                raw = await receipt_svc.get_receipts()
                if raw:
                    for r in raw:
                        if isinstance(r, dict) and (
                            r.get("tx_hash") == obj_id or r.get("id") == obj_id
                        ):
                            summary.update({
                                "action": r.get("action", ""),
                                "proof_type": r.get("proof_type", ""),
                                "result": r.get("result", ""),
                                "timestamp": r.get("timestamp", ""),
                                "fact_hash": r.get("fact_hash", ""),
                                "status": "verified" if r.get("tx_hash") else "runtime",
                                "source": "on-chain" if r.get("tx_hash") else "runtime",
                            })
                            # Build verification timeline
                            timeline = [
                                {
                                    "stage": "action",
                                    "status": "complete",
                                    "source": "runtime",
                                    "detail": r.get("action", ""),
                                },
                                {
                                    "stage": "proof_generation",
                                    "status": "complete" if r.get("proof_type") else "not_present",
                                    "source": "runtime",
                                    "detail": r.get("proof_type", ""),
                                },
                                {
                                    "stage": "fact_registration",
                                    "status": "complete" if r.get("fact_hash") else "not_present",
                                    "source": "on-chain" if r.get("fact_hash") else "not_configured",
                                    "detail": r.get("fact_hash", ""),
                                },
                                {
                                    "stage": "l3_inclusion",
                                    "status": "complete" if r.get("tx_hash") else "pending",
                                    "source": "on-chain" if r.get("tx_hash") else "not_configured",
                                    "detail": r.get("tx_hash", ""),
                                },
                                {
                                    "stage": "l2_verification",
                                    "status": "not_present",
                                    "source": "not_configured",
                                    "detail": "",
                                },
                                {
                                    "stage": "l1_verification",
                                    "status": "not_present",
                                    "source": "not_configured",
                                    "detail": "",
                                },
                            ]
                            # Relationships: fact and tx links when present
                            if r.get("fact_hash"):
                                relationships.append({
                                    "type": "fact",
                                    "id": str(r["fact_hash"]),
                                    "label": "Fact",
                                    "verb": "registered",
                                    "source": "on-chain",
                                })
                            if r.get("tx_hash"):
                                relationships.append({
                                    "type": "transaction",
                                    "id": str(r["tx_hash"]),
                                    "label": "L3 transaction",
                                    "verb": "included",
                                    "source": "rpc",
                                })
                            break
            except Exception:
                pass
    elif obj_type == "entity":
        summary["status"] = "indexed"
        summary["source"] = "index"
        summary["label"] = obj_id
        timeline = [{"stage": "indexed", "status": "complete", "source": "index", "detail": obj_id}]
    elif obj_type in ("transaction", "tx"):
        tx_rec = await _get_tx_receipt(obj_id)
        if tx_rec:
            status = (tx_rec.get("finality_status") or tx_rec.get("status") or "UNKNOWN")
            block_num = tx_rec.get("block_number")
            summary.update({
                "status": status,
                "source": "rpc",
                "block_number": block_num,
                "execution_status": tx_rec.get("execution_status", ""),
            })
            timeline = [
                {"stage": "submitted", "status": "complete", "source": "rpc", "detail": "transaction"},
                {"stage": "accepted_l2", "status": "complete" if status in ("ACCEPTED_ON_L2", "ACCEPTED_ON_L1") else "pending", "source": "rpc", "detail": status},
                {"stage": "accepted_l1", "status": "complete" if status == "ACCEPTED_ON_L1" else "pending", "source": "rpc", "detail": status},
            ]
            if block_num is not None:
                relationships.append({"type": "block", "id": str(block_num), "label": "Block", "verb": "included_in", "source": "rpc"})
    elif obj_type == "block":
        block_id = obj_id if obj_id == "latest" else (int(obj_id) if str(obj_id).isdigit() else None)
        if block_id is not None:
            blk = await _get_block(block_id)
            if blk:
                summary.update({
                    "status": "finalized",
                    "source": "rpc",
                    "block_number": blk.get("block_number"),
                    "block_hash": blk.get("block_hash"),
                    "parent_hash": blk.get("parent_hash"),
                })
                timeline = [{"stage": "block", "status": "complete", "source": "rpc", "detail": str(blk.get("block_number", ""))}]
                for tx_hash in (blk.get("transactions") or [])[:20]:
                    relationships.append({"type": "transaction", "id": str(tx_hash), "label": "Transaction", "verb": "in_block", "source": "rpc"})
    elif obj_type == "contract":
        summary["status"] = "known"
        summary["source"] = "rpc"
        summary["address"] = obj_id
        try:
            class_hash_result = await _rpc("starknet_getClassHashAt", {"block_id": "latest", "contract_address": obj_id})
            if isinstance(class_hash_result, str):
                summary["class_hash"] = class_hash_result
        except Exception:
            pass
        timeline = [{"stage": "contract", "status": "complete", "source": "rpc", "detail": obj_id[:20] + "…" if len(obj_id) > 20 else obj_id}]
    elif obj_type == "proof_job":
        proof_rec = await _get_proof_record(obj_id)
        if proof_rec:
            summary.update({
                "status": "verified" if (proof_rec.get("verification") or {}).get("l3", {}).get("verified_on_chain") else "pending",
                "source": "runtime",
                "commitment_hash": proof_rec.get("commitment_hash"),
                "model": (proof_rec.get("ezkl_proof") or {}).get("model_name", ""),
            })
            timeline = [
                {"stage": "proof_generated", "status": "complete", "source": "runtime", "detail": proof_rec.get("commitment_hash", "")[:16] + "…"},
                {"stage": "l3_verified", "status": "complete" if (proof_rec.get("verification") or {}).get("l3", {}).get("verified_on_chain") else "pending", "source": "runtime", "detail": ""},
            ]
            model_name = (proof_rec.get("ezkl_proof") or {}).get("model_name")
            if model_name:
                relationships.append({"type": "model", "id": model_name, "label": "Model", "verb": "used_by", "source": "runtime"})
    elif obj_type == "model":
        model_info = await _get_model_info(obj_id)
        if model_info:
            summary.update({
                "status": "ready" if model_info.get("ready") else "incomplete",
                "source": "runtime",
                "name": model_info.get("name"),
                "accuracy": model_info.get("accuracy"),
                "proving_key": model_info.get("proving_key"),
                "verification_key": model_info.get("verification_key"),
            })
            timeline = [{"stage": "model", "status": "complete" if model_info.get("ready") else "pending", "source": "runtime", "detail": model_info.get("name", "")}]
    elif obj_type == "fact":
        summary["status"] = "known"
        summary["source"] = "on-chain"
        summary["fact_hash"] = obj_id
        timeline = [{"stage": "fact", "status": "complete", "source": "on-chain", "detail": obj_id[:20] + "…" if len(obj_id) > 20 else obj_id}]
        receipt_svc = await _get_receipt_service()
        if receipt_svc:
            try:
                raw = await receipt_svc.get_receipts()
                for r in (raw or []):
                    if isinstance(r, dict) and r.get("fact_hash") == obj_id:
                        rid = r.get("tx_hash") or r.get("id")
                        if rid:
                            relationships.append({"type": "receipt", "id": str(rid), "label": "Receipt", "verb": "references", "source": "runtime"})
                            if len(relationships) >= 20:
                                break
            except Exception:
                pass

    for rel in relationships:
        rel["href"] = f"detail/{quote(str(rel.get('type', '')), safe='')}/{quote(str(rel.get('id', '')), safe='')}"
    payload = {
        "generated_at": _ts(),
        "summary": summary,
        "verification_timeline": timeline,
        "relationships": relationships,
        "self_href": f"detail/{quote(obj_type, safe='')}/{quote(obj_id, safe='')}",
        "paths": {
            "home": "..",
            "feed": "feed",
            "search": "search",
            "status": "status",
            "detail": "detail/{type}/{id}",
        },
    }
    if "text/html" in request.headers.get("accept", ""):
        return HTMLResponse(_render_detail_html(obj_type, obj_id, payload))
    return JSONResponse(payload)


@router.get("/paths", summary="Explorer API paths (self-description)")
async def forge_paths() -> dict[str, Any]:
    """Returns the explorer surface: every path you can follow. Use these to traverse end-to-end."""
    return {
        "service": "starkforge-zksyslog",
        "description": "Proof-aware evidence explorer. Follow links in feed, search, and detail to traverse receipts → facts → proof jobs → models → transactions → blocks.",
        "paths": {
            "home": {"method": "GET", "path": "", "description": "Explorer homepage (HTML)"},
            "feed": {"method": "GET", "path": "feed", "description": "Latest proof-backed receipts; each item has detail_href"},
            "search": {"method": "GET", "path": "search", "description": "Unified search; results have detail_href per item"},
            "detail": {"method": "GET", "path": "detail/{type}/{id}", "description": "Any object; relationships include href to related objects"},
            "status": {"method": "GET", "path": "status", "description": "System status (receipts, proofs, lanes)"},
            "health": {"method": "GET", "path": "health", "description": "Health (HTML)"},
            "proving": {"method": "GET", "path": "proving", "description": "Proving stats (HTML)"},
            "lane": {"method": "GET", "path": "lane/{lane_id}", "description": "Feed filtered by proving lane"},
        },
        "object_types": ["receipt", "fact", "proof_job", "model", "transaction", "block", "contract", "entity"],
        "evidence_flow": "action → proof job → fact → L3 tx → block (follow Relationships on each detail page)",
    }


@router.get("/lane/{lane_id}", response_class=HTMLResponse, summary="Lane-specific explorer page")
async def forge_lane_page(request: Request, lane_id: str) -> HTMLResponse:
    """Dedicated page for one proving lane: feed filtered by proof_type, link back to explorer."""
    status = await forge_status()
    lanes = status.get("lanes", {})
    available = lanes.get(lane_id, False)
    feed_data = await forge_feed(limit=50, lane=lane_id)
    items = feed_data.get("items", [])

    rows = ""
    for item in items:
        item_id = str(item.get("id", "-"))
        short_id = item_id[:12] + "..." + item_id[-8:] if len(item_id) > 24 else item_id
        detail_url = f"detail/receipt/{quote(str(item_id), safe='')}"
        badge_cls = "badge-onchain" if item.get("source") == "on-chain" else "badge-runtime"
        rows += f"""<tr>
  <td><a href="{detail_url}"><code>{escape(short_id)}</code></a></td>
  <td>{escape(str(item.get("action", "-")))}</td>
  <td>{escape(str(item.get("proof_type", "-")))}</td>
  <td><span class="badge {badge_cls}">{escape(str(item.get("source", "runtime")))}</span></td>
  <td class="muted">{escape(str(item.get("timestamp", "-")))}</td>
</tr>"""
    if not rows:
        rows = f'<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No receipts for this lane yet.</td></tr>'

    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lane {escape(lane_id)} — zkSyslog</title>
<style>
:root {{ --bg:#090b12; --panel:#0f131d; --line:#2a3040; --text:#f4f7ff; --muted:#7a8699; --emerald:#10b981; }}
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ font-family: Inter, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 20px; }}
a {{ color: var(--emerald); text-decoration: none; }} a:hover {{ text-decoration: underline; }}
.container {{ max-width: 900px; margin: 0 auto; }}
h1 {{ font-size: 1.25rem; margin-bottom: 8px; }}
nav {{ margin-bottom: 16px; font-size: 13px; }}
.badge {{ font-size: 10px; padding: 2px 8px; border-radius: 999px; }}
.badge-onchain {{ background: rgba(16,185,129,.2); color: var(--emerald); }}
.badge-runtime {{ background: rgba(148,163,184,.15); color: var(--muted); }}
table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
th {{ text-align: left; font-size: 11px; text-transform: uppercase; color: var(--muted); padding: 8px; border-bottom: 1px solid var(--line); }}
td {{ padding: 8px; border-bottom: 1px solid rgba(42,48,64,.5); font-size: 13px; }}
.mono {{ font-family: JetBrains Mono, monospace; font-size: 12px; }}
</style>
</head>
<body>
<div class="container">
<nav><a href="..">← zkSyslog</a></nav>
<h1>Lane: {escape(lane_id)} <span class="badge {"badge-onchain" if available else "badge-runtime"}">{"on-chain" if available else "runtime"}</span></h1>
<p class="muted" style="font-size:12px;margin-top:4px">{len(items)} receipt(s) in this lane</p>
<div class="table-wrap" style="margin-top:16px;border:1px solid var(--line);border-radius:10px;overflow:auto">
<table>
<thead><tr><th>ID</th><th>Action</th><th>Proof Type</th><th>Source</th><th>Timestamp</th></tr></thead>
<tbody>{rows}</tbody>
</table>
</div>
</div>
</body>
</html>""")


@router.get("/health", response_class=HTMLResponse, summary="Health status page")
async def forge_health_page() -> HTMLResponse:
    """Health HTML page so the top nav Health link opens a page."""
    status = await forge_status()
    h = status.get("health", "unknown")
    rc = status.get("receipt_count", 0)
    ps = status.get("proof_stats", {}) or {}
    return HTMLResponse(
        f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Health — zkSyslog</title>'
        f'<style>body{{font-family:Inter,sans-serif;background:#090b12;color:#f4f7ff;padding:20px;}}'
        f'a{{color:#10b981;text-decoration:none;}}</style></head><body>'
        f'<nav><a href=".">← Explorer</a></nav><h1>Health</h1>'
        f'<p>Backend: {escape(str(h))} · Receipts: {rc} · Proofs: {ps.get("total", 0)} / {ps.get("verified", 0)} verified</p>'
        f'</body></html>'
    )


@router.get("/proving", response_class=HTMLResponse, summary="Proving status page")
async def forge_proving_page() -> HTMLResponse:
    """Proving / proof stats HTML page so the top nav Proving link opens a page."""
    status = await forge_status()
    ps = status.get("proof_stats", {}) or {}
    return HTMLResponse(
        f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Proving — zkSyslog</title>'
        f'<style>body{{font-family:Inter,sans-serif;background:#090b12;color:#f4f7ff;padding:20px;}}'
        f'a{{color:#10b981;text-decoration:none;}}</style></head><body>'
        f'<nav style="margin-bottom:16px"><a href=".">← Explorer</a></nav><h1>Proving</h1>'
        f'<p>Proofs: {ps.get("total", 0)} total, {ps.get("verified", 0)} verified, {ps.get("pending", 0)} pending</p>'
        f'</body></html>'
    )


@router.get("", response_class=HTMLResponse, summary="zkSyslog explorer homepage")
async def forge_homepage(request: Request) -> HTMLResponse:
    """Renders the zkSyslog search-first explorer page."""
    # Gather live data for server-side render
    lane_param = request.query_params.get("lane")
    status = await forge_status()
    feed_data = await forge_feed(limit=20, lane=lane_param)

    receipt_count = status.get("receipt_count", 0)
    health = status.get("health", "unknown")
    proof_total = status.get("proof_stats", {}).get("total", 0)
    proof_verified = status.get("proof_stats", {}).get("verified", 0)

    # Build feed rows (link ID to detail page)
    feed_rows = ""
    for item in feed_data.get("items", []):
        item_id = str(item.get("id", "-"))
        short_id = item_id[:12] + "..." + item_id[-8:] if len(item_id) > 24 else item_id
        detail_type = item.get("type", "receipt")
        detail_url = f"detail/{detail_type}/{quote(str(item_id), safe='')}"
        badge_cls = "badge-onchain" if item.get("source") == "on-chain" else "badge-runtime"
        badge_label = item.get("source", "runtime")
        feed_rows += f"""<tr>
  <td><a href="{detail_url}"><code>{escape(short_id)}</code></a></td>
  <td>{escape(str(item.get("action", "-")))}</td>
  <td>{escape(str(item.get("proof_type", "-")))}</td>
  <td><span class="badge {badge_cls}">{escape(badge_label)}</span></td>
  <td class="muted">{escape(str(item.get("timestamp", "-")))}</td>
</tr>"""

    if not feed_rows:
        feed_rows = '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No receipts yet — the feed populates from live proof-backed events.</td></tr>'

    lanes_html = ""
    for lane, available in status.get("lanes", {}).items():
        cls = "badge-onchain" if available else "badge-runtime"
        lane_param = quote(str(lane), safe="")
        lanes_html += f'<a href="lane/{lane_param}" class="badge lane-badge {cls}" style="margin-right:6px;text-decoration:none;cursor:pointer">{escape(str(lane))}</a>'

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>zkSyslog — StarkForge Explorer</title>
  <style>
    :root {{
      --bg: #090b12;
      --panel: #0f131d;
      --panel-alt: #121826;
      --line: #2a3040;
      --text: #f4f7ff;
      --muted: #7a8699;
      --good: #34d399;
      --link: #67e8f9;
      --emerald: #10b981;
      --cyan: #22d3ee;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: "Inter", "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }}
    main {{
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 16px 64px;
    }}
    a {{ color: var(--link); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    code {{ font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 13px; }}
    .muted {{ color: var(--muted); }}

    /* ── Header ── */
    .explorer-header {{
      border-bottom: 1px solid var(--line);
      padding: 20px 0;
      margin-bottom: 24px;
    }}
    .explorer-header-inner {{
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }}
    .explorer-top-nav {{ display: flex; gap: 16px; align-items: center; }}
    .explorer-top-link {{
      font-size: 13px; font-weight: 600; color: var(--muted); text-decoration: none;
      padding: 4px 8px; border-radius: 6px;
    }}
    .explorer-top-link:hover {{ color: var(--emerald); }}
    .brand {{
      display: flex;
      align-items: baseline;
      gap: 8px;
    }}
    .brand h1 {{
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }}
    .brand h1 span {{ color: var(--emerald); }}
    .brand .sub {{ font-size: 12px; color: var(--muted); }}
    .status-strip {{
      display: flex;
      gap: 16px;
      font-size: 12px;
      color: var(--muted);
    }}
    .status-strip .dot {{
      display: inline-block;
      width: 7px; height: 7px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }}
    .dot-ok {{ background: var(--good); }}
    .dot-warn {{ background: #fb923c; }}
    .dot-err {{ background: #ef4444; }}

    /* ── Search ── */
    .search-section {{
      margin-bottom: 32px;
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--panel);
    }}
    .search-section .search-bar {{
      display: flex;
      gap: 0;
      border: 1px solid #2f3a50;
      border-radius: 10px;
      overflow: hidden;
      background: var(--panel);
    }}
    .search-bar input {{
      flex: 1;
      min-width: 0;
      border: none;
      background: transparent;
      color: var(--text);
      font-size: 15px;
      padding: 14px 16px;
      outline: none;
      font-family: "JetBrains Mono", "Fira Code", monospace;
    }}
    .search-bar input::placeholder {{ color: #4a5568; }}
    .search-bar button {{
      border: none;
      background: var(--emerald);
      color: #fff;
      font-weight: 600;
      padding: 0 24px;
      cursor: pointer;
      font-size: 14px;
      transition: background .12s;
    }}
    .search-bar button:hover {{ background: #059669; }}
    #search-clear {{ background: var(--panel); color: var(--muted); border: 1px solid var(--line); }}
    #search-clear:hover {{ background: #2f3a50; color: #e2e8f0; }}
    .search-load-more-btn {{ background: var(--panel); color: var(--muted); border: 1px solid var(--line); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }}
    .search-load-more-btn:hover {{ color: var(--emerald); border-color: var(--emerald); }}
    .scope-label {{
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
      margin-bottom: 10px;
      margin-top: 16px;
      display: block;
    }}
    .scope-chips {{
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }}
    .scope-chip {{
      border: 1px solid #2f3a50;
      color: #a0aec0;
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      background: transparent;
      transition: border-color .15s, color .15s, background .15s;
      min-height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }}
    .scope-chip:hover {{ border-color: #4a5568; color: var(--text); background: rgba(255,255,255,0.03); }}
    .scope-chip.active {{
      border-color: rgba(16, 185, 129, 0.6);
      color: #d1fae5;
      background: rgba(16, 185, 129, 0.12);
    }}
    .scope-chip:focus-visible {{ outline: 2px solid var(--emerald); outline-offset: 2px; }}

    .muted-link {{ color: var(--muted); text-decoration: none; }}
    .muted-link:hover {{ color: var(--link); text-decoration: underline; }}
    /* ── Cards ── */
    .stat-strip {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }}
    .stat-card {{
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
      background: var(--panel);
    }}
    .stat-card .label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--muted); }}
    .stat-card .value {{ font-size: 22px; font-weight: 700; margin-top: 4px; }}

    /* ── Feed table ── */
    .feed-section h2 {{
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--muted);
      margin-bottom: 10px;
    }}
    .table-wrap {{
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: auto;
      background: var(--panel);
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
    }}
    th, td {{
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      white-space: nowrap;
    }}
    th {{ color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }}
    tr:last-child td {{ border-bottom: none; }}
    tr:hover td {{ background: rgba(255,255,255,0.02); }}

    /* ── Badges ── */
    .badge {{
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid;
    }}
    .badge-onchain {{
      border-color: rgba(16,185,129,0.5);
      color: #a7f3d0;
      background: rgba(16,185,129,0.1);
    }}
    .badge-runtime {{
      border-color: rgba(148,163,184,0.3);
      color: #94a3b8;
      background: rgba(148,163,184,0.06);
    }}

    /* ── Lanes ── */
    .lanes-section {{
      margin-top: 20px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
    }}
    .lane-badge:hover {{ opacity: 0.9; text-decoration: none; }}
    .lanes-section h3 {{
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--muted);
      margin-bottom: 8px;
    }}
    .paths-section {{
      margin-top: 24px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      font-size: 12px;
      color: var(--muted);
    }}
    .paths-section h3 {{
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--muted);
      margin-bottom: 8px;
    }}
    .paths-section a {{ color: var(--link); }}
    .paths-section code {{ font-size: 11px; color: var(--emerald); }}

    /* ── Search results ── */
    #search-results {{
      display: none;
      margin-bottom: 24px;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 16px;
      background: var(--panel);
    }}
    #search-results h3 {{
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 8px;
    }}
    .result-group {{ margin-top: 12px; }}
    .result-group h4 {{
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--emerald);
      margin-bottom: 6px;
    }}
    .result-item {{
      padding: 6px 8px;
      border-bottom: 1px solid rgba(42,48,64,0.5);
      font-size: 13px;
    }}
    .result-item:last-child {{ border-bottom: none; }}

    /* ── Footer ── */
    .explorer-footer {{
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      font-size: 12px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
    }}

    @media (max-width: 640px) {{
      .search-section {{ padding: 14px; }}
      .search-bar {{ flex-wrap: wrap; }}
      .search-bar input {{ min-height: 44px; }}
      .search-bar button {{ min-height: 44px; flex: 1 1 auto; }}
      .scope-chips {{ gap: 6px; }}
      .scope-chip {{ padding: 6px 12px; min-height: 32px; }}
      .stat-strip {{ grid-template-columns: repeat(2, 1fr); }}
      .explorer-header-inner {{ flex-direction: column; align-items: flex-start; }}
      th, td {{ font-size: 12px; padding: 8px; }}
    }}
  </style>
</head>
<body>
  <header class="explorer-header">
    <div class="explorer-header-inner">
      <div class="brand">
        <h1><span>Stark</span>Forge</h1>
        <span class="sub">zkSyslog Explorer</span>
      </div>
      <nav class="explorer-top-nav">
        <a href="health" class="explorer-top-link">Health</a>
        <a href="proving" class="explorer-top-link">Proving</a>
      </nav>
      <div class="status-strip">
        <span><span class="dot {"dot-ok" if health == "ok" else "dot-warn"}"></span> Backend: {health}</span>
        <span>{receipt_count} receipts</span>
        <span>{proof_total} proofs ({proof_verified} verified)</span>
      </div>
    </div>
  </header>

  <main>
    <!-- Search -->
    <div class="search-section">
      <div class="search-bar">
        <input id="search-input" type="text" placeholder="Search tx hash, address, fact hash, proof ID, model..." />
        <button id="search-btn">Search</button>
        <button id="search-clear" type="button">Clear</button>
      </div>
      <span class="scope-label">Filter by scope</span>
      <span class="scope-label">Filter by scope</span>
      <span class="scope-label">Filter by scope</span>
      <div class="scope-chips" id="scope-chips">
        <button type="button" class="scope-chip active" data-scope="all">All</button>
        <button type="button" class="scope-chip" data-scope="receipts">Receipts</button>
        <button type="button" class="scope-chip" data-scope="txs">Txs</button>
        <button type="button" class="scope-chip" data-scope="facts">Facts</button>
        <button type="button" class="scope-chip" data-scope="proofs">Proof Jobs</button>
        <button type="button" class="scope-chip" data-scope="contracts">Contracts</button>
        <button type="button" class="scope-chip" data-scope="models">Models</button>
        <button type="button" class="scope-chip" data-scope="entities">Entities</button>
      </div>
    </div>

    <!-- Search results (hidden by default) -->
    <div id="search-results">
      <h3>Search Results</h3>
      <div id="search-results-body"></div>
      <div id="search-load-more-wrap" style="display:none; margin-top:10px;">
        <button type="button" id="search-load-more" class="search-load-more-btn">Load more</button>
      </div>
    </div>

    <!-- Stats strip -->
    <div class="stat-strip">
      <div class="stat-card">
        <div class="label">Receipts</div>
        <div class="value">{receipt_count}</div>
      </div>
      <div class="stat-card">
        <div class="label">Proofs</div>
        <div class="value">{proof_total}</div>
      </div>
      <div class="stat-card">
        <div class="label">Verified</div>
        <div class="value">{proof_verified}</div>
      </div>
      <div class="stat-card">
        <div class="label">Lanes</div>
        <div class="value">{len(status.get("lanes", {}))}</div>
      </div>
    </div>

    <!-- Evidence Feed -->
    <div class="feed-section">
      <h2>Latest Proof-Backed Events{f' <span class="muted">(lane: {escape(str(lane_param))})</span>' if lane_param else ''} <a href="feed" class="muted-link" style="font-size:0.85em;font-weight:normal;">Feed (JSON)</a></h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Action</th>
              <th>Proof Type</th>
              <th>Source</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {feed_rows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Proving Lanes -->
    <div class="lanes-section">
      <h3>Active Proving Lanes</h3>
      {lanes_html}
    </div>

    <!-- Explorer surface: follow paths end-to-end -->
    <div class="paths-section">
      <h3>Explorer API</h3>
      <p class="paths-desc">This surface is proof-aware, not just L3. Follow <strong>Feed</strong> and <strong>Search</strong> into <strong>Detail</strong>; on each detail page use <strong>Relationships</strong> to go to linked facts, transactions, blocks, proof jobs, models. Every API response includes <code>detail_href</code> or <code>href</code> so you can traverse without constructing URLs.</p>
      <p class="paths-flow"><strong>Evidence flow:</strong> action → proof job → fact → L3 tx → block</p>
      <p><a href="paths" class="muted-link">Paths (JSON)</a> · <a href="feed" class="muted-link">Feed</a> · <a href="search" class="muted-link">Search</a> · <a href="status" class="muted-link">Status</a></p>
    </div>

    <footer class="explorer-footer">
      <span>StarkForge / zkSyslog &mdash; Obsqra Labs</span>
      <span>Generated: {status.get("generated_at", "")}</span>
    </footer>
  </main>

  <script>
    const searchInput = document.getElementById("search-input");
    const searchBtn = document.getElementById("search-btn");
    const searchResults = document.getElementById("search-results");
    const searchBody = document.getElementById("search-results-body");
    const scopeChips = document.querySelectorAll(".scope-chip");
    let activeScope = "all";

    scopeChips.forEach(chip => {{
      chip.addEventListener("click", function() {{
        scopeChips.forEach(function(c) {{ c.classList.remove("active"); }});
        chip.classList.add("active");
        activeScope = chip.dataset.scope || "all";
        var q = searchInput.value.trim();
        if (!q) q = activeScope === "all" ? "" : activeScope;
        searchInput.value = q;
        searchResults.style.display = "block";
        searchBody.innerHTML = "<p class=\\"muted\\">Searching...</p>";
        doSearch();
      }});
    }});

    const groupToType = {{ receipts: "receipt", proofs: "proof_job", contracts: "contract", facts: "fact", models: "model", entities: "entity" }};
    async function doSearch() {{
      window._searchOffset = 0;
      const q = searchInput.value.trim();
      try {{
        const url = "/api/v1/zkdefi/forge/search?q=" + encodeURIComponent(q) + (activeScope && activeScope !== "all" ? "&scope=" + encodeURIComponent(activeScope) : "") + "&limit=25&offset=" + (window._searchOffset || 0);
        const resp = await fetch(url);
        const data = await resp.json();
        var scopeLabel = data.scope || "all";
        var queryLabel = q ? ' for "' + q.replace(/"/g, "&quot;") + '"' : "";
        let html = '<p class="muted">Found ' + data.total_results + ' result(s)' + queryLabel + ' (scope: ' + scopeLabel + ')</p>';
        for (const [group, items] of Object.entries(data.results || {{}})) {{
          if (items.length === 0) continue;
          const objType = groupToType[group] || "receipt";
          html += '<div class="result-group" id="result-group-' + group + '"><h4>' + group + ' (' + items.length + ')</h4>';
          for (const item of items) {{
            const id = (item.id || "-").replace(/"/g, "&quot;");
            const href = "detail/" + objType + "/" + encodeURIComponent(item.id || "");
            html += '<div class="result-item"><a href="' + href + '"><code>' + id + '</code></a> &mdash; ' + (item.action || item.proof_type || group) + ' <span class="muted">' + (item.timestamp || "") + '</span></div>';
          }}
          html += '</div>';
        }}
        if (data.total_results === 0) html += '<p class="muted">No matches. Try a different scope or query.</p>';
        searchBody.innerHTML = html;
        window._searchOffset = (data.offset || 0) + (data.limit || 25);
        window._searchTotalShown = data.total_results || 0;
        var loadMoreWrap = document.getElementById("search-load-more-wrap");
        if (loadMoreWrap) loadMoreWrap.style.display = (data.has_more && data.total_results > 0) ? "block" : "none";
        searchResults.style.display = "block";
        searchResults.scrollIntoView({{ behavior: "smooth", block: "nearest" }});
        if (q || (activeScope && activeScope !== "all")) {{
          const params = new URLSearchParams(window.location.search);
          if (q) params.set("q", q);
          if (activeScope && activeScope !== "all") params.set("scope", activeScope);
          var url = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
          window.history.replaceState({{}}, "", url);
        }}
      }} catch (e) {{
        searchBody.innerHTML = '<p class="muted">Search failed: ' + e.message + '</p>';
        searchResults.style.display = "block";
      }}
    }}

    searchBtn.addEventListener("click", doSearch);
    searchInput.addEventListener("keydown", (e) => {{ if (e.key === "Enter") doSearch(); }});
    async function loadMore() {{
      const q = searchInput.value.trim();
      const offset = window._searchOffset || 0;
      const url = "/api/v1/zkdefi/forge/search?q=" + encodeURIComponent(q) + (activeScope && activeScope !== "all" ? "&scope=" + encodeURIComponent(activeScope) : "") + "&limit=25&offset=" + offset;
      try {{
        const resp = await fetch(url);
        const data = await resp.json();
        const receipts = (data.results && data.results.receipts) ? data.results.receipts : [];
        var groupEl = document.getElementById("result-group-receipts");
        if (groupEl && receipts.length > 0) {{
          for (var i = 0; i < receipts.length; i++) {{
            var item = receipts[i];
            var id = (item.id || "-").replace(/"/g, "&quot;");
            var href = "detail/receipt/" + encodeURIComponent(item.id || "");
            var div = document.createElement("div");
            div.className = "result-item";
            div.innerHTML = '<a href="' + href + '"><code>' + id + '</code></a> &mdash; ' + (item.action || item.proof_type || "receipt") + ' <span class="muted">' + (item.timestamp || "") + '</span>';
            groupEl.appendChild(div);
          }}
          window._searchTotalShown = (window._searchTotalShown || 0) + receipts.length;
          var firstP = searchBody.querySelector("p.muted");
          var scopeLabel = data.scope || "all";
          var queryLabel = q ? ' for "' + q.replace(/"/g, "&quot;") + '"' : "";
          if (firstP) firstP.textContent = "Found " + window._searchTotalShown + " result(s)" + queryLabel + " (scope: " + scopeLabel + ")";
        }}
        window._searchOffset = (data.offset || 0) + (data.limit || 25);
        var loadMoreWrap = document.getElementById("search-load-more-wrap");
        if (loadMoreWrap) loadMoreWrap.style.display = data.has_more ? "block" : "none";
      }} catch (e) {{
        var w = document.getElementById("search-load-more-wrap");
        if (w) w.style.display = "none";
      }}
    }}
    var loadMoreBtn = document.getElementById("search-load-more");
    if (loadMoreBtn) loadMoreBtn.addEventListener("click", loadMore);
    const searchClear = document.getElementById("search-clear");
    if (searchClear) searchClear.addEventListener("click", function() {{
      searchInput.value = "";
      activeScope = "all";
      scopeChips.forEach(function(c) {{ c.classList.remove("active"); if (c.dataset.scope === "all") c.classList.add("active"); }});
      searchResults.style.display = "block";
      searchBody.innerHTML = "<p class=\\"muted\\">Searching...</p>";
      doSearch();
    }});
    document.addEventListener("keydown", function(e) {{
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target && e.target.tagName) || "")) {{
        e.preventDefault();
        searchInput.focus();
      }}
    }});

    (function applyParamsFromUrl() {{
      const params = new URLSearchParams(window.location.search);
      const lane = params.get("lane");
      const q = params.get("q");
      const scope = params.get("scope");
      if (scope && ["all","receipts","txs","facts","proofs","contracts","models","entities"].indexOf(scope) >= 0) {{
        activeScope = scope;
        scopeChips.forEach(function(c) {{ c.classList.toggle("active", c.dataset.scope === scope); }});
      }}
      if (lane) {{
        searchInput.value = lane;
        searchResults.style.display = "block";
        doSearch();
      }} else if (q || scope) {{
        if (q) searchInput.value = q;
        searchResults.style.display = "block";
        doSearch();
      }}
    }})();
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)
