#!/usr/bin/env python3
"""
Audit transaction links embedded in a showcase HTML report.

Checks:
- each public tx link resolves to a real receipt on the target chain
- failed / reverted txs are surfaced explicitly

Usage:
  python3 scripts/audit_showcase_tx_links.py
  python3 scripts/audit_showcase_tx_links.py --html artifacts/hackathon_showcase/latest.html
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib import request


DEFAULT_HTML = Path("artifacts/hackathon_showcase/latest.html")
ETH_RPC = "https://ethereum-sepolia-rpc.publicnode.com"
STARK_RPC = "https://starknet-sepolia-rpc.publicnode.com"


def _post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url=url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "zkdefi-showcase-link-audit/1.0",
        },
        method="POST",
    )
    with request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace") or "{}")


def _extract_tx_links(html: str) -> list[str]:
    return sorted(set(re.findall(r"https?://[^\"']+/tx/0x[a-fA-F0-9]+", html)))


def _audit_eth(tx_hash: str) -> tuple[bool, str]:
    resp = _post_json(
        ETH_RPC,
        {"jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionReceipt", "params": [tx_hash]},
    )
    receipt = resp.get("result")
    if not receipt:
        return False, "not_found"
    if str(receipt.get("status")) != "0x1":
        return False, f"failed:{receipt.get('status')}"
    return True, f"success gas={receipt.get('gasUsed')}"


def _audit_stark(tx_hash: str) -> tuple[bool, str]:
    resp = _post_json(
        STARK_RPC,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "starknet_getTransactionReceipt",
            "params": {"transaction_hash": tx_hash},
        },
    )
    if "error" in resp:
        return False, f"not_found:{resp['error']}"
    receipt = resp.get("result") or {}
    execution_status = str(receipt.get("execution_status") or "")
    finality_status = str(receipt.get("finality_status") or "")
    if execution_status and execution_status != "SUCCEEDED":
        return False, f"failed:{execution_status}"
    return True, f"success finality={finality_status or '-'}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", type=Path, default=DEFAULT_HTML)
    args = parser.parse_args()

    html_path = args.html
    if not html_path.exists():
        print(json.dumps({"ok": False, "error": f"missing html: {html_path}"}))
        return 2

    html = html_path.read_text(encoding="utf-8")
    links = _extract_tx_links(html)
    rows: list[dict[str, str | bool]] = []
    failures = 0

    for link in links:
        tx_hash = link.rsplit("/tx/", 1)[1]
        if "etherscan.io" in link:
            ok, detail = _audit_eth(tx_hash)
            network = "ethereum_sepolia"
        elif "starkscan.co" in link:
            ok, detail = _audit_stark(tx_hash)
            network = "starknet_sepolia"
        else:
            ok, detail = False, "unknown_explorer"
            network = "unknown"
        if not ok:
            failures += 1
        rows.append(
            {
                "ok": ok,
                "network": network,
                "tx_hash": tx_hash,
                "link": link,
                "detail": detail,
            }
        )

    result = {
        "ok": failures == 0,
        "html": str(html_path),
        "links_total": len(links),
        "failures": failures,
        "rows": rows,
    }
    print(json.dumps(result, indent=2))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
