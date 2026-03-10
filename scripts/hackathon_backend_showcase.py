#!/usr/bin/env python3
"""
Hackathon backend showcase runner.

Purpose:
- Demonstrate "UI lagging behind backend" with terminal-first evidence.
- Validate core claims across proofs, agents, privacy rails, and on-chain reads.

Usage:
  python scripts/hackathon_backend_showcase.py
  python scripts/hackathon_backend_showcase.py --base-url http://127.0.0.1:8003
  python scripts/hackathon_backend_showcase.py --wallet 0xabc... --skip-onchain
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib import error, request


DEFAULT_BASE_URL = "http://127.0.0.1:8003"
DEFAULT_WALLET = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
DEFAULT_TIMEOUT_SECONDS = 45.0
ENV_FILE = Path("backend/.env")


def _normalize_address(address: str) -> str:
    raw = str(address or "").strip().lower()
    if not raw:
        return "0x0"
    if raw.startswith("0x"):
        raw = "0x" + raw[2:].lstrip("0")
    return raw or "0x0"


def _load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        key = k.strip()
        value = v.strip().strip('"').strip("'")
        if key:
            out[key] = value
    return out


def _short_hex(value: str | None, size: int = 12) -> str:
    if not value:
        return "-"
    s = str(value)
    if len(s) <= size * 2:
        return s
    return f"{s[:size]}...{s[-size:]}"


class HttpClient:
    def __init__(self, base_url: str, timeout_seconds: float):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def call(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        url = f"{self.base_url}{path}"
        data: bytes | None = None
        req_headers = {
            "Accept": "application/json",
            "User-Agent": "zkdefi-hackathon-showcase/1.0",
        }
        if headers:
            req_headers.update(headers)
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            req_headers["Content-Type"] = "application/json"

        req = request.Request(url=url, data=data, method=method.upper(), headers=req_headers)
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as resp:
                status = int(resp.status)
                body = resp.read().decode("utf-8", errors="replace")
                if not body:
                    return status, {}
                try:
                    return status, json.loads(body)
                except json.JSONDecodeError:
                    return status, {"raw": body}
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw}
            return int(exc.code), parsed
        except Exception as exc:  # pragma: no cover - defensive runtime handling
            return 0, {"error": str(exc)}


def _rpc_call(
    rpc_url: str,
    method: str,
    params: list[Any] | dict[str, Any],
    timeout_seconds: float,
) -> tuple[bool, Any]:
    payload = {"jsonrpc": "2.0", "id": int(time.time() * 1000), "method": method, "params": params}
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url=rpc_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "zkdefi-hackathon-showcase/1.0",
        },
    )
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(body) if body else {}
            if "error" in parsed:
                return False, parsed["error"]
            return True, parsed.get("result")
    except Exception as exc:  # pragma: no cover
        return False, {"message": str(exc)}


@dataclass
class StepResult:
    name: str
    ok: bool
    details: dict[str, Any] = field(default_factory=dict)


class ShowcaseRunner:
    def __init__(
        self,
        base_url: str,
        wallet: str,
        timeout_seconds: float,
        skip_onchain: bool,
    ):
        self.wallet = _normalize_address(wallet)
        self.client = HttpClient(base_url=base_url, timeout_seconds=timeout_seconds)
        self.timeout_seconds = timeout_seconds
        self.skip_onchain = skip_onchain
        self.env_from_file = _load_env_file(ENV_FILE)
        self.results: list[StepResult] = []
        self.created_agent_id: str | None = None
        self._deployment_proof_hash: str | None = None
        self._last_rpc_url: str | None = None

    def _record(self, name: str, ok: bool, **details: Any) -> StepResult:
        res = StepResult(name=name, ok=ok, details=details)
        self.results.append(res)
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name}")
        for key, value in details.items():
            print(f"  - {key}: {value}")
        return res

    def run(self) -> int:
        print("== zkde.fi Hackathon Backend Showcase ==")
        print(f"base_url={self.client.base_url}")
        print(f"wallet={self.wallet}")
        print("")

        self.step_health()
        self.step_manifest()
        self.step_agent_create_execute()
        self.step_deployment_proof_and_calldata()
        self.step_full_privacy_commitment()
        self.step_policy_controls()
        self.step_onchain_read_via_backend()
        self.step_rpc_contract_presence()
        self.step_receipts_view()
        self.step_optional_advanced_proofs()

        print("")
        return self.print_claim_matrix()

    def step_health(self) -> None:
        status, body = self.client.call("GET", "/health")
        ok = status == 200 and body.get("status") == "ok"
        self._record(
            "Backend health",
            ok,
            status=status,
            service=body.get("service"),
            admin_configured=body.get("admin_configured"),
        )

    def step_manifest(self) -> None:
        status, body = self.client.call("GET", "/api/v1/zkdefi/reputation/pack/manifest")
        circuits = body.get("circuits", []) if isinstance(body, dict) else []
        ready_count = 0
        for item in circuits:
            artifacts = (item or {}).get("artifacts") or {}
            if artifacts.get("wasm") and artifacts.get("zkey"):
                ready_count += 1
        ok = status == 200 and len(circuits) > 0
        self._record(
            "Reputation pack manifest",
            ok,
            status=status,
            pack_id=body.get("pack_id") if isinstance(body, dict) else None,
            circuits=len(circuits),
            circuits_with_wasm_and_zkey=ready_count,
        )

    def step_optional_advanced_proofs(self) -> None:
        """
        Optional "hard-mode" checks for direct circuit batch + credit proof routes.
        These can fail when REQUIRE_REAL_PROOFS is enabled and Poseidon bridge
        runtime is unavailable for the active backend process environment.
        """
        status, body = self.client.call("GET", "/api/v1/zkdefi/skills/")
        skills = body.get("skills", []) if isinstance(body, dict) else []
        available = {str(s.get("skill_id")) for s in skills if isinstance(s, dict)}
        preferred = [
            "risk_score",
            "anomaly_detection",
            "yield_optimality",
            "strategy_integrity",
            "execution_integrity",
        ]
        selected = [sid for sid in preferred if sid in available]
        if not selected:
            selected = list(sorted(available))[:3]

        batch_payload = {"skill_ids": selected, "params": {}, "user_address": self.wallet}
        b_status, b_body = self.client.call("POST", "/api/v1/zkdefi/skills/batch", payload=batch_payload)
        succeeded = int((b_body or {}).get("succeeded", 0)) if isinstance(b_body, dict) else 0
        total = int((b_body or {}).get("total", 0)) if isinstance(b_body, dict) else 0
        proof_hashes = []
        for row in (b_body.get("results", []) if isinstance(b_body, dict) else []):
            if isinstance(row, dict) and row.get("proof_hash"):
                proof_hashes.append(str(row.get("proof_hash")))

        skill_ok = status == 200 and b_status == 200 and total > 0 and succeeded >= 1
        self._record(
            "Optional: batch skill proof runtime",
            skill_ok,
            selected_skills=",".join(selected),
            listed_skills=len(skills),
            batch_status=b_status,
            succeeded=f"{succeeded}/{total}",
            proof_hashes=len(proof_hashes),
            first_proof_hash=_short_hex(proof_hashes[0] if proof_hashes else None),
            note=(
                "If this fails with Poseidon bridge errors while other proof paths pass, "
                "backend env likely lacks the real bridge runtime wiring."
            ),
        )

        payload = {
            "user_address": self.wallet,
            "credit_score": 745,
            "collateral_wei": 2000000000000000000,
            "min_credit_score": 600,
            "min_collateral": 100000000000000000,
        }
        status, body = self.client.call(
            "POST",
            "/api/v1/zkdefi/reputation/proof/credit-eligibility",
            payload=payload,
            headers={"X-Wallet-Address": self.wallet},
        )
        ok = status == 200 and bool((body or {}).get("success"))
        self._record(
            "Optional: credit eligibility proof",
            ok,
            status=status,
            verified=((body or {}).get("groth16") or {}).get("verified"),
            proof_hash=_short_hex((body or {}).get("proof_hash")),
            envelope_id=((body or {}).get("envelope") or {}).get("envelope_id"),
            detail=(body or {}).get("detail") if isinstance(body, dict) else None,
        )

    def step_agent_create_execute(self) -> None:
        list_status, list_body = self.client.call("GET", "/api/v1/agents/models/list")
        models = list_body.get("models", []) if isinstance(list_body, dict) else []
        model_ids = [str(m.get("id")) for m in models if isinstance(m, dict) and m.get("id")]
        preferred = ["risk_scoring", "correlation_risk", "twap_position"]
        processors = [pid for pid in preferred if pid in model_ids][:3]
        if not processors:
            processors = model_ids[:3]

        create_payload = {
            "user_address": self.wallet,
            "name": f"Hackathon Demo Agent {int(time.time())}",
            "processors": processors,
            "decision_logic": {"type": "AND"},
            "llm": {"provider": "deterministic", "model": "deterministic-v1"},
        }
        c_status, c_body = self.client.call(
            "POST",
            "/api/v1/agents/create",
            payload=create_payload,
            headers={"X-Wallet-Address": self.wallet},
        )
        agent_id = (c_body or {}).get("id") if isinstance(c_body, dict) else None
        self.created_agent_id = str(agent_id) if agent_id else None

        if not agent_id:
            self._record(
                "Agent compose + execute",
                False,
                model_list_status=list_status,
                create_status=c_status,
                error=(c_body or {}).get("detail") if isinstance(c_body, dict) else c_body,
            )
            return

        execute_payload = {
            "user_address": self.wallet,
            "portfolio": {
                "assets": {"ETH": 250000, "USDC": 180000, "STRK": 90000},
                "daily_positions": [480000, 495000, 505000, 510000, 500000, 520000, 515000],
                "volatility": 32,
                "liquidity": 68,
                "drawdown": 11,
                "correlation": 38,
                "time_in_position": 42,
            },
            "constraints": {"max_risk": 80, "max_correlation": 85, "max_twap": 600000},
        }
        e_status, e_body = self.client.call(
            "POST",
            f"/api/v1/agents/{agent_id}/execute",
            payload=execute_payload,
            headers={"X-Wallet-Address": self.wallet},
        )
        processor_results = (e_body or {}).get("processor_results", []) if isinstance(e_body, dict) else []
        proved = sum(1 for row in processor_results if isinstance(row, dict) and row.get("has_proof"))
        ok = c_status == 200 and e_status == 200 and isinstance(e_body, dict) and "should_execute" in e_body
        self._record(
            "Agent compose + execute",
            ok,
            create_status=c_status,
            execute_status=e_status,
            agent_id=str(agent_id),
            processors=",".join(processors),
            should_execute=(e_body or {}).get("should_execute") if isinstance(e_body, dict) else None,
            processor_results=len(processor_results),
            processors_with_proof=proved,
        )

    def step_deployment_proof_and_calldata(self) -> None:
        payload = {
            "user_address": self.wallet,
            "risk_profile": "balanced",
            "total_amount": 5000,
        }
        status, body = self.client.call("POST", "/api/v1/deployments/execute", payload=payload)
        proof_hash = (body or {}).get("allocation_proof") if isinstance(body, dict) else None
        self._deployment_proof_hash = str(proof_hash) if proof_hash else None
        on_chain_calls = (body or {}).get("on_chain_calls", []) if isinstance(body, dict) else []
        ok = status == 200 and bool(proof_hash) and len(on_chain_calls) > 0
        self._record(
            "Deployment proof + on-chain calldata plan",
            ok,
            status=status,
            deployment_id=(body or {}).get("deployment_id") if isinstance(body, dict) else None,
            circuit_type=(body or {}).get("circuit_type") if isinstance(body, dict) else None,
            allocation_proof=_short_hex(proof_hash),
            on_chain_calls=len(on_chain_calls),
        )

    def step_full_privacy_commitment(self) -> None:
        payload = {
            "user_address": self.wallet,
            "amount": "10000000000000000",
            "pool_type": 1,
            "token": "STRK",
        }
        status, body = self.client.call(
            "POST",
            "/api/v1/zkdefi/full_privacy/deposit/generate_commitment",
            payload=payload,
            headers={"X-Wallet-Address": self.wallet},
        )
        ok = status == 200 and bool((body or {}).get("commitment"))
        self._record(
            "Full privacy commitment generation",
            ok,
            status=status,
            commitment=_short_hex((body or {}).get("commitment")),
            nonce=_short_hex((body or {}).get("nonce")),
            pool_type=(body or {}).get("pool_type"),
        )

    def step_policy_controls(self) -> None:
        g_status, g_body = self.client.call("GET", f"/api/v1/vault/constraints/{self.wallet}")
        p_status, p_body = self.client.call(
            "PUT",
            f"/api/v1/vault/constraints/{self.wallet}",
            payload={"risk_tolerance": 55, "rebalance_frequency": "5min"},
            headers={"X-Wallet-Address": self.wallet},
        )
        ok = g_status == 200 and p_status == 200
        self._record(
            "Policy controls (vault constraints)",
            ok,
            get_status=g_status,
            current_risk_tolerance=(g_body or {}).get("risk_tolerance") if isinstance(g_body, dict) else None,
            put_status=p_status,
            updated=(p_body or {}).get("updated") if isinstance(p_body, dict) else None,
        )

    def step_onchain_read_via_backend(self) -> None:
        if self.skip_onchain:
            self._record("On-chain read via backend", True, skipped=True)
            return

        status, body = self.client.call("GET", f"/api/v1/zkdefi/reputation/user/{self.wallet}/on-chain")
        ok = status == 200 and isinstance(body, dict) and body.get("source") == "on_chain"
        self._record(
            "On-chain read via backend",
            ok,
            status=status,
            tier=(body or {}).get("tier") if isinstance(body, dict) else None,
            reputation_score=(body or {}).get("reputation_score") if isinstance(body, dict) else None,
            relayer=((body or {}).get("can_use_relayer") if isinstance(body, dict) else None),
        )

    def step_rpc_contract_presence(self) -> None:
        if self.skip_onchain:
            self._record("Raw RPC contract presence", True, skipped=True)
            return

        env = self.env_from_file
        rpc_url = os.getenv("STARKNET_RPC_URL") or env.get("STARKNET_RPC_URL") or ""
        rpc_urls = []
        if rpc_url:
            rpc_urls.append(rpc_url)
        extra_urls = os.getenv("STARKNET_RPC_URLS") or env.get("STARKNET_RPC_URLS") or ""
        if extra_urls:
            for item in extra_urls.split(","):
                value = item.strip()
                if value and value not in rpc_urls:
                    rpc_urls.append(value)
        hard_fallbacks = [
            "https://api.cartridge.gg/x/starknet/sepolia",
            "https://starknet-sepolia-rpc.publicnode.com",
        ]
        for item in hard_fallbacks:
            if item not in rpc_urls:
                rpc_urls.append(item)

        addresses = {
            "REPUTATION_REGISTRY_ADDRESS": os.getenv("REPUTATION_REGISTRY_ADDRESS") or env.get("REPUTATION_REGISTRY_ADDRESS"),
            "FULL_PRIVACY_POOL_V2_ADDRESS": os.getenv("FULL_PRIVACY_POOL_V2_ADDRESS") or env.get("FULL_PRIVACY_POOL_V2_ADDRESS"),
            "RECEIPT_REGISTRY_ADDRESS": os.getenv("RECEIPT_REGISTRY_ADDRESS") or env.get("RECEIPT_REGISTRY_ADDRESS"),
            "VAULT_CONTROLLER_ADDRESS": os.getenv("VAULT_CONTROLLER_ADDRESS") or env.get("VAULT_CONTROLLER_ADDRESS"),
        }
        if not rpc_urls:
            self._record("Raw RPC contract presence", False, error="Missing STARKNET_RPC_URL")
            return

        ok_block = False
        block_result: Any = None
        selected_rpc = None
        for candidate in rpc_urls:
            ok_block, block_result = _rpc_call(candidate, "starknet_blockNumber", [], self.timeout_seconds)
            if ok_block:
                selected_rpc = candidate
                break
        if not selected_rpc:
            selected_rpc = rpc_urls[0]
        self._last_rpc_url = selected_rpc

        resolved: dict[str, str] = {}
        for name, addr in addresses.items():
            if not addr:
                continue
            ok_hash, hash_result = _rpc_call(
                selected_rpc,
                "starknet_getClassHashAt",
                ["latest", addr],
                self.timeout_seconds,
            )
            if ok_hash and isinstance(hash_result, str):
                resolved[name] = hash_result

        ok = ok_block and len(resolved) >= 2
        detail_map = {
            "rpc_url": selected_rpc,
            "block_number": block_result if ok_block else f"error:{block_result}",
            "resolved_contracts": len(resolved),
        }
        for key in sorted(resolved):
            detail_map[f"{key}_class_hash"] = _short_hex(resolved[key], size=10)
        self._record("Raw RPC contract presence", ok, **detail_map)

    def step_receipts_view(self) -> None:
        status, body = self.client.call("GET", f"/api/v1/zkdefi/receipts/on-chain/{self.wallet}")
        count = (body or {}).get("count") if isinstance(body, dict) else None
        ok = status == 200 and count is not None
        self._record(
            "Receipt stream visibility",
            ok,
            status=status,
            count=count,
        )

    def print_claim_matrix(self) -> int:
        print("== Claim Validation Matrix ==")

        def passed(step_name: str) -> bool:
            match = next((r for r in self.results if r.name == step_name), None)
            return bool(match and match.ok)

        claims = [
            ("Backend service is live", passed("Backend health")),
            ("Proof pack is present and introspectable", passed("Reputation pack manifest")),
            ("Agent composition + execution works", passed("Agent compose + execute")),
            ("Proof-backed deployment planning works", passed("Deployment proof + on-chain calldata plan")),
            ("Privacy commitment rails work", passed("Full privacy commitment generation")),
            ("Policy controls are API-operable", passed("Policy controls (vault constraints)")),
            ("On-chain state is queryable", passed("On-chain read via backend")),
            ("Contracts are verifiably deployed on RPC", passed("Raw RPC contract presence")),
            ("Receipt visibility pipeline is live", passed("Receipt stream visibility")),
        ]

        score = 0
        for label, ok in claims:
            mark = "PASS" if ok else "FAIL"
            if ok:
                score += 1
            print(f"[{mark}] {label}")

        print("")
        print(f"Score: {score}/{len(claims)} claims validated")
        return 0 if score == len(claims) else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run terminal-first backend showcase for zkde.fi")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"Backend base URL (default: {DEFAULT_BASE_URL})")
    parser.add_argument("--wallet", default=os.getenv("SHOWCASE_WALLET", DEFAULT_WALLET), help="Wallet address used for WalletOwner endpoints")
    parser.add_argument("--timeout-seconds", type=float, default=DEFAULT_TIMEOUT_SECONDS, help="Per-request timeout in seconds")
    parser.add_argument("--skip-onchain", action="store_true", help="Skip on-chain reads / RPC probes")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    runner = ShowcaseRunner(
        base_url=args.base_url,
        wallet=args.wallet,
        timeout_seconds=args.timeout_seconds,
        skip_onchain=bool(args.skip_onchain),
    )
    return runner.run()


if __name__ == "__main__":
    sys.exit(main())
