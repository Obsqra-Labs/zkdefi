# Gaps from Recent Plans — Status

**Date:** 2026-03-08  
**Sources:** gap-analysis (2026-03-07), phase1 plan, TradeDesk V2 implementation, real-aggregation, all-three-workstreams, phase4, phase2-3 signals.

---

## ✅ Closed (Already Implemented)

| Gap | Plan | Current State |
|-----|------|----------------|
| **Constraints / Policy paths** | Gap-analysis §2.3 | `vault_compat.py` exposes `/api/v1/vault/constraints` and `/api/v1/vault/policy`; frontend uses mc paths; both work. |
| **Governance voting power** | Gap-analysis §2.6 | `dao_governance.get_voting_power` uses real `_compute_capital_breakdown` (LP + lending + staking) + tier; GovernanceOverlay fetches `/api/v1/dao/voting_power`. |
| **PrivacyPoolAdapter / PoolLiquidityManager** | Phase 1 B1 | Both use `apiUrl()` for all requests (getPoolStats, getPoolLiquidity, deposit, withdraw, etc.). |
| **Execution Flow mode** | Gap-analysis §2.5 | CenterStageModes has "Execution Flow" tab; ExecutionFlowPanel fetches `mc/execution/current` and shows 7 steps. |
| **Memory Lane 3-level** | Gap-analysis §2.7 | MemoryLaneForensicPanel: compact list → expanded JSON → "Open Forensic Drawer" (mc/receipts/{id}); search and type filter. |
| **Circuit Board policy** | Gap-analysis §2.8 | CircuitBoard loads/saves via `apiFetch(\`/api/v1/zkdefi/mc/policy/${address}\`)`. |
| **Phase 2 signals** | Phase2-3 plan | Signals use ForecasterAdapter (snapshot_forecaster) and ReputationAdapter; fetch_opportunities prefers V2; metadata phase = phase-2-predictions. |
| **Agent Insights / Limits / DCA** | Gap-analysis §2.9 | Limits and DCA are in OpportunityAggregator; execution via TradeDesk V2 prepare (limit_orders_adapter, dca_service). |
| Deploy shows Trade Desk | Gap-analysis §2.2, Phase 1 | DeployOverlay default tab renders `<TradeDesk />`; no legacy DexPanel/LPPanel as default. |
| Ekubo router mounted | Gap-analysis §2.10, Phase 1 A1 | `main.py` mounts `ekubo_router` under `/api/v1/zkdefi`. |
| Ekubo positions in Deploy | Phase 1 A2/A3 | `lib/api/ekubo.ts`, `EkuboPositionsList.tsx` exist; DeployOverlay has "Ekubo LP positions" + `<EkuboPositionsList />`. |
| Privacy Pools tab + apiUrl | Gap-analysis §2.1, Phase 1 B1 | PrivacyPoolsPanel uses `apiUrl()` for dao positions fetch; three buckets (CONSERVATIVE/MODERATE/AGGRESSIVE). |
| TradeDesk real aggregation | Real-aggregation, V2 impl | V2 API + OpportunityAggregator (8 sources); frontend uses TradeDeskApiService, limit 100, SwapModal. |
| Execution history 500 | Conversation fix | ExecutionStore SQLite schema fixed (no inline INDEX); execution/history returns 200. |
| MemoryLane / ReceiptService | All-three-workstreams §1 | ReceiptService uses `/oracle/execution/history/{address}`; MemoryLane shows receipts. |
| Dark Ledger notes in CapitalLedger | Gap-analysis §2.4 | CapitalLedger calls `apiFetch(\`/api/v1/zkdefi/ledger/notes/${address}\`)` and maps note_count, sweep_available_usd; backend has `ledger.py` GET `/notes/{address}`. |

---

## 🔴 Deferred / Scoped for Later

- **Phase 3 oracle (P3.1–P3.6):** Policy storage, gating engine, Oracle Command Center UI — agent_execution and execution_policy_service exist; full P3 in `docs/plans/2026-03-08-phase2-3-signals-to-execution.md`.
- **Phase 4 (4.1–4.3):** Archive compression and Redis nonce are implemented and wired; analytics endpoint exists. Full scope in `docs/plans/2026-03-08-phase4-optimization.md`.

## Deferred viability check (past 72h)

*Checked against current codebase: which deferred items are still worth doing.*

**Still viable (not yet built):** P3.4 Reputation feedback loop (no execution_outcomes_processor); P3.5 Oracle Command Center UI (no OracleCommandCenter.tsx; gated-signals/should-execute exist); P3.6 E2E test; Phase 4 validation (1M events / 5 instances); post-merge feature-flag adapter wiring; optional real yield forecaster, on-chain proof verification; stability follow-up (shielded_deposit 500, toDisplayString, 503); Memory Lane optional (polling, CSV, proof UI); Intelligence surface A2A/BrainVisualizer; branches control-surface-deferred-auth, ui-improvements-pass, four-surface-rearchitecture.

**No longer deferred (done):** P3.1–P3.2 (policy + gating in execution_policy_service + oracle_gating); P3.3 (agent_orchestrator + agent_execution routes); Archive query API (archive_query.py: /oracle/archive/events, /oracle/health/database); Analytics (analytics.py + analytics_service); DCAAdapter + LPAdapter (implemented with tests); market context volatility/sentiment/trending (trade_desk.py).

**Low priority / superseded:** CapitalOSAdapter wiring (when Capital OS V2 branch merges); tradedesk-real-aggregation frontend (V2 covers it); reputation credit proof modal; Phase 4.1/4.2 scale tests (when needed).

## TradeDesk V2 Implementation Plan — Checklist

From `2026-03-08-tradedesk-v2-implementation.md`:

| Task | Status |
|------|--------|
| 1 UnifiedOpportunity + reputation score + gates | ✅ Done |
| 2 OpportunityAggregator (8 sources) | ✅ Done |
| 3 TradeDesk V2 API (opportunities, market, execute, advisory) | ✅ Done |
| 4 TradeDeskApiService | ✅ Done |
| 5 TradeDesk shell + header | ✅ Done |
| 6 OpportunityExplorer (FilterBar, List, Card) | ✅ Done (+ type counts, scroll, SwapModal) |
| 7 ActionPanel (execution, impact, gating, 3 modes) | ✅ Done (swap → modal; topOpps from opportunities) |
| 8 PrivacySidebar + bug fixes | ✅ Done |
| 9 Wire services to fetchWithRetry | ✅ Done |
| 10 Build, deploy, verify | ✅ Verified |

**V2 plan:** No open tasks. Remaining work is from other plans (gap-analysis, phase2-3, phase4).

---

## Recommended Next Steps

1. **Done (this pass):** Constraints/policy paths, governance voting power, PrivacyPoolAdapter apiUrl, Execution Flow mode, Memory Lane 3-level, Circuit Board and mc/policy, Phase 2 signals, Limits/DCA execution wiring.
2. **When ready:** Phase 3 oracle (P3.1-P3.6) per phase2-3 plan; Phase 4 full scope (4.1-4.3) per phase4 plan if scaling requires it.

---

## Doc References

- `docs/plans/2026-03-07-gap-analysis-plans-vs-builds.md`
- `docs/plans/2026-03-07-phase1-privacy-pools-trade-desk-ekubo.md`
- `docs/plans/2026-03-08-tradedesk-v2-implementation.md`
- `docs/plans/2026-03-08-tradedesk-real-aggregation.md`
- `docs/plans/2026-03-08-all-three-workstreams-design.md`
- `docs/plans/2026-03-08-phase4-optimization.md`
- `docs/plans/2026-03-08-phase2-3-signals-to-execution.md`
