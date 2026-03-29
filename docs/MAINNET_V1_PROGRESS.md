Mainnet V1 Progress
===================

Purpose: track the narrow `/portfolio` mainnet-v1 lane as it moves from preview to live.

What Is Live
------------
1. `/portfolio` single-surface flow
2. Execution gate check + receipts
3. Wallet-signed execution preview and live submission (guarded)
4. Route selection with `best` (AVNU first on mainnet, Ekubo fallback)
5. Receipt timeline with normalized statuses and tx polling
6. Rebalance prepare → review → sign flow
7. Minimum-amount guardrails for swaps/rebalances
8. Policy controls (pause, slippage, cooldown, max value, min amounts) on `/portfolio`
9. Backend tx status worker for wallet-signed receipts
10. Session key API + signature verification for registration
11. Rebalance allocation review card aligned with vault funding UX
12. AI recommendation card now distinct from user sliders (apply + gate check buttons)
13. `/portfolio` recommendation endpoint now uses the real strategy allocator contract from `/agent`
14. AI recommendation now includes allocator sleeves, APY, genome, provenance, and a derived mainnet-v1 token rebalance plan
15. Drift monitor now shows `aligned / watch / rebalance` status against the AI target mix
16. Drift attribution now explains likely causes such as recent swaps, deposits, prior rebalances, or market movement
17. Policy edits now create audit receipts with before/after diffs in the same receipt timeline
18. Background allocator monitor now reviews recent wallets and emits drift-monitor receipts when status escalates or persists
19. Recommendation payload now includes monitor review timestamps so `/portfolio` can show when the allocator last reviewed the wallet
20. `/portfolio` layout now treats the action loop as the primary surface, with an explicit `set target -> run gate -> sign` operating rail
21. `/portfolio` now has a venue-readiness rail that distinguishes live spot execution from partially wired LP / staking / lending work
22. Adapter rollout guidance is now documented in `docs/PORTFOLIO_MAINNET_UX_AND_ADAPTER_ROADMAP.md`
23. Execution gate now blocks fee-inefficient tiny actions before wallet signing
24. Rebalance construction now preserves a STRK gas buffer instead of selling through the fee token
25. Receipt lifecycle is now authoritative server-side: `ready_to_sign -> submitted -> accepted -> confirmed -> failed`
26. Execution gate now emits structured check / execute / confirm logs for production debugging
27. `/portfolio` now exposes execution-health telemetry with recent failures, in-flight actions, and success-rate summary
28. `/portfolio` frontend redesign spec is now documented component-by-component in `docs/PORTFOLIO_FRONTEND_SPEC.md`
29. Execution prep now uses short-lived route caching and explicit failure buckets so repeated wallet flows are faster and telemetry distinguishes quote, route, timeout, and wallet-build failures
30. Gate checks can now optionally pre-warm execution previews so the desk can reuse the approved route during wallet signing instead of rebuilding it from scratch
31. `/portfolio` frontend split is now live on real product-named components including `PortfolioHeaderStrip`, `PortfolioMainDesk`, `PortfolioRightRail`, `AIRecommendationCard`, `TargetEditor`, `PrimaryActionTray`, `ExecutionPlanCard`, and `SafetyDrawer`
32. The portfolio frontend module contract is now centralized in `frontend/src/components/portfolio/types.ts` and `formatters.ts`, reducing duplicate shell logic and trimming `/portfolio` first-load code
33. Receipt/event labeling, allocation normalization, and chain helper logic are now centralized in `frontend/src/components/portfolio/helpers.ts`, further shrinking `page.tsx` toward pure shell orchestration
34. Execution math, wallet-call assembly, approval optimization, and execution error extraction are now centralized in `frontend/src/components/portfolio/execution.ts`, removing another large duplicate helper slab from `page.tsx`
35. `/execute` now bypasses cached preview quotes while the frontend expires stale prepared routes before wallet signing, reducing `Insufficient tokens received` failures from stale rebalance quotes
36. Portfolio API request shapes and intent/policy builders are now centralized in `frontend/src/components/portfolio/api.ts`, moving backend payload contracts out of `page.tsx` and keeping the shell closer to fetch/state orchestration
37. `/portfolio` page orchestration now lives in `frontend/src/components/portfolio/usePortfolioPageShell.ts`, leaving `page.tsx` as a much thinner composition layer and trimming `/portfolio` first-load JS further
38. The remaining disconnected zero-state and capital-overview shell blocks now live in `PortfolioDisconnectedState.tsx` and `PortfolioCapitalOverview.tsx`, leaving `page.tsx` nearly pure route composition
39. Header, AI recommendation, execution plan, and primary action tray have been tightened toward a calmer consumer desk feel: clearer labels, stronger plan emphasis, and a more deliberate single-action surface
40. The target editor is now calmer and denser: cleaner swap ticket, stronger allocation overview, clearer target-total signal, and rebalance rows that read as allocation decisions instead of generic controls
41. The allocation overview, safety panel, and right rail now read more like a consumer desk: balances lead the rail, current mix is shown as one calmer allocation surface, and the primary safety section no longer uses backend-style gate wording
42. The safety drawer now follows the product hierarchy of blockers, warnings, passed checks, and then the full matrix, while the remaining route-level error banner has been replaced with a calmer portfolio-specific notice
43. Mobile and motion behavior is now calmer: the right rail collapses into mobile accordions with balances open first, the safety drawer expands smoothly instead of popping in, and CTA/status surfaces animate state changes more deliberately
44. Empty and unavailable states now read intentionally: no-portfolio and unsupported-asset wallets get a dedicated allocation shell, AI unavailability stays local to the AI card instead of escalating into page error chrome, and gate/policy refresh failures use calmer retry copy
45. The first-screen allocation story is now more coherent: current mix, your target, AI target, and move-needed deltas live in one overview frame instead of reading like separate strips
46. Redundant composition surfaces have been trimmed: the main capital panel now owns the current-allocation story, the rail balances list is more compact and secondary, and guardrails now sit above recent activity in the right rail
47. Above-the-fold hierarchy now reads in product order: the execution plan sits before the final safety-and-signing block, the header emergency control has been demoted from a dominant red bar into a calmer trading-control row, and the AI/plan/action surfaces use lighter shell weight so the desk feels less component-stacked
48. The redundant balances rail has been replaced with a deterministic risk-posture rail: canonical passport score, predictive credit model signal, and relayer/execution/lending decision modes now provide secondary trust context without duplicating the wallet-allocation surface
49. The trust-and-risk rail now handles canonical profile fetch failures explicitly instead of spinning forever: portfolio passes through risk loading/error state, the rail shows retryable fallback messaging, and only shows a spinner while the profile request is actually in flight
50. Canonical trust fetches now degrade cleanly in production when `/api/v1/zkdefi/risk_profile/v2/{address}` is missing: the frontend maps the still-live legacy reputation, passport, onboarding, linked-address, session, and governance endpoints into a best-effort v2 trust shape, while the frontend CSP also now permits the configured `*.lava.build` Starknet RPC host
51. Canonical trust routing is restored end-to-end: the backend `risk_profile` router now loads again after restoring backward compatibility for legacy session-service imports, public `risk_profile/v2` returns `200` again, and the frontend dead-route cache now expires quickly instead of pinning a whole browser session to legacy fallback

Key Files
---------
1. `backend/app/services/portfolio_execution_gate.py`
2. `backend/app/api/routes/execution_gate.py`
3. `backend/app/services/strategy_recommendation_service.py`
4. `backend/app/services/avnu_execution_service.py`
5. `backend/app/workers/portfolio_tx_status_worker.py`
6. `backend/app/api/routes/session_keys.py`
7. `backend/app/services/session_key_service.py`
8. `frontend/src/app/portfolio/page.tsx`
9. `frontend/src/lib/pendingTx.ts`
10. `frontend/src/components/zkdefi/vault/FundVaultPanel.tsx`
11. `docs/MAINNET_PORTFOLIO_DEPLOY.md`
12. `docs/SESSION_KEY_EXECUTION.md`
13. `backend/app/services/portfolio_monitor_service.py`
14. `backend/app/workers/portfolio_monitor_worker.py`
15. `docs/PORTFOLIO_MAINNET_UX_AND_ADAPTER_ROADMAP.md`
16. `docs/PORTFOLIO_FRONTEND_SPEC.md`
17. `frontend/src/app/portfolio/page.tsx`

Operational Defaults
--------------------
1. Mainnet mode is preview-only until both flags are set:
   - `EXECUTOR_LIVE_SUBMIT_MAINNET=true`
   - `EXECUTION_GATE_ALLOW_MAINNET_LIVE=true`
2. Wallet signing is the default execution path.

Gaps Remaining
--------------
1. Session keys / delegated execution use inside the execution gate (server-side signing path)
2. Extended swap/rebalance test coverage on mainnet assets
3. Receipt-aware drift explanations could be upgraded with better deposit/withdraw labeling across non-portfolio flows
4. Session key UI for create/list/revoke on `/portfolio`
5. Delegated execution should remain explicit about trust boundaries until there is a true non-custodial signing path
6. Production telemetry now has a compact UI surface, but still needs true dashboarding / alerting
7. `frontend/src/app/portfolio/page.tsx` is now nearly pure composition; the next cleanup pass should decide whether the remaining route-level error banner also belongs in a dedicated surface component

Notes
-----
Keep this doc updated when behavior changes, so deploys and demos stay coherent.

Recent Progress
---------------
1. Restored canonical trust profile routing after the backend import chain stopped skipping `app.api.risk_profile`; `/api/v1/zkdefi/risk_profile/v2/{address}` is live again.
2. Added session-key compatibility methods on the SQLite-backed service so legacy trust/profile callers and contract tests share one source of truth.
3. Fixed the mounted session-key list route shape so `/api/v1/zkdefi/session_keys/list/{address}` returns a real summary instead of `404`, which restores session history visibility inside the trust bundle.
4. Tightened the `/portfolio` right rail so current portfolio risk and historical trust context read as one coherent secondary surface, while staying explicitly separate from signing safety.
5. Compressed the `/portfolio` right rail further by removing one trust card and reducing vertical density across risk, guardrails, and recent activity so lower-priority sections sit higher on desktop.
6. Compressed the `/portfolio` main desk by tightening the AI recommendation card, execution plan, target editor shell, and primary action tray so more of the recommendation-to-signing path fits above the fold on shorter laptop screens.
7. Reduced the vertical weight of the `/portfolio` header strip so wallet identity, portfolio value, trust, drift, safety, and trading controls still read clearly while giving the main desk more first-screen room.
8. Reframed the `/portfolio` refinement pass around the actual allocation decision: the right rail now shows allocation-specific checks instead of the overbuilt trust-profile readout, the AI recommendation card now uses a cleaner target-plus-changes layout, and the main safety block now exposes the gate as a visible passed / warning / blocker snapshot for the current draft.
9. Tightened mainnet execution economics: the desk now shows draft value moved, estimated fee, and fee share directly in the gate surface, while the backend gas model now estimates wallet-signed rebalance costs more conservatively and blocks drafts that would strand too little STRK for fees.
10. Small-wallet rebalances now simplify toward one dominant move instead of fanning out into multiple tiny legs, wallet execution now merges duplicate approvals before signature, and the target editor now gives signable-target guidance when the gate says the current draft is too fee-heavy or too STRK-constrained.
11. Fixed `/portfolio` gate-state coherence bugs so fresh failed checks no longer fall back to a fake `Drafting` state, fee-efficiency failures now count as blockers when they truly block, and the rebalance sign path no longer has a silent no-op branch when wallet-prepared calls exist.
12. Relaxed the fee-efficiency policy for tiny single-step mainnet rebalances: if a route exists, the desk can now allow it with a `Safe, but expensive for size` warning instead of hard-blocking solely on small-wallet fee share.
13. Reframed `/portfolio` around a Gate-first product story: the main desk now opens with a dominant Gate hero, moves the primary CTA into that decisive surface, pulls the model proposal directly beneath it, compresses impact into a smaller set of before/after cards, and leaves deep checks in the drawer instead of letting infrastructure detail compete with the decision moment.
