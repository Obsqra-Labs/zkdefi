#!/usr/bin/env python3
"""Smoke test for proof-gated oracle execute route.

This script calls:
1) GET /api/v1/zkdefi/signals/top?limit=1
2) POST /api/v1/zkdefi/oracle/execute?address=...

It validates that the execute endpoint returns wallet-sign payload for
`proof_gated_yield_agent` and prints a concise summary.
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def _http_json(
    method: str,
    url: str,
    *,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 60.0,
) -> tuple[int, dict[str, Any]]:
    payload = None
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url=url, data=payload, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        try:
            parsed = json.loads(raw) if raw else {"detail": str(exc)}
        except Exception:
            parsed = {"detail": raw or str(exc)}
        return exc.code, parsed
    except urllib.error.URLError as exc:
        return 0, {"detail": f"request failed: {exc.reason}"}
    except TimeoutError:
        return 0, {"detail": "request timed out"}
    except socket.timeout:
        return 0, {"detail": "request timed out"}


def _fallback_signal() -> dict[str, Any]:
    return {
        "id": "smoke-signal-proof-gated",
        "type": "lending",
        "riskScore": 50,
        "privacyMode": "public",
        "predictions": {
            "reputationScore": {
                "score": 75,
            }
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test proof-gated oracle execute endpoint")
    parser.add_argument("--base-url", default="http://127.0.0.1:8003", help="Backend base URL")
    parser.add_argument(
        "--address",
        default="0x04422220537D26e01FA07fB8Bf7B50A6D87176cD47f4f8416Ed7e2576f1aecdb",
        help="User/agent address query parameter",
    )
    parser.add_argument("--amount", type=int, default=10**18, help="Amount in wei-like units")
    parser.add_argument("--action", choices=["deposit", "withdraw"], default="deposit")
    parser.add_argument("--model", default="creditworthiness", help="Model name for proof generation")
    parser.add_argument(
        "--input-data",
        default="[531,2,720,3,12,0,2,1,4500,850,1200,0]",
        help="JSON array for model inputData",
    )
    parser.add_argument("--admin-key", default="", help="Optional X-Admin-Key header")
    parser.add_argument("--timeout", type=float, default=120.0, help="HTTP timeout seconds")
    args = parser.parse_args()

    try:
        input_data = json.loads(args.input_data)
    except json.JSONDecodeError as exc:
        print(f"ERROR invalid --input-data JSON: {exc}")
        return 2

    if not isinstance(input_data, list) or not input_data:
        print("ERROR --input-data must be a non-empty JSON list")
        return 2

    base = args.base_url.rstrip("/")
    headers: dict[str, str] = {}
    if args.admin_key:
        headers["X-Admin-Key"] = args.admin_key

    # Try live signal; fall back to a permissive synthetic signal if none available.
    signal_url = f"{base}/api/v1/zkdefi/signals/top?limit=1"
    signal_status, signal_body = _http_json("GET", signal_url, headers=headers, timeout=args.timeout)
    signal = _fallback_signal()
    if signal_status == 200 and isinstance(signal_body, dict):
        signals = signal_body.get("signals")
        if isinstance(signals, list) and signals:
            signal = signals[0]

    query = urllib.parse.urlencode({"address": args.address})
    execute_url = f"{base}/api/v1/zkdefi/oracle/execute?{query}"
    execute_payload = {
        "signal": signal,
        "execution_params": {
            "adapterId": "proof_gated_yield_agent",
            "modelName": args.model,
            "inputData": input_data,
            "protocolId": 1,
            "amount": args.amount,
            "actionType": args.action,
            "proofMode": 2,
            "tier": 0,
            "valueEth": 0,
            "outputLowerBound": 0,
            "outputUpperBound": 10000,
            "executionChain": "l3",
            "bridgeCircuit": "ModelBridge",
            "executionProofHash": "0x0",
        },
    }

    status, body = _http_json(
        "POST",
        execute_url,
        body=execute_payload,
        headers=headers,
        timeout=args.timeout,
    )

    ok = (
        status == 200
        and isinstance(body, dict)
        and body.get("success") is True
        and body.get("status") == "wallet_sign_required"
        and isinstance(body.get("wallet_calldata"), dict)
        and isinstance(body.get("wallet_calldata", {}).get("calldata"), list)
    )

    print("status_code:", status)
    print("response_status:", body.get("status") if isinstance(body, dict) else None)
    print("call_id:", body.get("call_id") if isinstance(body, dict) else None)
    if isinstance(body, dict):
        wallet_calldata = body.get("wallet_calldata") or {}
        calldata = wallet_calldata.get("calldata") if isinstance(wallet_calldata, dict) else None
        print("calldata_len:", len(calldata) if isinstance(calldata, list) else None)
        proof_context = body.get("proof_context")
        if isinstance(proof_context, dict):
            print("proof_hash:", proof_context.get("proof_hash") or proof_context.get("execution_proof_hash"))

    if not ok:
        print("ERROR execute smoke failed")
        if isinstance(body, dict):
            print("detail:", body.get("detail") or body)
        return 1

    print("OK execute smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
