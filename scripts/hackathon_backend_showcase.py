#!/usr/bin/env python3
"""
Hackathon backend showcase runner.

Purpose:
- Demonstrate "UI lagging behind backend" with terminal-first evidence.
- Validate core claims across proofs, agents, privacy rails, and on-chain reads.
- Emit a local HTML + JSON report with Voyager links and deep circuit evidence.

Usage:
  python scripts/hackathon_backend_showcase.py
  python scripts/hackathon_backend_showcase.py --base-url http://127.0.0.1:8003
  python scripts/hackathon_backend_showcase.py --wallet 0xabc... --skip-onchain
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any
from urllib import error, parse, request


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "http://127.0.0.1:8003"
DEFAULT_WALLET = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
DEFAULT_TIMEOUT_SECONDS = 45.0
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "artifacts" / "hackathon_showcase"
ENV_FILE = PROJECT_ROOT / "backend" / ".env"
VOYAGER_SEPOLIA_BASE = "https://sepolia.voyager.online"


def _normalize_address(address: str) -> str:
    raw = str(address or "").strip().lower()
    if not raw:
        return "0x0"
    if not raw.startswith("0x"):
        raw = f"0x{raw}"
    body = raw[2:].lstrip("0")
    return f"0x{body}" if body else "0x0"


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


def _safe_float(raw: Any, default: float = 0.0) -> float:
    try:
        return float(raw)
    except Exception:
        return default


def _safe_int(raw: Any, default: int = 0) -> int:
    try:
        return int(raw)
    except Exception:
        return default


def _voyager_contract_url(address: str | None) -> str | None:
    if not address:
        return None
    return f"{VOYAGER_SEPOLIA_BASE}/contract/{address}"


def _voyager_class_url(class_hash: str | None) -> str | None:
    if not class_hash:
        return None
    return f"{VOYAGER_SEPOLIA_BASE}/class/{class_hash}"


def _voyager_tx_url(tx_hash: str | None) -> str | None:
    if not tx_hash:
        return None
    return f"{VOYAGER_SEPOLIA_BASE}/tx/{tx_hash}"


def _to_iso_utc(ts: float | None = None) -> str:
    if ts is None:
        ts = time.time()
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _relative_to_project(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(PROJECT_ROOT.resolve()))
    except Exception:
        return str(path)


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
            "User-Agent": "zkdefi-hackathon-showcase/2.0",
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
    payload = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": method,
        "params": params,
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url=rpc_url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "zkdefi-hackathon-showcase/2.0",
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
        artifact_dir: Path,
    ):
        self.wallet = _normalize_address(wallet)
        self.client = HttpClient(base_url=base_url, timeout_seconds=timeout_seconds)
        self.timeout_seconds = timeout_seconds
        self.skip_onchain = skip_onchain
        self.artifact_dir = artifact_dir
        self.env_from_file = _load_env_file(ENV_FILE)

        self.results: list[StepResult] = []
        self.claims: list[dict[str, Any]] = []
        self.core_score = 0
        self.core_total = 0

        self.created_agent_id: str | None = None
        self._deployment_proof_hash: str | None = None
        self._last_rpc_url: str | None = None

        self._deployment_output: dict[str, Any] = {}
        self._receipt_rows: list[dict[str, Any]] = []
        self._contract_rows: list[dict[str, Any]] = []
        self._skills_catalog: list[dict[str, Any]] = []
        self._opportunities: list[dict[str, Any]] = []
        self._advisories: list[dict[str, Any]] = []
        self._badge_screening: list[dict[str, Any]] = []
        self._provider_rows: list[dict[str, Any]] = []
        self._agent_models: list[dict[str, Any]] = []
        self._marketplace_models: list[dict[str, Any]] = []
        self._strategy_snapshots: dict[str, Any] = {}
        self._llm_config_packs: list[dict[str, Any]] = []
        self._circuit_inventory: dict[str, Any] = {}

    def _record(self, name: str, ok: bool, **details: Any) -> StepResult:
        res = StepResult(name=name, ok=ok, details=details)
        self.results.append(res)
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name}")
        for key, value in details.items():
            print(f"  - {key}: {value}")
        return res

    def run(self) -> int:
        started_at = time.time()

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
        self.step_circuit_inventory_deep_dive()
        self.step_ai_marketplace_and_badges()

        print("")
        exit_code = self.print_claim_matrix()
        artifacts = self.write_artifacts(started_at=started_at, exit_code=exit_code)

        print("")
        print("Artifacts:")
        print(f"  - JSON: {artifacts['json']}")
        print(f"  - HTML: {artifacts['html']}")
        print(f"  - Latest JSON: {artifacts['latest_json']}")
        print(f"  - Latest HTML: {artifacts['latest_html']}")

        return exit_code

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
        self._skills_catalog = list(skills) if isinstance(skills, list) else []

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
        self._agent_models = list(models) if isinstance(models, list) else []

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
        self._deployment_output = {
            "status": status,
            "deployment_id": (body or {}).get("deployment_id") if isinstance(body, dict) else None,
            "circuit_type": (body or {}).get("circuit_type") if isinstance(body, dict) else None,
            "allocation_proof": proof_hash,
            "on_chain_calls": on_chain_calls,
        }
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

        contract_rows: list[dict[str, Any]] = []
        for name, addr in addresses.items():
            if not addr:
                continue
            norm_addr = _normalize_address(addr)
            class_hash = resolved.get(name)
            contract_rows.append(
                {
                    "name": name,
                    "address": norm_addr,
                    "class_hash": class_hash,
                    "voyager_contract": _voyager_contract_url(norm_addr),
                    "voyager_class": _voyager_class_url(class_hash) if class_hash else None,
                }
            )
        self._contract_rows = contract_rows

        ok = ok_block and len(resolved) >= 2
        detail_map = {
            "rpc_url": selected_rpc,
            "block_number": block_result if ok_block else f"error:{block_result}",
            "resolved_contracts": len(resolved),
            "voyager_links": len(contract_rows),
        }
        for key in sorted(resolved):
            detail_map[f"{key}_class_hash"] = _short_hex(resolved[key], size=10)
        self._record("Raw RPC contract presence", ok, **detail_map)

    def step_receipts_view(self) -> None:
        status, body = self.client.call("GET", f"/api/v1/zkdefi/receipts/on-chain/{self.wallet}")
        receipts = (body or {}).get("receipts", []) if isinstance(body, dict) else []
        count = (body or {}).get("count") if isinstance(body, dict) else None

        tx_rows: list[dict[str, Any]] = []
        for row in receipts:
            if not isinstance(row, dict):
                continue
            tx_hash = row.get("tx_hash")
            if not tx_hash:
                continue
            tx_rows.append(
                {
                    "tx_hash": tx_hash,
                    "action": row.get("action"),
                    "proof_type": row.get("proof_type"),
                    "timestamp": row.get("timestamp"),
                    "voyager_tx": _voyager_tx_url(str(tx_hash)),
                }
            )

        # Deduplicate while preserving order.
        seen: set[str] = set()
        unique_rows: list[dict[str, Any]] = []
        for row in tx_rows:
            tx_hash = str(row.get("tx_hash"))
            if tx_hash in seen:
                continue
            seen.add(tx_hash)
            unique_rows.append(row)
        self._receipt_rows = unique_rows[:20]

        ok = status == 200 and count is not None
        self._record(
            "Receipt stream visibility",
            ok,
            status=status,
            count=count,
            tx_hashes=len(unique_rows),
            first_tx_hash=_short_hex(unique_rows[0]["tx_hash"] if unique_rows else None),
        )

    def _load_scanner_categories(self) -> dict[str, str]:
        scanner = PROJECT_ROOT / "backend" / "app" / "services" / "zkml" / "circuit_scanner.py"
        if not scanner.exists():
            return {}
        text = scanner.read_text(encoding="utf-8")
        pattern = re.compile(r'"([A-Za-z0-9_]+)"\s*:\s*\{(.*?)\}\s*,', re.DOTALL)
        out: dict[str, str] = {}
        for match in pattern.finditer(text):
            name = match.group(1)
            body = match.group(2)
            cat_match = re.search(r'"category"\s*:\s*"([^"]+)"', body)
            if cat_match:
                out[name.lower()] = cat_match.group(1)
        return out

    def _infer_circuit_category(self, stem: str) -> str:
        s = stem.lower()
        if "privacy" in s or "deposit" in s or "withdraw" in s or "pool" in s or "vote" in s:
            return "privacy_or_membership"
        if "risk" in s or "anomaly" in s or "correlation" in s or "yield" in s:
            return "ml_scoring"
        if "strategy" in s or "execution" in s or "rebalance" in s:
            return "strategy_integrity"
        if "bridge" in s or "robustness" in s:
            return "ezkl_or_bridge"
        if "solvency" in s or "passport" in s or "performance" in s or "credit" in s:
            return "reputation"
        return "other"

    def step_circuit_inventory_deep_dive(self) -> None:
        circuits_dir = PROJECT_ROOT / "circuits"
        circom_files = sorted(circuits_dir.glob("*.circom"))

        scanner_categories = self._load_scanner_categories()
        rows: list[dict[str, Any]] = []
        by_category: dict[str, int] = {}

        wasm_ready = 0
        zkey_ready = 0
        dual_ready = 0

        for path in circom_files:
            stem = path.stem
            wasm_candidates = [
                circuits_dir / "build" / f"{stem}_js" / f"{stem}.wasm",
                circuits_dir / f"{stem}_js" / f"{stem}.wasm",
            ]
            zkey_candidates = [
                circuits_dir / "build" / f"{stem}_final.zkey",
                circuits_dir / f"{stem}_final.zkey",
                circuits_dir / f"{stem}_0000.zkey",
            ]

            wasm_path = next((p for p in wasm_candidates if p.exists()), None)
            zkey_path = next((p for p in zkey_candidates if p.exists()), None)

            has_wasm = wasm_path is not None
            has_zkey = zkey_path is not None
            if has_wasm:
                wasm_ready += 1
            if has_zkey:
                zkey_ready += 1
            if has_wasm and has_zkey:
                dual_ready += 1

            category = scanner_categories.get(stem.lower(), self._infer_circuit_category(stem))
            by_category[category] = by_category.get(category, 0) + 1

            rows.append(
                {
                    "name": stem,
                    "source": _relative_to_project(path),
                    "category": category,
                    "wasm": _relative_to_project(wasm_path) if wasm_path else None,
                    "zkey": _relative_to_project(zkey_path) if zkey_path else None,
                    "ready": has_wasm and has_zkey,
                }
            )

        cairo_count = len(list((PROJECT_ROOT / "contracts" / "src").rglob("*.cairo")))
        onnx_count = len(list(PROJECT_ROOT.rglob("*.onnx")))
        groth16_zkeys_total = len(list((PROJECT_ROOT / "circuits").rglob("*_final.zkey")))

        self._circuit_inventory = {
            "circom_sources": len(circom_files),
            "circuits_with_wasm": wasm_ready,
            "circuits_with_zkey": zkey_ready,
            "circuits_ready_dual_artifacts": dual_ready,
            "categories": dict(sorted(by_category.items())),
            "rows": rows,
            "cairo_contract_sources": cairo_count,
            "onnx_models": onnx_count,
            "groth16_final_zkeys_total": groth16_zkeys_total,
        }

        ok = len(circom_files) >= 20
        self._record(
            "Local zkML circuit inventory (20+ deep dive)",
            ok,
            circom_sources=len(circom_files),
            circuits_with_wasm=wasm_ready,
            circuits_with_zkey=zkey_ready,
            dual_ready=dual_ready,
            cairo_contracts=cairo_count,
            onnx_models=onnx_count,
            categories=len(by_category),
        )

    def _risk_level_from_score(self, score: float) -> str:
        if score <= 35:
            return "low"
        if score <= 65:
            return "medium"
        return "high"

    def _normalize_opportunities(self, raw: Any) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        out: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            out.append(
                {
                    "id": item.get("id") or item.get("opportunity_id") or item.get("pool_id"),
                    "title": item.get("title") or item.get("name") or item.get("pair") or "opportunity",
                    "pair": item.get("pair"),
                    "type": item.get("type") or item.get("kind"),
                    "yield_pct": _safe_float(item.get("currentYield", item.get("current_yield", 0.0))),
                    "risk_score": _safe_float(item.get("riskScore", item.get("risk_score", 0.0))),
                    "privacy_level": item.get("privacyLevel", item.get("privacy_level")),
                    "raw": item,
                }
            )
        return out

    def _build_llm_config_packs(self) -> list[dict[str, Any]]:
        providers = self._provider_rows if isinstance(self._provider_rows, list) else []
        provider_ids = {str(p.get("provider_id")): p for p in providers if isinstance(p, dict)}

        def _pick_provider(preferred: list[str], fallback: str = "deterministic") -> str:
            for pid in preferred:
                if pid in provider_ids:
                    return pid
            return fallback if fallback in provider_ids else (next(iter(provider_ids.keys()), "deterministic"))

        def _pick_model(provider_id: str) -> str:
            provider = provider_ids.get(provider_id) or {}
            default_model = provider.get("default_model")
            if default_model:
                return str(default_model)
            models = provider.get("models")
            if isinstance(models, list) and models:
                return str(models[0])
            return "deterministic-v1"

        skill_ids = [str(s.get("skill_id")) for s in self._skills_catalog if isinstance(s, dict) and s.get("skill_id")]

        conservative_skills = [
            sid
            for sid in [
                "risk_score",
                "anomaly_detection",
                "execution_integrity",
                "solvency_proof",
                "risk_passport",
            ]
            if sid in skill_ids
        ]
        balanced_skills = [
            sid
            for sid in [
                "risk_score",
                "anomaly_detection",
                "yield_optimality",
                "strategy_integrity",
                "execution_integrity",
            ]
            if sid in skill_ids
        ]
        aggressive_skills = [
            sid
            for sid in [
                "yield_optimality",
                "strategy_integrity",
                "arb_check",
                "mev_protection",
                "liquidation_check",
            ]
            if sid in skill_ids
        ]

        if not conservative_skills:
            conservative_skills = skill_ids[:4]
        if not balanced_skills:
            balanced_skills = skill_ids[:5]
        if not aggressive_skills:
            aggressive_skills = skill_ids[:5]

        processor_ids = [str(m.get("id")) for m in self._agent_models if isinstance(m, dict) and m.get("id")]
        processors_default = processor_ids[:3]
        marketplace_model_ids = [str(m.get("id")) for m in self._marketplace_models if isinstance(m, dict) and m.get("id")]

        packs = []
        for profile, p_preference, skills in [
            ("conservative", ["deterministic", "openai", "anthropic"], conservative_skills),
            ("balanced", ["openai", "anthropic", "deterministic"], balanced_skills),
            ("aggressive", ["anthropic", "openai", "deterministic"], aggressive_skills),
        ]:
            provider_id = _pick_provider(p_preference)
            packs.append(
                {
                    "profile": profile,
                    "llm": {
                        "provider": provider_id,
                        "model": _pick_model(provider_id),
                        "temperature": 0.15 if profile == "conservative" else (0.25 if profile == "balanced" else 0.35),
                        "max_tokens": 1200,
                    },
                    "agent": {
                        "processors": processors_default,
                        "decision_logic": {"type": "AND" if profile != "aggressive" else "WEIGHTED"},
                    },
                    "zk_skill_set": skills,
                    "advisory_endpoints": {
                        "opportunities": "/api/v1/zkdefi/trade-desk/v2/opportunities",
                        "ai_advisory": "/api/v1/zkdefi/trade-desk/v2/ai/advisory/{opp_id}",
                        "badge_screen": "/api/v1/zkdefi/skills/screen/opportunity",
                        "recommend": "/api/v2/strategies/recommend",
                    },
                    "marketplace_models": marketplace_model_ids,
                }
            )

        return packs

    def step_ai_marketplace_and_badges(self) -> None:
        provider_status, provider_body = self.client.call("GET", "/api/v1/agents/providers")
        model_status, model_body = self.client.call("GET", "/api/v1/agents/models/list")
        market_status, market_body = self.client.call(
            "GET",
            "/api/v1/agents/marketplace/models/search?status=active&limit=12",
        )

        providers = provider_body.get("providers", []) if isinstance(provider_body, dict) else []
        models = model_body.get("models", []) if isinstance(model_body, dict) else []
        marketplace_models = market_body.get("models", []) if isinstance(market_body, dict) else []

        self._provider_rows = list(providers) if isinstance(providers, list) else []
        self._agent_models = list(models) if isinstance(models, list) else self._agent_models
        self._marketplace_models = list(marketplace_models) if isinstance(marketplace_models, list) else []

        opp_path = (
            "/api/v1/zkdefi/trade-desk/v2/opportunities?"
            + parse.urlencode({"limit": 8, "user_address": self.wallet})
        )
        opp_status, opp_body = self.client.call("GET", opp_path)
        opportunities = []
        if isinstance(opp_body, dict):
            opportunities = self._normalize_opportunities(opp_body.get("opportunities", []))

        # Fallback to legacy route if the v2 route is unavailable.
        if (opp_status != 200 or not opportunities):
            legacy_status, legacy_body = self.client.call("GET", "/api/v1/zkdefi/opportunities/list")
            if legacy_status == 200 and isinstance(legacy_body, dict):
                legacy_rows = self._normalize_opportunities(legacy_body.get("opportunities", []))
                if legacy_rows:
                    opp_status = legacy_status
                    opportunities = legacy_rows

        opportunities = [o for o in opportunities if o.get("id")][:6]
        self._opportunities = opportunities

        advisories: list[dict[str, Any]] = []
        screenings: list[dict[str, Any]] = []

        for opp in opportunities[:4]:
            opp_id = str(opp.get("id"))
            advisory_path = (
                f"/api/v1/zkdefi/trade-desk/v2/ai/advisory/{opp_id}?"
                + parse.urlencode({"user_address": self.wallet})
            )
            a_status, a_body = self.client.call("GET", advisory_path)
            advisories.append(
                {
                    "opp_id": opp_id,
                    "status": a_status,
                    "recommendation": (a_body or {}).get("recommendation") if isinstance(a_body, dict) else None,
                    "confidence": (a_body or {}).get("confidence") if isinstance(a_body, dict) else None,
                    "narrative": (a_body or {}).get("narrative") if isinstance(a_body, dict) else None,
                    "detail": (a_body or {}).get("detail") if isinstance(a_body, dict) else None,
                }
            )

            apy_bps = int(max(0, min(500000, round(_safe_float(opp.get("yield_pct"), 0.0) * 100))))
            screen_payload = {
                "pool_id": opp_id,
                "apy_bps": apy_bps,
                "risk_level": self._risk_level_from_score(_safe_float(opp.get("risk_score"), 50.0)),
                "user_address": self.wallet,
            }
            s_status, s_body = self.client.call("POST", "/api/v1/zkdefi/skills/screen/opportunity", payload=screen_payload)

            proof_hashes = (s_body or {}).get("proof_hashes", {}) if isinstance(s_body, dict) else {}
            screenings.append(
                {
                    "opp_id": opp_id,
                    "status": s_status,
                    "proof_status": (s_body or {}).get("proof_status") if isinstance(s_body, dict) else None,
                    "is_proved": (s_body or {}).get("is_proved") if isinstance(s_body, dict) else None,
                    "yield_proof_hash": proof_hashes.get("yield_optimality") if isinstance(proof_hashes, dict) else None,
                    "strategy_proof_hash": proof_hashes.get("strategy_integrity") if isinstance(proof_hashes, dict) else None,
                    "yield_error": (((s_body or {}).get("yield_result") or {}).get("error") if isinstance(s_body, dict) else None),
                    "integrity_error": (((s_body or {}).get("integrity_result") or {}).get("error") if isinstance(s_body, dict) else None),
                }
            )

        self._advisories = advisories
        self._badge_screening = screenings

        r_status, r_body = self.client.call(
            "POST",
            "/api/v2/strategies/recommend",
            payload={
                "user_address": self.wallet,
                "risk_profile": "balanced",
                "amount": 5000,
            },
        )
        a_status, a_body = self.client.call(
            "POST",
            "/api/v2/strategies/analyze",
            payload={
                "user_address": self.wallet,
                "risk_profile": "BALANCED",
                "deposit_amount": 1000000000,
            },
        )
        self._strategy_snapshots = {
            "recommend_status": r_status,
            "recommend": r_body if isinstance(r_body, dict) else {"raw": r_body},
            "analyze_status": a_status,
            "analyze": a_body if isinstance(a_body, dict) else {"raw": a_body},
        }

        if not self._skills_catalog:
            s_status, s_body = self.client.call("GET", "/api/v1/zkdefi/skills/")
            if s_status == 200 and isinstance(s_body, dict) and isinstance(s_body.get("skills"), list):
                self._skills_catalog = list(s_body.get("skills") or [])

        self._llm_config_packs = self._build_llm_config_packs()

        advisory_hits = sum(1 for row in advisories if row.get("status") == 200)
        screening_calls = sum(1 for row in screenings if row.get("status") == 200)
        proved_count = sum(1 for row in screenings if bool(row.get("is_proved")))

        ok = (
            provider_status == 200
            and model_status == 200
            and market_status == 200
            and opp_status == 200
            and len(opportunities) > 0
            and r_status == 200
        )
        self._record(
            "AI market advisory + strategy badge flow",
            ok,
            providers=len(providers),
            agent_models=len(models),
            marketplace_models=len(marketplace_models),
            opportunities=len(opportunities),
            advisory_calls=advisory_hits,
            screening_calls=screening_calls,
            proved_badges=proved_count,
            recommend_status=r_status,
            analyze_status=a_status,
            config_profiles=len(self._llm_config_packs),
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

        self.claims = []
        score = 0
        for label, ok in claims:
            mark = "PASS" if ok else "FAIL"
            if ok:
                score += 1
            self.claims.append({"label": label, "ok": ok})
            print(f"[{mark}] {label}")

        self.core_score = score
        self.core_total = len(claims)

        print("")
        print(f"Score: {score}/{len(claims)} claims validated")
        return 0 if score == len(claims) else 1

    def _report_payload(self, started_at: float, exit_code: int) -> dict[str, Any]:
        return {
            "generated_at": _to_iso_utc(),
            "started_at": _to_iso_utc(started_at),
            "base_url": self.client.base_url,
            "wallet": self.wallet,
            "exit_code": exit_code,
            "core_claims": self.claims,
            "core_score": {
                "validated": self.core_score,
                "total": self.core_total,
            },
            "steps": [
                {
                    "name": r.name,
                    "ok": r.ok,
                    "details": r.details,
                }
                for r in self.results
            ],
            "onchain": {
                "rpc_url": self._last_rpc_url,
                "contracts": self._contract_rows,
                "receipts": self._receipt_rows,
            },
            "deployment": self._deployment_output,
            "circuit_inventory": self._circuit_inventory,
            "ai_showcase": {
                "providers": self._provider_rows,
                "agent_models": self._agent_models,
                "marketplace_models": self._marketplace_models,
                "opportunities": self._opportunities,
                "advisories": self._advisories,
                "badge_screening": self._badge_screening,
                "strategies": self._strategy_snapshots,
                "skills_catalog_count": len(self._skills_catalog),
                "llm_config_packs": self._llm_config_packs,
            },
        }

    def _html_table(self, headers: list[str], rows: list[list[str]]) -> str:
        if not rows:
            return "<p class=\"muted\">No rows.</p>"
        thead = "".join(f"<th>{escape(h)}</th>" for h in headers)
        body_rows = []
        for row in rows:
            cols = "".join(f"<td>{col}</td>" for col in row)
            body_rows.append(f"<tr>{cols}</tr>")
        tbody = "\n".join(body_rows)
        return f"<table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>"

    def _render_html_report(self, payload: dict[str, Any]) -> str:
        claims = payload.get("core_claims", [])
        claim_rows = [
            [
                escape(str(c.get("label"))),
                "<span class=\"pass\">PASS</span>" if c.get("ok") else "<span class=\"fail\">FAIL</span>",
            ]
            for c in claims
            if isinstance(c, dict)
        ]

        step_rows = []
        for step in payload.get("steps", []):
            if not isinstance(step, dict):
                continue
            details = step.get("details") if isinstance(step.get("details"), dict) else {}
            compact = ", ".join(f"{k}={details[k]}" for k in list(details.keys())[:6])
            step_rows.append(
                [
                    escape(str(step.get("name"))),
                    "<span class=\"pass\">PASS</span>" if step.get("ok") else "<span class=\"fail\">FAIL</span>",
                    escape(compact),
                ]
            )

        contract_rows = []
        for row in (payload.get("onchain", {}) or {}).get("contracts", []):
            if not isinstance(row, dict):
                continue
            address = str(row.get("address") or "-")
            class_hash = str(row.get("class_hash") or "-")
            contract_link = row.get("voyager_contract")
            class_link = row.get("voyager_class")
            address_html = (
                f"<a href=\"{escape(str(contract_link))}\" target=\"_blank\" rel=\"noreferrer\">{escape(_short_hex(address, 14))}</a>"
                if contract_link
                else escape(_short_hex(address, 14))
            )
            class_html = (
                f"<a href=\"{escape(str(class_link))}\" target=\"_blank\" rel=\"noreferrer\">{escape(_short_hex(class_hash, 14))}</a>"
                if class_link and class_hash != "-"
                else escape(_short_hex(class_hash, 14))
            )
            contract_rows.append([escape(str(row.get("name") or "-")), address_html, class_html])

        receipt_rows = []
        for row in (payload.get("onchain", {}) or {}).get("receipts", []):
            if not isinstance(row, dict):
                continue
            tx_hash = str(row.get("tx_hash") or "-")
            tx_link = row.get("voyager_tx")
            tx_html = (
                f"<a href=\"{escape(str(tx_link))}\" target=\"_blank\" rel=\"noreferrer\">{escape(_short_hex(tx_hash, 16))}</a>"
                if tx_link
                else escape(_short_hex(tx_hash, 16))
            )
            receipt_rows.append(
                [
                    tx_html,
                    escape(str(row.get("action") or "-")),
                    escape(str(row.get("proof_type") or "-")),
                    escape(str(row.get("timestamp") or "-")),
                ]
            )

        inventory = payload.get("circuit_inventory", {}) if isinstance(payload.get("circuit_inventory"), dict) else {}
        category_rows = []
        for k, v in (inventory.get("categories") or {}).items():
            category_rows.append([escape(str(k)), escape(str(v))])

        circuit_rows = []
        for row in (inventory.get("rows") or [])[:40]:
            if not isinstance(row, dict):
                continue
            circuit_rows.append(
                [
                    escape(str(row.get("name") or "-")),
                    escape(str(row.get("category") or "-")),
                    "<span class=\"pass\">ready</span>" if row.get("ready") else "<span class=\"fail\">missing</span>",
                    escape(str(row.get("wasm") or "-")),
                    escape(str(row.get("zkey") or "-")),
                ]
            )

        ai = payload.get("ai_showcase", {}) if isinstance(payload.get("ai_showcase"), dict) else {}
        opportunity_rows = []
        for row in (ai.get("opportunities") or [])[:8]:
            if not isinstance(row, dict):
                continue
            opportunity_rows.append(
                [
                    escape(str(row.get("id") or "-")),
                    escape(str(row.get("title") or "-")),
                    escape(str(row.get("pair") or "-")),
                    escape(str(row.get("type") or "-")),
                    escape(f"{_safe_float(row.get('yield_pct')):.2f}"),
                    escape(f"{_safe_float(row.get('risk_score')):.1f}"),
                ]
            )

        advisory_rows = []
        for row in (ai.get("advisories") or [])[:8]:
            if not isinstance(row, dict):
                continue
            advisory_rows.append(
                [
                    escape(str(row.get("opp_id") or "-")),
                    escape(str(row.get("recommendation") or "-")),
                    escape(str(row.get("confidence") or "-")),
                    escape(str(row.get("status") or "-")),
                ]
            )

        badge_rows = []
        for row in (ai.get("badge_screening") or [])[:8]:
            if not isinstance(row, dict):
                continue
            badge_rows.append(
                [
                    escape(str(row.get("opp_id") or "-")),
                    escape(str(row.get("proof_status") or "-")),
                    "<span class=\"pass\">true</span>" if row.get("is_proved") else "<span class=\"fail\">false</span>",
                    escape(_short_hex(str(row.get("yield_proof_hash") or "-"), 10)),
                    escape(_short_hex(str(row.get("strategy_proof_hash") or "-"), 10)),
                    escape(str(row.get("yield_error") or row.get("integrity_error") or ""))[:180],
                ]
            )

        packs_html = []
        for pack in ai.get("llm_config_packs", []):
            if not isinstance(pack, dict):
                continue
            packs_html.append(
                "<details>"
                f"<summary>{escape(str(pack.get('profile', 'profile')))} config</summary>"
                f"<pre>{escape(json.dumps(pack, indent=2))}</pre>"
                "</details>"
            )
        packs_block = "\n".join(packs_html) if packs_html else "<p class=\"muted\">No config packs generated.</p>"

        recommend_block = escape(json.dumps(((ai.get("strategies") or {}).get("recommend") or {}), indent=2))
        analyze_block = escape(json.dumps(((ai.get("strategies") or {}).get("analyze") or {}), indent=2))

        html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>zkde.fi Hackathon Backend Showcase</title>
  <style>
    :root {{
      --bg: #0d1321;
      --panel: #161f35;
      --panel-alt: #11192b;
      --text: #f4f7ff;
      --muted: #9fb2d4;
      --good: #4ade80;
      --bad: #f97316;
      --line: #2b3a5d;
      --link: #60a5fa;
    }}
    body {{
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: radial-gradient(circle at top right, #1f355f 0%, var(--bg) 45%);
      color: var(--text);
      line-height: 1.45;
    }}
    main {{
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 18px 48px;
    }}
    h1, h2 {{
      margin: 0 0 12px;
      font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      letter-spacing: 0.3px;
    }}
    h1 {{ font-size: 28px; }}
    h2 {{ font-size: 20px; margin-top: 28px; }}
    p {{ margin: 8px 0; }}
    .meta {{ color: var(--muted); font-size: 14px; }}
    .score {{
      display: inline-block;
      margin-top: 10px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.03);
      font-weight: 700;
    }}
    section {{
      margin-top: 16px;
      background: linear-gradient(180deg, var(--panel), var(--panel-alt));
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.18);
    }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
    th, td {{
      text-align: left;
      padding: 8px 9px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      font-size: 13px;
    }}
    th {{ color: var(--muted); font-weight: 600; }}
    a {{ color: var(--link); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .pass {{ color: var(--good); font-weight: 700; }}
    .fail {{ color: var(--bad); font-weight: 700; }}
    .muted {{ color: var(--muted); }}
    pre {{
      margin: 8px 0 0;
      padding: 10px;
      background: #0a1222;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
    }}
    details {{ margin-top: 8px; }}
    summary {{ cursor: pointer; color: var(--link); }}
    @media (max-width: 700px) {{
      h1 {{ font-size: 22px; }}
      h2 {{ font-size: 18px; }}
      th, td {{ font-size: 12px; padding: 7px 6px; }}
    }}
  </style>
</head>
<body>
  <main>
    <h1>zkde.fi Backend Showcase Report</h1>
    <p class="meta">Generated: {escape(str(payload.get('generated_at')))} UTC</p>
    <p class="meta">Base URL: {escape(str(payload.get('base_url')))} | Wallet: {escape(str(payload.get('wallet')))}</p>
    <p class="score">Core claims: {escape(str((payload.get('core_score') or {}).get('validated', 0)))} / {escape(str((payload.get('core_score') or {}).get('total', 0)))} validated</p>

    <section>
      <h2>Core Claim Matrix</h2>
      {self._html_table(["Claim", "Status"], claim_rows)}
    </section>

    <section>
      <h2>Execution Steps</h2>
      {self._html_table(["Step", "Status", "Highlights"], step_rows)}
    </section>

    <section>
      <h2>On-chain Links (Voyager)</h2>
      <p class="meta">RPC used: {escape(str((payload.get('onchain') or {}).get('rpc_url') or '-'))}</p>
      {self._html_table(["Contract", "Address", "Class Hash"], contract_rows)}
      <h3>Receipts / Tx Links</h3>
      {self._html_table(["Tx", "Action", "Proof Type", "Timestamp"], receipt_rows)}
    </section>

    <section>
      <h2>zkML Circuit Deep Dive</h2>
      <p class="meta">
        Circom sources: {escape(str(inventory.get('circom_sources', 0)))} |
        wasm ready: {escape(str(inventory.get('circuits_with_wasm', 0)))} |
        zkey ready: {escape(str(inventory.get('circuits_with_zkey', 0)))} |
        dual-ready: {escape(str(inventory.get('circuits_ready_dual_artifacts', 0)))}
      </p>
      <p class="meta">
        Cairo contract sources: {escape(str(inventory.get('cairo_contract_sources', 0)))} |
        Groth16 final zkeys (repo-wide): {escape(str(inventory.get('groth16_final_zkeys_total', 0)))} |
        ONNX models: {escape(str(inventory.get('onnx_models', 0)))}
      </p>
      {self._html_table(["Category", "Count"], category_rows)}
      <h3>Circuit Inventory (first 40)</h3>
      {self._html_table(["Circuit", "Category", "Ready", "WASM", "ZKEY"], circuit_rows)}
    </section>

    <section>
      <h2>Opportunity Advisory + Badge Flow</h2>
      {self._html_table(["Opp ID", "Title", "Pair", "Type", "Yield %", "Risk"], opportunity_rows)}
      <h3>AI Advisory Snapshot</h3>
      {self._html_table(["Opp ID", "Recommendation", "Confidence", "Status"], advisory_rows)}
      <h3>Badge Circuit Screening Snapshot</h3>
      {self._html_table(["Opp ID", "Proof Status", "is_proved", "Yield Proof", "Strategy Proof", "Error"], badge_rows)}
    </section>

    <section>
      <h2>LLM + Marketplace Config Packs</h2>
      <p class="meta">Profiles generated from live providers/models/skills and marketplace model registry.</p>
      {packs_block}
    </section>

    <section>
      <h2>Strategy API Evidence</h2>
      <p class="meta">`/api/v2/strategies/recommend`</p>
      <pre>{recommend_block}</pre>
      <p class="meta">`/api/v2/strategies/analyze`</p>
      <pre>{analyze_block}</pre>
    </section>
  </main>
</body>
</html>
"""
        return html

    def write_artifacts(self, started_at: float, exit_code: int) -> dict[str, str]:
        payload = self._report_payload(started_at=started_at, exit_code=exit_code)

        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

        json_path = self.artifact_dir / f"showcase-{stamp}.json"
        html_path = self.artifact_dir / f"showcase-{stamp}.html"
        latest_json = self.artifact_dir / "latest.json"
        latest_html = self.artifact_dir / "latest.html"

        json_blob = json.dumps(payload, indent=2, sort_keys=True)
        html_blob = self._render_html_report(payload)

        json_path.write_text(json_blob, encoding="utf-8")
        html_path.write_text(html_blob, encoding="utf-8")
        latest_json.write_text(json_blob, encoding="utf-8")
        latest_html.write_text(html_blob, encoding="utf-8")

        return {
            "json": str(json_path.resolve()),
            "html": str(html_path.resolve()),
            "latest_json": str(latest_json.resolve()),
            "latest_html": str(latest_html.resolve()),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run terminal-first backend showcase for zkde.fi")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"Backend base URL (default: {DEFAULT_BASE_URL})")
    parser.add_argument("--wallet", default=os.getenv("SHOWCASE_WALLET", DEFAULT_WALLET), help="Wallet address used for WalletOwner endpoints")
    parser.add_argument("--timeout-seconds", type=float, default=DEFAULT_TIMEOUT_SECONDS, help="Per-request timeout in seconds")
    parser.add_argument("--skip-onchain", action="store_true", help="Skip on-chain reads / RPC probes")
    parser.add_argument(
        "--artifact-dir",
        default=str(DEFAULT_ARTIFACT_DIR),
        help=f"Directory for JSON/HTML report artifacts (default: {DEFAULT_ARTIFACT_DIR})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    runner = ShowcaseRunner(
        base_url=args.base_url,
        wallet=args.wallet,
        timeout_seconds=args.timeout_seconds,
        skip_onchain=bool(args.skip_onchain),
        artifact_dir=Path(args.artifact_dir),
    )
    return runner.run()


if __name__ == "__main__":
    sys.exit(main())
