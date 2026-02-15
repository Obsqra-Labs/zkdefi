# Risk Passport Phase 1 — Pre-release UI Checklist

Use this checklist before considering Phase 1 done or before starting Phase 2. Tick items as you verify them.

**Related:** [RISK_PASSPORT_IMPLEMENTATION.md](RISK_PASSPORT_IMPLEMENTATION.md) (implementation summary), [RISK_PASSPORT_NEXT_STEPS.md](RISK_PASSPORT_NEXT_STEPS.md) (what’s next).

---

## Prerequisites

- [x] Backend running (e.g. `http://127.0.0.1:8003`), frontend running, wallet (e.g. ArgentX) on correct network (Sepolia/mainnet per env).
- [x] API base in frontend matches backend (e.g. `frontend/src/lib/config.ts` or env).

---

## Profile page (`/profile`)

- [x] With wallet disconnected: connect prompt or no crash.
- [x] With wallet connected: Overview tab loads; Risk Passport card is visible.
- [x] If user has no passport data: card shows “No passport data yet” and “Run proofs” CTA to `/agent`.
- [x] If user has passport: card shows letter (A/B/C/D with correct color), composite score (0–100), tier name, optional credit tier; up to 5 proof receipts with `proof_type · result` and date.
- [x] If reputation fails (e.g. 301): card may show “Reputation unavailable” or fallback; no uncaught error.

---

## Agent / Rebalancer

- [x] Open “Propose rebalance” modal, select a “To” protocol: “Pool passport (To pool)” line appears; shows “Loading…”, then “Not analyzed yet” or “Safe (score)” / “Not safe (score)”.
- [x] Create proposal → “Run zkML Checks” → “Execute”: after execution, proposal shows “Proof verified: Executed because risk score passed and pool safe.”; if backend returns `tx_hash`, “View on Starkscan” link is present and points to `sepolia.starkscan.co/tx/{tx_hash}` (or mainnet URL if applicable).
- [x] No console errors during modal open, pool passport fetch, or proposal list load.

---

## Optional

- [x] Landing/marketing copy that mentions “Risk Passport” renders (no broken links).
- [x] Health: `GET /api/v1/zkdefi/status` returns 200 (API up).

---

## Frontend improvements (aligned with this week’s work)

- [x] **Execution errors:** AgentRebalancer shows “Execution failed: {proposal.error}” and hides TX line / “completed” when `proposal.error` is set; toast on 200 with `result.execution_error`.
- [x] **Stake-collateral API:** Profile calls stake-collateral with query params `address` and `amount_wei` (ETH → wei); backend expects these, not JSON body.
- [x] **Upgrade-tier API:** Profile sends body `{ address, target_tier, upgrade_proof_hash }` (target_tier = current + 1, upgrade_proof_hash = `"0x0"`); “Already at max tier” handled.
- [x] **ShieldedPoolPanel:** Reputation fetch uses `/api/v1/zkdefi/reputation/user/{address}` (was `/api/v1/reputation/{address}`).
- [x] **Policy / pool stress:** Proposal card shows `proposal.reason`; when policy denies (e.g. “Pool stress too high”), reason is visible; execution_error and proposal.error already surfaced.
