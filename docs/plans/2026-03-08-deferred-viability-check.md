# Deferred items — viability check (past 72h)

**Date:** 2026-03-08  
**Purpose:** Which deferred items from recent plans are still viable vs already done or obsolete.

---

## Still viable (not yet built; dependencies in place)

| Item | Where | Why still viable |
|------|--------|-------------------|
| **P3.4 Reputation feedback loop** | Phase 3 | No execution_outcomes_processor; no receipt to reputation update. Policies, gating, orchestrator exist. |
| **P3.5 Oracle Command Center UI** | Phase 3 | No OracleCommandCenter.tsx; oracle gated-signals, should-execute, policies exist. |
| **P3.6 E2E (signal to execution to receipt to reputation)** | Phase 3 | Depends on P3.4; orchestrator, execution history, receipts already there. |
| **Phase 4 validation** | Phase 4 | 4.1-4.3 code present; deferred part: 1M+ events / 5+ instances testing. |
| **Post-merge feature-flag wiring** | Handoff | Adapters exist; wiring into TradeDesk/oracle behind flags not done. |
| **Optional: real yield forecaster** | Handoff | Still using market-forecaster proxy. |
| **Optional: on-chain proof verification** | Handoff | Placeholder; verification not implemented. |
| **Stability follow-up** | 2026-03-07 stability plan | shielded_deposit 500, toDisplayString, 503 catch-all. |
| **Memory Lane optional** | Memory Lane plan | Polling, CSV export, advanced search, proof UI. |
| **Intelligence surface A2A / BrainVisualizer** | 2026-03-06 design | Design only; implementation deferred. |
| **Branch: control-surface-deferred-auth** | UNFINISHED-WORK-SUMMARY | Branch exists; proof gating + Cairo. |
| **Branch: ui-improvements-pass** | UNFINISHED-WORK-SUMMARY | Branch exists; ARIA/responsiveness started. |
| **Branch: four-surface-rearchitecture** | UNFINISHED-WORK-SUMMARY | Branch exists; orchestration MVP; E2E + relayer + prod guide missing. |

---

## No longer deferred (already done)

| Item | Evidence |
|------|----------|
| **P3.1-P3.2 Policy and gating** | execution_policy_service.py, oracle_gating.py: policies, should-execute, gated-signals. |
| **P3.3 Agent orchestration** | agent_orchestrator.py, agent_execution.py: prepare_execution, relayer, oracle/execute, oracle/execution/history. |
| **Archive query API** | archive_query.py: oracle/archive/events, oracle/health/database. |
| **Analytics endpoints** | analytics.py, analytics_service.py; mounted in main.py. |
| **DCAAdapter and LPAdapter** | DCAAdapter.ts, LPAdapter.ts and tests. TRADE_DESK doc TODO outdated. |
| **Market context (volatility, sentiment, trending)** | trade_desk.py implements these (not placeholders). |

---

## Low priority or superseded

| Item | Note |
|------|------|
| **CapitalOSAdapter to TradeDesk** | Wire when Capital OS V2 branch merges. |
| **tradedesk-real-aggregation frontend** | Backend on main; V2 UI covers most. |
| **Reputation credit UI proof modal** | 2026-03-05 plan; mock in place; optional. |
| **Phase 4.2 multi-instance tested** | Only when running 5+ instances. |
| **Phase 4.1 1M+ events** | When archive scale demands it. |

---

## Summary

- **Still viable:** 13 items (P3.4, P3.5, P3.6, Phase 4 validation, feature-flag wiring, optional yield/proof/stability/Memory Lane/Intelligence, 3 branches).
- **Already done:** 6 items (P3.1-P3.3, archive query, analytics, DCA/LP adapters, market context).
- **Low priority / superseded:** 5 items.

Ref: docs/plans/2026-03-08-gaps-from-recent-plans.md
