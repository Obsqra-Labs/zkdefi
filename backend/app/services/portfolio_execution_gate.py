"""
Mainnet-v1 execution gate service for the clean `/portfolio` flow.

This service is intentionally additive. It does not replace the legacy rebalancer
or `/agent` stack; it provides a stable gate contract for swap/rebalance checks,
receipt persistence, recommendation scaffolding, and optional execution previews.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from app.services.ekubo_config import (
    EKUBO_MAINNET_CHAIN_ID,
    SEPOLIA_ETH,
    SEPOLIA_STRK,
    SEPOLIA_USDC,
    get_ekubo_chain_id,
)
from app.services.avnu_execution_service import build_avnu_swap_execution
from app.services.ekubo_execution_service import build_swap_calldata, submit_swap
from app.services.portfolio_monitor_service import get_portfolio_monitor_service
from app.services.execution_policy_service import get_execution_policy_service
from app.services.position_scanner import PortfolioSnapshot, scan_portfolio
from app.services.receipt_service import get_receipt_service
from app.services.session_key_service import get_session_key_service
from app.services.vault_policy_service import get_vault_policy_service
from app.services.zkml.circuit_scanner import (
    build_agent_reputation_inputs,
    build_anomaly_detector_inputs,
    build_correlation_risk_inputs,
    build_execution_integrity_inputs,
    build_historical_performance_inputs,
    build_il_predictor_inputs,
    build_liquidation_risk_inputs,
    build_mev_resistance_inputs,
    build_risk_score_inputs,
    build_safety_diversification_inputs,
    build_slippage_bound_inputs,
    build_yield_optimality_inputs,
    build_cross_protocol_arb_inputs,
    run_circuit_scan,
)

logger = logging.getLogger(__name__)

SUPPORTED_ASSETS = ("ETH", "STRK", "USDC")
ASSET_PRICES_USD = {
    "ETH": 3200.0,
    "STRK": 0.72,
    "USDC": 1.0,
}
ASSET_DECIMALS = {
    "ETH": 18,
    "STRK": 18,
    "USDC": 6,
}
SEPOLIA_TOKEN_BY_SYMBOL = {
    "ETH": SEPOLIA_ETH,
    "STRK": SEPOLIA_STRK,
    "USDC": SEPOLIA_USDC,
}
MAINNET_TOKEN_BY_SYMBOL = {
    "ETH": "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    "STRK": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    "USDC": "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
}
NETWORK_MAINNET = "starknet_mainnet"
NETWORK_SEPOLIA = "starknet_sepolia"
MAINNET_STRK_GAS_RESERVE = max(0.0, float(os.getenv("PORTFOLIO_MAINNET_STRK_GAS_RESERVE", "0.35")))

MAINNET_V1_CIRCUITS = [
    "RiskScore",
    "AnomalyDetector",
    "CorrelationRisk",
    "SafetyDiversification",
    "ImpermanentLossPredictor",
    "YieldOptimality",
    "SlippageBound",
    "AgentReputationScore",
    "CrossProtocolArbitrage",
    "LiquidationRisk",
    "HistoricalPerformanceAttestation",
    "MEVResistanceProof",
    "ExecutionIntegrity",
]

WARN_FEE_SHARE_OF_ACTION = max(0.0, float(os.getenv("PORTFOLIO_WARN_FEE_SHARE_OF_ACTION", "0.35")))
BLOCK_FEE_SHARE_OF_ACTION = max(WARN_FEE_SHARE_OF_ACTION, float(os.getenv("PORTFOLIO_BLOCK_FEE_SHARE_OF_ACTION", "0.85")))
MIN_SWAP_VALUE_USD = max(0.0, float(os.getenv("PORTFOLIO_MIN_SWAP_VALUE_USD", "0.75")))
MIN_REBALANCE_VALUE_USD = max(0.0, float(os.getenv("PORTFOLIO_MIN_REBALANCE_VALUE_USD", "0.5")))
MIN_MULTI_SWAP_REBALANCE_VALUE_USD = max(0.0, float(os.getenv("PORTFOLIO_MIN_MULTI_SWAP_REBALANCE_VALUE_USD", "1.0")))
SMALL_PORTFOLIO_GRACE_USD = max(0.0, float(os.getenv("PORTFOLIO_SMALL_PORTFOLIO_GRACE_USD", "25.0")))
SMALL_PORTFOLIO_MIN_ACTION_USD = max(0.0, float(os.getenv("PORTFOLIO_SMALL_PORTFOLIO_MIN_ACTION_USD", "0.5")))
SMALL_PORTFOLIO_SINGLE_STEP_USD = max(0.0, float(os.getenv("PORTFOLIO_SMALL_PORTFOLIO_SINGLE_STEP_USD", "15.0")))
SMALL_PORTFOLIO_GRACE_MAX_FEE_SHARE = max(
    0.0,
    float(os.getenv("PORTFOLIO_SMALL_PORTFOLIO_GRACE_MAX_FEE_SHARE", "0.5")),
)
SMALL_PORTFOLIO_SINGLE_STEP_MAX_FEE_SHARE = max(
    SMALL_PORTFOLIO_GRACE_MAX_FEE_SHARE,
    float(os.getenv("PORTFOLIO_SMALL_PORTFOLIO_SINGLE_STEP_MAX_FEE_SHARE", "1.0")),
)
ESTIMATED_USD_PER_GAS_UNIT = max(0.0, float(os.getenv("PORTFOLIO_ESTIMATED_USD_PER_GAS_UNIT", "0.00000012")))
ESTIMATED_BASE_GAS_UNITS = max(0, int(os.getenv("PORTFOLIO_ESTIMATED_BASE_GAS_UNITS", "500000")))
ESTIMATED_WALLET_CALL_GAS_UNITS = max(0, int(os.getenv("PORTFOLIO_ESTIMATED_WALLET_CALL_GAS_UNITS", "2000000")))
EXECUTION_PREP_CACHE_TTL_SECONDS = max(0, int(os.getenv("PORTFOLIO_EXECUTION_PREP_CACHE_TTL_SECONDS", "30")))

DEFAULT_POLICY = {
    "policy_version": "mainnet_v1",
    "allowed_assets": list(SUPPORTED_ASSETS),
    "allowed_adapters": ["best", "ekubo", "avnu"],
    "max_value_per_action_usd": 25_000.0,
    "max_slippage_bps": 150,
    "cooldown_seconds": 300,
    "max_swaps_per_rebalance": 3,
    "paused": False,
    "min_amounts": {
        "ETH": 0.00001,
        "STRK": 0.1,
        "USDC": 1.0,
    },
}


def _canonical_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return "0x" + hashlib.sha256(encoded).hexdigest()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_address(address: str) -> str:
    return (address or "").strip().lower()


def _json_log(event: str, **payload: Any) -> None:
    try:
        logger.info("%s %s", event, json.dumps(payload, sort_keys=True, default=str))
    except Exception:
        logger.info("%s %s", event, payload)


def _normalize_asset(symbol: str | None) -> str | None:
    if symbol is None:
        return None
    asset = str(symbol).strip().upper()
    return asset or None


def _to_address_int(address: str) -> int:
    value = (address or "").strip()
    if not value:
        return 0
    try:
        return int(value, 16) if value.startswith("0x") else int(value)
    except ValueError:
        return 0


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class PortfolioExecutionGateService:
    """Stable gate surface for swap/rebalance actions on the `/portfolio` route."""

    def __init__(self) -> None:
        self.receipt_service = get_receipt_service()
        self.execution_policy_service = get_execution_policy_service()
        self.session_key_service = get_session_key_service()
        self.monitor_service = get_portfolio_monitor_service()
        self._execution_prep_cache: dict[str, dict[str, Any]] = {}

    async def get_policy_snapshot(
        self,
        owner_address: str,
        override: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized = _normalize_address(owner_address)
        execution_policy = self.execution_policy_service.get_policy(normalized).data
        exec_rules = execution_policy.get("executionRules", {})
        snapshot = {
            **DEFAULT_POLICY,
            "address": normalized,
            "min_reputation_score": execution_policy.get("gateRules", {}).get("minReputationScore", 0),
            "max_risk_score": execution_policy.get("gateRules", {}).get("maxRiskScore", 80),
            "require_circuit_verified": execution_policy.get("gateRules", {}).get("requireCircuitVerified", False),
            "paused": not bool(execution_policy.get("isActive", True)),
            "max_value_per_action_usd": min(
                DEFAULT_POLICY["max_value_per_action_usd"],
                _safe_float(exec_rules.get("dailyLimitUSD"), DEFAULT_POLICY["max_value_per_action_usd"]),
            ),
            "cooldown_seconds": _safe_int(exec_rules.get("cooldownSeconds"), DEFAULT_POLICY["cooldown_seconds"]),
            "max_slippage_bps": _safe_int(exec_rules.get("maxSlippageBps"), DEFAULT_POLICY["max_slippage_bps"]),
            "max_swaps_per_rebalance": _safe_int(
                exec_rules.get("maxSwapsPerRebalance"),
                DEFAULT_POLICY["max_swaps_per_rebalance"],
            ),
            "min_amounts": exec_rules.get("minAmounts") or DEFAULT_POLICY["min_amounts"],
        }
        if override:
            snapshot.update({k: v for k, v in override.items() if v is not None})
        snapshot["policy_hash"] = _canonical_hash(snapshot)
        return snapshot

    async def get_gate_receipts(self, owner_address: str) -> list[dict[str, Any]]:
        receipts = await self.receipt_service.get_user_receipts(_normalize_address(owner_address))
        items: list[dict[str, Any]] = []
        for receipt in receipts:
            metadata = receipt.get("metadata")
            if not isinstance(metadata, dict):
                continue
            if metadata.get("source") != "execution_gate_v1":
                continue
            refreshed = await self._refresh_receipt_tx_status(receipt, metadata)
            items.append(refreshed)
        return items

    async def get_telemetry_summary(self, owner_address: str) -> dict[str, Any]:
        receipts = await self.get_gate_receipts(owner_address)
        recent = receipts[:25]
        status_counts: dict[str, int] = {}
        failure_buckets: dict[str, int] = {}
        submitted = 0
        confirmed = 0
        recent_failures: list[dict[str, Any]] = []
        in_flight: list[dict[str, Any]] = []

        for receipt in recent:
            metadata = receipt.get("metadata") if isinstance(receipt.get("metadata"), dict) else {}
            status = str(metadata.get("status") or "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1
            if status == "submitted":
                submitted += 1
            if status in {"accepted", "confirmed"}:
                confirmed += 1
            for code in metadata.get("reason_codes") or []:
                key = str(code).split(":", 1)[0]
                failure_buckets[key] = failure_buckets.get(key, 0) + 1
            execution_meta = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
            error = str(execution_meta.get("error") or "")
            failure_bucket = str(execution_meta.get("failure_bucket") or "").strip()
            if error:
                bucket = failure_bucket or "execution_error"
                failure_buckets[bucket] = failure_buckets.get(bucket, 0) + 1
            reason_codes = [str(code) for code in metadata.get("reason_codes") or []]
            if status in {"blocked", "failed"} or error:
                stage = str(metadata.get("stage") or "check")
                primary_bucket = (
                    failure_bucket
                    if stage == "execute" and failure_bucket
                    else (reason_codes[0].split(":", 1)[0] if reason_codes else (failure_bucket or ("execution_error" if error else status)))
                )
                primary_reason = (
                    error if stage == "execute" and error else (reason_codes[0] if reason_codes else (error or "No reason recorded."))
                )
                recent_failures.append(
                    {
                        "receipt_id": receipt.get("receipt_id"),
                        "timestamp": receipt.get("timestamp"),
                        "action_type": receipt.get("action_type"),
                        "stage": stage,
                        "status": status,
                        "bucket": primary_bucket,
                        "reason": primary_reason,
                    }
                )
            if status in {"ready_to_sign", "submitted", "accepted"}:
                execution_meta = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
                in_flight.append(
                    {
                        "receipt_id": receipt.get("receipt_id"),
                        "timestamp": receipt.get("timestamp"),
                        "action_type": receipt.get("action_type"),
                        "status": status,
                        "tx_hash": receipt.get("tx_hash"),
                        "venue": execution_meta.get("execution_adapter"),
                    }
                )

        top_failures = sorted(
            ({"bucket": bucket, "count": count} for bucket, count in failure_buckets.items()),
            key=lambda item: (-item["count"], item["bucket"]),
        )[:5]
        total_terminal = sum(count for key, count in status_counts.items() if key in {"accepted", "confirmed", "failed", "blocked"})
        settled_success = sum(count for key, count in status_counts.items() if key in {"accepted", "confirmed"})
        success_rate_pct = round((settled_success / total_terminal) * 100, 1) if total_terminal else None

        return {
            "owner_address": _normalize_address(owner_address),
            "recent_receipt_count": len(recent),
            "status_counts": status_counts,
            "submitted_count": submitted,
            "settled_count": confirmed,
            "success_rate_pct": success_rate_pct,
            "top_failure_buckets": top_failures,
            "recent_failures": recent_failures[:4],
            "in_flight": in_flight[:4],
        }

    async def confirm_wallet_execution_receipt(
        self,
        owner_address: str,
        receipt_id: str,
        tx_hash: str,
    ) -> dict[str, Any]:
        normalized = _normalize_address(owner_address)
        receipt = await self.receipt_service.get_receipt(receipt_id)
        if receipt is None:
            raise ValueError("Receipt not found.")
        if _normalize_address(receipt.get("user", "")) != normalized:
            raise PermissionError("Receipt does not belong to this wallet.")
        result = await self.receipt_service.confirm_receipt(receipt_id, tx_hash)
        _json_log(
            "execution_gate.confirm",
            owner_address=normalized,
            receipt_id=receipt_id,
            tx_hash=tx_hash,
            status=result.get("status"),
        )
        return result

    def get_executor_readiness(self, network_id: str) -> dict[str, Any]:
        from app.services.contract_executor import get_executor

        readiness = get_executor().get_readiness(network_id)
        readiness["gate_live_submission_allowed"] = (
            os.getenv("EXECUTION_GATE_ALLOW_MAINNET_LIVE", "false").lower() == "true"
            if readiness.get("network_id") == NETWORK_MAINNET
            else True
        )
        readiness["mode"] = (
            "live"
            if readiness.get("can_submit_live") and readiness.get("gate_live_submission_allowed")
            else "preview"
        )
        return readiness

    def _receipt_status_for_execution(self, execution: dict[str, Any]) -> str:
        status = str(execution.get("status") or "").lower()
        if status == "prepared":
            return "ready_to_sign"
        if status == "submitted":
            return "submitted"
        if status == "blocked":
            return "blocked"
        if status == "error":
            return "failed"
        return status or "recorded"

    async def _refresh_receipt_tx_status(
        self,
        receipt: dict[str, Any],
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        if metadata.get("stage") != "execute":
            return receipt
        tx_hash = str(receipt.get("tx_hash") or "").strip()
        if not tx_hash:
            return receipt
        execution_meta = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
        status = str(execution_meta.get("tx_status") or "").lower()
        if status in {"accepted", "confirmed", "rejected"}:
            return receipt
        lifecycle_status = str(metadata.get("status") or "").lower()
        if lifecycle_status == "failed" or str(execution_meta.get("error") or "").strip():
            return receipt
        checked_at = execution_meta.get("tx_checked_at")
        if isinstance(checked_at, str):
            try:
                last = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
                if (_utc_now() - last).total_seconds() < 30:
                    return receipt
            except ValueError:
                pass
        network_id = execution_meta.get("execution_chain") or NETWORK_MAINNET
        tx_status = await self._fetch_tx_status(tx_hash, network_id)
        execution_meta = {
            **execution_meta,
            "tx_status": tx_status,
            "tx_checked_at": _utc_now().isoformat(),
        }
        if tx_status in {"accepted", "confirmed"} and not execution_meta.get("portfolio_after"):
            owner_address = _normalize_address(receipt.get("user", ""))
            snapshot = await self._load_portfolio_snapshot(owner_address)
            holdings = self._aggregate_supported_assets(snapshot)
            current_weights = self._weights_pct(holdings)
            execution_meta["portfolio_after"] = self._serialize_portfolio_state(snapshot, holdings, current_weights)
        lifecycle_status = {
            "accepted": "accepted",
            "confirmed": "confirmed",
            "rejected": "failed",
        }.get(tx_status, "submitted")
        metadata = {**metadata, "status": lifecycle_status, "execution": execution_meta}
        await self.receipt_service.update_receipt_metadata(receipt.get("receipt_id"), metadata)
        receipt = {**receipt, "metadata": metadata}
        return receipt

    async def _fetch_tx_status(self, tx_hash: str, network_id: str) -> str:
        import httpx

        rpc_url = os.getenv("EXECUTOR_RPC_URL_MAINNET") if network_id == NETWORK_MAINNET else None
        rpc_url = rpc_url or os.getenv("STARKNET_RPC_URL")
        if not rpc_url:
            return "unknown"
        payload = {
            "jsonrpc": "2.0",
            "method": "starknet_getTransactionStatus",
            "params": [tx_hash],
            "id": 1,
        }
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                resp = await client.post(rpc_url, json=payload)
                resp.raise_for_status()
                data = resp.json().get("result", {})
        except Exception:
            return "unknown"
        finality = str(data.get("finality_status") or "").upper()
        execution = str(data.get("execution_status") or "").upper()
        if execution in {"REJECTED", "REVERTED"} or finality == "REJECTED":
            return "rejected"
        if finality == "ACCEPTED_ON_L1":
            return "confirmed"
        if finality == "ACCEPTED_ON_L2":
            return "accepted"
        if finality == "RECEIVED":
            return "received"
        return "pending"

    async def recommend(self, owner_address: str) -> dict[str, Any]:
        normalized = _normalize_address(owner_address)
        policy = await self.get_policy_snapshot(normalized)
        snapshot = await self._load_portfolio_snapshot(normalized)
        holdings = self._aggregate_supported_assets(snapshot)
        current_weights = self._weights_pct(holdings)
        total_value = sum(item["value_usd"] for item in holdings.values())
        receipts = await self.receipt_service.get_user_receipts(normalized)
        raw_policy = get_vault_policy_service().get_policy(normalized, create_if_missing=True) or {}
        risk_tolerance = self._risk_tolerance_from_policy(raw_policy)
        risk_profile = self._risk_profile_from_tolerance(risk_tolerance)
        recommendation_amount = max(total_value, 1.0)

        try:
            from app.services.strategy_recommendation_service import get_recommendation

            strategy = await get_recommendation(
                normalized,
                recommendation_amount,
                risk_profile,
            )
            allocator_target_allocations = self._derive_asset_targets_from_strategy(
                strategy.get("recommended_pools") or [],
            )
            rationale = str(strategy.get("ai_reasoning") or "").strip() or (
                "Allocator returned a protocol mix and the gate derived a mainnet-v1 token target from it."
            )
            source = "allocator_v1"
        except Exception as exc:
            logger.warning("strategy allocator unavailable for %s: %s", normalized[:18], exc)
            strategy = {
                "recommended_pools": [],
                "ai_reasoning": "",
                "ai_confidence": 0.0,
                "expected_portfolio_apy": 0.0,
                "portfolio_risk_assessment": "",
                "recommendation_id": None,
                "attestation_hash": None,
                "provenance": None,
                "genome": None,
            }
            allocator_target_allocations = self._fallback_target_allocations(current_weights, total_value)
            rationale = (
                "Allocator service is unavailable, so the gate fell back to a simple defensive token mix."
            )
            source = "heuristic_fallback_v1"

        recommendation_plan = await self._select_recommendation_target(
            owner_address=normalized,
            holdings=holdings,
            target_allocations=allocator_target_allocations,
            policy=policy,
        )
        target_allocations = recommendation_plan["target_allocations"]
        steps = recommendation_plan["swap_steps"]

        intent = {
            "type": "rebalance",
            "network_id": NETWORK_MAINNET,
            "target_allocations": target_allocations,
            "deadline": _safe_int(_utc_now().timestamp()) + 1800,
            "nonce": _safe_int(_utc_now().timestamp()),
            "block_number": 0,
            "max_slippage_bps": min(policy["max_slippage_bps"], 75),
            "adapter_target": "best",
        }
        translation = self._build_execution_translation(
            strategy.get("recommended_pools") or [],
            target_allocations,
            steps,
        )
        drift_monitor = self._build_drift_monitor(
            current_allocations=current_weights,
            target_allocations=allocator_target_allocations,
            total_value_usd=total_value,
            cooldown_seconds=_safe_int(policy.get("cooldown_seconds"), 300),
            receipts=receipts,
        )
        monitor_state = self.monitor_service.get_state(normalized) or {}
        if drift_monitor:
            drift_monitor = {
                **drift_monitor,
                "last_reviewed_at": monitor_state.get("last_reviewed_at"),
                "last_alerted_at": monitor_state.get("last_alerted_at"),
            }
        rebalance_summary = self._build_rebalance_summary(
            current_allocations=current_weights,
            target_allocations=target_allocations,
            drift_monitor=drift_monitor,
        )
        if recommendation_plan["mode"] == "best_next_move":
            rebalance_summary = {
                **rebalance_summary,
                "headline": recommendation_plan["headline"],
                "why": recommendation_plan["note"],
            }
        return {
            "owner_address": normalized,
            "source": source,
            "risk_profile": risk_profile,
            "risk_tolerance": risk_tolerance,
            "tracked_capital_usd": round(total_value, 2),
            "constraint_context": {
                "risk_tolerance": risk_tolerance,
                "max_position_pct": _safe_int(raw_policy.get("risk_budget", {}).get("max_position_pct"), 35),
                "rebalance_frequency_seconds": policy.get("cooldown_seconds"),
                "allowed_execution_venues": policy.get("allowed_adapters", []),
                "execution_mode": raw_policy.get("execution_policy", {}).get("mode", "assist"),
            },
            "current_allocations": current_weights,
            "target_allocations": target_allocations,
            "allocator_target_allocations": allocator_target_allocations,
            "estimated_swap_count": len(steps),
            "rationale": rebalance_summary.get("headline") or recommendation_plan["note"] or rationale,
            "recommendation_mode": recommendation_plan["mode"],
            "recommendation_note": recommendation_plan["note"],
            "intent": intent,
            "recommended_pools": strategy.get("recommended_pools") or [],
            "expected_portfolio_apy": _safe_float(strategy.get("expected_portfolio_apy")),
            "ai_confidence": _safe_float(strategy.get("ai_confidence")),
            "portfolio_risk_assessment": str(strategy.get("portfolio_risk_assessment") or ""),
            "recommendation_id": strategy.get("recommendation_id"),
            "attestation_hash": strategy.get("attestation_hash"),
            "provenance": strategy.get("provenance"),
            "genome": strategy.get("genome"),
            "derived_swap_steps": steps,
            "allocator_swap_steps": recommendation_plan["allocator_swap_steps"],
            "execution_translation": translation,
            "drift_monitor": drift_monitor,
            "rebalance_summary": rebalance_summary,
            "execution_fit": {
                "mode": "spot_rebalance_proxy",
                "description": (
                    "The allocator recommends protocol exposure first. Mainnet-v1 derives a token mix from that "
                    "strategy and rebalances wallet holdings toward it with spot swaps."
                ),
            },
        }

    async def record_policy_update_receipt(
        self,
        owner_address: str,
        *,
        before: dict[str, Any],
        after: dict[str, Any],
    ) -> dict[str, Any]:
        normalized = _normalize_address(owner_address)
        changed_fields: list[str] = []
        for field in (
            "paused",
            "max_value_per_action_usd",
            "max_slippage_bps",
            "cooldown_seconds",
            "max_swaps_per_rebalance",
            "min_amounts",
        ):
            if before.get(field) != after.get(field):
                changed_fields.append(field)
        return await self.receipt_service.create_receipt(
            user_address=normalized,
            constraints_hash=str(after.get("policy_hash") or ""),
            proof_hash=str(before.get("policy_hash") or ""),
            action_type="policy_update",
            metadata={
                "source": "execution_gate_v1",
                "stage": "policy",
                "status": "updated",
                "policy": {
                    "changed_fields": changed_fields,
                    "before": before,
                    "after": after,
                },
            },
        )

    async def check_intent(
        self,
        owner_address: str,
        intent: dict[str, Any],
        *,
        portfolio_id: str | None = None,
        policy_override: dict[str, Any] | None = None,
        persist: bool = True,
        prepare_preview: bool = False,
    ) -> dict[str, Any]:
        normalized = _normalize_address(owner_address)
        normalized_intent = self._normalize_intent(intent)
        policy = await self.get_policy_snapshot(normalized, override=policy_override)
        snapshot = await self._load_portfolio_snapshot(normalized)
        holdings = self._aggregate_supported_assets(snapshot)
        current_weights = self._weights_pct(holdings)
        swap_steps = self._get_swap_steps_for_intent(normalized_intent, holdings)
        action_value_usd = self._estimate_action_value_usd(normalized_intent, holdings, swap_steps)
        portfolio_features = self._build_portfolio_features(snapshot, holdings)
        receipts = await self.get_gate_receipts(normalized)

        route_hash = normalized_intent.get("route_hash") or self._derive_route_hash(normalized_intent, swap_steps)
        intent_hash = _canonical_hash(
            {
                "owner_address": normalized,
                "portfolio_id": portfolio_id,
                "intent": normalized_intent,
                "route_hash": route_hash,
            }
        )

        inputs_override = self._build_circuit_inputs(
            normalized,
            normalized_intent,
            holdings,
            current_weights,
            policy,
            portfolio_features,
            receipts,
        )
        scan_result = await run_circuit_scan(
            circuits=MAINNET_V1_CIRCUITS,
            inputs_override=inputs_override,
            user_address=_to_address_int(normalized),
            portfolio_features=portfolio_features,
            mode="gate",
        )

        constraint_results, reason_codes = self._format_circuit_results(scan_result)
        proof_mode = "groth16" if all(item.get("success", False) for item in scan_result.get("results", [])) else "advisory"
        policy_results, policy_reason_codes = self._evaluate_policy_constraints(
            normalized,
            normalized_intent,
            policy,
            receipts,
            action_value_usd,
            swap_steps,
            self._estimate_gas(normalized_intent, swap_steps),
            holdings,
        )
        constraint_results.extend(policy_results)
        reason_codes.extend(policy_reason_codes)

        policy_allowed = all(result.get("passed", False) for result in policy_results)
        zkml_allowed = (
            all(result.get("passed", False) for result in constraint_results if result.get("kind") == "zkml")
            if proof_mode == "groth16"
            else True
        )
        allowed = policy_allowed and zkml_allowed
        estimated_gas = self._estimate_gas(normalized_intent, swap_steps)
        estimated_cost_usd = round(estimated_gas * ESTIMATED_USD_PER_GAS_UNIT, 4)

        response = {
            "owner_address": normalized,
            "portfolio_id": portfolio_id,
            "execution_chain": self._normalized_network_id(normalized_intent),
            "allowed": allowed,
            "reason_codes": sorted(dict.fromkeys(reason_codes)),
            "constraint_results": constraint_results,
            "policy_hash": policy["policy_hash"],
            "intent_hash": intent_hash,
            "proof_mode": proof_mode,
            "route_hash": route_hash,
            "estimated_gas": estimated_gas,
            "estimated_cost_usd": estimated_cost_usd,
            "policy_snapshot": policy,
            "current_allocations": current_weights,
            "swap_steps": swap_steps,
            "portfolio_summary": self._portfolio_summary(snapshot, holdings),
        }

        if allowed and prepare_preview:
            preview_intent = {**normalized_intent, "owner_address": normalized}
            response["execution_preview"] = await self._prepare_execution_preview(
                preview_intent,
                response,
            )

        if persist:
            receipt = await self.receipt_service.create_receipt(
                user_address=normalized,
                constraints_hash=policy["policy_hash"],
                proof_hash=intent_hash,
                action_type=normalized_intent["type"],
                amount=int(round(action_value_usd * 100)),
                metadata={
                    "source": "execution_gate_v1",
                    "stage": "check",
                    "allowed": allowed,
                    "proof_mode": proof_mode,
                    "policy_hash": policy["policy_hash"],
                    "intent_hash": intent_hash,
                    "route_hash": route_hash,
                    "reason_codes": response["reason_codes"],
                    "constraint_results": constraint_results,
                    "intent": normalized_intent,
                    "swap_steps": swap_steps,
                    "execution_preview": response.get("execution_preview"),
                },
            )
            response["receipt_id"] = receipt["receipt_id"]

        _json_log(
            "execution_gate.check",
            owner_address=normalized,
            action_type=normalized_intent["type"],
            allowed=allowed,
            proof_mode=proof_mode,
            reason_codes=response["reason_codes"],
            action_value_usd=action_value_usd,
            estimated_cost_usd=estimated_cost_usd,
            swap_step_count=len(swap_steps),
            adapter_target=normalized_intent.get("adapter_target"),
        )

        return response

    async def _prepare_execution_preview(
        self,
        intent: dict[str, Any],
        gate_result: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_intent = self._normalize_intent(intent)
        normalized_intent["owner_address"] = _normalize_address(intent.get("owner_address") or "")
        try:
            if normalized_intent["type"] == "swap":
                execution = await self._execute_swap_intent(normalized_intent, False, use_cache=True)
                wallet_calls = execution.get("wallet_calls") or []
                has_calldata = bool(execution.get("calldata"))
                return {
                    "status": execution.get("status"),
                    "execution_adapter": execution.get("execution_adapter"),
                    "expected_out": execution.get("expected_out"),
                    "route": execution.get("route") or [],
                    "warning": execution.get("warning"),
                    "error": execution.get("error"),
                    "failure_bucket": execution.get("failure_bucket"),
                    "prep_latency_ms": execution.get("prep_latency_ms"),
                    "prepared_call_count": 1 if wallet_calls or has_calldata else 0,
                    "wallet_call_count": len(wallet_calls),
                    "cache_hit_count": 1 if execution.get("cache_hit") else 0,
                    "cache_hit": bool(execution.get("cache_hit")),
                }

            execution = await self._execute_rebalance_intent(
                normalized_intent,
                gate_result,
                False,
                use_cache=True,
            )
            prepared_calls = execution.get("prepared_calls") or []
            return {
                "status": execution.get("status"),
                "execution_adapter": execution.get("execution_adapter"),
                "warning": execution.get("warning"),
                "error": execution.get("error"),
                "failure_bucket": execution.get("failure_bucket"),
                "prep_latency_ms": execution.get("prep_latency_ms"),
                "prepared_call_count": len(prepared_calls),
                "wallet_call_count": sum(len(item.get("wallet_calls") or []) for item in prepared_calls),
                "cache_hit_count": execution.get("cache_hit_count", 0),
                "cache_hit": bool(execution.get("cache_hit_count")),
            }
        except Exception as exc:
            message = str(exc) or "Execution preview could not be prepared."
            return {
                "status": "error",
                "warning": "Execution preview could not be prepared during the safety check.",
                "error": message,
                "failure_bucket": self._classify_execution_error(message),
                "prep_latency_ms": 0,
                "prepared_call_count": 0,
                "wallet_call_count": 0,
                "cache_hit_count": 0,
                "cache_hit": False,
            }

    async def execute_intent(
        self,
        owner_address: str,
        intent: dict[str, Any],
        *,
        portfolio_id: str | None = None,
        policy_override: dict[str, Any] | None = None,
        execute_live: bool = False,
    ) -> dict[str, Any]:
        gate_result = await self.check_intent(
            owner_address,
            intent,
            portfolio_id=portfolio_id,
            policy_override=policy_override,
            persist=False,
        )
        normalized = _normalize_address(owner_address)
        normalized_intent = self._normalize_intent(intent)
        normalized_intent["owner_address"] = normalized
        snapshot_before = await self._load_portfolio_snapshot(normalized)
        holdings_before = self._aggregate_supported_assets(snapshot_before)
        current_weights_before = self._weights_pct(holdings_before)
        action_value_usd = self._estimate_action_value_usd(
            normalized_intent,
            holdings_before,
            gate_result.get("swap_steps", []),
        )

        session_key_id = normalized_intent.get("session_key_id")
        if session_key_id:
            session_check = self.session_key_service.validate_key(
                key_id=session_key_id,
                owner_address=normalized,
                policy_hash=gate_result.get("policy_hash"),
            )
            if not session_check.get("ok"):
                receipt = await self.receipt_service.create_receipt(
                    user_address=normalized,
                    constraints_hash=gate_result["policy_hash"],
                    proof_hash=gate_result["intent_hash"],
                    action_type=normalized_intent["type"],
                    amount=int(round(action_value_usd * 100)),
                    metadata={
                        "source": "execution_gate_v1",
                        "stage": "execute",
                        "status": "blocked",
                        "reason": session_check.get("reason"),
                        "session_key_id": session_key_id,
                    },
                )
                return {
                    "status": "blocked",
                    "executed": False,
                    "error": f"Session key invalid: {session_check.get('reason')}",
                    "receipt_id": receipt["receipt_id"],
                    "gate": gate_result,
                }
        elif execute_live and os.getenv("REQUIRE_SESSION_KEY_FOR_LIVE", "false").lower() == "true":
            receipt = await self.receipt_service.create_receipt(
                user_address=normalized,
                constraints_hash=gate_result["policy_hash"],
                proof_hash=gate_result["intent_hash"],
                action_type=normalized_intent["type"],
                amount=int(round(action_value_usd * 100)),
                metadata={
                    "source": "execution_gate_v1",
                    "stage": "execute",
                    "status": "blocked",
                    "reason": "session_key_required",
                },
            )
            return {
                "status": "blocked",
                "executed": False,
                "error": "Session key required for live execution.",
                "receipt_id": receipt["receipt_id"],
                "gate": gate_result,
            }

        allow_advisory_override = bool(normalized_intent.get("allow_advisory_override"))
        can_override_gate = self._can_override_blocked_gate(
            normalized_intent,
            gate_result,
            execute_live=execute_live,
        )

        if not gate_result["allowed"] and not (allow_advisory_override and can_override_gate):
            receipt = await self.receipt_service.create_receipt(
                user_address=normalized,
                constraints_hash=gate_result["policy_hash"],
                proof_hash=gate_result["intent_hash"],
                action_type=normalized_intent["type"],
                amount=int(round(action_value_usd * 100)),
                metadata={
                    "source": "execution_gate_v1",
                    "stage": "execute",
                    "status": "blocked",
                    "gate": gate_result,
                },
            )
            return {
                "status": "blocked",
                "executed": False,
                "receipt_id": receipt["receipt_id"],
                "gate": gate_result,
            }

        if normalized_intent["type"] == "swap":
            execution = await self._execute_swap_intent(
                normalized_intent,
                execute_live and self._live_execution_allowed(normalized_intent),
                use_cache=False,
            )
        else:
            execution = await self._execute_rebalance_intent(
                normalized_intent,
                gate_result,
                execute_live and self._live_execution_allowed(normalized_intent),
                use_cache=False,
            )

        metadata = {
            "source": "execution_gate_v1",
            "stage": "execute",
            "status": self._receipt_status_for_execution(execution),
            "gate": {
                "policy_hash": gate_result["policy_hash"],
                "intent_hash": gate_result["intent_hash"],
                "route_hash": gate_result["route_hash"],
                "target_allocations": gate_result.get("current_allocations")
                if normalized_intent["type"] == "swap"
                else normalized_intent.get("target_allocations"),
                "swap_steps": gate_result.get("swap_steps", []),
                "override_used": allow_advisory_override and can_override_gate,
            },
            "execution": {
                **execution,
                "session_key_id": session_key_id,
                "portfolio_before": self._serialize_portfolio_state(
                    snapshot_before,
                    holdings_before,
                    current_weights_before,
                ),
            },
        }
        receipt = await self.receipt_service.create_receipt(
            user_address=normalized,
            constraints_hash=gate_result["policy_hash"],
            proof_hash=gate_result["intent_hash"],
            action_type=normalized_intent["type"],
            amount=int(round(action_value_usd * 100)),
            metadata=metadata,
        )
        if execution.get("tx_hash"):
            await self.receipt_service.confirm_receipt(receipt["receipt_id"], execution["tx_hash"])

        _json_log(
            "execution_gate.execute",
            owner_address=normalized,
            action_type=normalized_intent["type"],
            status=execution.get("status"),
            receipt_status=metadata["status"],
            execution_adapter=execution.get("execution_adapter"),
            action_value_usd=action_value_usd,
            tx_hash=execution.get("tx_hash"),
            error=execution.get("error"),
            warning=execution.get("warning"),
            prepared_call_count=len(execution.get("prepared_calls") or []),
            wallet_call_count=len(execution.get("wallet_calls") or []),
        )

        return {
            **execution,
            "executed": bool(execution.get("tx_hash")),
            "receipt_id": receipt["receipt_id"],
            "gate": gate_result,
        }

    def _can_override_blocked_gate(
        self,
        intent: dict[str, Any],
        gate_result: dict[str, Any],
        *,
        execute_live: bool,
    ) -> bool:
        if execute_live:
            return False
        if gate_result.get("allowed"):
            return False
        if not gate_result.get("swap_steps"):
            return False

        failed_constraints = [
            item
            for item in gate_result.get("constraint_results", [])
            if not item.get("passed")
        ]
        if not failed_constraints:
            return False

        failed_names = {str(item.get("name") or "") for item in failed_constraints}
        if failed_names != {"FeeEfficiencyGuard"}:
            return False

        fee_guard = next(
            (
                item
                for item in gate_result.get("constraint_results", [])
                if str(item.get("name") or "") == "FeeEfficiencyGuard"
            ),
            None,
        )
        if not fee_guard:
            return False

        if str(fee_guard.get("severity") or "") != "blocked":
            return False

        return True

    async def _execute_swap_intent(
        self,
        intent: dict[str, Any],
        execute_live: bool,
        *,
        use_cache: bool = True,
    ) -> dict[str, Any]:
        network_id = self._normalized_network_id(intent)
        token_map = self._token_map_for_network(network_id)
        token_in = token_map.get(intent["token_in"])
        token_out = token_map.get(intent["token_out"])
        if not token_in or not token_out:
            return {
                "status": "error",
                "error": "Swap execution only supports ETH, STRK, and USDC.",
            }

        amount_wei = _safe_int(intent["amount_wei"])
        slippage_bps = _safe_int(intent.get("max_slippage_bps"), 50)
        adapter_pref = str(intent.get("adapter_target") or "best").strip().lower()
        cache_key = self._swap_execution_cache_key(intent, network_id)
        if not execute_live and use_cache:
            cached = self._get_cached_swap_execution(cache_key)
            if cached:
                cached["cache_hit"] = True
                return cached

        candidates: list[dict[str, Any]] = []
        ekubo_error: str | None = None
        avnu_error: str | None = None
        chain_id = self._chain_id_for_network(network_id)
        prep_started = _utc_now()

        async def _try_avnu() -> dict[str, Any]:
            return await build_avnu_swap_execution(
                token_in=token_in,
                token_out=token_out,
                amount_in_wei=amount_wei,
                taker_address=_normalize_address(intent.get("owner_address") or ""),
                slippage_bps=slippage_bps,
                chain_id=chain_id,
            )

        async def _try_ekubo(timeout_s: float) -> dict[str, Any]:
            return await asyncio.wait_for(
                build_swap_calldata(
                    chain_id,
                    token_in,
                    token_out,
                    amount_wei,
                    slippage_bps=slippage_bps,
                ),
                timeout=timeout_s,
            )

        # For mainnet best-route, prefer AVNU first because it returns executable wallet calls
        # quickly, while deep Ekubo discovery can take minutes for unsupported pairs.
        if adapter_pref == "best" and network_id == NETWORK_MAINNET:
            avnu = await _try_avnu()
            if avnu.get("wallet_calls"):
                candidates.append(
                    {
                        "venue": "avnu",
                        "expected_out": _safe_int(avnu.get("expected_out")),
                        "calldata": None,
                        "wallet_calls": avnu.get("wallet_calls") or [],
                        "route": avnu.get("route") or [],
                    }
                )
            else:
                avnu_error = str(avnu.get("error") or "AVNU quote failed.")

            if not candidates:
                try:
                    calldata = await _try_ekubo(timeout_s=8.0)
                    if calldata.get("contract_address") and calldata.get("calldata"):
                        candidates.append(
                            {
                                "venue": "ekubo",
                                "expected_out": _safe_int(calldata.get("expected_out")),
                                "calldata": calldata,
                                "wallet_calls": [],
                            }
                        )
                    else:
                        ekubo_error = str(calldata.get("error") or "Ekubo quote failed.")
                except asyncio.TimeoutError:
                    ekubo_error = "Ekubo route discovery timed out."
        else:
            if adapter_pref in {"ekubo", "best"}:
                try:
                    calldata = await _try_ekubo(timeout_s=12.0)
                    if calldata.get("contract_address") and calldata.get("calldata"):
                        candidates.append(
                            {
                                "venue": "ekubo",
                                "expected_out": _safe_int(calldata.get("expected_out")),
                                "calldata": calldata,
                                "wallet_calls": [],
                            }
                        )
                    else:
                        ekubo_error = str(calldata.get("error") or "Ekubo quote failed.")
                except asyncio.TimeoutError:
                    ekubo_error = "Ekubo route discovery timed out."

            if adapter_pref in {"avnu", "best"}:
                avnu = await _try_avnu()
                if avnu.get("wallet_calls"):
                    candidates.append(
                        {
                            "venue": "avnu",
                            "expected_out": _safe_int(avnu.get("expected_out")),
                            "calldata": None,
                            "wallet_calls": avnu.get("wallet_calls") or [],
                            "route": avnu.get("route") or [],
                        }
                    )
                else:
                    avnu_error = str(avnu.get("error") or "AVNU quote failed.")

        best = max(candidates, key=lambda item: int(item.get("expected_out") or 0), default=None)
        if best is None:
            result = {
                "status": "error",
                "tx_hash": None,
                "calldata": None,
                "wallet_calls": [],
                "execution_chain": network_id,
                "execution_adapter": adapter_pref,
                "live_submission_allowed": self._live_execution_allowed(intent),
                "warning": None,
                "error": avnu_error if adapter_pref == "avnu" else ekubo_error if adapter_pref == "ekubo" else (
                    f"Best-route failed. Ekubo: {ekubo_error or 'n/a'}. AVNU: {avnu_error or 'n/a'}."
                ),
                "failure_bucket": self._classify_execution_error(
                    avnu_error if adapter_pref == "avnu" else ekubo_error if adapter_pref == "ekubo" else (
                        f"Best-route failed. Ekubo: {ekubo_error or 'n/a'}. AVNU: {avnu_error or 'n/a'}."
                    )
                ),
                "prep_latency_ms": int((_utc_now() - prep_started).total_seconds() * 1000),
            }
            if not execute_live and use_cache:
                self._store_cached_swap_execution(cache_key, result)
            return result

        tx_hash: str | None = None
        status = "prepared"
        warning: str | None = None
        if best["venue"] == "ekubo" and execute_live and best.get("calldata", {}).get("contract_address") and best.get("calldata", {}).get("calldata"):
            call = best["calldata"]
            tx_hash = await submit_swap(
                str(call["contract_address"]),
                str(call["entrypoint"]),
                [str(item) for item in call["calldata"]],
                network_id=network_id,
            )
            status = "submitted" if tx_hash else "prepared"
        elif best["venue"] == "avnu" and execute_live:
            warning = "AVNU execution is prepared for wallet signing only in mainnet-v1."

        if network_id == NETWORK_MAINNET and not self._live_execution_allowed(intent):
            warning = "Mainnet live submission is disabled until EXECUTION_GATE_ALLOW_MAINNET_LIVE=true."

        result = {
            "status": status,
            "tx_hash": tx_hash,
            "calldata": best.get("calldata"),
            "wallet_calls": best.get("wallet_calls") or [],
            "execution_chain": network_id,
            "execution_adapter": best["venue"],
            "live_submission_allowed": self._live_execution_allowed(intent),
            "warning": warning,
            "expected_out": str(best.get("expected_out") or 0),
            "route": best.get("route") or [],
            "prep_latency_ms": int((_utc_now() - prep_started).total_seconds() * 1000),
            "cache_hit": False,
        }
        if not execute_live and use_cache:
            self._store_cached_swap_execution(cache_key, result)
        return result

    async def _execute_rebalance_intent(
        self,
        intent: dict[str, Any],
        gate_result: dict[str, Any],
        execute_live: bool,
        *,
        use_cache: bool = True,
    ) -> dict[str, Any]:
        steps = gate_result.get("swap_steps", [])
        network_id = self._normalized_network_id(intent)
        
        async def _prepare_step(step: dict[str, Any]) -> dict[str, Any]:
            step_intent = {
                **intent,
                "type": "swap",
                "token_in": step["from_asset"],
                "token_out": step["to_asset"],
                "amount_wei": _safe_int(step["amount_wei"]),
            }
            execution = await self._execute_swap_intent(step_intent, False, use_cache=use_cache)
            return {
                "step": step,
                "status": "ready" if execution.get("status") != "error" else "error",
                "calldata": execution.get("calldata"),
                "wallet_calls": execution.get("wallet_calls") or [],
                "execution_adapter": execution.get("execution_adapter"),
                "route": execution.get("route") or [],
                "error": execution.get("error"),
                "failure_bucket": execution.get("failure_bucket"),
                "prep_latency_ms": execution.get("prep_latency_ms"),
                "cache_hit": execution.get("cache_hit", False),
            }

        prepared_calls = await asyncio.gather(*[_prepare_step(step) for step in steps]) if steps else []

        live_disabled = execute_live and len(prepared_calls) > 1
        tx_hash: str | None = None
        status = "prepared"
        if execute_live and len(prepared_calls) == 1:
            single = prepared_calls[0]
            call = single.get("calldata") or {}
            if single.get("execution_adapter") == "ekubo" and call.get("contract_address") and call.get("calldata"):
                tx_hash = await submit_swap(
                    str(call["contract_address"]),
                    str(call["entrypoint"]),
                    [str(item) for item in call["calldata"]],
                    network_id=network_id,
                )
                status = "submitted" if tx_hash else "prepared"
        elif any(call.get("status") == "error" for call in prepared_calls):
            status = "error"

        errored = [call for call in prepared_calls if call.get("status") == "error"]
        failure_bucket = next((str(call.get("failure_bucket") or "").strip() for call in errored if str(call.get("failure_bucket") or "").strip()), None)
        return {
            "status": status,
            "tx_hash": tx_hash,
            "execution_chain": network_id,
            "live_submission_allowed": self._live_execution_allowed(intent),
            "prepared_calls": prepared_calls,
            "failure_bucket": failure_bucket,
            "prep_latency_ms": sum(_safe_int(call.get("prep_latency_ms")) for call in prepared_calls),
            "cache_hit_count": len([call for call in prepared_calls if call.get("cache_hit")]),
            "warning": (
                "Mainnet live submission is disabled until EXECUTION_GATE_ALLOW_MAINNET_LIVE=true."
                if network_id == NETWORK_MAINNET and not self._live_execution_allowed(intent)
                else (
                    "Live bundle execution is disabled for multi-swap rebalances; review the prepared calls instead."
                    if live_disabled
                    else None
                )
            ),
        }

    async def _load_portfolio_snapshot(self, owner_address: str) -> PortfolioSnapshot | None:
        if not owner_address.startswith("0x"):
            return None
        try:
            return await scan_portfolio(owner_address)
        except Exception as exc:
            logger.warning("execution gate portfolio scan failed for %s: %s", owner_address[:18], exc)
            return None

    def _aggregate_supported_assets(self, snapshot: PortfolioSnapshot | None) -> dict[str, dict[str, float]]:
        holdings = {
            symbol: {"value_usd": 0.0, "amount": 0.0}
            for symbol in SUPPORTED_ASSETS
        }
        if snapshot is None:
            return holdings

        for position in snapshot.positions:
            asset = _normalize_asset(position.asset_symbol)
            if asset not in holdings:
                continue
            holdings[asset]["value_usd"] += max(0.0, _safe_float(position.value_usd))
            holdings[asset]["amount"] += max(0.0, _safe_float(position.amount))
        return holdings

    def _weights_pct(self, holdings: dict[str, dict[str, float]]) -> dict[str, float]:
        total = sum(item["value_usd"] for item in holdings.values())
        if total <= 0:
            return {asset: 0.0 for asset in SUPPORTED_ASSETS}
        return {
            asset: round((item["value_usd"] / total) * 100.0, 2)
            for asset, item in holdings.items()
        }

    def _normalize_intent(self, intent: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(intent or {})
        normalized["type"] = str(normalized.get("type") or "swap").strip().lower()
        normalized["network_id"] = self._normalized_network_id(normalized)
        normalized["token_in"] = _normalize_asset(normalized.get("token_in"))
        normalized["token_out"] = _normalize_asset(normalized.get("token_out"))
        normalized["amount_wei"] = _safe_int(normalized.get("amount_wei") or normalized.get("amount"))
        normalized["deadline"] = _safe_int(normalized.get("deadline"))
        normalized["nonce"] = _safe_int(normalized.get("nonce"))
        normalized["block_number"] = _safe_int(normalized.get("block_number"))
        normalized["max_slippage_bps"] = _safe_int(normalized.get("max_slippage_bps"), 50)
        normalized["adapter_target"] = str(normalized.get("adapter_target") or "best").strip().lower()
        normalized["route_hash"] = normalized.get("route_hash")
        normalized["allow_advisory_override"] = bool(normalized.get("allow_advisory_override"))
        normalized["session_key_id"] = str(normalized.get("session_key_id") or "").strip() or None
        normalized["target_allocations"] = self._normalize_target_allocations(normalized.get("target_allocations"))
        normalized["delta_list"] = normalized.get("delta_list") if isinstance(normalized.get("delta_list"), list) else []
        return normalized

    def _normalized_network_id(self, intent: dict[str, Any]) -> str:
        value = str((intent or {}).get("network_id") or NETWORK_MAINNET).strip().lower()
        return NETWORK_SEPOLIA if value == NETWORK_SEPOLIA else NETWORK_MAINNET

    def _chain_id_for_network(self, network_id: str) -> str:
        return get_ekubo_chain_id() if network_id == NETWORK_SEPOLIA else EKUBO_MAINNET_CHAIN_ID

    def _token_map_for_network(self, network_id: str) -> dict[str, str]:
        return SEPOLIA_TOKEN_BY_SYMBOL if network_id == NETWORK_SEPOLIA else MAINNET_TOKEN_BY_SYMBOL

    def _live_execution_allowed(self, intent: dict[str, Any]) -> bool:
        network_id = self._normalized_network_id(intent)
        if network_id == NETWORK_MAINNET:
            require_session = os.getenv("REQUIRE_SESSION_KEY_FOR_LIVE", "false").lower() == "true"
            if require_session and not intent.get("session_key_id"):
                return False
            return os.getenv("EXECUTION_GATE_ALLOW_MAINNET_LIVE", "false").lower() == "true"
        return True

    def _normalize_target_allocations(self, target_allocations: Any) -> dict[str, float] | None:
        if not isinstance(target_allocations, dict) or not target_allocations:
            return None
        cleaned: dict[str, float] = {}
        total = 0.0
        for raw_asset, raw_weight in target_allocations.items():
            asset = _normalize_asset(raw_asset)
            if asset not in SUPPORTED_ASSETS:
                continue
            weight = max(0.0, _safe_float(raw_weight))
            cleaned[asset] = weight
            total += weight
        if not cleaned or total <= 0:
            return None
        if total <= 1.01:
            cleaned = {asset: weight * 100.0 for asset, weight in cleaned.items()}
            total = sum(cleaned.values())
        normalized = {
            asset: round((cleaned.get(asset, 0.0) / total) * 100.0, 2)
            for asset in SUPPORTED_ASSETS
        }
        residual = round(100.0 - sum(normalized.values()), 2)
        if residual != 0:
            normalized["USDC"] = round(normalized.get("USDC", 0.0) + residual, 2)
        return normalized

    def _risk_tolerance_from_policy(self, policy: dict[str, Any]) -> int:
        max_drawdown_bps = _safe_int(policy.get("risk_budget", {}).get("max_drawdown_bps"), 1500)
        if max_drawdown_bps <= 900:
            return 25
        if max_drawdown_bps <= 1500:
            return 50
        if max_drawdown_bps <= 2500:
            return 75
        return 90

    def _risk_profile_from_tolerance(self, tolerance: int) -> str:
        if tolerance <= 35:
            return "conservative"
        if tolerance >= 70:
            return "aggressive"
        return "balanced"

    def _fallback_target_allocations(
        self,
        current_weights: dict[str, float],
        total_value: float,
    ) -> dict[str, float]:
        if total_value <= 0:
            return {"ETH": 40.0, "STRK": 20.0, "USDC": 40.0}
        if max(current_weights.values(), default=0.0) >= 65.0:
            return {"ETH": 45.0, "STRK": 20.0, "USDC": 35.0}
        if current_weights.get("USDC", 0.0) < 15.0:
            return {"ETH": 45.0, "STRK": 25.0, "USDC": 30.0}
        return {"ETH": 40.0, "STRK": 25.0, "USDC": 35.0}

    def _derive_asset_targets_from_strategy(
        self,
        recommended_pools: list[dict[str, Any]],
    ) -> dict[str, float]:
        exposures = {asset: 0.0 for asset in SUPPORTED_ASSETS}

        for pool in recommended_pools:
            allocation_pct = max(0.0, _safe_float(pool.get("allocation_percent")))
            protocol = str(pool.get("protocol") or "").strip().lower()
            pair = str(pool.get("pair") or "").strip().upper()

            if protocol == "ekubo" and "/" in pair:
                left, right = [token.strip() for token in pair.split("/", 1)]
                if left in exposures:
                    exposures[left] += allocation_pct / 2.0
                if right in exposures:
                    exposures[right] += allocation_pct / 2.0
                continue

            if "STRK" in pair and "LENDING" in pair:
                exposures["STRK"] += allocation_pct
                continue
            if "ETH" in pair and "LENDING" in pair:
                exposures["ETH"] += allocation_pct
                continue
            if "STRK" in pair and "STAKING" in pair:
                exposures["STRK"] += allocation_pct
                continue
            if "ETH" in pair and "STAKING" in pair:
                exposures["ETH"] += allocation_pct
                continue
            if protocol == "idle" or "RESERVE" in pair or "USDC" in pair:
                exposures["USDC"] += allocation_pct

        normalized = self._normalize_target_allocations(exposures)
        if normalized:
            return normalized
        return {"ETH": 40.0, "STRK": 25.0, "USDC": 35.0}

    def _pool_asset_exposures(
        self,
        pool: dict[str, Any],
    ) -> dict[str, float]:
        allocation_pct = max(0.0, _safe_float(pool.get("allocation_percent")))
        protocol = str(pool.get("protocol") or "").strip().lower()
        pair = str(pool.get("pair") or "").strip().upper()
        exposures = {asset: 0.0 for asset in SUPPORTED_ASSETS}

        if protocol == "ekubo" and "/" in pair:
            left, right = [token.strip() for token in pair.split("/", 1)]
            if left in exposures:
                exposures[left] += allocation_pct / 2.0
            if right in exposures:
                exposures[right] += allocation_pct / 2.0
            return exposures

        if "STRK" in pair and ("LENDING" in pair or "STAKING" in pair):
            exposures["STRK"] += allocation_pct
            return exposures
        if "ETH" in pair and ("LENDING" in pair or "STAKING" in pair):
            exposures["ETH"] += allocation_pct
            return exposures
        if protocol == "idle" or "RESERVE" in pair or "USDC" in pair:
            exposures["USDC"] += allocation_pct
            return exposures
        return exposures

    def _build_execution_translation(
        self,
        recommended_pools: list[dict[str, Any]],
        target_allocations: dict[str, float],
        steps: list[dict[str, Any]],
    ) -> dict[str, Any]:
        sleeves: list[dict[str, Any]] = []
        for pool in recommended_pools:
            exposures = self._pool_asset_exposures(pool)
            non_zero = {
                asset: round(weight, 2)
                for asset, weight in exposures.items()
                if weight > 0
            }
            sleeves.append(
                {
                    "pool_id": pool.get("pool_id"),
                    "protocol": pool.get("protocol"),
                    "pair": pool.get("pair"),
                    "allocation_percent": max(0.0, _safe_float(pool.get("allocation_percent"))),
                    "portfolio_v1_mode": "translated",
                    "directly_executable_on_portfolio_v1": False,
                    "translated_asset_targets": non_zero,
                    "note": (
                        "This sleeve informs the target token mix. `/portfolio` mainnet-v1 does not deploy directly "
                        "into this protocol; it only rebalances spot wallet holdings."
                    ),
                }
            )

        return {
            "mode": "spot_rebalance_translation",
            "direct_execution_supported": ["swap", "rebalance"],
            "strategy_sleeves_are_advisory": True,
            "target_allocations": target_allocations,
            "rebalance_step_count": len(steps),
            "sleeves": sleeves,
            "user_message": (
                "The allocator expresses a portfolio thesis in strategy sleeves. `/portfolio` then translates that "
                "thesis into token balance targets and executes only the spot swaps needed to move the wallet "
                "toward those targets."
            ),
        }

    def _assess_fee_efficiency(
        self,
        *,
        intent_type: str,
        network_id: str,
        action_value_usd: float,
        swap_steps: list[dict[str, Any]],
        estimated_gas: int,
        holdings: dict[str, dict[str, float]],
    ) -> dict[str, Any]:
        estimated_cost_usd = round(estimated_gas * ESTIMATED_USD_PER_GAS_UNIT, 4)
        fee_share = estimated_cost_usd / max(action_value_usd, 0.0001)
        portfolio_total_usd = sum(_safe_float(item.get("value_usd", 0.0)) for item in holdings.values())
        min_value_threshold = (
            MIN_SWAP_VALUE_USD if intent_type == "swap" else (
                MIN_MULTI_SWAP_REBALANCE_VALUE_USD if len(swap_steps) > 1 else MIN_REBALANCE_VALUE_USD
            )
        )
        small_portfolio_grace = (
            intent_type == "rebalance"
            and network_id == NETWORK_MAINNET
            and portfolio_total_usd <= SMALL_PORTFOLIO_GRACE_USD
            and action_value_usd >= SMALL_PORTFOLIO_MIN_ACTION_USD
        )
        small_portfolio_single_step_grace = small_portfolio_grace and len(swap_steps) == 1
        effective_fee_share_block = (
            SMALL_PORTFOLIO_SINGLE_STEP_MAX_FEE_SHARE
            if small_portfolio_single_step_grace
            else BLOCK_FEE_SHARE_OF_ACTION
        )
        effective_grace_fee_share_limit = (
            SMALL_PORTFOLIO_SINGLE_STEP_MAX_FEE_SHARE
            if small_portfolio_single_step_grace
            else SMALL_PORTFOLIO_GRACE_MAX_FEE_SHARE
        )
        grace_revoked_for_fee_share = small_portfolio_grace and fee_share > effective_grace_fee_share_limit
        fee_blocked = (
            (action_value_usd < min_value_threshold and not small_portfolio_grace)
            or fee_share > effective_fee_share_block
            or grace_revoked_for_fee_share
        )
        fee_warning = not fee_blocked and fee_share > WARN_FEE_SHARE_OF_ACTION
        return {
            "estimated_cost_usd": estimated_cost_usd,
            "fee_share": fee_share,
            "fee_share_pct": round(fee_share * 100, 1),
            "portfolio_total_usd": round(portfolio_total_usd, 2),
            "min_value_threshold": min_value_threshold,
            "small_portfolio_grace": small_portfolio_grace,
            "small_portfolio_single_step_grace": small_portfolio_single_step_grace,
            "effective_fee_share_block": effective_fee_share_block,
            "effective_grace_fee_share_limit": effective_grace_fee_share_limit,
            "grace_revoked_for_fee_share": grace_revoked_for_fee_share,
            "fee_blocked": fee_blocked,
            "fee_warning": fee_warning,
            "swap_step_count": len(swap_steps),
        }

    def _projected_allocations_after_steps(
        self,
        holdings: dict[str, dict[str, float]],
        swap_steps: list[dict[str, Any]],
    ) -> dict[str, float]:
        projected = {
            asset: {
                "value_usd": _safe_float(item.get("value_usd", 0.0)),
                "amount": _safe_float(item.get("amount", 0.0)),
            }
            for asset, item in holdings.items()
        }
        for step in swap_steps:
            from_asset = _normalize_asset(step.get("from_asset"))
            to_asset = _normalize_asset(step.get("to_asset"))
            if from_asset not in projected or to_asset not in projected:
                continue
            value_usd = max(0.0, _safe_float(step.get("value_usd", 0.0)))
            if value_usd <= 0:
                continue
            moved_value = min(max(0.0, _safe_float(projected[from_asset].get("value_usd", 0.0))), value_usd)
            projected[from_asset]["value_usd"] = max(0.0, _safe_float(projected[from_asset].get("value_usd", 0.0)) - moved_value)
            projected[to_asset]["value_usd"] = max(0.0, _safe_float(projected[to_asset].get("value_usd", 0.0)) + moved_value)
        return self._weights_pct(projected)

    def _build_small_portfolio_candidate_steps(
        self,
        holdings: dict[str, dict[str, float]],
        target_allocations: dict[str, float],
    ) -> list[dict[str, Any]]:
        total_value = sum(item["value_usd"] for item in holdings.values())
        if total_value <= 0:
            return []

        target_values = {
            asset: (target_allocations.get(asset, 0.0) / 100.0) * total_value
            for asset in SUPPORTED_ASSETS
        }
        deltas = {
            asset: round(target_values[asset] - holdings[asset]["value_usd"], 2)
            for asset in SUPPORTED_ASSETS
        }
        sells = [
            {
                "asset": asset,
                "value_usd": min(abs(delta), self._max_sellable_value_usd(asset, holdings)),
            }
            for asset, delta in deltas.items()
            if delta < -0.5 and self._max_sellable_value_usd(asset, holdings) > 0.5
        ]
        buys = [
            {"asset": asset, "value_usd": delta}
            for asset, delta in deltas.items()
            if delta > 0.5
        ]
        candidates: list[dict[str, Any]] = []
        for sell in sells:
            for buy in buys:
                matched = round(min(sell["value_usd"], buy["value_usd"]), 2)
                if matched < SMALL_PORTFOLIO_MIN_ACTION_USD:
                    continue
                amount = matched / max(ASSET_PRICES_USD.get(sell["asset"], 1.0), 1e-9)
                candidates.append(
                    {
                        "from_asset": sell["asset"],
                        "to_asset": buy["asset"],
                        "value_usd": matched,
                        "amount": amount,
                        "amount_wei": int(amount * (10 ** ASSET_DECIMALS[sell["asset"]])),
                    }
                )
        candidates.sort(key=lambda item: _safe_float(item.get("value_usd")), reverse=True)
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for step in candidates:
            key = (str(step.get("from_asset") or ""), str(step.get("to_asset") or ""))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(step)
        return deduped[:4]

    async def _score_recommendation_candidate_step(
        self,
        *,
        owner_address: str,
        step: dict[str, Any],
        policy: dict[str, Any],
        holdings: dict[str, dict[str, float]],
        target_allocations: dict[str, float],
    ) -> dict[str, Any]:
        step_intent = {
            "type": "swap",
            "network_id": NETWORK_MAINNET,
            "token_in": step["from_asset"],
            "token_out": step["to_asset"],
            "amount_wei": _safe_int(step["amount_wei"]),
            "max_slippage_bps": min(policy.get("max_slippage_bps", DEFAULT_POLICY["max_slippage_bps"]), 75),
            "adapter_target": "best",
            "owner_address": owner_address,
        }
        execution = await self._execute_swap_intent(step_intent, False, use_cache=True)
        route_ready = execution.get("status") != "error" and bool(
            execution.get("wallet_calls") or (
                execution.get("calldata", {}).get("contract_address")
                and execution.get("calldata", {}).get("calldata")
            )
        )
        estimated_gas = self._estimate_gas(step_intent, [step])
        fee_assessment = self._assess_fee_efficiency(
            intent_type="swap",
            network_id=NETWORK_MAINNET,
            action_value_usd=_safe_float(step.get("value_usd")),
            swap_steps=[step],
            estimated_gas=estimated_gas,
            holdings=holdings,
        )
        current_allocations = self._weights_pct(holdings)
        current_gap = sum(
            abs(_safe_float(target_allocations.get(asset)) - _safe_float(current_allocations.get(asset)))
            for asset in SUPPORTED_ASSETS
        )
        projected_target = self._projected_allocations_after_steps(holdings, [step])
        projected_gap = sum(
            abs(_safe_float(target_allocations.get(asset)) - _safe_float(projected_target.get(asset)))
            for asset in SUPPORTED_ASSETS
        )
        gap_reduction = round(max(0.0, current_gap - projected_gap), 2)
        return {
            "step": step,
            "execution": execution,
            "route_ready": route_ready,
            "fee_assessment": fee_assessment,
            "projected_target": projected_target,
            "gap_reduction": gap_reduction,
            "score": (
                1 if route_ready else 0,
                1 if not fee_assessment["fee_blocked"] else 0,
                1 if not fee_assessment["fee_warning"] else 0,
                gap_reduction,
                _safe_float(step.get("value_usd")),
                -_safe_float(fee_assessment.get("fee_share")),
            ),
        }

    async def _select_recommendation_target(
        self,
        *,
        owner_address: str,
        holdings: dict[str, dict[str, float]],
        target_allocations: dict[str, float],
        policy: dict[str, Any],
    ) -> dict[str, Any]:
        allocator_steps = self._build_rebalance_steps(holdings, target_allocations)
        total_value = sum(item["value_usd"] for item in holdings.values())
        action_value_usd = self._estimate_action_value_usd(
            {"type": "rebalance"},
            holdings,
            allocator_steps,
        )
        estimated_gas = self._estimate_gas(
            {
                "type": "rebalance",
                "network_id": NETWORK_MAINNET,
                "max_slippage_bps": min(policy.get("max_slippage_bps", DEFAULT_POLICY["max_slippage_bps"]), 75),
            },
            allocator_steps,
        )
        fee_assessment = self._assess_fee_efficiency(
            intent_type="rebalance",
            network_id=NETWORK_MAINNET,
            action_value_usd=action_value_usd,
            swap_steps=allocator_steps,
            estimated_gas=estimated_gas,
            holdings=holdings,
        )
        result = {
            "mode": "allocator_target",
            "target_allocations": target_allocations,
            "swap_steps": allocator_steps,
            "allocator_swap_steps": allocator_steps,
            "note": None,
            "headline": None,
        }
        if (
            total_value > SMALL_PORTFOLIO_SINGLE_STEP_USD
            or len(allocator_steps) != 1
            or fee_assessment["fee_blocked"]
        ):
            return result

        candidate_steps = self._build_small_portfolio_candidate_steps(holdings, target_allocations)
        route_ranked_candidate: dict[str, Any] | None = None
        if len(candidate_steps) > 1:
            ranked = await asyncio.gather(
                *[
                    self._score_recommendation_candidate_step(
                        owner_address=owner_address,
                        step=step,
                        policy=policy,
                        holdings=holdings,
                        target_allocations=target_allocations,
                    )
                    for step in candidate_steps
                ]
            )
            route_ranked_candidate = max(ranked, key=lambda item: item["score"], default=None)
            if route_ranked_candidate and route_ranked_candidate["route_ready"]:
                chosen_step = route_ranked_candidate["step"]
                projected_target = route_ranked_candidate["projected_target"]
                projected_gap = max(
                    (
                        abs(_safe_float(target_allocations.get(asset)) - _safe_float(projected_target.get(asset)))
                        for asset in SUPPORTED_ASSETS
                    ),
                    default=0.0,
                )
                if projected_gap >= 4.0:
                    execution = route_ranked_candidate["execution"]
                    route_bits = [str(execution.get("execution_adapter") or "").upper()]
                    route_names = [str(item) for item in (execution.get("route") or []) if str(item)]
                    if route_names:
                        route_bits.append(" / ".join(route_names))
                    route_summary = " via ".join(bit for bit in route_bits if bit)
                    return {
                        "mode": "best_next_move",
                        "target_allocations": projected_target,
                        "swap_steps": [chosen_step],
                        "allocator_swap_steps": allocator_steps,
                        "note": (
                            f"On a ${total_value:,.2f} wallet, the cleanest live route is one {chosen_step['from_asset']} → "
                            f"{chosen_step['to_asset']} swap for about ${_safe_float(chosen_step.get('value_usd')):,.2f}"
                            + (f" {route_summary.lower()}." if route_summary else ".")
                            + f" The longer-horizon suggested mix still leans toward ETH {target_allocations.get('ETH', 0.0):.0f}% / "
                            f"STRK {target_allocations.get('STRK', 0.0):.0f}% / USDC {target_allocations.get('USDC', 0.0):.0f}%."
                        ),
                        "headline": f"Take the cleanest routed move: sell {chosen_step['from_asset']} and add {chosen_step['to_asset']}.",
                    }

        projected_target = self._projected_allocations_after_steps(holdings, allocator_steps)
        projected_gap = max(
            (
                abs(_safe_float(target_allocations.get(asset)) - _safe_float(projected_target.get(asset)))
                for asset in SUPPORTED_ASSETS
            ),
            default=0.0,
        )
        if projected_gap < 4.0:
            return result

        lead_step = allocator_steps[0]
        return {
            "mode": "best_next_move",
            "target_allocations": projected_target,
            "swap_steps": self._build_rebalance_steps(holdings, projected_target),
            "allocator_swap_steps": allocator_steps,
            "note": (
                f"On a ${total_value:,.2f} wallet, the cleanest first move is one {lead_step['from_asset']} → "
                f"{lead_step['to_asset']} swap for about ${_safe_float(lead_step.get('value_usd')):,.2f}. "
                f"The longer-horizon suggested mix still leans toward ETH {target_allocations.get('ETH', 0.0):.0f}% / "
                f"STRK {target_allocations.get('STRK', 0.0):.0f}% / USDC {target_allocations.get('USDC', 0.0):.0f}%."
            ),
            "headline": f"Take the cleanest next move: sell {lead_step['from_asset']} and add {lead_step['to_asset']}.",
        }

    def _serialize_portfolio_state(
        self,
        snapshot: PortfolioSnapshot | None,
        holdings: dict[str, dict[str, float]],
        allocations: dict[str, float],
    ) -> dict[str, Any]:
        return {
            "captured_at": _utc_now().isoformat(),
            "snapshot_hash": getattr(snapshot, "snapshot_hash", None),
            "total_value_usd": round(sum(item["value_usd"] for item in holdings.values()), 2),
            "allocations": {
                asset: round(allocations.get(asset, 0.0), 2)
                for asset in SUPPORTED_ASSETS
            },
            "balances": {
                asset: {
                    "amount": round(holdings.get(asset, {}).get("amount", 0.0), 8),
                    "value_usd": round(holdings.get(asset, {}).get("value_usd", 0.0), 2),
                }
                for asset in SUPPORTED_ASSETS
            },
        }

    def _build_drift_monitor(
        self,
        *,
        current_allocations: dict[str, float],
        target_allocations: dict[str, float],
        total_value_usd: float,
        cooldown_seconds: int,
        receipts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        per_asset_gap = {
            asset: round(target_allocations.get(asset, 0.0) - current_allocations.get(asset, 0.0), 2)
            for asset in SUPPORTED_ASSETS
        }
        absolute_gaps = {
            asset: round(abs(gap), 2)
            for asset, gap in per_asset_gap.items()
        }
        total_turnover_pct = round(sum(absolute_gaps.values()) / 2.0, 2)
        turnover_value_usd = round((total_turnover_pct / 100.0) * max(total_value_usd, 0.0), 2)
        trigger_pct = 7.5
        watch_pct = 3.0
        largest_asset = max(absolute_gaps, key=absolute_gaps.get, default="ETH")
        largest_gap_pct = absolute_gaps.get(largest_asset, 0.0)
        assets_out_of_band = [
            {
                "asset": asset,
                "current_pct": round(current_allocations.get(asset, 0.0), 2),
                "target_pct": round(target_allocations.get(asset, 0.0), 2),
                "gap_pct": round(per_asset_gap.get(asset, 0.0), 2),
                "abs_gap_pct": round(absolute_gaps.get(asset, 0.0), 2),
            }
            for asset in SUPPORTED_ASSETS
            if absolute_gaps.get(asset, 0.0) >= watch_pct
        ]

        if largest_gap_pct >= trigger_pct or total_turnover_pct >= 10.0:
            status = "rebalance"
            explanation = (
                "The wallet has drifted materially away from the suggested mix. A rebalance is justified if "
                "the gate still approves the path."
            )
        elif largest_gap_pct >= watch_pct or total_turnover_pct >= 5.0:
            status = "watch"
            explanation = (
                "The wallet is starting to drift. No urgent rebalance is implied yet, but the agent should keep "
                "watching price moves and new inflows."
            )
        else:
            status = "aligned"
            explanation = (
                "The wallet remains close to the suggested mix. The agent can stay in monitor mode rather than "
                "forcing a rebalance."
            )

        drivers = self._build_drift_drivers(
            receipts=receipts,
            status=status,
            current_allocations=current_allocations,
            target_allocations=target_allocations,
            largest_gap_asset=largest_asset,
            largest_gap_pct=largest_gap_pct,
            total_turnover_pct=total_turnover_pct,
            assets_out_of_band=assets_out_of_band,
        )

        return {
            "status": status,
            "monitoring_mode": "agent_watch",
            "rebalance_trigger_pct": trigger_pct,
            "watch_trigger_pct": watch_pct,
            "total_turnover_pct": total_turnover_pct,
            "estimated_turnover_usd": turnover_value_usd,
            "largest_gap_asset": largest_asset,
            "largest_gap_pct": round(largest_gap_pct, 2),
            "assets_out_of_band": assets_out_of_band,
            "next_review_seconds": max(300, cooldown_seconds),
            "explanation": explanation,
            "drivers": drivers,
        }

    def _build_drift_drivers(
        self,
        *,
        receipts: list[dict[str, Any]],
        status: str,
        current_allocations: dict[str, float],
        target_allocations: dict[str, float],
        largest_gap_asset: str,
        largest_gap_pct: float,
        total_turnover_pct: float,
        assets_out_of_band: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        recent = sorted(
            [
                receipt
                for receipt in receipts
                if isinstance(receipt, dict)
            ],
            key=lambda item: str(item.get("timestamp") or ""),
            reverse=True,
        )[:25]

        drivers: list[dict[str, Any]] = []
        recent_executes = []
        recent_swaps = 0
        recent_rebalances = 0
        recent_deposits = 0
        recent_withdrawals = 0
        latest_rebalance_execute: dict[str, Any] | None = None

        for receipt in recent:
            metadata = receipt.get("metadata")
            metadata = metadata if isinstance(metadata, dict) else {}
            stage = str(metadata.get("stage") or "")
            action_type = str(receipt.get("action_type") or "").lower()
            has_submitted_tx = bool(receipt.get("tx_hash"))
            if stage == "execute" and has_submitted_tx:
                recent_executes.append(receipt)
                if action_type == "swap":
                    recent_swaps += 1
                elif action_type == "rebalance":
                    recent_rebalances += 1
                    if latest_rebalance_execute is None:
                        latest_rebalance_execute = receipt
            if action_type in {"deposit", "fund"}:
                recent_deposits += 1
            if action_type in {"withdraw", "redeem"}:
                recent_withdrawals += 1

        if recent_swaps:
            drivers.append(
                {
                    "kind": "manual_swaps",
                    "label": "Recent wallet swaps likely pushed the mix off target.",
                    "confidence": "high" if recent_swaps >= 2 else "medium",
                    "evidence": f"{recent_swaps} recent executed swap receipt(s).",
                    "suggested_action": "Run the gate against the AI proposal again before executing a corrective rebalance.",
                }
            )

        if recent_deposits:
            drivers.append(
                {
                    "kind": "fresh_deposit",
                    "label": "Fresh capital likely changed the portfolio weights.",
                    "confidence": "medium",
                    "evidence": f"{recent_deposits} recent deposit/fund receipt(s).",
                    "suggested_action": "Re-evaluate the suggested target now that the wallet capital base has changed.",
                }
            )

        if recent_withdrawals:
            drivers.append(
                {
                    "kind": "withdrawal",
                    "label": "Recent outflows likely distorted the target mix.",
                    "confidence": "medium",
                    "evidence": f"{recent_withdrawals} recent withdrawal receipt(s).",
                    "suggested_action": "Treat the next recommendation as a fresh allocation pass rather than a pure rebalance.",
                }
            )

        if recent_rebalances and status in {"watch", "rebalance"}:
            metadata = latest_rebalance_execute.get("metadata") if isinstance(latest_rebalance_execute, dict) else {}
            metadata = metadata if isinstance(metadata, dict) else {}
            execution_meta = metadata.get("execution") if isinstance(metadata.get("execution"), dict) else {}
            gate_meta = metadata.get("gate") if isinstance(metadata.get("gate"), dict) else {}
            after_state = execution_meta.get("portfolio_after") if isinstance(execution_meta.get("portfolio_after"), dict) else {}
            after_allocations = after_state.get("allocations") if isinstance(after_state.get("allocations"), dict) else {}
            target_from_receipt = gate_meta.get("target_allocations") if isinstance(gate_meta.get("target_allocations"), dict) else target_allocations

            if after_allocations:
                post_execution_gap = max(
                    (
                        abs(_safe_float(after_allocations.get(asset)) - _safe_float(target_from_receipt.get(asset)))
                        for asset in SUPPORTED_ASSETS
                    ),
                    default=0.0,
                )
                current_vs_after_gap = max(
                    (
                        abs(_safe_float(current_allocations.get(asset)) - _safe_float(after_allocations.get(asset)))
                        for asset in SUPPORTED_ASSETS
                    ),
                    default=0.0,
                )
                if post_execution_gap >= 4.0:
                    drivers.append(
                        {
                            "kind": "incomplete_prior_rebalance",
                            "label": "The last rebalance still left the wallet materially off target.",
                            "confidence": "high",
                            "evidence": f"After the prior rebalance, the max asset gap was still {post_execution_gap:.1f}%.",
                            "suggested_action": "Inspect the prepared steps and final execution route before trusting another automated rebalance.",
                        }
                    )
                elif current_vs_after_gap >= 3.0:
                    drivers.append(
                        {
                            "kind": "post_rebalance_market_drift",
                            "label": "The wallet drifted again after the last completed rebalance.",
                            "confidence": "medium",
                            "evidence": f"Current allocations moved {current_vs_after_gap:.1f}% away from the last post-execution snapshot.",
                            "suggested_action": "Treat this as normal market drift unless a new manual trade or deposit also occurred.",
                        }
                    )
            else:
                drivers.append(
                    {
                        "kind": "incomplete_prior_rebalance",
                        "label": "A previous rebalance was submitted, but there is no settled post-trade snapshot yet.",
                        "confidence": "medium",
                        "evidence": f"{recent_rebalances} recent rebalance receipt(s) exist, but settlement evidence is incomplete.",
                        "suggested_action": "Wait for settlement or refresh receipts before treating the current gap as pure market drift.",
                    }
                )

        if not drivers and status in {"watch", "rebalance"}:
            leading_assets = ", ".join(item["asset"] for item in assets_out_of_band[:2]) or largest_gap_asset
            drivers.append(
                {
                    "kind": "market_drift",
                    "label": "No strong wallet-action signal found, so this looks like market drift.",
                    "confidence": "medium" if total_turnover_pct >= 8 else "low",
                    "evidence": f"{leading_assets} moved far enough away from the target mix to require {total_turnover_pct:.1f}% turnover.",
                    "suggested_action": "Let the agent keep monitoring unless the gate still shows a clean rebalance and the user wants to tighten the mix.",
                }
            )

        if not drivers:
            drivers.append(
                {
                    "kind": "aligned",
                    "label": "The wallet is still broadly aligned with the suggested mix.",
                    "confidence": "high",
                    "evidence": "No material out-of-band assets detected.",
                    "suggested_action": "Keep monitoring rather than forcing turnover.",
                }
            )

        return drivers[:3]

    def _build_rebalance_summary(
        self,
        *,
        current_allocations: dict[str, float],
        target_allocations: dict[str, float],
        drift_monitor: dict[str, Any] | None,
    ) -> dict[str, Any]:
        changes: list[dict[str, Any]] = []
        for asset in SUPPORTED_ASSETS:
            current_pct = round(_safe_float(current_allocations.get(asset)), 2)
            target_pct = round(_safe_float(target_allocations.get(asset)), 2)
            delta_pct = round(target_pct - current_pct, 2)
            changes.append(
                {
                    "asset": asset,
                    "current_pct": current_pct,
                    "target_pct": target_pct,
                    "delta_pct": delta_pct,
                    "direction": "increase" if delta_pct > 0 else "decrease" if delta_pct < 0 else "hold",
                }
            )

        top_changes = sorted(changes, key=lambda item: abs(_safe_float(item["delta_pct"])), reverse=True)
        meaningful = [item for item in top_changes if abs(_safe_float(item["delta_pct"])) >= 1.0]
        primary = meaningful[0] if meaningful else top_changes[0]
        secondary = meaningful[1] if len(meaningful) > 1 else None
        status = str((drift_monitor or {}).get("status") or "aligned")
        turnover = _safe_float((drift_monitor or {}).get("total_turnover_pct"))

        if status == "rebalance":
            headline = (
                f"Reduce {primary['asset']} and build toward a more balanced mix."
                if primary.get("direction") == "decrease"
                else f"Build {primary['asset']} exposure to bring the wallet back on target."
            )
        elif status == "watch":
            headline = "The wallet is drifting, but a full rebalance is not urgent yet."
        else:
            headline = "The wallet is already close to target, so only small adjustments are needed."

        why_parts: list[str] = []
        if primary:
            why_parts.append(
                f"{primary['asset']} moves from {primary['current_pct']:.0f}% to {primary['target_pct']:.0f}%."
            )
        if secondary and abs(_safe_float(secondary["delta_pct"])) >= 3.0:
            why_parts.append(
                f"{secondary['asset']} shifts from {secondary['current_pct']:.0f}% to {secondary['target_pct']:.0f}%."
            )
        if turnover > 0:
            why_parts.append(f"That implies about {turnover:.1f}% portfolio turnover.")

        drivers = (drift_monitor or {}).get("drivers") or []
        if drivers and isinstance(drivers[0], dict) and drivers[0].get("evidence"):
            why = f"{' '.join(why_parts)} {str(drivers[0]['evidence'])}".strip()
        else:
            why = " ".join(why_parts).strip()

        return {
            "headline": headline,
            "why": why,
            "top_changes": meaningful[:3] if meaningful else top_changes[:3],
        }

    def _get_swap_steps_for_intent(
        self,
        intent: dict[str, Any],
        holdings: dict[str, dict[str, float]],
    ) -> list[dict[str, Any]]:
        if intent["type"] == "swap":
            price = ASSET_PRICES_USD.get(intent.get("token_in") or "", 0.0)
            amount = _safe_int(intent.get("amount_wei"))
            if price <= 0 or amount <= 0 or not intent.get("token_in") or not intent.get("token_out"):
                return []
            human = amount / float(10 ** ASSET_DECIMALS[intent["token_in"]])
            return [
                {
                    "from_asset": intent["token_in"],
                    "to_asset": intent["token_out"],
                    "amount_wei": amount,
                    "amount": human,
                    "value_usd": round(human * price, 2),
                }
            ]
        if intent["target_allocations"]:
            return self._build_rebalance_steps(holdings, intent["target_allocations"])

        steps: list[dict[str, Any]] = []
        for delta in intent.get("delta_list", []):
            from_asset = _normalize_asset(delta.get("from_asset"))
            to_asset = _normalize_asset(delta.get("to_asset"))
            value_usd = max(0.0, _safe_float(delta.get("value_usd")))
            if not from_asset or not to_asset or value_usd <= 0:
                continue
            amount = value_usd / max(ASSET_PRICES_USD.get(from_asset, 1.0), 1e-9)
            amount_wei = int(amount * (10 ** ASSET_DECIMALS[from_asset]))
            steps.append(
                {
                    "from_asset": from_asset,
                    "to_asset": to_asset,
                    "value_usd": round(value_usd, 2),
                    "amount": amount,
                    "amount_wei": amount_wei,
                }
            )
        return steps

    def _build_rebalance_steps(
        self,
        holdings: dict[str, dict[str, float]],
        target_allocations: dict[str, float],
    ) -> list[dict[str, Any]]:
        total_value = sum(item["value_usd"] for item in holdings.values())
        if total_value <= 0:
            return []

        target_values = {
            asset: (target_allocations.get(asset, 0.0) / 100.0) * total_value
            for asset in SUPPORTED_ASSETS
        }
        deltas = {
            asset: round(target_values[asset] - holdings[asset]["value_usd"], 2)
            for asset in SUPPORTED_ASSETS
        }
        sells = [
            {
                "asset": asset,
                "value_usd": min(abs(delta), self._max_sellable_value_usd(asset, holdings)),
            }
            for asset, delta in deltas.items()
            if delta < -0.5 and self._max_sellable_value_usd(asset, holdings) > 0.5
        ]
        buys = [
            {"asset": asset, "value_usd": delta}
            for asset, delta in deltas.items()
            if delta > 0.5
        ]

        if total_value <= SMALL_PORTFOLIO_SINGLE_STEP_USD and sells and buys:
            primary_sell = max(sells, key=lambda item: item["value_usd"])
            primary_buy = max(buys, key=lambda item: item["value_usd"])
            matched = round(min(primary_sell["value_usd"], primary_buy["value_usd"]), 2)
            if matched >= SMALL_PORTFOLIO_MIN_ACTION_USD:
                amount = matched / max(ASSET_PRICES_USD.get(primary_sell["asset"], 1.0), 1e-9)
                return [
                    {
                        "from_asset": primary_sell["asset"],
                        "to_asset": primary_buy["asset"],
                        "value_usd": matched,
                        "amount": amount,
                        "amount_wei": int(amount * (10 ** ASSET_DECIMALS[primary_sell["asset"]])),
                    }
                ]
            return []

        steps: list[dict[str, Any]] = []
        for sell in sells:
            remaining_sell = sell["value_usd"]
            for buy in buys:
                if remaining_sell <= 0.5 or buy["value_usd"] <= 0.5:
                    continue
                matched = min(remaining_sell, buy["value_usd"])
                amount = matched / max(ASSET_PRICES_USD.get(sell["asset"], 1.0), 1e-9)
                steps.append(
                    {
                        "from_asset": sell["asset"],
                        "to_asset": buy["asset"],
                        "value_usd": round(matched, 2),
                        "amount": amount,
                        "amount_wei": int(amount * (10 ** ASSET_DECIMALS[sell["asset"]])),
                    }
                )
                remaining_sell = round(remaining_sell - matched, 2)
                buy["value_usd"] = round(buy["value_usd"] - matched, 2)
                if len(steps) >= DEFAULT_POLICY["max_swaps_per_rebalance"]:
                    return steps
        return steps

    def _max_sellable_value_usd(
        self,
        asset: str,
        holdings: dict[str, dict[str, float]],
    ) -> float:
        current_value = max(0.0, _safe_float(holdings.get(asset, {}).get("value_usd")))
        if asset != "STRK":
            return round(current_value, 2)
        current_amount = max(0.0, _safe_float(holdings.get(asset, {}).get("amount")))
        reserve_amount = min(current_amount, MAINNET_STRK_GAS_RESERVE)
        reserve_value = reserve_amount * ASSET_PRICES_USD["STRK"]
        return round(max(0.0, current_value - reserve_value), 2)

    def _estimate_action_value_usd(
        self,
        intent: dict[str, Any],
        holdings: dict[str, dict[str, float]],
        swap_steps: list[dict[str, Any]],
    ) -> float:
        if intent["type"] == "swap":
            step = swap_steps[0] if swap_steps else None
            return round(_safe_float(step.get("value_usd")) if step else 0.0, 2)
        return round(sum(_safe_float(step.get("value_usd")) for step in swap_steps), 2)

    def _build_portfolio_features(
        self,
        snapshot: PortfolioSnapshot | None,
        holdings: dict[str, dict[str, float]],
    ) -> list[int]:
        total = sum(item["value_usd"] for item in holdings.values())
        weights = self._weights_pct(holdings)
        max_weight = max(weights.values(), default=0.0)
        stable_pct = weights.get("USDC", 0.0)
        protocol_count = snapshot.protocol_count if snapshot else 0
        position_count = snapshot.position_count if snapshot else 0
        errors = len(snapshot.errors) if snapshot else 0
        features = [
            min(999, int(total // 100)),
            min(500, protocol_count * 10),
            min(500, position_count * 10),
            min(100, int(round(max_weight))),
            min(100, int(round(stable_pct))),
            min(100, int(round(weights.get("ETH", 0.0)))),
            min(100, int(round(weights.get("STRK", 0.0)))),
            min(100, errors * 10),
        ]
        return features

    def _build_circuit_inputs(
        self,
        owner_address: str,
        intent: dict[str, Any],
        holdings: dict[str, dict[str, float]],
        current_weights: dict[str, float],
        policy: dict[str, Any],
        portfolio_features: list[int],
        receipts: list[dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        user_int = _to_address_int(owner_address)
        action_value_usd = max(1.0, self._estimate_action_value_usd(intent, holdings, self._get_swap_steps_for_intent(intent, holdings)))
        allocation_bps = [
            int(round((current_weights.get(asset, 0.0) / 100.0) * 10_000))
            for asset in SUPPORTED_ASSETS
        ]
        allocation_bps.append(max(0, 10_000 - sum(allocation_bps)))
        allocation_bps.extend([0] * 4)
        allocation_bps = allocation_bps[:8]

        history_count = max(1, len(receipts))
        success_count = len([receipt for receipt in receipts if receipt.get("tx_hash")])
        blocked_count = len(
            [
                receipt
                for receipt in receipts
                if isinstance(receipt.get("metadata"), dict)
                and receipt["metadata"].get("stage") == "check"
                and not receipt["metadata"].get("allowed")
            ]
        )
        mean_balance = max(10_000, int(action_value_usd * 100))
        balances = [mean_balance + (index * 150) for index in range(12)]

        policy_hash_int = int(policy["policy_hash"], 16) % (2**250)
        max_slippage_bps = _safe_int(intent.get("max_slippage_bps"), policy["max_slippage_bps"])
        submission_block = max(1, _safe_int(intent.get("block_number"), 100_000))
        inclusion_block = submission_block + 2
        deadline = max(submission_block + 2, _safe_int(intent.get("deadline"), submission_block + 10))
        expected_price = max(1, int(round(ASSET_PRICES_USD.get(intent.get("token_in") or "ETH", 1.0) * 100)))
        actual_price = expected_price + max(1, min(8, max_slippage_bps // 10))
        expected_yields = [780, 640, 520, 440, 360, 320, 250, 220]
        current_allocs = [
            int(round(current_weights.get("ETH", 0.0))),
            int(round(current_weights.get("STRK", 0.0))),
            int(round(current_weights.get("USDC", 0.0))),
            0,
            0,
            0,
            0,
            0,
        ]

        return {
            "RiskScore": build_risk_score_inputs(
                portfolio_features=portfolio_features,
                threshold=max(30, _safe_int(policy.get("max_risk_score"), 80)),
                user_address=user_int,
            ),
            "AnomalyDetector": build_anomaly_detector_inputs(
                tvl_volatility=min(45, int(round(current_weights.get("STRK", 0.0) / 2)) + 8),
                liquidity_concentration=min(45, int(round(max(current_weights.values(), default=0.0)))),
                user_address=user_int,
            ),
            "CorrelationRisk": build_correlation_risk_inputs(
                positions=[
                    max(1, int(round(current_weights.get("ETH", 0.0)))),
                    max(1, int(round(current_weights.get("STRK", 0.0)))),
                    max(1, int(round(current_weights.get("USDC", 0.0)))),
                    5,
                    5,
                ],
                threshold=max(70, _safe_int(policy.get("max_risk_score"), 80)),
                user_address=user_int,
            ),
            "SafetyDiversification": build_safety_diversification_inputs(
                allocations=[
                    max(1, int(round(current_weights.get("ETH", 0.0)))),
                    max(1, int(round(current_weights.get("STRK", 0.0)))),
                    max(1, int(round(current_weights.get("USDC", 0.0)))),
                    5,
                    5,
                    5,
                ],
                safety_scores=[82, 64, 94, 58, 55, 60],
                threshold=60,
                user_address=user_int,
            ),
            "ImpermanentLossPredictor": build_il_predictor_inputs(
                position_size=max(1_000, int(action_value_usd * 100)),
                current_price=expected_price + 6,
                max_il_tolerance_bps=500,
                user_address=user_int,
            ),
            "YieldOptimality": build_yield_optimality_inputs(
                allocations=current_allocs,
                predicted_yields=expected_yields,
                optimality_threshold_bps=250,
                user_address=user_int,
            ),
            "SlippageBound": build_slippage_bound_inputs(
                trade_amount=max(1_000, int(action_value_usd * 100)),
                current_liquidity=5_000_000,
                max_slippage_bps=max_slippage_bps,
                user_address=user_int,
            ),
            "AgentReputationScore": build_agent_reputation_inputs(
                metrics=[
                    min(250, int(sum(item["value_usd"] for item in holdings.values()) // 100)),
                    min(100, success_count + 40),
                    min(25, blocked_count),
                    320,
                    60,
                    min(365, history_count * 30),
                    min(100, history_count * 10),
                ],
                min_reputation_score=max(50, _safe_int(policy.get("min_reputation_score"), 0)),
                user_address=user_int,
            ),
            "CrossProtocolArbitrage": build_cross_protocol_arb_inputs(
                source_price=expected_price,
                dest_price=expected_price + 18,
                trade_amount=max(1000, int(action_value_usd * 50)),
                min_profit_bps=10,
                user_address=user_int,
            ),
            "LiquidationRisk": build_liquidation_risk_inputs(
                collateral_values=[200_000, 150_000, 120_000, 0, 0, 0, 0, 0],
                debt_values=[80_000, 50_000, 30_000, 1, 1, 1, 1, 1],
                liquidation_thresholds=[8000, 8500, 7500, 10000, 10000, 10000, 10000, 10000],
                num_active=3,
                user_address=user_int,
            ),
            "HistoricalPerformanceAttestation": build_historical_performance_inputs(
                period_returns=[180, 120, -40, 240, 80, 200, 0, 0, 0, 0, 0, 0],
                period_balances=balances,
                user_address=user_int,
            ),
            "MEVResistanceProof": build_mev_resistance_inputs(
                submission_block=submission_block,
                inclusion_block=inclusion_block,
                expected_price=expected_price,
                actual_price=actual_price,
                max_delay_blocks=5,
                max_price_deviation_bps=max_slippage_bps,
                user_address=user_int,
            ),
            "ExecutionIntegrity": build_execution_integrity_inputs(
                submission_block=submission_block,
                inclusion_block=inclusion_block,
                expected_price=expected_price,
                actual_price=actual_price,
                max_delay_blocks=max(5, deadline - submission_block),
                max_price_deviation_bps=max_slippage_bps,
                user_address=user_int,
            ),
        }

    def _format_circuit_results(self, scan_result: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
        constraint_results: list[dict[str, Any]] = []
        reason_codes: list[str] = []
        for result in scan_result.get("results", []):
            success = bool(result.get("success"))
            passed = success and result.get("is_compliant") is not False
            reason = "passed"
            if not success:
                reason = result.get("error") or "Proof generation failed."
                reason_codes.append(f"zkml_proof_failed:{result.get('circuit', 'unknown')}")
            elif result.get("is_compliant") is False:
                reason = "Circuit returned non-compliant."
                reason_codes.append(f"zkml_non_compliant:{result.get('circuit', 'unknown')}")
            constraint_results.append(
                {
                    "name": result.get("circuit"),
                    "kind": "zkml",
                    "passed": passed,
                    "success": success,
                    "reason": reason,
                    "proof_hash": result.get("proof_hash"),
                    "duration_ms": result.get("duration_ms"),
                }
            )
        return constraint_results, reason_codes

    def _evaluate_policy_constraints(
        self,
        owner_address: str,
        intent: dict[str, Any],
        policy: dict[str, Any],
        receipts: list[dict[str, Any]],
        action_value_usd: float,
        swap_steps: list[dict[str, Any]],
        estimated_gas: int,
        holdings: dict[str, dict[str, float]],
    ) -> tuple[list[dict[str, Any]], list[str]]:
        results: list[dict[str, Any]] = []
        reason_codes: list[str] = []

        min_amounts = policy.get("min_amounts") or DEFAULT_POLICY.get("min_amounts", {})
        def _min_amount_wei(asset: str | None) -> int:
            if not asset:
                return 0
            min_amt = _safe_float(min_amounts.get(asset), 0.0)
            return int(min_amt * (10 ** ASSET_DECIMALS.get(asset, 18)))

        paused = bool(policy.get("paused"))
        if paused:
            reason_codes.append("policy_paused")
        results.append(
            {
                "name": "PauseGuard",
                "kind": "policy",
                "passed": not paused,
                "success": True,
                "reason": "Portfolio is paused." if paused else "Portfolio is active.",
            }
        )

        adapter = str(intent.get("adapter_target") or "").lower()
        adapter_ok = adapter in policy.get("allowed_adapters", [])
        if not adapter_ok:
            reason_codes.append("adapter_not_allowed")
        results.append(
            {
                "name": "AdapterAllowlist",
                "kind": "policy",
                "passed": adapter_ok,
                "success": True,
                "reason": f"Adapter `{adapter}` is not allowed." if not adapter_ok else "Adapter allowed.",
            }
        )

        assets = {intent.get("token_in"), intent.get("token_out")}
        if intent["type"] == "rebalance" and intent.get("target_allocations"):
            assets = set(intent["target_allocations"].keys())
        allowed_assets = set(policy.get("allowed_assets", []))
        asset_ok = all(asset in allowed_assets for asset in assets if asset)
        if not asset_ok:
            reason_codes.append("asset_not_allowed")
        results.append(
            {
                "name": "AssetAllowlist",
                "kind": "policy",
                "passed": asset_ok,
                "success": True,
                "reason": "Unsupported asset in intent." if not asset_ok else "Assets allowed.",
            }
        )

        min_ok = True
        min_reason = "Minimum amount satisfied."
        if intent["type"] == "swap":
            min_required = _min_amount_wei(intent.get("token_in"))
            amount_wei = _safe_int(intent.get("amount_wei"))
            if min_required and amount_wei < min_required:
                min_ok = False
                min_reason = f"Amount below minimum for {intent.get('token_in')}."
        else:
            for step in swap_steps:
                min_required = _min_amount_wei(step.get("from_asset"))
                if min_required and _safe_int(step.get("amount_wei")) < min_required:
                    min_ok = False
                    min_reason = f"Rebalance step below minimum for {step.get('from_asset')}."
                    break
        if not min_ok:
            reason_codes.append("min_amount_too_small")
        results.append(
            {
                "name": "MinAmountGuard",
                "kind": "policy",
                "passed": min_ok,
                "success": True,
                "reason": min_reason,
            }
        )

        slippage = _safe_int(intent.get("max_slippage_bps"))
        slippage_ok = slippage <= _safe_int(policy.get("max_slippage_bps"), DEFAULT_POLICY["max_slippage_bps"])
        if not slippage_ok:
            reason_codes.append("slippage_exceeds_limit")
        results.append(
            {
                "name": "SlippageGuard",
                "kind": "policy",
                "passed": slippage_ok,
                "success": True,
                "reason": (
                    f"Requested slippage {slippage} bps exceeds policy."
                    if not slippage_ok
                    else "Requested slippage is within policy."
                ),
            }
        )

        value_ok = action_value_usd <= _safe_float(policy.get("max_value_per_action_usd"), DEFAULT_POLICY["max_value_per_action_usd"])
        if not value_ok:
            reason_codes.append("action_value_exceeds_limit")
        results.append(
            {
                "name": "ActionValueGuard",
                "kind": "policy",
                "passed": value_ok,
                "success": True,
                "reason": (
                    f"Action value ${action_value_usd:,.2f} exceeds policy limit."
                    if not value_ok
                    else "Action value is within policy."
                ),
            }
        )

        fee_assessment = self._assess_fee_efficiency(
            intent_type=intent["type"],
            network_id=str(intent.get("network_id") or NETWORK_MAINNET),
            action_value_usd=action_value_usd,
            swap_steps=swap_steps,
            estimated_gas=estimated_gas,
            holdings=holdings,
        )
        estimated_cost_usd = fee_assessment["estimated_cost_usd"]
        fee_share = fee_assessment["fee_share"]
        min_value_threshold = fee_assessment["min_value_threshold"]
        small_portfolio_grace = fee_assessment["small_portfolio_grace"]
        small_portfolio_single_step_grace = fee_assessment["small_portfolio_single_step_grace"]
        effective_fee_share_block = fee_assessment["effective_fee_share_block"]
        grace_revoked_for_fee_share = fee_assessment["grace_revoked_for_fee_share"]
        fee_blocked = fee_assessment["fee_blocked"]
        fee_warning = fee_assessment["fee_warning"]
        fee_ok = not fee_blocked
        if fee_blocked:
            reason_codes.append("fee_inefficient")
        fee_reason = "Estimated fee is efficient enough for this action."
        if action_value_usd < min_value_threshold and not small_portfolio_grace:
            fee_reason = (
                f"Action is too small for production execution. Minimum economical size is about ${min_value_threshold:,.2f}."
            )
        elif grace_revoked_for_fee_share:
            fee_reason = (
                f"Small-wallet grace does not apply here because the estimated fee share is still too high "
                f"({fee_share * 100:.1f}% on ${action_value_usd:,.2f})."
            )
        elif fee_share > effective_fee_share_block:
            fee_reason = (
                f"Estimated fee ${estimated_cost_usd:,.2f} is too large relative to the action value "
                f"(${action_value_usd:,.2f})."
            )
        elif small_portfolio_single_step_grace:
            fee_reason = (
                "Small-portfolio single-step grace is active. A route exists and the desk will allow it, "
                "but the fee is still large for the amount moved."
            )
        elif small_portfolio_grace:
            fee_reason = (
                "Small-portfolio grace is active. This rebalance is below the normal notional threshold, "
                "but the desk is allowing it on mainnet."
            )
        elif fee_warning:
            fee_reason = (
                f"Estimated fee is a bit high for this action (${estimated_cost_usd:,.2f} on ${action_value_usd:,.2f}), "
                "but still acceptable."
            )
        results.append(
            {
                "name": "FeeEfficiencyGuard",
                "kind": "policy",
                "passed": fee_ok,
                "success": True,
                "reason": fee_reason,
                "warning": fee_warning or small_portfolio_grace,
                "severity": "blocked" if fee_blocked else ("warning" if fee_warning or small_portfolio_grace else "info"),
                "estimated_fee_usd": estimated_cost_usd,
                "fee_share_pct": fee_assessment["fee_share_pct"],
            }
        )

        reserve_active = False
        reserve_ok = True
        reserve_reason = "No STRK gas reserve adjustment needed."
        wallet_strk_balance = round(_safe_float(holdings.get("STRK", {}).get("amount", 0.0)), 6)
        estimated_fee_strk = round(estimated_cost_usd / max(ASSET_PRICES_USD["STRK"], 1e-9), 6)
        required_fee_reserve_strk = round(max(MAINNET_STRK_GAS_RESERVE, estimated_fee_strk * 1.1), 6)
        remaining_strk_after_action = wallet_strk_balance
        if (
            intent["type"] == "rebalance"
            and intent.get("network_id") == NETWORK_MAINNET
            and any(str(step.get("from_asset")) == "STRK" for step in swap_steps)
        ):
            reserve_active = True
            strk_sold_amount = sum(_safe_float(step.get("amount", 0.0)) for step in swap_steps if str(step.get("from_asset")) == "STRK")
            remaining_strk_after_action = round(max(0.0, wallet_strk_balance - strk_sold_amount), 6)
            reserve_ok = remaining_strk_after_action >= required_fee_reserve_strk
            if not reserve_ok:
                reason_codes.append("insufficient_gas_reserve")
                reserve_reason = (
                    f"Estimated network fee needs about {required_fee_reserve_strk:.2f} STRK available for gas, "
                    f"but this draft leaves only {remaining_strk_after_action:.2f} STRK after the planned sells."
                )
            else:
                reserve_reason = (
                    f"Holding back about {required_fee_reserve_strk:.2f} STRK for gas before selling the rest."
                )
        results.append(
            {
                "name": "GasReserveGuard",
                "kind": "policy",
                "passed": reserve_ok,
                "success": True,
                "reason": reserve_reason,
                "active": reserve_active,
                "severity": "blocked" if not reserve_ok else ("warning" if reserve_active else "info"),
                "reserve_strk": required_fee_reserve_strk if reserve_active else 0.0,
                "wallet_strk_balance": wallet_strk_balance,
                "remaining_strk_after_action": remaining_strk_after_action,
                "estimated_fee_strk": estimated_fee_strk,
            }
        )

        bundle_ok = True
        if intent["type"] == "rebalance":
            bundle_ok = len(swap_steps) <= _safe_int(
                policy.get("max_swaps_per_rebalance"),
                DEFAULT_POLICY["max_swaps_per_rebalance"],
            )
            if not bundle_ok:
                reason_codes.append("rebalance_bundle_too_large")
        results.append(
            {
                "name": "BundleSizeGuard",
                "kind": "policy",
                "passed": bundle_ok,
                "success": True,
                "reason": (
                    "Rebalance decomposes into too many swaps."
                    if not bundle_ok
                    else "Bundle size is within policy."
                ),
            }
        )

        cooldown_ok = True
        latest_ts: datetime | None = None
        for receipt in receipts:
            metadata = receipt.get("metadata")
            if not isinstance(metadata, dict):
                continue
            if metadata.get("stage") != "execute":
                continue
            tx_hash = str(receipt.get("tx_hash") or "").strip()
            if not tx_hash:
                continue
            timestamp = receipt.get("timestamp")
            if not isinstance(timestamp, str):
                continue
            try:
                parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            except ValueError:
                continue
            if latest_ts is None or parsed > latest_ts:
                latest_ts = parsed

        if latest_ts is not None:
            elapsed = (_utc_now() - latest_ts).total_seconds()
            cooldown_ok = elapsed >= _safe_int(policy.get("cooldown_seconds"), DEFAULT_POLICY["cooldown_seconds"])
        if not cooldown_ok:
            reason_codes.append("cooldown_active")
        results.append(
            {
                "name": "CooldownGuard",
                "kind": "policy",
                "passed": cooldown_ok,
                "success": True,
                "reason": "Cooldown active from the most recent execution." if not cooldown_ok else "Cooldown clear.",
            }
        )

        return results, reason_codes

    def _derive_route_hash(self, intent: dict[str, Any], swap_steps: list[dict[str, Any]]) -> str:
        payload = {
            "type": intent["type"],
            "token_in": intent.get("token_in"),
            "token_out": intent.get("token_out"),
            "adapter_target": intent.get("adapter_target"),
            "target_allocations": intent.get("target_allocations"),
            "swap_steps": swap_steps,
        }
        return _canonical_hash(payload)

    def _estimate_gas(self, intent: dict[str, Any], swap_steps: list[dict[str, Any]]) -> int:
        if intent["type"] == "swap":
            wallet_call_count = 2
        else:
            wallet_call_count = max(2, max(1, len(swap_steps)) * 2)
        return ESTIMATED_BASE_GAS_UNITS + (wallet_call_count * ESTIMATED_WALLET_CALL_GAS_UNITS)

    def _portfolio_summary(
        self,
        snapshot: PortfolioSnapshot | None,
        holdings: dict[str, dict[str, float]],
    ) -> dict[str, Any]:
        total_supported = round(sum(item["value_usd"] for item in holdings.values()), 2)
        return {
            "wallet_address": snapshot.wallet_address if snapshot else None,
            "snapshot_hash": snapshot.snapshot_hash if snapshot else None,
            "total_supported_value_usd": total_supported,
            "protocol_count": snapshot.protocol_count if snapshot else 0,
            "position_count": snapshot.position_count if snapshot else 0,
            "protocols_found": snapshot.protocols_found if snapshot else [],
        }

    def _swap_execution_cache_key(self, intent: dict[str, Any], network_id: str) -> str:
        payload = {
            "network_id": network_id,
            "type": intent.get("type"),
            "token_in": intent.get("token_in"),
            "token_out": intent.get("token_out"),
            "amount_wei": _safe_int(intent.get("amount_wei")),
            "max_slippage_bps": _safe_int(intent.get("max_slippage_bps"), 50),
            "adapter_target": str(intent.get("adapter_target") or "best").strip().lower(),
            "owner_address": _normalize_address(intent.get("owner_address") or ""),
        }
        return _canonical_hash(payload)

    def _get_cached_swap_execution(self, cache_key: str) -> dict[str, Any] | None:
        if EXECUTION_PREP_CACHE_TTL_SECONDS <= 0:
            return None
        cached = self._execution_prep_cache.get(cache_key)
        if not cached:
            return None
        created_at = cached.get("created_at")
        if not isinstance(created_at, datetime):
            self._execution_prep_cache.pop(cache_key, None)
            return None
        if (_utc_now() - created_at).total_seconds() > EXECUTION_PREP_CACHE_TTL_SECONDS:
            self._execution_prep_cache.pop(cache_key, None)
            return None
        return deepcopy(cached.get("payload"))

    def _store_cached_swap_execution(self, cache_key: str, payload: dict[str, Any]) -> None:
        if EXECUTION_PREP_CACHE_TTL_SECONDS <= 0:
            return
        if str(payload.get("status") or "").lower() == "submitted":
            return
        self._execution_prep_cache[cache_key] = {
            "created_at": _utc_now(),
            "payload": deepcopy(payload),
        }

    def _classify_execution_error(self, error: str | None) -> str:
        message = str(error or "").strip().lower()
        if not message:
            return "execution_error"
        if "timed out" in message:
            return "route_timeout"
        if "no avnu liquidity" in message or "no executable" in message or "no liquidity" in message:
            return "route_unavailable"
        if "returned no executable calls" in message or "wallet calls" in message:
            return "wallet_call_build_failed"
        if "quote" in message:
            return "quote_failed"
        if "build" in message:
            return "build_failed"
        if "supports eth, strk, and usdc" in message:
            return "unsupported_asset"
        if "session key" in message:
            return "session_key_invalid"
        return "execution_error"


_service: PortfolioExecutionGateService | None = None


def get_portfolio_execution_gate_service() -> PortfolioExecutionGateService:
    global _service
    if _service is None:
        _service = PortfolioExecutionGateService()
    return _service
