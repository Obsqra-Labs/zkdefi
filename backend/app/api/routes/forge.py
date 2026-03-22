"""
StarkForge / zkSyslog Explorer API Routes

Search-first proof-aware explorer surface. Provides:
- GET  /forge/                  Explorer homepage (HTML)
- GET  /forge/feed              Latest proof-backed receipts/events (JSON)
- GET  /forge/proofs            Dedicated proof feed with settlement cursors (JSON)
- GET  /forge/proofs/page       Dedicated proofs page (HTML)
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


def _normalize_timestamp(value: object) -> str | None:
    from datetime import datetime, timezone

    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat()
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        try:
            return datetime.fromtimestamp(float(text), timezone.utc).isoformat()
        except Exception:
            return text
    return text


def _binding_profile_label(profile: object) -> str | None:
    if isinstance(profile, dict):
        version = str(profile.get("statement_version") or "").strip()
        keys = (
            "binds_ezkl_proof_hash",
            "binds_model_hash",
            "binds_output_bounds",
            "binds_output_commitment",
            "binds_output_vector",
            "binds_timestamp",
        )
        flags = [bool(profile.get(key)) for key in keys]
        if flags and all(flags):
            base = "full"
        elif any(flags):
            base = "partial"
        else:
            base = "minimal"
        return f"{base} / {version}" if version else base
    text = str(profile or "").strip()
    return text or None


def _match_scope_label(scope: object) -> str | None:
    value = str(scope or "").strip().lower()
    if not value:
        return "exact proof"
    if value == "lane_model":
        return "lane/model mirror"
    if value == "exact_hash":
        return "exact proof"
    return value.replace("_", " ")


def _short_id(value: object, head: int = 12, tail: int = 8) -> str:
    text = str(value or "").strip()
    if not text:
        return "-"
    if len(text) <= head + tail + 3:
        return text
    return f"{text[:head]}...{text[-tail:]}"


def _binding_tone(label: object) -> str:
    value = str(label or "").strip().lower()
    if value.startswith("full"):
        return "good"
    if value.startswith("partial"):
        return "warn"
    return "neutral"


def _chip_html(label: object, tone: str = "neutral") -> str:
    text = str(label or "").strip()
    if not text:
        return ""
    tone_class = tone if tone in {"good", "warn", "neutral", "exact", "mirror"} else "neutral"
    return f'<span class="mini-chip {tone_class}">{escape(text)}</span>'


def _code_ref_html(value: object, href: str | None = None, *, shorten: bool = True) -> str:
    text = str(value or "").strip() or "-"
    label = _short_id(text) if shorten and text != "-" else text
    code_html = f'<code class="code-chip" title="{escape(text)}">{escape(label)}</code>'
    if href:
        return f'<a href="{escape(href)}">{code_html}</a>'
    return code_html


def _cell_stack_html(primary_html: str, *, meta_lines: list[str] | None = None, chips: list[str] | None = None) -> str:
    parts = ['<div class="cell-stack">', f'<div class="cell-title">{primary_html}</div>']
    visible_chips = [chip for chip in (chips or []) if chip]
    if visible_chips:
        parts.append(f'<div class="cell-chip-row">{"".join(visible_chips)}</div>')
    for line in meta_lines or []:
        if line:
            parts.append(f'<div class="cell-meta">{line}</div>')
    parts.append("</div>")
    return "".join(parts)


def _forge_list_page_styles(max_width_px: int = 1180) -> str:
    return f"""
:root {{ --bg:#090b12; --panel:#0f131d; --panel-alt:#121826; --line:#2a3040; --text:#f4f7ff; --muted:#7a8699; --emerald:#10b981; --link:#67e8f9; --warn:#fb923c; }}
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ font-family: Inter, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 20px; }}
a {{ color: var(--link); text-decoration:none; }} a:hover {{ text-decoration:underline; }}
.container {{ max-width: {max_width_px}px; margin: 0 auto; }}
nav {{ margin-bottom: 16px; display:flex; gap:14px; flex-wrap:wrap; font-size:13px; }}
.muted {{ color: var(--muted); }}
.page-intro {{ margin-top: 6px; color: var(--muted); max-width: 84ch; }}
.toolbar {{
  display:grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap:12px;
  align-items:end;
  margin: 16px 0;
  padding: 14px;
  border:1px solid var(--line);
  border-radius:12px;
  background:linear-gradient(180deg, rgba(15,19,29,.96), rgba(18,24,38,.88));
}}
.toolbar label {{
  font-size:13px;
  color:var(--muted);
  display:flex;
  flex-direction:column;
  gap:6px;
}}
.toolbar label span {{
  font-size:11px;
  text-transform:uppercase;
  letter-spacing:.06em;
}}
.toolbar .toolbar-check {{
  flex-direction:row;
  align-items:center;
  gap:8px;
  min-height: 42px;
}}
.toolbar input[type=text] {{
  width:100%;
  min-width: 0;
  padding:10px 12px;
  border-radius:8px;
  border:1px solid var(--line);
  background:#0b1019;
  color:var(--text);
}}
.toolbar button {{
  background: var(--panel);
  color: var(--muted);
  border: 1px solid var(--line);
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
}}
.toolbar button:hover {{ color: var(--emerald); border-color: var(--emerald); }}
.table-wrap {{
  border:1px solid var(--line);
  border-radius:12px;
  overflow:auto;
  background:linear-gradient(180deg, rgba(12,16,25,.98), rgba(15,19,29,.92));
  box-shadow: 0 12px 32px rgba(0,0,0,.22);
}}
table {{
  width:100%;
  min-width: 980px;
  border-collapse: separate;
  border-spacing: 0;
}}
th, td {{
  text-align:left;
  padding:12px 14px;
  border-bottom:1px solid rgba(42,48,64,.72);
  font-size:13px;
  vertical-align:top;
  white-space:normal;
  overflow-wrap:anywhere;
}}
thead th {{
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(9,12,20,.96);
  backdrop-filter: blur(10px);
  color:var(--muted);
  font-weight:600;
  font-size:11px;
  text-transform:uppercase;
  letter-spacing:.08em;
}}
tbody tr:nth-child(odd) td {{ background: rgba(255,255,255,.015); }}
tbody tr:hover td {{ background: rgba(28,39,58,.68); }}
tbody tr:last-child td {{ border-bottom:none; }}
.cell-stack {{ display:flex; flex-direction:column; gap:5px; min-width:0; }}
.cell-title {{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-weight:600; color:var(--text); }}
.cell-meta {{ font-size:12px; color:var(--muted); }}
.cell-chip-row {{ display:flex; flex-wrap:wrap; gap:6px; }}
.mini-chip {{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:2px 8px;
  border-radius:999px;
  border:1px solid rgba(122,134,153,.28);
  background:rgba(122,134,153,.08);
  color:#cdd7e7;
  font-size:11px;
  font-weight:600;
}}
.mini-chip.good {{
  border-color: rgba(16,185,129,.36);
  background: rgba(16,185,129,.12);
  color: #b7f7dc;
}}
.mini-chip.warn {{
  border-color: rgba(251,146,60,.36);
  background: rgba(251,146,60,.12);
  color: #ffd8b3;
}}
.mini-chip.exact {{
  border-color: rgba(34,211,238,.3);
  background: rgba(34,211,238,.1);
  color: #c7fbff;
}}
.mini-chip.mirror {{
  border-color: rgba(147,197,253,.3);
  background: rgba(147,197,253,.1);
  color: #dbeafe;
}}
.code-chip {{
  display:inline-flex;
  align-items:center;
  padding:3px 7px;
  border-radius:7px;
  border:1px solid rgba(42,48,64,.85);
  background:#09111b;
  font-family: "JetBrains Mono", monospace;
  font-size:12px;
  max-width:100%;
}}
.graph-metric {{ font-weight:600; }}
.muted-link {{ color: var(--muted); text-decoration:none; }}
.muted-link:hover {{ color: var(--link); text-decoration:underline; }}
.footer {{ margin-top: 12px; display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap; }}
@media (max-width: 760px) {{
  body {{ padding: 16px; }}
  .toolbar {{ grid-template-columns: 1fr; }}
  table {{ min-width: 760px; }}
  th, td {{ padding: 10px 11px; font-size: 12px; }}
}}
"""


def _load_pathc_artifacts() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        from app.services.showcase_artifacts import load_pathc_history, load_pathc_latest_report

        latest = load_pathc_latest_report()
        history = load_pathc_history()
        return (
            latest if isinstance(latest, dict) else {},
            history if isinstance(history, list) else [],
        )
    except Exception:
        return {}, []


def _normalize_pathc_route_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    tx_hash = str(raw.get("tx_hash") or "").strip()
    if not tx_hash:
        return None
    model_name = (
        str(raw.get("resolved_model_name") or "").strip()
        or str(raw.get("source_model_name") or "").strip()
        or str(raw.get("route_key") or "").strip()
    )
    generated_at = _normalize_timestamp(raw.get("last_checked_at") or raw.get("generated_at"))
    l2_verified = bool(raw.get("l2_verified") or (raw.get("l2_last") or {}).get("verified_on_l2"))
    return {
        "tx_hash": tx_hash,
        "model_name": model_name,
        "route_key": str(raw.get("route_key") or "").strip() or None,
        "route_source": str(raw.get("route_source") or "").strip() or None,
        "generated_at": generated_at,
        "latest_public_timestamp": generated_at if l2_verified else None,
        "latest_public_tx_hash": tx_hash if l2_verified else None,
        "l1_status": raw.get("l1_status", (raw.get("l1_receipt") or {}).get("status")),
        "l1_gas_used": raw.get("l1_gas_used", (raw.get("l1_receipt") or {}).get("gasUsed")),
        "l2_verified": l2_verified,
        "mode": str(raw.get("mode") or "verify_and_bridge"),
        "network": "ethereum_sepolia",
        "detail_href": f"detail/transaction/{quote(tx_hash, safe='')}",
        "source": "pathc_artifact",
    }


def _get_pathc_route_rows() -> list[dict[str, Any]]:
    latest, history = _load_pathc_artifacts()
    rows_by_tx: dict[str, dict[str, Any]] = {}
    for raw in history:
        row = _normalize_pathc_route_row(raw)
        if not row:
            continue
        rows_by_tx[str(row.get("tx_hash"))] = row
    latest_row = _normalize_pathc_route_row(latest)
    if latest_row:
        rows_by_tx[str(latest_row.get("tx_hash"))] = latest_row
    rows = list(rows_by_tx.values())
    rows.sort(
        key=lambda row: (
            str(row.get("generated_at") or ""),
            str(row.get("tx_hash") or ""),
        ),
        reverse=True,
    )
    return rows


def _pathc_settlement_graph(route: dict[str, Any]) -> dict[str, Any] | None:
    model_name = str(route.get("model_name") or "").strip()
    tx_hash = str(
        route.get("latest_public_tx_hash")
        or route.get("latest_tx_hash")
        or route.get("tx_hash")
        or ""
    ).strip()
    if not model_name or not tx_hash:
        return None
    return {
        "nodes": [
            {"type": "model", "id": model_name, "href": f"detail/model/{quote(model_name, safe='')}"},
            {"type": "transaction", "id": tx_hash, "href": f"detail/transaction/{quote(tx_hash, safe='')}"},
        ],
        "edges": [
            {"from": tx_hash, "to": model_name, "verb": "bridges_for"},
        ],
    }


def _pathc_summary_rows() -> list[dict[str, Any]]:
    rows = _get_pathc_route_inventory_rows()
    confirmed = [row for row in rows if bool(row.get("l2_verified"))]
    latest_confirmed = confirmed[0] if confirmed else None
    models = {str(row.get("model_name") or "").strip() for row in rows if str(row.get("model_name") or "").strip()}
    confirmed_models = {
        str(row.get("model_name") or "").strip() for row in confirmed if str(row.get("model_name") or "").strip()
    }
    return [
        {
            "lane": "path_c_bridge",
            "route_count": len(rows),
            "confirmed_route_count": len(confirmed),
            "model_count": len(models),
            "confirmed_model_count": len(confirmed_models),
            "latest_public_timestamp": latest_confirmed.get("latest_public_timestamp") if latest_confirmed else None,
            "latest_public_tx_hash": latest_confirmed.get("latest_public_tx_hash") if latest_confirmed else None,
            "latest_public_model_name": latest_confirmed.get("model_name") if latest_confirmed else None,
        }
    ]


def _get_pathc_route_inventory_rows() -> list[dict[str, Any]]:
    by_route: dict[str, dict[str, Any]] = {}
    for row in _get_pathc_route_rows():
        route_id = (
            str(row.get("route_key") or "").strip()
            or str(row.get("model_name") or "").strip()
            or str(row.get("tx_hash") or "").strip()
        )
        if not route_id:
            continue
        current = by_route.get(route_id)
        if current is None:
            current = {
                "route_id": route_id,
                "route_key": row.get("route_key"),
                "route_source": row.get("route_source"),
                "model_name": row.get("model_name"),
                "mode": row.get("mode"),
                "network": row.get("network"),
                "detail_href": row.get("detail_href"),
                "latest_attempt_timestamp": row.get("generated_at"),
                "latest_tx_hash": row.get("tx_hash"),
                "latest_public_timestamp": row.get("latest_public_timestamp"),
                "latest_public_tx_hash": row.get("latest_public_tx_hash"),
                "l2_verified": bool(row.get("l2_verified")),
            }
            by_route[route_id] = current
            continue
        if str(row.get("generated_at") or "") >= str(current.get("latest_attempt_timestamp") or ""):
            current["latest_attempt_timestamp"] = row.get("generated_at")
            current["latest_tx_hash"] = row.get("tx_hash")
            current["detail_href"] = row.get("detail_href")
        if row.get("route_key"):
            current["route_key"] = row.get("route_key")
        if row.get("route_source"):
            current["route_source"] = row.get("route_source")
        if row.get("model_name"):
            current["model_name"] = row.get("model_name")
        if row.get("mode"):
            current["mode"] = row.get("mode")
        if row.get("network"):
            current["network"] = row.get("network")
        if row.get("l2_verified") and (
            str(row.get("latest_public_timestamp") or "") >= str(current.get("latest_public_timestamp") or "")
        ):
            current["latest_public_timestamp"] = row.get("latest_public_timestamp")
            current["latest_public_tx_hash"] = row.get("latest_public_tx_hash")
            current["l2_verified"] = True

    rows = list(by_route.values())
    rows.sort(
        key=lambda row: (
            str(row.get("latest_public_timestamp") or row.get("latest_attempt_timestamp") or ""),
            str(row.get("latest_public_tx_hash") or row.get("latest_tx_hash") or ""),
        ),
        reverse=True,
    )
    return rows


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


async def _get_indexed_proofs(
    *,
    limit: int = 50,
    model_name: str | None = None,
    user_address: str | None = None,
    public_only: bool = False,
    cursor_timestamp: str | None = None,
    cursor_proof_hash: str | None = None,
) -> list[dict[str, Any]]:
    payload = await _get_indexed_proof_payload(
        limit=limit,
        model_name=model_name,
        user_address=user_address,
        public_only=public_only,
        cursor_timestamp=cursor_timestamp,
        cursor_proof_hash=cursor_proof_hash,
    )
    proofs = payload.get("proofs")
    return proofs if isinstance(proofs, list) else []


async def _get_indexed_proof_items(
    *,
    limit: int = 50,
    model_name: str | None = None,
    user_address: str | None = None,
    public_only: bool = False,
    cursor_timestamp: str | None = None,
    cursor_proof_hash: str | None = None,
) -> list[dict[str, Any]]:
    payload = await _get_indexed_proof_payload(
        limit=limit,
        model_name=model_name,
        user_address=user_address,
        public_only=public_only,
        cursor_timestamp=cursor_timestamp,
        cursor_proof_hash=cursor_proof_hash,
    )
    return _proof_feed_items_from_payload(payload)


async def _get_indexed_proof_payload(
    *,
    limit: int = 50,
    model_name: str | None = None,
    user_address: str | None = None,
    public_only: bool = False,
    cursor_timestamp: str | None = None,
    cursor_proof_hash: str | None = None,
) -> dict[str, Any]:
    try:
        from app.api.routes import proofs as proofs_routes

        payload = await proofs_routes.list_proofs(
            model_name=model_name,
            user_address=user_address,
            source="indexed",
            public_only=public_only,
            sort_by="latest_public_settlement",
            limit=limit,
            offset=0,
            cursor_timestamp=cursor_timestamp,
            cursor_proof_hash=cursor_proof_hash,
        )
        return payload if isinstance(payload, dict) else {"proofs": []}
    except Exception as e:
        logger.warning("forge indexed proof fetch: %s", e)
        return {"proofs": []}


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


async def _list_proofs_for_search(limit: int = 50) -> list[dict[str, Any]]:
    """List indexed proof records with public-settlement summaries for search results."""
    proofs = await _get_indexed_proofs(limit=limit, public_only=False)
    out: list[dict[str, Any]] = []
    for row in proofs:
        bridge_statement = row.get("bridge_statement") if isinstance(row.get("bridge_statement"), dict) else {}
        summary = row.get("public_receipt_summary") if isinstance(row.get("public_receipt_summary"), dict) else {}
        proof_hash = row.get("proof_hash") or row.get("commitment_hash")
        if not proof_hash:
            continue
        out.append(
            {
                "id": str(proof_hash),
                "proof_type": bridge_statement.get("proof_type") or row.get("proof_type") or "proof",
                "model_name": bridge_statement.get("model_name") or row.get("model_name", ""),
                "verified": bool(summary.get("count")),
                "lane": bridge_statement.get("lane"),
                "binding_profile": bridge_statement.get("binding_profile"),
                "binding_profile_label": _binding_profile_label(bridge_statement.get("binding_profile")),
                "fact_hash": bridge_statement.get("fact_hash") or bridge_statement.get("bridge_fact_hash"),
                "latest_public_tx_hash": summary.get("latest_tx_hash"),
                "latest_public_timestamp": _normalize_timestamp(summary.get("latest_timestamp")),
                "latest_public_match_scope": summary.get("latest_match_scope"),
                "latest_public_match_scope_label": _match_scope_label(summary.get("latest_match_scope")),
                "latest_activity_timestamp": _normalize_timestamp(row.get("created_at")),
                "detail_href": f"detail/proof_job/{quote(str(proof_hash), safe='')}",
            }
        )
    for item in out:
        item["settlement_graph"] = _proof_settlement_graph(item)
    return out[:limit]


async def _find_receipt_record(obj_id: str) -> dict[str, Any] | None:
    receipt_svc = await _get_receipt_service()
    if not receipt_svc:
        return None
    try:
        raw = await receipt_svc.get_receipts()
    except Exception:
        return None
    for row in (raw or []):
        if not isinstance(row, dict):
            continue
        if row.get("tx_hash") == obj_id or row.get("receipt_id") == obj_id or row.get("id") == obj_id:
            return row
    return None


async def _find_proof_record_by_public_tx(tx_hash: str) -> dict[str, Any] | None:
    try:
        payload = await _get_indexed_proof_payload(limit=5000, public_only=True)
        proofs = payload.get("proofs") if isinstance(payload.get("proofs"), list) else []
    except Exception:
        return None
    target = str(tx_hash or "")
    for row in proofs:
        for receipt in (row.get("public_receipts") or []):
            if str(receipt.get("tx_hash") or "") == target:
                return row
    return None


def _append_unique_relationship(
    relationships: list[dict[str, Any]],
    *,
    rel_type: str,
    rel_id: str | None,
    label: str,
    verb: str,
    source: str,
) -> None:
    rel_key = (rel_type, str(rel_id or ""))
    if not rel_key[1]:
        return
    for row in relationships:
        if (str(row.get("type") or ""), str(row.get("id") or "")) == rel_key:
            return
    relationships.append(
        {
            "type": rel_type,
            "id": rel_key[1],
            "label": label,
            "verb": verb,
            "source": source,
        }
    )


def _proof_record_components(proof_rec: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    bridge_statement = proof_rec.get("bridge_statement") if isinstance(proof_rec.get("bridge_statement"), dict) else {}
    settlement = proof_rec.get("public_receipt_summary") if isinstance(proof_rec.get("public_receipt_summary"), dict) else {}
    proof_hash = proof_rec.get("proof_hash") or proof_rec.get("commitment_hash")
    fact_hash = bridge_statement.get("fact_hash") or bridge_statement.get("bridge_fact_hash")
    model_name = bridge_statement.get("model_name") or proof_rec.get("model_name")

    summary = {
        "status": "public_settled" if settlement.get("count") else "indexed",
        "source": proof_rec.get("source", "indexed"),
        "proof_hash": proof_hash,
        "fact_hash": fact_hash,
        "proof_type": bridge_statement.get("proof_type") or proof_rec.get("proof_type"),
        "lane": bridge_statement.get("lane"),
        "binding_profile": bridge_statement.get("binding_profile"),
        "binding_profile_label": _binding_profile_label(bridge_statement.get("binding_profile")),
        "model": model_name or "",
        "latest_public_tx_hash": settlement.get("latest_tx_hash"),
        "latest_public_match_scope": settlement.get("latest_match_scope"),
        "latest_public_match_scope_label": _match_scope_label(settlement.get("latest_match_scope")),
        "public_receipts": settlement.get("count", 0),
    }
    timeline = [
        {
            "stage": "proof_indexed",
            "status": "complete",
            "source": proof_rec.get("source", "indexed"),
            "detail": str(proof_hash or "")[:16] + "…" if proof_hash else "",
        },
        {
            "stage": "public_settlement",
            "status": "complete" if settlement.get("count") else "pending",
            "source": "public" if settlement.get("count") else "not_present",
            "detail": settlement.get("latest_tx_hash", ""),
        },
    ]
    if fact_hash:
        timeline.insert(
            1,
            {
                "stage": "bridge_fact",
                "status": "complete",
                "source": "indexed",
                "detail": str(fact_hash),
            },
        )

    relationships: list[dict[str, Any]] = []
    _append_unique_relationship(
        relationships,
        rel_type="fact",
        rel_id=str(fact_hash or ""),
        label="Fact",
        verb="commits",
        source="indexed",
    )
    _append_unique_relationship(
        relationships,
        rel_type="model",
        rel_id=str(model_name or ""),
        label="Model",
        verb="used_by",
        source="indexed",
    )
    for row in (proof_rec.get("public_receipts") or [])[:10]:
        tx_hash = row.get("tx_hash")
        _append_unique_relationship(
            relationships,
            rel_type="transaction",
            rel_id=str(tx_hash or ""),
            label=f"{row.get('public_chain') or 'public'} transaction",
            verb="settles",
            source="public",
        )

    return summary, timeline, relationships


def _list_models_for_search(limit: int = 50) -> list[dict[str, Any]]:
    """List model names from ezkl_models dir for search results."""
    try:
        from pathlib import Path
        base = Path(__file__).resolve().parents[2]
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
    """Fetch proof record by commitment/bridge/ezkl proof hash from proof API."""
    try:
        from fastapi import HTTPException
        from app.api.routes import proofs as proofs_routes

        return await proofs_routes.get_proof(proof_hash)
    except HTTPException:
        return None
    except Exception as e:
        logger.warning("forge proof lookup failed: %s", e)
        return None


async def _get_model_info(model_id: str) -> dict[str, Any] | None:
    """Resolve model by name from ezkl_models dir."""
    try:
        from pathlib import Path
        base = Path(__file__).resolve().parents[2]
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


def _find_pathc_route_by_tx(tx_hash: str) -> dict[str, Any] | None:
    target = str(tx_hash or "").strip().lower()
    if not target:
        return None
    for row in _get_pathc_route_rows():
        if str(row.get("tx_hash") or "").strip().lower() == target:
            return row
    return None


def _proof_feed_items_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    proof_rows = payload.get("proofs") if isinstance(payload.get("proofs"), list) else []
    items: list[dict[str, Any]] = []
    for row in proof_rows:
        bridge_statement = row.get("bridge_statement") if isinstance(row.get("bridge_statement"), dict) else {}
        summary = row.get("public_receipt_summary") if isinstance(row.get("public_receipt_summary"), dict) else {}
        proof_hash = row.get("proof_hash") or row.get("commitment_hash")
        if not proof_hash:
            continue
        items.append(
            {
                "type": "proof_job",
                "id": str(proof_hash),
                "proof_type": bridge_statement.get("proof_type") or row.get("proof_type", ""),
                "lane": bridge_statement.get("lane"),
                "binding_profile": bridge_statement.get("binding_profile"),
                "binding_profile_label": _binding_profile_label(bridge_statement.get("binding_profile")),
                "model_name": bridge_statement.get("model_name") or row.get("model_name", ""),
                "fact_hash": bridge_statement.get("fact_hash") or bridge_statement.get("bridge_fact_hash"),
                "latest_public_tx_hash": summary.get("latest_tx_hash"),
                "latest_public_timestamp": _normalize_timestamp(summary.get("latest_timestamp")),
                "latest_public_match_scope": summary.get("latest_match_scope"),
                "latest_public_match_scope_label": _match_scope_label(summary.get("latest_match_scope")),
                "latest_activity_timestamp": _normalize_timestamp(row.get("created_at")),
                "public_receipts": summary.get("count", 0),
                "source": "indexed_public" if summary.get("count") else "indexed",
                "detail_href": f"detail/proof_job/{quote(str(proof_hash), safe='')}",
            }
        )
    for item in items:
        item["settlement_graph"] = _proof_settlement_graph(item)
    return items


def _proof_matches_filters(item: dict[str, Any], *, lane: str | None = None, model_name: str | None = None) -> bool:
    lane_filter = str(lane or "").strip().lower()
    model_filter = str(model_name or "").strip().lower()
    item_lane = str(item.get("lane") or "").strip().lower()
    item_model = str(item.get("model_name") or "").strip().lower()
    if lane_filter and item_lane != lane_filter:
        return False
    if model_filter and item_model != model_filter:
        return False
    return True


def _proof_cursor_from_item(item: dict[str, Any]) -> dict[str, str] | None:
    timestamp = str(item.get("latest_public_timestamp") or "")
    proof_hash = str(item.get("id") or "")
    if not timestamp and not proof_hash:
        return None
    return {
        "timestamp": timestamp,
        "proof_hash": proof_hash,
    }


def _proof_settlement_graph(item: dict[str, Any]) -> dict[str, Any]:
    proof_id = str(item.get("id") or "")
    fact_hash = str(item.get("fact_hash") or "")
    model_name = str(item.get("model_name") or "")
    tx_hash = str(item.get("latest_public_tx_hash") or "")
    nodes = [
        {"type": "proof_job", "id": proof_id, "href": item.get("detail_href")},
    ]
    edges: list[dict[str, Any]] = []
    if fact_hash:
        nodes.append({"type": "fact", "id": fact_hash, "href": f"detail/fact/{quote(fact_hash, safe='')}"})
        edges.append({"from": proof_id, "to": fact_hash, "verb": "commits"})
    if model_name:
        nodes.append({"type": "model", "id": model_name, "href": f"detail/model/{quote(model_name, safe='')}"})
        edges.append({"from": proof_id, "to": model_name, "verb": "uses"})
    if tx_hash:
        nodes.append({"type": "transaction", "id": tx_hash, "href": f"detail/transaction/{quote(tx_hash, safe='')}"})
        edges.append({"from": proof_id, "to": tx_hash, "verb": "settles_with"})
    return {
        "nodes": nodes,
        "edges": edges,
    }


def _merge_settlement_graphs(
    graphs: list[dict[str, Any]],
    *,
    center_type: str | None = None,
    center_id: str | None = None,
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen_nodes: set[tuple[str, str]] = set()
    seen_edges: set[tuple[str, str, str]] = set()

    def add_node(node: dict[str, Any]) -> None:
        node_type = str(node.get("type") or "")
        node_id = str(node.get("id") or "")
        if not node_type or not node_id:
            return
        key = (node_type, node_id)
        if key in seen_nodes:
            return
        seen_nodes.add(key)
        nodes.append(node)

    def add_edge(edge: dict[str, Any]) -> None:
        src = str(edge.get("from") or "")
        dst = str(edge.get("to") or "")
        verb = str(edge.get("verb") or "")
        if not src or not dst or not verb:
            return
        key = (src, dst, verb)
        if key in seen_edges:
            return
        seen_edges.add(key)
        edges.append(edge)

    if center_type and center_id:
        add_node(
            {
                "type": center_type,
                "id": center_id,
                "href": f"detail/{quote(center_type, safe='')}/{quote(center_id, safe='')}",
            }
        )

    for graph in graphs:
        if not isinstance(graph, dict):
            continue
        for node in graph.get("nodes") or []:
            if isinstance(node, dict):
                add_node(node)
        for edge in graph.get("edges") or []:
            if isinstance(edge, dict):
                add_edge(edge)

    return {
        "center": {"type": center_type, "id": center_id} if center_type and center_id else None,
        "nodes": nodes,
        "edges": edges,
    }


def _settlement_graph_from_proof_record(proof_rec: dict[str, Any]) -> dict[str, Any] | None:
    items = _proof_feed_items_from_payload({"proofs": [proof_rec]})
    if not items:
        return None
    graph = items[0].get("settlement_graph")
    return graph if isinstance(graph, dict) else None


async def _graph_neighborhood_for_model(
    model_name: str,
    *,
    limit: int = 3,
    public_only: bool = False,
) -> dict[str, Any]:
    items = await _get_indexed_proof_items(limit=limit, model_name=model_name, public_only=public_only)
    graphs = [
        graph
        for graph in (item.get("settlement_graph") for item in items)
        if isinstance(graph, dict)
    ]
    model_key = str(model_name or "").strip().lower()
    for route in _get_pathc_route_inventory_rows():
        if str(route.get("model_name") or "").strip().lower() != model_key:
            continue
        if public_only and not route.get("l2_verified"):
            continue
        graphs.append(_pathc_settlement_graph(route))
    return _merge_settlement_graphs(graphs, center_type="model", center_id=model_name)


async def _graph_neighborhood_for_object(
    obj_type: str,
    obj_id: str,
    *,
    limit: int = 3,
    public_only: bool = False,
) -> dict[str, Any] | None:
    if obj_type == "model":
        return await _graph_neighborhood_for_model(obj_id, limit=limit, public_only=public_only)

    proof_rec: dict[str, Any] | None = None
    pathc_route: dict[str, Any] | None = None
    if obj_type == "proof_job":
        proof_rec = await _get_proof_record(obj_id)
    elif obj_type == "fact":
        proof_rec = await _get_proof_record(obj_id)
    elif obj_type in ("transaction", "tx"):
        proof_rec = await _find_proof_record_by_public_tx(obj_id)
        if proof_rec is None:
            pathc_route = _find_pathc_route_by_tx(obj_id)
    elif obj_type == "receipt":
        receipt_row = await _find_receipt_record(obj_id)
        if receipt_row:
            proof_lookup = receipt_row.get("proof_hash") or receipt_row.get("fact_hash")
            proof_rec = await _get_proof_record(str(proof_lookup)) if proof_lookup else None
        if proof_rec is None:
            proof_rec = await _find_proof_record_by_public_tx(obj_id)

    graph = _settlement_graph_from_proof_record(proof_rec) if proof_rec else None
    if not isinstance(graph, dict) and pathc_route:
        graph = _pathc_settlement_graph(pathc_route)
    if not isinstance(graph, dict):
        return None
    return _merge_settlement_graphs([graph], center_type=obj_type, center_id=obj_id)


async def _get_model_rows(
    *,
    limit: int,
    offset: int = 0,
    q: str = "",
    public_only: bool = False,
    lane: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    model_proofs = await _list_proofs_for_search(5000)
    pathc_routes = _get_pathc_route_inventory_rows()
    proofs_by_model: dict[str, list[dict[str, Any]]] = {}
    pathc_by_model: dict[str, list[dict[str, Any]]] = {}
    for proof in model_proofs:
        model_key = str(proof.get("model_name") or "").strip().lower()
        if not model_key:
            continue
        if lane and str(proof.get("lane") or "").strip().lower() != str(lane).strip().lower():
            continue
        proofs_by_model.setdefault(model_key, []).append(proof)
    for route in pathc_routes:
        model_key = str(route.get("model_name") or "").strip().lower()
        if not model_key:
            continue
        if lane and str(lane).strip().lower() != "path_c_bridge":
            continue
        pathc_by_model.setdefault(model_key, []).append(route)

    rows: list[dict[str, Any]] = []
    query = q.lower().strip()
    for m in _list_models_for_search(50):
        name = str(m.get("name", m.get("id", "")))
        if query and query not in name.lower():
            continue
        model_key = str(m.get("id") or name).strip().lower()
        proofs = proofs_by_model.get(model_key) or []
        model_pathc_routes = pathc_by_model.get(model_key) or []
        public_proofs = [proof for proof in proofs if proof.get("latest_public_tx_hash")]
        confirmed_pathc_routes = [route for route in model_pathc_routes if route.get("l2_verified")]
        if public_only and not public_proofs and not confirmed_pathc_routes:
            continue

        latest_proof = max(
            proofs,
            key=lambda proof: (
                str(proof.get("latest_activity_timestamp") or ""),
                str(proof.get("id") or ""),
            ),
            default={},
        )
        latest_public_proof = max(
            public_proofs,
            key=lambda proof: (
                str(proof.get("latest_public_timestamp") or ""),
                str(proof.get("id") or ""),
            ),
            default={},
        )
        latest_pathc_route = max(
            model_pathc_routes,
            key=lambda route: (
                str(route.get("latest_attempt_timestamp") or route.get("latest_public_timestamp") or ""),
                str(route.get("latest_tx_hash") or route.get("latest_public_tx_hash") or ""),
            ),
            default={},
        )
        latest_public_pathc_route = max(
            confirmed_pathc_routes,
            key=lambda route: (
                str(route.get("latest_public_timestamp") or ""),
                str(route.get("tx_hash") or ""),
            ),
            default={},
        )
        lane_counts: dict[str, int] = {}
        binding_profiles: set[str] = set()
        for proof in proofs:
            lane_name = str(proof.get("lane") or "").strip()
            if lane_name:
                lane_counts[lane_name] = lane_counts.get(lane_name, 0) + 1
            binding_profile = str(proof.get("binding_profile") or "").strip()
            if binding_profile:
                binding_profiles.add(binding_profile)
        if model_pathc_routes:
            lane_counts["path_c_bridge"] = len(model_pathc_routes)

        latest_public_proof_timestamp = str(latest_public_proof.get("latest_public_timestamp") or "")
        latest_public_pathc_timestamp = str(latest_public_pathc_route.get("latest_public_timestamp") or "")
        latest_public_tx_hash = latest_public_proof.get("latest_public_tx_hash")
        latest_public_timestamp = latest_public_proof.get("latest_public_timestamp")
        latest_public_lane = latest_public_proof.get("lane")
        latest_public_binding_profile = latest_public_proof.get("binding_profile")
        latest_public_match_scope = latest_public_proof.get("latest_public_match_scope")
        latest_public_match_scope_label = latest_public_proof.get("latest_public_match_scope_label")
        latest_public_source_kind = "proof" if latest_public_proof else None
        if latest_public_pathc_timestamp and latest_public_pathc_timestamp >= latest_public_proof_timestamp:
            latest_public_tx_hash = latest_public_pathc_route.get("latest_public_tx_hash")
            latest_public_timestamp = latest_public_pathc_route.get("latest_public_timestamp")
            latest_public_lane = "path_c_bridge"
            latest_public_binding_profile = None
            latest_public_match_scope = "exact_hash"
            latest_public_match_scope_label = _match_scope_label("exact_hash")
            latest_public_source_kind = "path_c"

        graphs: list[dict[str, Any]] = []
        graph_source = latest_public_proof or latest_proof
        if isinstance(graph_source.get("settlement_graph"), dict):
            graphs.append(graph_source.get("settlement_graph"))
        if latest_public_pathc_route:
            graphs.append(_pathc_settlement_graph(latest_public_pathc_route))
        elif latest_pathc_route:
            graphs.append(_pathc_settlement_graph(latest_pathc_route))
        settlement_graph = _merge_settlement_graphs(graphs, center_type="model", center_id=str(m["id"])) if graphs else None
        rows.append(
            {
                "id": m["id"],
                "name": name,
                "ready": m.get("ready", False),
                "proof_count": len(proofs),
                "public_proof_count": len(public_proofs),
                "lane_counts": lane_counts,
                "binding_profiles": sorted(binding_profiles),
                "latest_proof_hash": latest_proof.get("id"),
                "latest_lane": latest_proof.get("lane"),
                "latest_binding_profile": latest_proof.get("binding_profile"),
                "latest_activity_timestamp": latest_proof.get("latest_activity_timestamp"),
                "latest_public_proof_hash": latest_public_proof.get("id"),
                "latest_public_lane": latest_public_lane,
                "latest_public_binding_profile": latest_public_binding_profile,
                "latest_public_tx_hash": latest_public_tx_hash,
                "latest_public_timestamp": latest_public_timestamp,
                "latest_public_match_scope": latest_public_match_scope,
                "latest_public_match_scope_label": latest_public_match_scope_label,
                "latest_public_source_kind": latest_public_source_kind,
                "pathc_route_count": len(model_pathc_routes),
                "pathc_confirmed_count": len(confirmed_pathc_routes),
                "latest_pathc_tx_hash": latest_pathc_route.get("latest_tx_hash") or latest_pathc_route.get("latest_public_tx_hash"),
                "latest_pathc_timestamp": latest_pathc_route.get("latest_attempt_timestamp") or latest_pathc_route.get("latest_public_timestamp"),
                "latest_pathc_route_key": latest_pathc_route.get("route_key"),
                "latest_pathc_route_source": latest_pathc_route.get("route_source"),
                "latest_confirmed_pathc_tx_hash": latest_public_pathc_route.get("latest_public_tx_hash"),
                "latest_confirmed_pathc_timestamp": latest_public_pathc_route.get("latest_public_timestamp"),
                "settlement_graph": settlement_graph,
                "detail_href": f"detail/model/{quote(str(m['id']), safe='')}",
                "graph_href": f"graph/model/{quote(str(m['id']), safe='')}",
            }
        )
    rows.sort(key=lambda row: str(row.get("name") or row.get("id") or ""))
    rows.sort(key=lambda row: str(row.get("latest_activity_timestamp") or ""), reverse=True)
    rows.sort(key=lambda row: str(row.get("latest_public_timestamp") or ""), reverse=True)
    rows.sort(key=lambda row: 0 if row.get("latest_proof_hash") else 1)
    rows.sort(key=lambda row: 0 if row.get("latest_public_proof_hash") else 1)
    total = len(rows)
    return rows[offset: offset + limit], total


async def _get_model_row(model_id: str, *, public_only: bool = False, lane: str | None = None) -> dict[str, Any] | None:
    rows, _ = await _get_model_rows(limit=5000, offset=0, q="", public_only=public_only, lane=lane)
    target = str(model_id or "").strip().lower()
    for row in rows:
        if str(row.get("id") or row.get("name") or "").strip().lower() == target:
            return row
    return None


async def _get_lane_summary_rows(limit: int = 5000) -> list[dict[str, Any]]:
    proof_rows = await _list_proofs_for_search(limit=limit)
    by_lane: dict[str, dict[str, Any]] = {}

    for proof in proof_rows:
        lane_name = str(proof.get("lane") or "").strip() or "unknown"
        row = by_lane.setdefault(
            lane_name,
            {
                "lane": lane_name,
                "proof_count": 0,
                "public_proof_count": 0,
                "models": set(),
                "proof_types": set(),
                "binding_profiles": set(),
                "latest_activity_timestamp": None,
                "latest_activity_proof_hash": None,
                "latest_public_timestamp": None,
                "latest_public_proof_hash": None,
                "latest_public_tx_hash": None,
            },
        )
        row["proof_count"] += 1

        model_name = str(proof.get("model_name") or "").strip()
        if model_name:
            row["models"].add(model_name)

        proof_type = str(proof.get("proof_type") or "").strip()
        if proof_type:
            row["proof_types"].add(proof_type)

        binding_label = str(proof.get("binding_profile_label") or "").strip()
        if binding_label:
            row["binding_profiles"].add(binding_label)

        latest_activity_timestamp = str(proof.get("latest_activity_timestamp") or "")
        if latest_activity_timestamp and latest_activity_timestamp >= str(row.get("latest_activity_timestamp") or ""):
            row["latest_activity_timestamp"] = latest_activity_timestamp
            row["latest_activity_proof_hash"] = proof.get("id")

        latest_public_timestamp = str(proof.get("latest_public_timestamp") or "")
        if latest_public_timestamp:
            row["public_proof_count"] += 1
            if latest_public_timestamp >= str(row.get("latest_public_timestamp") or ""):
                row["latest_public_timestamp"] = latest_public_timestamp
                row["latest_public_proof_hash"] = proof.get("id")
                row["latest_public_tx_hash"] = proof.get("latest_public_tx_hash")

    rows: list[dict[str, Any]] = []
    for row in by_lane.values():
        rows.append(
            {
                "lane": row["lane"],
                "proof_count": row["proof_count"],
                "public_proof_count": row["public_proof_count"],
                "model_count": len(row["models"]),
                "proof_types": sorted(row["proof_types"]),
                "binding_profiles": sorted(row["binding_profiles"]),
                "latest_activity_timestamp": row["latest_activity_timestamp"],
                "latest_activity_proof_hash": row["latest_activity_proof_hash"],
                "latest_public_timestamp": row["latest_public_timestamp"],
                "latest_public_proof_hash": row["latest_public_proof_hash"],
                "latest_public_tx_hash": row["latest_public_tx_hash"],
            }
        )

    rows.sort(key=lambda item: str(item.get("lane") or ""))
    rows.sort(key=lambda item: str(item.get("latest_activity_timestamp") or ""), reverse=True)
    rows.sort(key=lambda item: str(item.get("latest_public_timestamp") or ""), reverse=True)
    rows.sort(key=lambda item: int(item.get("model_count") or 0), reverse=True)
    rows.sort(key=lambda item: int(item.get("proof_count") or 0), reverse=True)
    rows.sort(key=lambda item: int(item.get("public_proof_count") or 0), reverse=True)
    return rows


async def _get_fact_rows(
    *,
    limit: int,
    offset: int = 0,
    q: str = "",
    public_only: bool = False,
    lane: str | None = None,
    model_name: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    proof_items = await _get_indexed_proof_items(limit=200, public_only=public_only)
    seen_facts: set[str] = set()
    rows: list[dict[str, Any]] = []
    query = q.lower().strip()
    lane_filter = str(lane or "").strip().lower()
    model_filter = str(model_name or "").strip().lower()
    for item in proof_items:
        fact_hash = str(item.get("fact_hash") or "").strip()
        if not fact_hash or fact_hash in seen_facts:
            continue
        if query and query not in fact_hash.lower():
            continue
        if lane_filter and str(item.get("lane") or "").strip().lower() != lane_filter:
            continue
        if model_filter and str(item.get("model_name") or "").strip().lower() != model_filter:
            continue
        seen_facts.add(fact_hash)
        rows.append(
            {
                "id": fact_hash,
                "fact_hash": fact_hash,
                "lane": item.get("lane"),
                "model_name": item.get("model_name"),
                "latest_public_tx_hash": item.get("latest_public_tx_hash"),
                "latest_public_timestamp": item.get("latest_public_timestamp"),
                "settlement_graph": item.get("settlement_graph"),
                "detail_href": f"detail/fact/{quote(fact_hash, safe='')}",
                "graph_href": f"graph/fact/{quote(fact_hash, safe='')}",
            }
        )
    total = len(rows)
    return rows[offset: offset + limit], total


async def _get_filtered_proof_feed_payload(
    *,
    limit: int,
    model_name: str | None,
    lane: str | None,
    user_address: str | None,
    public_only: bool,
    cursor_timestamp: str | None,
    cursor_proof_hash: str | None,
) -> dict[str, Any]:
    if not lane and not model_name:
        payload = await _get_indexed_proof_payload(
            limit=limit,
            model_name=model_name,
            user_address=user_address,
            public_only=public_only,
            cursor_timestamp=cursor_timestamp,
            cursor_proof_hash=cursor_proof_hash,
        )
        return {
            "items": _proof_feed_items_from_payload(payload),
            "total_results": int(payload.get("total") or 0),
            "next_cursor": payload.get("next_cursor"),
        }

    collected: list[dict[str, Any]] = []
    matched_total = 0
    next_ts = cursor_timestamp
    next_hash = cursor_proof_hash
    batch_limit = max(limit * 4, 100)

    while True:
        payload = await _get_indexed_proof_payload(
            limit=batch_limit,
            model_name=model_name,
            user_address=user_address,
            public_only=public_only,
            cursor_timestamp=next_ts,
            cursor_proof_hash=next_hash,
        )
        items = _proof_feed_items_from_payload(payload)
        matching = [item for item in items if _proof_matches_filters(item, lane=lane, model_name=model_name)]
        matched_total += len(matching)
        if len(collected) < limit + 1:
            collected.extend(matching[: max(0, (limit + 1) - len(collected))])
        next_cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), dict) else None
        if not next_cursor:
            break
        next_ts = str(next_cursor.get("timestamp") or "")
        next_hash = str(next_cursor.get("proof_hash") or "")
        if len(collected) > limit and not next_cursor:
            break
        if not next_ts and not next_hash:
            break

    has_more = len(collected) > limit
    page_items = collected[:limit]
    return {
        "items": page_items,
        "total_results": matched_total,
        "next_cursor": _proof_cursor_from_item(page_items[-1]) if has_more and page_items else None,
    }


# ── Endpoints ───────────────────────────────────────────────────────────


@router.get("/status", summary="Compact system status for explorer strip")
async def forge_status() -> dict[str, Any]:
    """Returns a compact status snapshot for the explorer status bar."""
    health = await _get_system_health()
    proof_stats = await _get_proof_stats()
    lane_summary = await _get_lane_summary_rows()
    pathc_routes = _get_pathc_route_inventory_rows()
    derived_total = sum(int(row.get("proof_count") or 0) for row in lane_summary)
    derived_public = sum(int(row.get("public_proof_count") or 0) for row in lane_summary)
    confirmed_pathc = [row for row in pathc_routes if row.get("l2_verified")]
    latest_confirmed_pathc = max(
        confirmed_pathc,
        key=lambda row: (
            str(row.get("latest_public_timestamp") or ""),
            str(row.get("tx_hash") or ""),
        ),
        default={},
    )

    receipt_svc = await _get_receipt_service()
    receipt_count = 0
    if receipt_svc:
        try:
            receipts = await receipt_svc.get_receipts()
            receipt_count = len(receipts) if receipts else 0
        except Exception:
            pass

    lanes = {str(row.get("lane") or ""): bool(row.get("proof_count")) for row in lane_summary if row.get("lane")}
    if not lanes:
        lanes = {
            "groth16_modelbridge": True,
            "noir_honk": True,
            "native_kzg": True,
            "stark_integrity": True,
        }

    return {
        "generated_at": _ts(),
        "service": "starkforge-zksyslog",
        "health": health.get("status", "unknown") if isinstance(health, dict) else "unknown",
        "receipt_count": receipt_count,
        "proof_stats": {
            "total": int((proof_stats or {}).get("total_proofs") or derived_total),
            "verified": int((proof_stats or {}).get("verified_proofs") or derived_public),
            "pending": int((proof_stats or {}).get("pending_proofs") or max(derived_total - derived_public, 0)),
            "public_settled": derived_public,
        },
        "path_c_summary": {
            "route_count": len(pathc_routes),
            "confirmed_count": len(confirmed_pathc),
            "model_count": len({str(row.get("model_name") or "") for row in pathc_routes if row.get("model_name")}),
            "latest_confirmed_model": latest_confirmed_pathc.get("model_name"),
            "latest_confirmed_tx_hash": latest_confirmed_pathc.get("latest_public_tx_hash"),
            "latest_confirmed_timestamp": latest_confirmed_pathc.get("latest_public_timestamp"),
        },
        "lanes": lanes,
        "lane_summary": lane_summary,
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
            raw = await receipt_svc.get_receipts(limit=limit * 4)
            if raw:
                for r in raw[: limit * 2]:
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

    if scope in (None, "all", "proofs"):
        try:
            indexed_proofs = await _get_indexed_proofs(limit=limit * 2, public_only=False)
            for proof in indexed_proofs:
                bridge_statement = proof.get("bridge_statement") if isinstance(proof.get("bridge_statement"), dict) else {}
                summary = proof.get("public_receipt_summary") if isinstance(proof.get("public_receipt_summary"), dict) else {}
                lane_name = str(bridge_statement.get("lane") or "")
                proof_type = str(bridge_statement.get("proof_type") or proof.get("proof_type") or "")
                lane_filter = (lane or "").lower()
                if lane_filter and lane_filter not in proof_type.lower() and lane_filter not in lane_name.lower():
                    continue
                proof_hash = proof.get("proof_hash") or proof.get("commitment_hash")
                if not proof_hash:
                    continue
                items.append(
                    {
                        "type": "proof_job",
                        "id": str(proof_hash),
                        "action": proof.get("action_type", "proof_job"),
                        "proof_type": proof_type,
                        "result": "public_settled" if summary.get("count") else "indexed",
                        "timestamp": str(summary.get("latest_timestamp") or proof.get("created_at", "")),
                        "fact_hash": bridge_statement.get("fact_hash") or bridge_statement.get("bridge_fact_hash") or "",
                        "source": "indexed_public" if summary.get("count") else "indexed",
                        "detail_href": f"detail/proof_job/{quote(str(proof_hash), safe='')}",
                    }
                )
        except Exception as e:
            logger.warning("forge feed proof fetch: %s", e)

    # Sort by timestamp desc, take limit
    items.sort(key=lambda x: str(x.get("timestamp", "") or ""), reverse=True)
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
    public_only: bool = Query(False, description="For proof-scope search, keep only publicly settled rows"),
    model_name: Optional[str] = Query(default=None, description="For proof-scope search, filter by canonical model name"),
    lane: Optional[str] = Query(default=None, description="For proof-scope search, filter by proving lane"),
    cursor_timestamp: Optional[str] = Query(default=None, description="Proof-scope cursor settlement timestamp"),
    cursor_proof_hash: Optional[str] = Query(default=None, description="Proof-scope cursor proof hash tie-breaker"),
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

    proof_next_cursor: dict[str, str] | None = None
    proof_total: int | None = None
    if scope in (None, "all", "proofs"):
        if scope == "proofs" and not q:
            payload = await _get_filtered_proof_feed_payload(
                limit=limit,
                model_name=model_name,
                lane=lane,
                user_address=None,
                public_only=public_only,
                cursor_timestamp=cursor_timestamp,
                cursor_proof_hash=cursor_proof_hash,
            )
            proof_next_cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), dict) else None
            proof_total = int(payload.get("total_results") or 0)
            results["proofs"] = payload.get("items") if isinstance(payload.get("items"), list) else []
        else:
            for p in await _list_proofs_for_search(200):
                s = " ".join(str(v) for v in p.values()).lower()
                if q and q.lower() not in s:
                    continue
                if public_only and not p.get("verified"):
                    continue
                if not _proof_matches_filters(p, lane=lane, model_name=model_name):
                    continue
                results["proofs"].append({
                    "id": p["id"],
                    "proof_type": p.get("proof_type", ""),
                    "model_name": p.get("model_name", ""),
                    "verified": p.get("verified", False),
                    "lane": p.get("lane"),
                    "latest_public_tx_hash": p.get("latest_public_tx_hash"),
                    "latest_public_timestamp": p.get("latest_public_timestamp"),
                    "latest_public_match_scope": p.get("latest_public_match_scope"),
                    "latest_public_match_scope_label": p.get("latest_public_match_scope_label"),
                    "settlement_graph": p.get("settlement_graph"),
                    "detail_href": f"detail/proof_job/{quote(str(p['id']), safe='')}",
                })
            results["proofs"] = results["proofs"][offset: offset + limit]

    if scope in (None, "all", "models"):
        rows, _ = await _get_model_rows(limit=limit, offset=offset, q=q, public_only=public_only, lane=lane)
        results["models"] = rows

    if scope in (None, "all", "contracts") and q and re.fullmatch(r"0x[0-9a-fA-F]{40,}", q.strip()):
        addr = q.strip()
        results["contracts"].append({"id": addr, "address": addr, "detail_href": f"detail/contract/{quote(addr, safe='')}"})
        results["contracts"] = results["contracts"][offset: offset + limit]

    if scope in (None, "all", "facts"):
        try:
            rows, _ = await _get_fact_rows(
                limit=limit,
                offset=offset,
                q=q,
                public_only=public_only,
                lane=lane,
                model_name=model_name,
            )
            results["facts"] = rows
        except Exception:
            pass

    if scope and scope != "all":
        if scope == "txs":
            allowed = {"receipts"}
        else:
            allowed = {scope}
        results = {k: (v if k in allowed else []) for k, v in results.items()}

    total = proof_total if scope == "proofs" and not q and proof_total is not None else sum(len(v) for v in results.values())
    has_more = full_count > offset + limit if search_receipts and scope in (None, "all", "receipts", "txs") else False
    if scope == "proofs" and not q and proof_next_cursor:
        has_more = True
    return {
        "generated_at": _ts(),
        "query": q,
        "query_type": qtype,
        "scope": scope or "all",
        "total_results": total,
        "offset": offset,
        "limit": limit,
        "public_only": public_only,
        "model_name": model_name,
        "lane": lane,
        "has_more": has_more,
        "next_cursor": proof_next_cursor,
        "results": results,
        "paths": {
            "self": "search",
            "feed": "feed",
            "detail": "detail/{type}/{id}",
            "status": "status",
        },
    }


@router.get("/proofs", summary="Dedicated indexed proof feed with settlement cursors")
async def forge_proofs_feed(
    limit: int = Query(25, ge=1, le=100, description="Page size for proof rows"),
    public_only: bool = Query(False, description="Keep only publicly settled proof rows"),
    user_address: Optional[str] = Query(default=None, description="Optional user filter"),
    model_name: Optional[str] = Query(default=None, description="Optional canonical model-name filter"),
    lane: Optional[str] = Query(default=None, description="Optional proving-lane filter"),
    cursor_timestamp: Optional[str] = Query(default=None, description="Settlement cursor timestamp"),
    cursor_proof_hash: Optional[str] = Query(default=None, description="Settlement cursor proof hash tie-breaker"),
) -> dict[str, Any]:
    payload = await _get_filtered_proof_feed_payload(
        limit=limit,
        model_name=model_name,
        lane=lane,
        user_address=user_address,
        public_only=public_only,
        cursor_timestamp=cursor_timestamp,
        cursor_proof_hash=cursor_proof_hash,
    )
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    next_cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), dict) else None
    return {
        "generated_at": _ts(),
        "count": len(items),
        "total_results": int(payload.get("total_results") or 0),
        "limit": limit,
        "public_only": public_only,
        "user_address": user_address,
        "model_name": model_name,
        "lane": lane,
        "cursor_timestamp": cursor_timestamp,
        "cursor_proof_hash": cursor_proof_hash,
        "has_more": bool(next_cursor),
        "next_cursor": next_cursor,
        "items": items,
        "paths": {
            "self": "proofs",
            "page": "proofs/page",
            "detail": "detail/proof_job/{id}",
            "search": "search?scope=proofs",
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
    settlement_graph = payload.get("settlement_graph") if isinstance(payload.get("settlement_graph"), dict) else None

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
            href = f"../{quote(rel_type, safe='')}/{quote(rel_id, safe='')}"
            return f'<div class="result-item"><a href="{href}"><code>{escape(rel_id[:20])}{"…" if len(rel_id) > 20 else ""}</code></a> — {label}</div>'
        return f'<div class="result-item"><code>{escape(rel_id)}</code> — {label}</div>'

    rel_rows = "".join(_rel_row(r) for r in relationships) if relationships else '<p class="muted">No linked items.</p>'
    graph_nodes = settlement_graph.get("nodes") if settlement_graph else []
    graph_edges = settlement_graph.get("edges") if settlement_graph else []
    graph_rows = ""
    if settlement_graph:
        graph_rows += f'<div class="graph-meta muted">{len(graph_nodes)} node(s) · {len(graph_edges)} edge(s)</div>'
        parts: list[str] = []
        for node in graph_nodes[:10]:
            node_type = escape(str(node.get("type", "")))
            node_id = str(node.get("id", ""))
            node_href = str(node.get("href", ""))
            if node_href.startswith("detail/"):
                node_href = "../" + node_href[len("detail/"):]
            if node_href:
                parts.append(
                    f'<div class="result-item"><strong>{node_type}</strong> '
                    f'<a href="{escape(node_href)}"><code>{escape(node_id[:24])}{"…" if len(node_id) > 24 else ""}</code></a></div>'
                )
            else:
                parts.append(
                    f'<div class="result-item"><strong>{node_type}</strong> <code>{escape(node_id)}</code></div>'
                )
        graph_rows += "".join(parts)
    else:
        graph_rows = '<p class="muted">No typed graph neighborhood.</p>'

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
.graph-meta {{ font-size: 12px; margin-bottom: 10px; }}
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
  <div class="pane">
    <h3>Settlement Graph</h3>
    <div>{graph_rows}</div>
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
    settlement_graph: dict[str, Any] | None = None

    if obj_type == "receipt":
        receipt_row = await _find_receipt_record(obj_id)
        proof_rec = None
        if receipt_row:
            proof_lookup = receipt_row.get("proof_hash") or receipt_row.get("fact_hash")
            proof_rec = await _get_proof_record(str(proof_lookup)) if proof_lookup else None
        else:
            proof_rec = await _find_proof_record_by_public_tx(obj_id)
        if receipt_row or proof_rec:
            summary.update({
                "action": receipt_row.get("action", "") if receipt_row else "",
                "proof_type": receipt_row.get("proof_type", "") if receipt_row else "",
                "result": receipt_row.get("result", "") if receipt_row else "",
                "timestamp": receipt_row.get("timestamp", "") if receipt_row else "",
                "fact_hash": receipt_row.get("fact_hash", "") if receipt_row else "",
                "tx_hash": receipt_row.get("tx_hash") if receipt_row else obj_id,
                "status": "verified" if receipt_row and receipt_row.get("tx_hash") else "runtime",
                "source": "on-chain" if receipt_row and receipt_row.get("tx_hash") else "runtime",
            })
            timeline = [
                {
                    "stage": "receipt_observed",
                    "status": "complete",
                    "source": "public" if not receipt_row else "runtime",
                    "detail": (
                        (receipt_row.get("action", "") or receipt_row.get("proof_type", ""))
                        if receipt_row
                        else obj_id
                    ),
                }
            ]
            if proof_rec:
                proof_summary, proof_timeline, proof_relationships = _proof_record_components(proof_rec)
                settlement_graph = _settlement_graph_from_proof_record(proof_rec)
                summary.update(proof_summary)
                if not summary.get("action"):
                    summary["action"] = str(proof_rec.get("action_type") or "proof_job")
                if not summary.get("proof_type"):
                    summary["proof_type"] = str(proof_summary.get("proof_type") or "")
                if not summary.get("timestamp"):
                    settlement = proof_rec.get("public_receipt_summary") if isinstance(proof_rec.get("public_receipt_summary"), dict) else {}
                    summary["timestamp"] = settlement.get("latest_timestamp") or str(proof_rec.get("created_at") or "")
                if receipt_row and receipt_row.get("tx_hash"):
                    summary.setdefault("tx_hash", receipt_row.get("tx_hash"))
                else:
                    summary["tx_hash"] = obj_id
                timeline.extend(proof_timeline)
                _append_unique_relationship(
                    relationships,
                    rel_type="proof_job",
                    rel_id=str(proof_summary.get("proof_hash") or ""),
                    label="Proof Job",
                    verb="backs",
                    source="indexed",
                )
                for rel in proof_relationships:
                    _append_unique_relationship(
                        relationships,
                        rel_type=str(rel.get("type") or ""),
                        rel_id=str(rel.get("id") or ""),
                        label=str(rel.get("label") or ""),
                        verb=str(rel.get("verb") or ""),
                        source=str(rel.get("source") or ""),
                    )
            else:
                timeline.extend(
                    [
                        {
                            "stage": "proof_generation",
                            "status": "complete" if receipt_row.get("proof_type") else "not_present",
                            "source": "runtime",
                            "detail": receipt_row.get("proof_type", ""),
                        },
                        {
                            "stage": "fact_registration",
                            "status": "complete" if receipt_row.get("fact_hash") else "not_present",
                            "source": "on-chain" if receipt_row.get("fact_hash") else "not_configured",
                            "detail": receipt_row.get("fact_hash", ""),
                        },
                    ]
                )
            _append_unique_relationship(
                relationships,
                rel_type="fact",
                rel_id=str((receipt_row.get("fact_hash") if receipt_row else None) or summary.get("fact_hash") or ""),
                label="Fact",
                verb="registered",
                source="on-chain",
            )
            _append_unique_relationship(
                relationships,
                rel_type="transaction",
                rel_id=str((receipt_row.get("tx_hash") if receipt_row else None) or obj_id),
                label="Receipt transaction",
                verb="included",
                source="rpc",
            )
    elif obj_type == "entity":
        summary["status"] = "indexed"
        summary["source"] = "index"
        summary["label"] = obj_id
        timeline = [{"stage": "indexed", "status": "complete", "source": "index", "detail": obj_id}]
    elif obj_type in ("transaction", "tx"):
        tx_rec = await _get_tx_receipt(obj_id)
        proof_rec = await _find_proof_record_by_public_tx(obj_id)
        pathc_route = _find_pathc_route_by_tx(obj_id)
        if tx_rec:
            status = (tx_rec.get("finality_status") or tx_rec.get("status") or "UNKNOWN")
            block_num = tx_rec.get("block_number")
            summary.update({
                "status": status,
                "source": "rpc",
                "block_number": block_num,
                "execution_status": tx_rec.get("execution_status", ""),
            })
            timeline = []
            if proof_rec:
                proof_summary, proof_timeline, proof_relationships = _proof_record_components(proof_rec)
                settlement_graph = _settlement_graph_from_proof_record(proof_rec)
                summary.update(proof_summary)
                summary["tx_status"] = status
                summary["execution_status"] = tx_rec.get("execution_status", "")
                summary["block_number"] = block_num
                summary["source"] = "public"
                timeline.extend([row for row in proof_timeline if row.get("stage") != "public_settlement"])
                _append_unique_relationship(
                    relationships,
                    rel_type="proof_job",
                    rel_id=str(proof_summary.get("proof_hash") or ""),
                    label="Proof Job",
                    verb="settles_with",
                    source="indexed",
                )
                for rel in proof_relationships:
                    _append_unique_relationship(
                        relationships,
                        rel_type=str(rel.get("type") or ""),
                        rel_id=str(rel.get("id") or ""),
                        label=str(rel.get("label") or ""),
                        verb=str(rel.get("verb") or ""),
                        source=str(rel.get("source") or ""),
                    )
            elif pathc_route:
                graph = _pathc_settlement_graph(pathc_route)
                settlement_graph = _merge_settlement_graphs(
                    [graph] if isinstance(graph, dict) else [],
                    center_type="transaction",
                    center_id=obj_id,
                )
                summary.update(
                    {
                        "status": "public_settled" if pathc_route.get("l2_verified") else "pending",
                        "source": "public",
                        "model": pathc_route.get("model_name"),
                        "latest_public_tx_hash": pathc_route.get("tx_hash"),
                        "latest_public_match_scope": "exact_hash",
                        "latest_public_match_scope_label": _match_scope_label("exact_hash"),
                        "bridge_mode": pathc_route.get("mode"),
                        "route_key": pathc_route.get("route_key"),
                        "route_source": pathc_route.get("route_source"),
                        "tx_status": status,
                        "execution_status": tx_rec.get("execution_status", ""),
                        "block_number": block_num,
                    }
                )
                timeline.append(
                    {
                        "stage": "path_c_bridge",
                        "status": "complete" if pathc_route.get("l2_verified") else "pending",
                        "source": "public",
                        "detail": str(pathc_route.get("tx_hash") or ""),
                    }
                )
                _append_unique_relationship(
                    relationships,
                    rel_type="model",
                    rel_id=str(pathc_route.get("model_name") or ""),
                    label="Model",
                    verb="bridges_for",
                    source="indexed",
                )
            timeline.extend(
                [
                    {"stage": "submitted", "status": "complete", "source": "rpc", "detail": "transaction"},
                    {"stage": "accepted_l2", "status": "complete" if status in ("ACCEPTED_ON_L2", "ACCEPTED_ON_L1") else "pending", "source": "rpc", "detail": status},
                    {"stage": "accepted_l1", "status": "complete" if status == "ACCEPTED_ON_L1" else "pending", "source": "rpc", "detail": status},
                ]
            )
            if block_num is not None:
                relationships.append({"type": "block", "id": str(block_num), "label": "Block", "verb": "included_in", "source": "rpc"})
        elif proof_rec:
            proof_summary, proof_timeline, proof_relationships = _proof_record_components(proof_rec)
            settlement_graph = _settlement_graph_from_proof_record(proof_rec)
            summary.update(proof_summary)
            summary["source"] = "public"
            summary["tx_hash"] = obj_id
            timeline = proof_timeline
            _append_unique_relationship(
                relationships,
                rel_type="proof_job",
                rel_id=str(proof_summary.get("proof_hash") or ""),
                label="Proof Job",
                verb="settles_with",
                source="indexed",
            )
            for rel in proof_relationships:
                _append_unique_relationship(
                    relationships,
                    rel_type=str(rel.get("type") or ""),
                    rel_id=str(rel.get("id") or ""),
                    label=str(rel.get("label") or ""),
                    verb=str(rel.get("verb") or ""),
                    source=str(rel.get("source") or ""),
                )
        elif pathc_route:
            graph = _pathc_settlement_graph(pathc_route)
            settlement_graph = _merge_settlement_graphs(
                [graph] if isinstance(graph, dict) else [],
                center_type="transaction",
                center_id=obj_id,
            )
            summary.update(
                {
                    "status": "public_settled" if pathc_route.get("l2_verified") else "pending",
                    "source": "public",
                    "model": pathc_route.get("model_name"),
                    "latest_public_tx_hash": pathc_route.get("tx_hash"),
                    "latest_public_match_scope": "exact_hash",
                    "latest_public_match_scope_label": _match_scope_label("exact_hash"),
                    "bridge_mode": pathc_route.get("mode"),
                    "route_key": pathc_route.get("route_key"),
                    "route_source": pathc_route.get("route_source"),
                    "tx_hash": obj_id,
                }
            )
            timeline = [
                {
                    "stage": "path_c_bridge",
                    "status": "complete" if pathc_route.get("l2_verified") else "pending",
                    "source": "public",
                    "detail": str(pathc_route.get("tx_hash") or ""),
                }
            ]
            _append_unique_relationship(
                relationships,
                rel_type="model",
                rel_id=str(pathc_route.get("model_name") or ""),
                label="Model",
                verb="bridges_for",
                source="indexed",
            )
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
            proof_summary, proof_timeline, proof_relationships = _proof_record_components(proof_rec)
            settlement_graph = _settlement_graph_from_proof_record(proof_rec)
            summary.update(proof_summary)
            timeline = proof_timeline
            relationships = proof_relationships
    elif obj_type == "model":
        model_info = await _get_model_info(obj_id)
        model_row = await _get_model_row(obj_id)
        settlement_graph = await _graph_neighborhood_for_model(obj_id, limit=5, public_only=False)
        if model_info or model_row:
            summary.update({
                "status": (
                    "ready"
                    if model_info and model_info.get("ready")
                    else ("incomplete" if model_info else "indexed")
                ),
                "source": (
                    "runtime+indexed" if model_info and model_row else
                    ("runtime" if model_info else "indexed")
                ),
                "name": (model_info or {}).get("name") or (model_row or {}).get("name") or obj_id,
                "accuracy": (model_info or {}).get("accuracy"),
                "proving_key": (model_info or {}).get("proving_key"),
                "verification_key": (model_info or {}).get("verification_key"),
            })
            if model_row:
                summary.update({
                    "proof_count": model_row.get("proof_count", 0),
                    "public_proof_count": model_row.get("public_proof_count", 0),
                    "pathc_route_count": model_row.get("pathc_route_count", 0),
                    "pathc_confirmed_count": model_row.get("pathc_confirmed_count", 0),
                    "lane_counts": model_row.get("lane_counts"),
                    "binding_profiles": model_row.get("binding_profiles"),
                    "latest_proof_hash": model_row.get("latest_proof_hash"),
                    "latest_lane": model_row.get("latest_lane"),
                    "latest_binding_profile": model_row.get("latest_binding_profile"),
                    "latest_binding_profile_label": _binding_profile_label(model_row.get("latest_binding_profile")),
                    "latest_activity_timestamp": model_row.get("latest_activity_timestamp"),
                    "latest_public_proof_hash": model_row.get("latest_public_proof_hash"),
                    "latest_public_lane": model_row.get("latest_public_lane"),
                    "latest_public_binding_profile": model_row.get("latest_public_binding_profile"),
                    "latest_public_binding_profile_label": _binding_profile_label(model_row.get("latest_public_binding_profile")),
                    "latest_public_tx_hash": model_row.get("latest_public_tx_hash"),
                    "latest_public_timestamp": model_row.get("latest_public_timestamp"),
                    "latest_public_source_kind": model_row.get("latest_public_source_kind"),
                    "latest_pathc_tx_hash": model_row.get("latest_pathc_tx_hash"),
                    "latest_pathc_timestamp": model_row.get("latest_pathc_timestamp"),
                    "latest_pathc_route_key": model_row.get("latest_pathc_route_key"),
                    "latest_pathc_route_source": model_row.get("latest_pathc_route_source"),
                    "latest_confirmed_pathc_tx_hash": model_row.get("latest_confirmed_pathc_tx_hash"),
                    "latest_confirmed_pathc_timestamp": model_row.get("latest_confirmed_pathc_timestamp"),
                })
            timeline = [
                {
                    "stage": "model_artifacts",
                    "status": "complete" if model_info and model_info.get("ready") else ("pending" if model_info else "not_present"),
                    "source": "runtime",
                    "detail": str(((model_info or {}).get("name")) or obj_id),
                }
            ]
            if model_row:
                timeline.append(
                    {
                        "stage": "indexed_proofs",
                        "status": "complete" if int(model_row.get("proof_count", 0) or 0) else "not_present",
                        "source": "indexed",
                        "detail": f"{int(model_row.get('proof_count', 0) or 0)} proof(s)",
                    }
                )
                timeline.append(
                    {
                        "stage": "latest_activity",
                        "status": "complete" if model_row.get("latest_proof_hash") else "not_present",
                        "source": "indexed",
                        "detail": str(model_row.get("latest_proof_hash") or ""),
                    }
                )
                timeline.append(
                    {
                        "stage": "public_settlement",
                        "status": "complete" if model_row.get("latest_public_tx_hash") else "pending",
                        "source": "public" if model_row.get("latest_public_tx_hash") else "not_present",
                        "detail": str(model_row.get("latest_public_tx_hash") or ""),
                    }
                )
                timeline.append(
                    {
                        "stage": "path_c_bridge",
                        "status": "complete" if model_row.get("latest_confirmed_pathc_tx_hash") else ("pending" if model_row.get("pathc_route_count") else "not_present"),
                        "source": "public" if model_row.get("latest_confirmed_pathc_tx_hash") else ("indexed" if model_row.get("pathc_route_count") else "not_present"),
                        "detail": str(model_row.get("latest_confirmed_pathc_tx_hash") or model_row.get("latest_pathc_tx_hash") or ""),
                    }
                )
                _append_unique_relationship(
                    relationships,
                    rel_type="proof_job",
                    rel_id=str(model_row.get("latest_proof_hash") or ""),
                    label="Latest proof job",
                    verb="latest_activity",
                    source="indexed",
                )
                _append_unique_relationship(
                    relationships,
                    rel_type="proof_job",
                    rel_id=str(model_row.get("latest_public_proof_hash") or ""),
                    label="Latest public proof job",
                    verb="latest_public_settlement",
                    source="indexed",
                )
                _append_unique_relationship(
                    relationships,
                    rel_type="transaction",
                    rel_id=str(model_row.get("latest_public_tx_hash") or ""),
                    label="Latest public settlement tx",
                    verb="settled_by",
                    source="public",
                )
                _append_unique_relationship(
                    relationships,
                    rel_type="transaction",
                    rel_id=str(model_row.get("latest_confirmed_pathc_tx_hash") or ""),
                    label="Latest Path C bridge tx",
                    verb="bridged_by",
                    source="public",
                )
            if isinstance(settlement_graph, dict):
                for node in settlement_graph.get("nodes") or []:
                    if not isinstance(node, dict):
                        continue
                    node_type = str(node.get("type") or "")
                    node_id = str(node.get("id") or "")
                    if not node_type or not node_id:
                        continue
                    if node_type == "model" and node_id == obj_id:
                        continue
                    label = {
                        "proof_job": "Proof Job",
                        "fact": "Fact",
                        "transaction": "Transaction",
                    }.get(node_type, node_type.title())
                    verb = {
                        "proof_job": "used_by",
                        "fact": "commits",
                        "transaction": "settled_by",
                    }.get(node_type, "related")
                    source = "public" if node_type == "transaction" else "indexed"
                    _append_unique_relationship(
                        relationships,
                        rel_type=node_type,
                        rel_id=node_id,
                        label=label,
                        verb=verb,
                        source=source,
                    )
    elif obj_type == "fact":
        summary["status"] = "known"
        summary["source"] = "on-chain"
        summary["fact_hash"] = obj_id
        proof_rec = await _get_proof_record(obj_id)
        if proof_rec:
            proof_summary, proof_timeline, proof_relationships = _proof_record_components(proof_rec)
            settlement_graph = _settlement_graph_from_proof_record(proof_rec)
            summary.update(proof_summary)
            summary["fact_hash"] = obj_id
            timeline = proof_timeline
            _append_unique_relationship(
                relationships,
                rel_type="proof_job",
                rel_id=str(proof_summary.get("proof_hash") or ""),
                label="Proof Job",
                verb="commits",
                source="indexed",
            )
            for rel in proof_relationships:
                _append_unique_relationship(
                    relationships,
                    rel_type=str(rel.get("type") or ""),
                    rel_id=str(rel.get("id") or ""),
                    label=str(rel.get("label") or ""),
                    verb=str(rel.get("verb") or ""),
                    source=str(rel.get("source") or ""),
                )
        else:
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
        "settlement_graph": settlement_graph,
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


@router.get("/graph/{obj_type}/{obj_id}", summary="Compact typed graph neighborhood")
async def forge_graph(
    obj_type: str,
    obj_id: str,
    limit: int = Query(3, ge=1, le=20, description="Maximum recent proof neighborhoods to merge for model graphs"),
    public_only: bool = Query(False, description="For model graphs, keep only publicly settled proof neighborhoods"),
) -> dict[str, Any]:
    graph = await _graph_neighborhood_for_object(obj_type, obj_id, limit=limit, public_only=public_only)
    return {
        "generated_at": _ts(),
        "type": obj_type,
        "id": obj_id,
        "limit": limit,
        "public_only": public_only,
        "graph": graph,
        "paths": {
            "self": f"graph/{quote(obj_type, safe='')}/{quote(obj_id, safe='')}",
            "detail": f"detail/{quote(obj_type, safe='')}/{quote(obj_id, safe='')}",
            "search": "search",
            "proofs": "proofs",
        },
    }


@router.get("/facts", summary="Dedicated fact feed with proof-backed graph context")
async def forge_facts_feed(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    public_only: bool = Query(False),
    q: str = Query(default="", description="Optional fact hash substring filter"),
    lane: Optional[str] = Query(default=None, description="Optional proving-lane filter"),
    model_name: Optional[str] = Query(default=None, description="Optional model filter"),
) -> dict[str, Any]:
    rows, total = await _get_fact_rows(
        limit=limit,
        offset=offset,
        q=q,
        public_only=public_only,
        lane=lane,
        model_name=model_name,
    )
    return {
        "generated_at": _ts(),
        "count": len(rows),
        "total_results": total,
        "limit": limit,
        "offset": offset,
        "query": q,
        "public_only": public_only,
        "lane": lane,
        "model_name": model_name,
        "has_more": total > offset + limit,
        "items": rows,
        "paths": {
            "self": "facts",
            "page": "facts/page",
            "detail": "detail/fact/{id}",
            "graph": "graph/fact/{id}",
            "search": "search?scope=facts",
        },
    }


@router.get("/models", summary="Dedicated model feed with proof-backed graph context")
async def forge_models_feed(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    public_only: bool = Query(False),
    q: str = Query(default="", description="Optional model-name substring filter"),
    lane: Optional[str] = Query(default=None, description="Optional latest-lane filter"),
) -> dict[str, Any]:
    rows, total = await _get_model_rows(
        limit=limit,
        offset=offset,
        q=q,
        public_only=public_only,
        lane=lane,
    )
    return {
        "generated_at": _ts(),
        "count": len(rows),
        "total_results": total,
        "limit": limit,
        "offset": offset,
        "query": q,
        "public_only": public_only,
        "lane": lane,
        "has_more": total > offset + limit,
        "items": rows,
        "paths": {
            "self": "models",
            "page": "models/page",
            "detail": "detail/model/{id}",
            "graph": "graph/model/{id}",
            "search": "search?scope=models",
        },
    }


@router.get("/paths", summary="Explorer API paths (self-description)")
async def forge_paths() -> dict[str, Any]:
    """Returns the explorer surface: every path you can follow. Use these to traverse end-to-end."""
    public_base = "https://zkde.fi/explorer/"
    api_base = "/api/v1/zkdefi/forge"
    return {
        "service": "starkforge-zksyslog",
        "description": "Proof-aware evidence explorer. Follow links in feed, search, and detail to traverse receipts → facts → proof jobs → models → transactions → blocks.",
        "public_base_url": public_base,
        "api_base_path": api_base,
        "public_pages": {
            "home": public_base,
            "proofs": public_base + "proofs/page",
            "facts": public_base + "facts/page",
            "models": public_base + "models/page",
        },
        "paths": {
            "home": {"method": "GET", "path": "", "description": "Explorer homepage (HTML)"},
            "feed": {"method": "GET", "path": "feed", "description": "Latest proof-backed receipts; each item has detail_href"},
            "proofs": {"method": "GET", "path": "proofs", "description": "Dedicated proof feed with settlement cursors"},
            "proofs_page": {"method": "GET", "path": "proofs/page", "description": "Dedicated proofs page backed by the cursor feed"},
            "facts": {"method": "GET", "path": "facts", "description": "Dedicated fact feed with proof-backed graph context"},
            "facts_page": {"method": "GET", "path": "facts/page", "description": "Dedicated facts page backed by the fact feed"},
            "models": {"method": "GET", "path": "models", "description": "Dedicated model feed with proof-backed graph context"},
            "models_page": {"method": "GET", "path": "models/page", "description": "Dedicated models page backed by the model feed"},
            "search": {"method": "GET", "path": "search", "description": "Unified search; results have detail_href per item"},
            "graph": {"method": "GET", "path": "graph/{type}/{id}", "description": "Compact typed graph neighborhood for proof/fact/tx/model traversal"},
            "detail": {"method": "GET", "path": "detail/{type}/{id}", "description": "Any object; relationships include href to related objects"},
            "status": {"method": "GET", "path": "status", "description": "System status (receipts, proofs, lanes)"},
            "health": {"method": "GET", "path": "health", "description": "Health (HTML)"},
            "proving": {"method": "GET", "path": "proving", "description": "Proving stats (HTML)"},
            "lane": {"method": "GET", "path": "lane/{lane_id}", "description": "Feed filtered by proving lane"},
        },
        "object_types": ["receipt", "fact", "proof_job", "model", "transaction", "block", "contract", "entity"],
        "evidence_flow": "action → proof job → fact → L3 tx → block (follow Relationships on each detail page)",
    }


@router.get("/proofs/page", response_class=HTMLResponse, summary="Dedicated proofs page")
async def forge_proofs_page(
    request: Request,
    limit: int = Query(25, ge=1, le=100),
    public_only: bool = Query(False),
    user_address: Optional[str] = Query(default=None),
    model_name: Optional[str] = Query(default=None),
    lane: Optional[str] = Query(default=None),
) -> HTMLResponse:
    status = await forge_status()
    payload = await forge_proofs_feed(
        limit=limit,
        public_only=public_only,
        user_address=user_address,
        model_name=model_name,
        lane=lane,
    )
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    next_cursor = payload.get("next_cursor") if isinstance(payload.get("next_cursor"), dict) else None

    rows = ""
    for item in items:
        proof_id = str(item.get("id", "-"))
        detail_url = f"../detail/proof_job/{quote(proof_id, safe='')}"
        latest_activity = str(item.get("latest_activity_timestamp") or "-")
        latest_public_tx_hash = str(item.get("latest_public_tx_hash") or "")
        latest_public_timestamp = str(item.get("latest_public_timestamp") or "-")
        latest_public_match_scope = str(item.get("latest_public_match_scope_label") or "exact proof")
        binding_label = str(item.get("binding_profile_label") or "-")
        binding_tone = _binding_tone(binding_label)
        graph = item.get("settlement_graph") if isinstance(item.get("settlement_graph"), dict) else {}
        node_count = len(graph.get("nodes") or []) if isinstance(graph.get("nodes"), list) else 0
        edge_count = len(graph.get("edges") or []) if isinstance(graph.get("edges"), list) else 0
        graph_url = f"../graph/proof_job/{quote(proof_id, safe='')}"
        proof_cell = _cell_stack_html(
            _code_ref_html(proof_id, detail_url),
            meta_lines=[f'<a class="muted-link" href="{detail_url}">open proof detail</a>'],
        )
        model_cell = _cell_stack_html(escape(str(item.get("model_name", "-"))))
        lane_cell = _cell_stack_html(
            escape(str(item.get("lane", "-"))),
            chips=[_chip_html(str(item.get("proof_type", "-")), "neutral")],
        )
        activity_cell = _cell_stack_html(
            escape(latest_activity),
            meta_lines=[f'proof={_code_ref_html(proof_id, detail_url)}'],
        )
        if latest_public_tx_hash:
            public_tx_href = f"../detail/transaction/{quote(latest_public_tx_hash, safe='')}"
            public_html = _cell_stack_html(
                _code_ref_html(latest_public_tx_hash, public_tx_href),
                chips=[
                    _chip_html(
                        latest_public_match_scope,
                        "mirror" if "mirror" in latest_public_match_scope.lower() else "exact",
                    )
                ],
                meta_lines=[escape(latest_public_timestamp)],
            )
        else:
            public_html = _cell_stack_html(
                '<span class="muted">not public yet</span>',
                chips=[_chip_html("runtime only", "warn")],
            )
        binding_html = _cell_stack_html(
            escape(binding_label),
            chips=[_chip_html(binding_label.split("/", 1)[0].strip() or binding_label, binding_tone)],
        )
        graph_html = _cell_stack_html(
            f'<a href="{graph_url}" class="muted-link graph-metric">{node_count} node(s) · {edge_count} edge(s)</a>',
            meta_lines=[f'<a class="muted-link" href="{graph_url}">open graph</a>'],
        )
        rows += f"""<tr>
  <td>{proof_cell}</td>
  <td>{model_cell}</td>
  <td>{lane_cell}</td>
  <td>{activity_cell}</td>
  <td>{public_html}</td>
  <td>{binding_html}</td>
  <td>{graph_html}</td>
</tr>"""
    if not rows:
        rows = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No proofs for this selection yet.</td></tr>'

    cursor_json = escape(str(next_cursor.get("timestamp", ""))) if next_cursor else ""
    cursor_proof = escape(str(next_cursor.get("proof_hash", ""))) if next_cursor else ""
    checked = "checked" if public_only else ""
    user_value = escape(user_address or "")
    model_value = escape(model_name or "")
    lane_value = escape(lane or "")

    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proofs — zkSyslog</title>
<style>{_forge_list_page_styles(1220)}</style>
</head>
<body>
<div class="container">
<nav><a href="..">← zkSyslog</a><a href="../">Home</a><a href="../search?scope=proofs">Search</a><a href="../facts/page">Facts</a><a href="../models/page">Models</a></nav>
<h1>Dedicated Proof Feed</h1>
<p class="page-intro">Indexed proof jobs ordered by latest public settlement. Each row separates runtime activity from public settlement and makes binding strength/provenance explicit instead of compressing it into one line.</p>

<div class="toolbar">
  <label><span>User</span><input id="user-address" type="text" value="{user_value}" placeholder="0x... optional" /></label>
  <label><span>Model</span><input id="model-name" type="text" value="{model_value}" placeholder="yield_forecast" /></label>
  <label><span>Lane</span><input id="lane-name" type="text" value="{lane_value}" placeholder="modelbridge / noir_v2" /></label>
  <label class="toolbar-check"><input id="public-only" type="checkbox" {checked} /> public settled only</label>
  <button id="apply-filters" type="button">Apply</button>
</div>

<div class="table-wrap">
<table>
<thead><tr><th>Proof</th><th>Model</th><th>Lane / Type</th><th>Latest Activity</th><th>Latest Public Settlement</th><th>Binding</th><th>Graph</th></tr></thead>
<tbody id="proof-table-body">{rows}</tbody>
</table>
</div>
<div class="footer">
  <span class="muted" id="proof-summary">Showing {len(items)} of {payload.get("total_results", 0)} proof(s)</span>
  <button id="load-more" type="button" {'style="display:none"' if not next_cursor else ''}>Load more</button>
</div>
</div>
<script>
const bodyEl = document.getElementById("proof-table-body");
const loadMoreBtn = document.getElementById("load-more");
const summaryEl = document.getElementById("proof-summary");
const userInput = document.getElementById("user-address");
const modelInput = document.getElementById("model-name");
const laneInput = document.getElementById("lane-name");
const publicOnlyInput = document.getElementById("public-only");
let nextCursor = {{"timestamp": "{cursor_json}", "proof_hash": "{cursor_proof}" }};
let shownCount = {len(items)};
let totalResults = {int(payload.get("total_results", 0) or 0)};
function escapeHtml(value) {{
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}}
function buildUrl(useCursor) {{
  const params = new URLSearchParams();
  params.set("limit", {limit!r});
  if (publicOnlyInput.checked) params.set("public_only", "true");
  if (userInput.value.trim()) params.set("user_address", userInput.value.trim());
  if (modelInput.value.trim()) params.set("model_name", modelInput.value.trim());
  if (laneInput.value.trim()) params.set("lane", laneInput.value.trim());
  if (useCursor && nextCursor && nextCursor.timestamp) {{
    params.set("cursor_timestamp", nextCursor.timestamp);
    params.set("cursor_proof_hash", nextCursor.proof_hash || "");
  }}
  return "../proofs?" + params.toString();
}}
function renderRows(items) {{
  for (const item of items) {{
    const tr = document.createElement("tr");
    const id = item.id || "-";
    const shortId = id.length > 24 ? id.slice(0, 12) + "..." + id.slice(-8) : id;
    const graph = item.settlement_graph || {{}};
    const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
    const matchScope = item.latest_public_match_scope_label || 'exact proof';
    const binding = item.binding_profile_label || '-';
    const bindingTone = binding.startsWith('full') ? 'good' : (binding.startsWith('partial') ? 'warn' : 'neutral');
    const matchTone = matchScope.includes('mirror') ? 'mirror' : 'exact';
    const publicCell = item.latest_public_tx_hash
      ? '<div class="cell-stack"><div class="cell-title"><a href="../detail/transaction/' + encodeURIComponent(item.latest_public_tx_hash) + '"><code class="code-chip" title="' + escapeHtml(item.latest_public_tx_hash) + '">' + escapeHtml(item.latest_public_tx_hash.length > 24 ? item.latest_public_tx_hash.slice(0, 12) + '...' + item.latest_public_tx_hash.slice(-8) : item.latest_public_tx_hash) + '</code></a></div><div class="cell-chip-row"><span class="mini-chip ' + matchTone + '">' + escapeHtml(matchScope) + '</span></div><div class="cell-meta">' + escapeHtml(item.latest_public_timestamp || '-') + '</div></div>'
      : '<div class="cell-stack"><div class="cell-title"><span class="muted">not public yet</span></div><div class="cell-chip-row"><span class="mini-chip warn">runtime only</span></div></div>';
    tr.innerHTML = '<td><div class="cell-stack"><div class="cell-title"><a href="../detail/proof_job/' + encodeURIComponent(id) + '"><code class="code-chip" title="' + escapeHtml(id) + '">' + escapeHtml(shortId) + '</code></a></div><div class="cell-meta"><a class="muted-link" href="../detail/proof_job/' + encodeURIComponent(id) + '">open proof detail</a></div></div></td>' +
      '<td><div class="cell-stack"><div class="cell-title">' + escapeHtml(item.model_name || '-') + '</div></div></td>' +
      '<td><div class="cell-stack"><div class="cell-title">' + escapeHtml(item.lane || '-') + '</div><div class="cell-chip-row"><span class="mini-chip neutral">' + escapeHtml(item.proof_type || '-') + '</span></div></div></td>' +
      '<td><div class="cell-stack"><div class="cell-title">' + escapeHtml(item.latest_activity_timestamp || '-') + '</div><div class="cell-meta">proof=<a href="../detail/proof_job/' + encodeURIComponent(id) + '">' + '<code class="code-chip" title="' + escapeHtml(id) + '">' + escapeHtml(shortId) + '</code></a></div></div></td>' +
      '<td>' + publicCell + '</td>' +
      '<td><div class="cell-stack"><div class="cell-title">' + escapeHtml(binding) + '</div><div class="cell-chip-row"><span class="mini-chip ' + bindingTone + '">' + escapeHtml(binding.split('/')[0].trim() || binding) + '</span></div></div></td>' +
      '<td><div class="cell-stack"><div class="cell-title"><a href="../graph/proof_job/' + encodeURIComponent(id) + '" class="muted-link graph-metric">' + nodeCount + ' node(s) · ' + edgeCount + ' edge(s)</a></div><div class="cell-meta"><a class="muted-link" href="../graph/proof_job/' + encodeURIComponent(id) + '">open graph</a></div></div></td>';
    bodyEl.appendChild(tr);
  }}
}}
function updateSummary() {{
  summaryEl.textContent = 'Showing ' + shownCount + ' of ' + totalResults + ' proof(s)';
}}
async function refresh(useCursor) {{
  const resp = await fetch(buildUrl(useCursor));
  const data = await resp.json();
  const items = data.items || [];
  if (!useCursor) {{
    bodyEl.innerHTML = '';
    shownCount = 0;
    totalResults = data.total_results || 0;
  }}
  renderRows(items);
  shownCount += items.length;
  nextCursor = data.next_cursor || null;
  loadMoreBtn.style.display = nextCursor ? 'inline-block' : 'none';
  updateSummary();
}}
document.getElementById("apply-filters").addEventListener("click", function() {{ refresh(false); }});
loadMoreBtn.addEventListener("click", function() {{ refresh(true); }});
</script>
</body>
</html>""")


def _graph_chip_html(row: dict[str, Any]) -> str:
    graph = row.get("settlement_graph") if isinstance(row.get("settlement_graph"), dict) else {}
    nodes = graph.get("nodes") if isinstance(graph, dict) else []
    edges = graph.get("edges") if isinstance(graph, dict) else []
    if not isinstance(nodes, list):
        nodes = []
    if not isinstance(edges, list):
        edges = []
    graph_href = str(row.get("graph_href") or "")
    detail_href = str(row.get("detail_href") or "")
    graph_link = f'<a href="../{escape(graph_href)}">graph</a>' if graph_href else ""
    detail_link = f'<a href="../{escape(detail_href)}">detail</a>' if detail_href else ""
    links = " · ".join(part for part in (detail_link, graph_link) if part)
    return _cell_stack_html(
        f'<span class="graph-metric">{len(nodes)} node(s) · {len(edges)} edge(s)</span>',
        meta_lines=[links] if links else None,
    )


@router.get("/facts/page", response_class=HTMLResponse, summary="Dedicated facts page")
async def forge_facts_page(
    request: Request,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    public_only: bool = Query(False),
    q: str = Query(default=""),
    lane: Optional[str] = Query(default=None),
    model_name: Optional[str] = Query(default=None),
) -> HTMLResponse:
    payload = await forge_facts_feed(
        limit=limit,
        offset=offset,
        public_only=public_only,
        q=q,
        lane=lane,
        model_name=model_name,
    )
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    next_offset = offset + limit
    has_more = bool(payload.get("has_more"))
    checked = "checked" if public_only else ""
    q_value = escape(q or "")
    lane_value = escape(lane or "")
    model_value = escape(model_name or "")
    rows = ""
    for item in items:
        fact_hash = str(item.get("fact_hash", "-"))
        fact_href = f"../detail/fact/{quote(fact_hash, safe='')}"
        latest_public_tx_hash = str(item.get("latest_public_tx_hash") or "").strip()
        latest_public_tx_html = (
            _cell_stack_html(
                _code_ref_html(
                    latest_public_tx_hash,
                    f"../detail/transaction/{quote(latest_public_tx_hash, safe='')}",
                ),
                chips=[
                    _chip_html(
                        str(item.get("latest_public_match_scope_label") or "exact proof"),
                        "mirror"
                        if "mirror" in str(item.get("latest_public_match_scope_label") or "").lower()
                        else "exact",
                    )
                ]
                if latest_public_tx_hash
                else [_chip_html("runtime only", "warn")],
                meta_lines=[escape(str(item.get("latest_public_timestamp") or "-"))] if latest_public_tx_hash else None,
            )
            if latest_public_tx_hash
            else _cell_stack_html('<span class="muted">not public yet</span>', chips=[_chip_html("runtime only", "warn")])
        )
        rows += f"""<tr>
  <td>{_cell_stack_html(_code_ref_html(fact_hash, fact_href), meta_lines=[f'<a class="muted-link" href="{fact_href}">open fact detail</a>'])}</td>
  <td>{_cell_stack_html(escape(str(item.get("model_name", "-"))))}</td>
  <td>{_cell_stack_html(escape(str(item.get("lane", "-"))), chips=[_chip_html(str(item.get("proof_type") or "").strip() or "proof-backed", "neutral")])}</td>
  <td>{latest_public_tx_html}</td>
  <td>{_graph_chip_html(item)}</td>
</tr>"""
    if not rows:
        rows = '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No facts for this selection yet.</td></tr>'
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Facts — zkSyslog</title>
<style>{_forge_list_page_styles(1180)}</style>
</head>
<body>
<div class="container">
<nav><a href="..">← zkSyslog</a><a href="../">Home</a><a href="../proofs/page">Proofs</a><a href="../models/page">Models</a></nav>
<h1>Dedicated Fact Feed</h1>
<p class="page-intro">Bridge facts with proof-backed graph context and direct navigation into proofs, models, and public settlement transactions. Public settlement is separated from runtime-only fact rows so missing public receipts are obvious.</p>
<div class="toolbar">
  <label><span>Search</span><input id="fact-query" type="text" value="{q_value}" placeholder="0x..." /></label>
  <label><span>Model</span><input id="model-name" type="text" value="{model_value}" placeholder="yield_forecast" /></label>
  <label><span>Lane</span><input id="lane-name" type="text" value="{lane_value}" placeholder="modelbridge / noir_v2" /></label>
  <label class="toolbar-check"><input id="public-only" type="checkbox" {checked} /> public settled only</label>
  <button id="apply-filters" type="button">Apply</button>
</div>
<div class="table-wrap">
<table>
<thead><tr><th>Fact</th><th>Model</th><th>Lane</th><th>Latest Public Tx</th><th>Graph</th></tr></thead>
<tbody>{rows}</tbody>
</table>
</div>
<div class="footer">
  <span class="muted">Showing {len(items)} of {int(payload.get("total_results", 0) or 0)} fact(s)</span>
  {"<a id=\"load-more\" href=\"?limit=" + str(limit) + "&offset=" + str(next_offset) + "&q=" + quote(q or "", safe='') + ("&public_only=true" if public_only else "") + ("&lane=" + quote(lane or "", safe='') if lane else "") + ("&model_name=" + quote(model_name or "", safe='') if model_name else "") + "\">Next page</a>" if has_more else ""}
</div>
<script>
document.getElementById("apply-filters").addEventListener("click", function() {{
  const params = new URLSearchParams();
  params.set("limit", {limit!r});
  if (document.getElementById("fact-query").value.trim()) params.set("q", document.getElementById("fact-query").value.trim());
  if (document.getElementById("model-name").value.trim()) params.set("model_name", document.getElementById("model-name").value.trim());
  if (document.getElementById("lane-name").value.trim()) params.set("lane", document.getElementById("lane-name").value.trim());
  if (document.getElementById("public-only").checked) params.set("public_only", "true");
  window.location.search = params.toString();
}});
</script>
</div>
</body>
</html>""")


@router.get("/models/page", response_class=HTMLResponse, summary="Dedicated models page")
async def forge_models_page(
    request: Request,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    public_only: bool = Query(False),
    q: str = Query(default=""),
    lane: Optional[str] = Query(default=None),
) -> HTMLResponse:
    payload = await forge_models_feed(limit=limit, offset=offset, public_only=public_only, q=q, lane=lane)
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    next_offset = offset + limit
    has_more = bool(payload.get("has_more"))
    checked = "checked" if public_only else ""
    q_value = escape(q or "")
    lane_value = escape(lane or "")
    rows = ""
    for item in items:
        name = str(item.get("name", item.get("id", "-")))
        latest_activity_bits = []
        if item.get("latest_lane"):
            latest_activity_bits.append(str(item.get("latest_lane")))
        activity_binding_label = _binding_profile_label(item.get("latest_binding_profile"))
        if activity_binding_label:
            latest_activity_bits.append(activity_binding_label)
        latest_activity_label = " / ".join(latest_activity_bits) if latest_activity_bits else "-"
        latest_activity_hash = str(item.get("latest_proof_hash") or "-")
        latest_activity_ts = str(item.get("latest_activity_timestamp") or "-")

        latest_public_bits = []
        if item.get("latest_public_lane"):
            latest_public_bits.append(str(item.get("latest_public_lane")))
        public_binding_label = _binding_profile_label(item.get("latest_public_binding_profile"))
        if public_binding_label:
            latest_public_bits.append(public_binding_label)
        latest_public_label = " / ".join(latest_public_bits) if latest_public_bits else "-"
        latest_public_tx = str(item.get("latest_public_tx_hash") or "-")
        latest_public_ts = str(item.get("latest_public_timestamp") or "-")
        latest_public_source_kind = str(item.get("latest_public_source_kind") or "")

        lane_counts = item.get("lane_counts") if isinstance(item.get("lane_counts"), dict) else {}
        lane_summary = ", ".join(
            f"{lane_name}={count}" for lane_name, count in sorted(lane_counts.items())
        ) or "-"
        pathc_summary_bits = []
        if int(item.get("pathc_route_count") or 0):
            pathc_summary_bits.append(f"{int(item.get('pathc_route_count') or 0)} route(s)")
        if int(item.get("pathc_confirmed_count") or 0):
            pathc_summary_bits.append(f"{int(item.get('pathc_confirmed_count') or 0)} confirmed")
        pathc_summary = " / ".join(pathc_summary_bits) or "no Path C routes"
        latest_activity_href = (
            f"../detail/proof_job/{quote(latest_activity_hash, safe='')}" if latest_activity_hash and latest_activity_hash != "-" else ""
        )
        latest_public_href = (
            f"../detail/transaction/{quote(latest_public_tx, safe='')}" if latest_public_tx and latest_public_tx != "-" else ""
        )
        activity_chips = []
        if item.get("latest_lane"):
            activity_chips.append(_chip_html(str(item.get("latest_lane")), "neutral"))
        if activity_binding_label:
            activity_chips.append(_chip_html(activity_binding_label, _binding_tone(activity_binding_label)))
        public_chips = []
        if item.get("latest_public_lane"):
            public_chips.append(_chip_html(str(item.get("latest_public_lane")), "neutral"))
        if public_binding_label:
            public_chips.append(_chip_html(public_binding_label, _binding_tone(public_binding_label)))
        public_source_label = "exact proof" if (latest_public_source_kind or "proof") == "proof" else "Path C bridge"
        if latest_public_tx and latest_public_tx != "-":
            public_chips.append(_chip_html(public_source_label, "exact" if public_source_label == "exact proof" else "mirror"))
        elif public_source_label:
            public_chips.append(_chip_html("not public yet", "warn"))
        coverage_chips = []
        if int(item.get("pathc_route_count") or 0):
            coverage_chips.append(_chip_html(f"Path C {int(item.get('pathc_route_count') or 0)} route(s)", "neutral"))
        if int(item.get("pathc_confirmed_count") or 0):
            coverage_chips.append(_chip_html(f"{int(item.get('pathc_confirmed_count') or 0)} confirmed", "good"))
        rows += f"""<tr>
  <td>{_cell_stack_html(escape(name), meta_lines=[f'<a class="muted-link" href="../detail/model/{quote(str(item.get("id", "")), safe="")}">open model detail</a>'])}</td>
  <td>{_cell_stack_html(_chip_html('ready' if item.get('ready') else 'incomplete', 'good' if item.get('ready') else 'warn'))}</td>
  <td>{_cell_stack_html(
      escape(latest_activity_ts),
      chips=activity_chips,
      meta_lines=[
          f'proof={_code_ref_html(latest_activity_hash, latest_activity_href)}' if latest_activity_href else f'proof={_code_ref_html(latest_activity_hash, shorten=False)}',
      ],
  )}</td>
  <td>{_cell_stack_html(
      escape(latest_public_ts if latest_public_tx != '-' else 'not public yet'),
      chips=public_chips,
      meta_lines=[
          f'tx={_code_ref_html(latest_public_tx, latest_public_href)}' if latest_public_href else 'no public settlement receipt',
      ],
  )}</td>
  <td>{_cell_stack_html(
      f'{int(item.get("proof_count", 0) or 0)} proof(s) · {int(item.get("public_proof_count", 0) or 0)} public',
      chips=coverage_chips,
      meta_lines=[escape(lane_summary)] + ([] if coverage_chips else [f'Path C: {escape(pathc_summary)}']),
  )}</td>
  <td>{_graph_chip_html(item)}</td>
</tr>"""
    if not rows:
        rows = '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No models for this selection yet.</td></tr>'
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Models — zkSyslog</title>
<style>{_forge_list_page_styles(1240)}</style>
</head>
<body>
<div class="container">
<nav><a href="..">← zkSyslog</a><a href="../">Home</a><a href="../proofs/page">Proofs</a><a href="../facts/page">Facts</a></nav>
<h1>Dedicated Model Feed</h1>
<p class="page-intro">Provable model inventory with separate latest proof activity and latest public settlement, plus bridge-lane density and Path C route coverage. Activity and settlement are shown independently so stale public receipts do not hide fresh runtime movement.</p>
<div class="toolbar">
  <label><span>Search</span><input id="model-query" type="text" value="{q_value}" placeholder="yield_forecast" /></label>
  <label><span>Lane</span><input id="lane-name" type="text" value="{lane_value}" placeholder="noir_v2 / modelbridge" /></label>
  <label class="toolbar-check"><input id="public-only" type="checkbox" {checked} /> only models with public proof receipts</label>
  <button id="apply-filters" type="button">Apply</button>
</div>
<div class="table-wrap">
<table>
<thead><tr><th>Model</th><th>Ready</th><th>Latest Activity</th><th>Latest Public Settlement</th><th>Coverage</th><th>Graph</th></tr></thead>
<tbody>{rows}</tbody>
</table>
</div>
<div class="footer">
  <span class="muted">Showing {len(items)} of {int(payload.get("total_results", 0) or 0)} model(s)</span>
  {"<a id=\"load-more\" href=\"?limit=" + str(limit) + "&offset=" + str(next_offset) + "&q=" + quote(q or "", safe='') + ("&public_only=true" if public_only else "") + ("&lane=" + quote(lane or "", safe='') if lane else "") + "\">Next page</a>" if has_more else ""}
</div>
<script>
document.getElementById("apply-filters").addEventListener("click", function() {{
  const params = new URLSearchParams();
  params.set("limit", {limit!r});
  if (document.getElementById("model-query").value.trim()) params.set("q", document.getElementById("model-query").value.trim());
  if (document.getElementById("lane-name").value.trim()) params.set("lane", document.getElementById("lane-name").value.trim());
  if (document.getElementById("public-only").checked) params.set("public_only", "true");
  window.location.search = params.toString();
}});
</script>
</div>
</body>
</html>""")


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
    proof_public = status.get("proof_stats", {}).get("public_settled", 0)

    # Build feed rows (link ID to detail page)
    feed_rows = ""
    for item in feed_data.get("items", []):
        item_id = str(item.get("id", "-"))
        detail_type = item.get("type", "receipt")
        detail_url = f"detail/{detail_type}/{quote(str(item_id), safe='')}"
        badge_cls = "badge-onchain" if item.get("source") == "on-chain" else "badge-runtime"
        badge_label = item.get("source", "runtime")
        feed_rows += f"""<tr>
  <td>{_cell_stack_html(_code_ref_html(item_id, detail_url), meta_lines=[f'<a class="muted-link" href="{detail_url}">open detail</a>'])}</td>
  <td>{_cell_stack_html(escape(str(item.get("action", "-"))))}</td>
  <td>{_cell_stack_html(escape(str(item.get("proof_type", "-"))), chips=[_chip_html(str(item.get("source", "runtime")), "good" if item.get("source") == "on-chain" else "neutral")])}</td>
  <td><span class="badge {badge_cls}">{escape(badge_label)}</span></td>
  <td>{_cell_stack_html(escape(str(item.get("timestamp", "-"))))}</td>
</tr>"""

    if not feed_rows:
        feed_rows = '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No receipts yet — the feed populates from live proof-backed events.</td></tr>'

    lanes_html = ""
    for lane, available in status.get("lanes", {}).items():
        cls = "badge-onchain" if available else "badge-runtime"
        lane_slug = quote(str(lane), safe="")
        lanes_html += f'<a href="lane/{lane_slug}" class="badge lane-badge {cls}" style="margin-right:6px;text-decoration:none;cursor:pointer">{escape(str(lane))}</a>'

    lane_summary_html = ""
    for row in status.get("lane_summary", [])[:8]:
        lane_name = str(row.get("lane") or "-")
        lane_slug = quote(lane_name, safe="")
        proof_types = row.get("proof_types") if isinstance(row.get("proof_types"), list) else []
        binding_profiles = row.get("binding_profiles") if isinstance(row.get("binding_profiles"), list) else []
        latest_activity = str(row.get("latest_activity_timestamp") or "-")
        latest_public = str(row.get("latest_public_timestamp") or "not public yet")
        binding_label = binding_profiles[0] if binding_profiles else "-"
        type_label = ", ".join(str(item) for item in proof_types[:2]) if proof_types else "-"
        lane_summary_html += f"""<a href="lane/{lane_slug}" class="lane-card">
      <div class="lane-card-top">
        <strong>{escape(lane_name)}</strong>
        <span class="badge {'badge-onchain' if row.get('public_proof_count') else 'badge-runtime'}">{int(row.get('public_proof_count') or 0)} public</span>
      </div>
      <div class="lane-card-stats">
        <span>{int(row.get("proof_count") or 0)} proofs</span>
        <span>{int(row.get("model_count") or 0)} models</span>
      </div>
      <div class="lane-card-meta"><span class="muted">Type</span><span>{escape(type_label)}</span></div>
      <div class="lane-card-meta"><span class="muted">Binding</span><span>{escape(binding_label)}</span></div>
      <div class="lane-card-meta"><span class="muted">Latest Activity</span><span>{escape(latest_activity)}</span></div>
      <div class="lane-card-meta"><span class="muted">Latest Public</span><span>{escape(latest_public)}</span></div>
    </a>"""
    if not lane_summary_html:
        lane_summary_html = '<p class="muted">No indexed lane coverage yet.</p>'

    path_c_summary = status.get("path_c_summary") if isinstance(status.get("path_c_summary"), dict) else {}
    path_c_html = ""
    if path_c_summary:
        path_c_html = f"""<div class="lane-card">
      <div class="lane-card-top">
        <strong>path_c_bridge</strong>
        <span class="badge {'badge-onchain' if int(path_c_summary.get('confirmed_count') or 0) else 'badge-runtime'}">{int(path_c_summary.get('confirmed_count') or 0)} confirmed</span>
      </div>
      <div class="lane-card-stats">
        <span>{int(path_c_summary.get("route_count") or 0)} routes</span>
        <span>{int(path_c_summary.get("model_count") or 0)} models</span>
      </div>
      <div class="lane-card-meta"><span class="muted">Latest Confirmed</span><span>{escape(str(path_c_summary.get("latest_confirmed_timestamp") or "not confirmed yet"))}</span></div>
      <div class="lane-card-meta"><span class="muted">Model</span><span>{escape(str(path_c_summary.get("latest_confirmed_model") or "-"))}</span></div>
      <div class="lane-card-meta"><span class="muted">Surface</span><span><a href="models/page">model explorer</a></span></div>
    </div>"""

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
	    .lane-summary-section {{
	      margin-bottom: 28px;
	      padding: 14px;
	      border: 1px solid var(--line);
	      border-radius: 10px;
	      background: var(--panel);
	    }}
	    .lane-summary-section h2 {{
	      font-size: 12px;
	      text-transform: uppercase;
	      letter-spacing: 0.4px;
	      color: var(--muted);
	      margin-bottom: 12px;
	    }}
	    .lane-summary-grid {{
	      display: grid;
	      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
	      gap: 10px;
	    }}
	    .lane-card {{
	      display: block;
	      border: 1px solid rgba(42,48,64,0.8);
	      border-radius: 10px;
	      padding: 12px;
	      background: var(--panel-alt);
	      color: var(--text);
	      text-decoration: none;
	    }}
	    .lane-card:hover {{
	      border-color: rgba(16,185,129,0.45);
	      text-decoration: none;
	    }}
	    .lane-card-top {{
	      display: flex;
	      justify-content: space-between;
	      gap: 10px;
	      align-items: center;
	      margin-bottom: 8px;
	    }}
	    .lane-card-stats {{
	      display: flex;
	      gap: 10px;
	      flex-wrap: wrap;
	      font-size: 12px;
	      color: var(--text);
	      margin-bottom: 10px;
	    }}
	    .lane-card-meta {{
	      display: flex;
	      justify-content: space-between;
	      gap: 10px;
	      font-size: 11px;
	      padding-top: 6px;
	      margin-top: 6px;
	      border-top: 1px solid rgba(42,48,64,0.6);
	    }}

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
      box-shadow: 0 12px 30px rgba(0,0,0,.18);
    }}
    table {{
      width: 100%;
      min-width: 760px;
      border-collapse: separate;
      border-spacing: 0;
    }}
    th, td {{
      text-align: left;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(42,48,64,.7);
      font-size: 13px;
      white-space: normal;
      overflow-wrap: anywhere;
    }}
    th {{
      position: sticky;
      top: 0;
      z-index: 1;
      color: var(--muted);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      background: rgba(9,12,20,.96);
      backdrop-filter: blur(10px);
    }}
    tbody tr:nth-child(odd) td {{ background: rgba(255,255,255,.015); }}
    tr:last-child td {{ border-bottom: none; }}
    tr:hover td {{ background: rgba(28,39,58,.68); }}
    .cell-stack {{ display:flex; flex-direction:column; gap:5px; min-width:0; }}
    .cell-title {{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-weight:600; }}
    .cell-meta {{ font-size:12px; color:var(--muted); }}
    .cell-chip-row {{ display:flex; flex-wrap:wrap; gap:6px; }}
    .mini-chip {{
      display:inline-flex;
      align-items:center;
      padding:2px 8px;
      border-radius:999px;
      border:1px solid rgba(122,134,153,.28);
      background:rgba(122,134,153,.08);
      color:#cdd7e7;
      font-size:11px;
      font-weight:600;
    }}
    .mini-chip.good {{
      border-color: rgba(16,185,129,.36);
      background: rgba(16,185,129,.12);
      color: #b7f7dc;
    }}
    .code-chip {{
      display:inline-flex;
      align-items:center;
      padding:3px 7px;
      border-radius:7px;
      border:1px solid rgba(42,48,64,.85);
      background:#09111b;
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size:12px;
      max-width:100%;
    }}

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
        <a href="proofs/page" class="explorer-top-link">Proofs</a>
        <a href="facts/page" class="explorer-top-link">Facts</a>
        <a href="models/page" class="explorer-top-link">Models</a>
        <a href="health" class="explorer-top-link">Health</a>
        <a href="proving" class="explorer-top-link">Proving</a>
      </nav>
      <div class="status-strip">
        <span><span class="dot {"dot-ok" if health == "ok" else "dot-warn"}"></span> Backend: {health}</span>
        <span>{receipt_count} receipts</span>
        <span>{proof_total} proofs ({proof_public} public)</span>
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
	        <div class="label">Public Settled</div>
	        <div class="value">{proof_public}</div>
	      </div>
	      <div class="stat-card">
	        <div class="label">Lanes</div>
	        <div class="value">{len(status.get("lanes", {}))}</div>
	      </div>
	    </div>

	    <div class="lane-summary-section">
	      <h2>Lane Coverage</h2>
	      <div class="lane-summary-grid">
	        {lane_summary_html}
            {path_c_html}
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
      <p><a href="paths" class="muted-link">Paths (JSON)</a> · <a href="feed" class="muted-link">Feed</a> · <a href="proofs" class="muted-link">Proofs Feed</a> · <a href="proofs/page" class="muted-link">Proofs Page</a> · <a href="facts/page" class="muted-link">Facts Page</a> · <a href="models/page" class="muted-link">Models Page</a> · <a href="search" class="muted-link">Search</a> · <a href="status" class="muted-link">Status</a></p>
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
    function isProofCursorMode(q) {{
      return activeScope === "proofs" && !q;
    }}
    function resetSearchPagination() {{
      window._searchOffset = 0;
      window._searchCursor = null;
      window._searchTotalShown = 0;
    }}
    function buildSearchUrl(q, append) {{
      const params = new URLSearchParams();
      params.set("q", q);
      if (activeScope && activeScope !== "all") params.set("scope", activeScope);
      params.set("limit", "25");
      if (isProofCursorMode(q)) {{
        if (append && window._searchCursor) {{
          if (window._searchCursor.timestamp) params.set("cursor_timestamp", window._searchCursor.timestamp);
          if (window._searchCursor.proof_hash) params.set("cursor_proof_hash", window._searchCursor.proof_hash);
        }}
      }} else {{
        params.set("offset", String(append ? (window._searchOffset || 0) : 0));
      }}
      return "/api/v1/zkdefi/forge/search?" + params.toString();
    }}
    function ensureResultGroup(group, itemsLength) {{
      var groupEl = document.getElementById("result-group-" + group);
      if (!groupEl) {{
        groupEl = document.createElement("div");
        groupEl.className = "result-group";
        groupEl.id = "result-group-" + group;
        groupEl.innerHTML = '<h4>' + group + ' (' + itemsLength + ')</h4>';
        searchBody.appendChild(groupEl);
      }} else {{
        var header = groupEl.querySelector("h4");
        if (header) {{
          var currentCount = groupEl.querySelectorAll(".result-item").length + itemsLength;
          header.textContent = group + " (" + currentCount + ")";
        }}
      }}
      return groupEl;
    }}
    function appendResultItems(group, items) {{
      if (!items || items.length === 0) return 0;
      const objType = groupToType[group] || "receipt";
      const groupEl = ensureResultGroup(group, items.length);
      for (const item of items) {{
        const id = (item.id || "-").replace(/"/g, "&quot;");
        const href = "detail/" + objType + "/" + encodeURIComponent(item.id || "");
        const div = document.createElement("div");
        div.className = "result-item";
        div.innerHTML = '<a href="' + href + '"><code>' + id + '</code></a> &mdash; ' + (item.action || item.proof_type || group) + ' <span class="muted">' + (item.timestamp || item.latest_public_timestamp || "") + '</span>';
        groupEl.appendChild(div);
      }}
      return items.length;
    }}
    function renderSearchResults(data, q, append) {{
      var scopeLabel = data.scope || "all";
      var queryLabel = q ? ' for "' + q.replace(/"/g, "&quot;") + '"' : "";
      if (!append) {{
        searchBody.innerHTML = '<p class="muted">Found ' + (data.total_results || 0) + ' result(s)' + queryLabel + ' (scope: ' + scopeLabel + ')</p>';
      }}
      let appendedCount = 0;
      for (const [group, items] of Object.entries(data.results || {{}})) {{
        appendedCount += appendResultItems(group, items || []);
      }}
      if (!append && (data.total_results || 0) === 0) {{
        searchBody.innerHTML += '<p class="muted">No matches. Try a different scope or query.</p>';
      }}
      window._searchTotalShown = append ? ((window._searchTotalShown || 0) + appendedCount) : appendedCount;
      if (!isProofCursorMode(q)) {{
        window._searchOffset = (data.offset || 0) + (data.limit || 25);
        window._searchCursor = null;
      }} else {{
        window._searchOffset = 0;
        window._searchCursor = data.next_cursor || null;
      }}
      var loadMoreWrap = document.getElementById("search-load-more-wrap");
      var hasMore = isProofCursorMode(q) ? !!data.next_cursor : !!data.has_more;
      if (loadMoreWrap) loadMoreWrap.style.display = hasMore ? "block" : "none";
      var firstP = searchBody.querySelector("p.muted");
      if (firstP) {{
        var shown = window._searchTotalShown || 0;
        var total = data.total_results || shown;
        firstP.textContent = "Showing " + shown + " of " + total + " result(s)" + queryLabel + " (scope: " + scopeLabel + ")";
      }}
    }}
    async function doSearch() {{
      resetSearchPagination();
      const q = searchInput.value.trim();
      try {{
        const resp = await fetch(buildSearchUrl(q, false));
        const data = await resp.json();
        renderSearchResults(data, q, false);
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
      try {{
        const resp = await fetch(buildSearchUrl(q, true));
        const data = await resp.json();
        renderSearchResults(data, q, true);
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
