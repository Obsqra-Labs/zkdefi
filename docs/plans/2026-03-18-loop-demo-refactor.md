# Loop Demo Refactor ? Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the landing "Loop" demo into a single-scroll linear flow (identity ? risk ? data ? accept ? receipt ? stream/teaser) so it feels part of the site and preserves all current technical integrations.

**Architecture:** One React tree in `CapitalOSSection`; state for address (connected or demo), risk config, oracle result, execution result. Step 1: two CTAs (Connect wallet | Generate random) and compact identity summary. Step 2: risk picker then oracle stream in one column. Step 3: Accept CTA, receipt below, then IntelligentStream and optional Capital OS teaser. Same section styling as Hero/Proof Flow; no iframe or heavy demo box.

**Tech Stack:** Next.js 14, React, existing `apiFetch`, Starknet wallet adapter (if not already in project), existing demo API routes.

**Design reference:** `docs/plans/2026-03-18-loop-demo-refactor-design.md`

**Design alignment (designer feedback):** Tempo (slow identity ? fast oracle ? weighty execution ? ambient stream); Step 1: Try as guest primary, Connect wallet secondary; identity reveal not load (~600ms sequential); Step 2: no dead zone (preload + animate delta or "Recalculating?"); Step 3: proof summary above Accept, Accept consequential weight, receipt frame + Voyager endpoint, intro line before stream, semantic progress; blocked-trade state (amber, rejection receipt) when `should_execute: False`.

---

## Task 1: Add wallet connection to landing context

**Files:**
- Modify: `frontend/src/app/page.tsx` ? ensure landing can pass a connected address (or null) into the loop section if we add a provider at app level; or skip and handle connect inside the section.
- Create or modify: `frontend/src/components/marketing/CapitalOSSection.tsx` ? add state `identityAddress: string | null` and `identitySource: 'connected' | 'demo'`. For this task, only add the state and a constant `DEMO_ADDRESS`; no UI change yet.

**Step 1:** In `CapitalOSSection`, add:
- `const DEMO_ADDRESS = "0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d";`
- State: `const [identityAddress, setIdentityAddress] = useState<string | null>(null);`
- State: `const [identitySource, setIdentitySource] = useState<'connected' | 'demo' | null>(null);`

Keep existing `onboarded`, `reputation`, etc. for now. Do not remove any existing behavior.

**Step 2:** Run frontend build to confirm no regression.

```bash
cd frontend && npm run build
```
Expected: BUILD succeeds.

**Step 3:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx
git commit -m "refactor(loop): add identity address and source state for two-flow Step 1"
```

---

## Task 2: Step 1 ? Two CTAs (Try as guest primary | Connect wallet secondary)

**Files:**
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`

**Step 1:** Locate the Step 1 block (Reputation Passport). Replace with two CTAs ? **Try as guest** primary (full width, dominant), **Connect wallet** secondary (smaller, lower, or to the side):
- **Try as guest** ? `setIdentityAddress(DEMO_ADDRESS); setIdentitySource('demo'); handleOnboard()`.
- **Connect wallet** ? on click trigger wallet connect; on success `setIdentityAddress(address); setIdentitySource('connected'); handleOnboard()`. If no connect exists, stub "Connect not implemented" for follow-up.

**Step 2:** After either path, identity via **reveal, not load**: no spinner. Sequential reveal (~600ms): tier ? score ? credential hash ? "verified". Reuse ReputationProfile content but animate so it feels discovered. "No wallet needed" only for guest path if at all.

**Step 3:** Run `npm run build` in frontend. Manually test: click "Generate random" ? reputation loads; if Connect exists, test connect ? reputation loads for that address.

**Step 4:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx
git commit -m "feat(loop): Step 1 two CTAs ? Connect wallet and Generate random"
```

---

## Task 3: Wire Starknet wallet connect for landing (if not present)

**Files:**
- Check: `frontend/src/components/marketing/SiteHeader.tsx` or `frontend/src/app/layout.tsx` for existing connect.
- Create or modify: provider/context that exposes `address: string | null` and `connect: () => Promise<void>` for the landing. If already present, skip this task and document where connect lives in the plan.

**Step 1:** If no connect exists, add a minimal Starknet connect (e.g. via `getStarknet` or project?s chosen adapter) in a context or in the section. On connect success, call the callback passed from `CapitalOSSection` (e.g. `onConnected(address)`).

**Step 2:** In `CapitalOSSection`, when "Connect wallet" is clicked, call that connect; on success set `identityAddress` and `identitySource('connected')` and run reputation fetch.

**Step 3:** Run build and quick manual test.

**Step 4:** Commit.

```bash
git add [files changed]
git commit -m "feat(loop): wire Starknet wallet connect for Step 1"
```

---

## Task 4: Step 2 ? Linear layout and no dead zone (risk first, oracle below)

**Design:** No dead zone: preload balanced results; animate delta when risk changes. Fallback: Recalculating skeleton (not Loading).

**Files:**
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Modify: `frontend/src/components/marketing/TrustDemo.tsx` (only if layout props needed)

**Step 1:** Remove the two-column layout (sticky CapitalBrain sidebar + TrustDemo). Replace with a single column:
- First block: risk picker only (extract or reuse CapitalBrain?s risk slider and presets: Conservative / Balanced / Aggressive). Optionally keep skill toggles and protocol weights in an "Advanced" collapsible; for minimal change, keep current CapitalBrain but render it full-width above the oracle.
- Second block: TrustDemo content (oracle results ? pools, primary recommendation, proof hashes) rendered directly below. No sidebar.

**Step 2:** Remove or simplify `FlowConnector` between Step 1 and Step 2 (no dashed "?" line). Use normal section spacing.

**Step 3:** Ensure when risk (and any other config) is set, TrustDemo still receives `riskTolerance`, `enabledSkills`, `protocolWeights` and `triggerKey` so oracle fetches. Verify `onResult` still sets `oracleResult` for Step 3.

**Step 4:** Run build. Manually test: complete Step 1, set risk, confirm oracle table/cards appear below.

**Step 5:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx [and TrustDemo if modified]
git commit -m "refactor(loop): Step 2 linear ? risk picker then oracle stream in one column"
```

---

## Task 5: Step 3 ? Accept (weight), proof summary, receipt frame, blocked state, stream intro

**Files:**
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Modify: `frontend/src/components/marketing/AgentExecutionLoop.tsx` (optional: accept a prop to hide the duplicate "oracle feed" header if it?s redundant with Step 2)

**Step 1:** Recommendation block (pool, APY, risk, one-line reasoning). Proof summary line above button (e.g. 13 circuits screened, risk within bounds, ready to execute). Button Accept recommendation full width, slightly larger, consequential styling. On click: same flow as Run loop (simulate-and-execute, then proof-of-performance).

**Step 2:** Receipt below button, same column, no modal. Visual frame (border or verified badge); Voyager link last in receipt block. If API returns should_execute false: blocked state ? amber, copy "The proof gate blocked this trade. Risk threshold exceeded.", show rejection receipt.

**Step 3:** Below receipt: one intro line (e.g. "Your agent, running."), then IntelligentStream, then optional Capital OS teaser. Remove or simplify FlowConnector between Step 2 and Step 3.

**Step 4:** Run build. Manually test: full flow through receipt and stream intro.

**Step 5:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx frontend/src/components/marketing/AgentExecutionLoop.tsx
git commit -m "feat(loop): Step 3 Accept weight, proof summary, receipt frame, blocked state, stream intro"
```

---

## Task 6: Add IntelligentStream below receipt

**Files:**
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Use: `frontend/src/components/marketing/IntelligentStream.tsx` (existing)

**Step 1:** Below the receipt, show one intro line (e.g. "Your agent, running." or "The system does not stop at execution.") then render IntelligentStream. Import `IntelligentStream`; render `<IntelligentStream walletAddress={identityAddress ?? DEMO_ADDRESS} />`. Only mount when `identityAddress` is set and optionally when Step 3 has run (design: below receipt, so prefer after execution).

**Step 2:** Pass the current loop identity (connected or demo) so the stream shows events for that address. If the demo stream API expects a different param, use existing `DEMO_ADDRESS` for demo path and connected address for connect path.

**Step 3:** Run build. Manually test: complete loop, scroll down, see event stream below receipt.

**Step 4:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx
git commit -m "feat(loop): add IntelligentStream below receipt"
```

---

## Task 7: Add Capital OS teaser below stream

**Files:**
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Reference: `frontend/src/lib/demoCapitalOS.ts` for strip/teaser data

**Step 1:** Below IntelligentStream, add a short "Capital OS" teaser: one line of copy (e.g. "This is what you?d see in Capital OS") and a link to `/agent`. Optionally render a minimal strip-style summary (e.g. tier, receipt count) using `DEMO_STRIP` or static text.

**Step 2:** Style to match landing (same typography, link color). No heavy card; keep it one small block.

**Step 3:** Run build. Manually test: scroll to bottom of loop, see teaser and link to /agent.

**Step 4:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx
git commit -m "feat(loop): add Capital OS teaser below stream"
```

---

## Task 8: Unify section styling (no embedded feel)

**Files:**
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Reference: `frontend/src/app/page.tsx` for `section-dark`, `section-sep`, max-width classes

**Step 1:** Audit the Loop section wrapper and inner divs. Remove any iframe, thick border, or "app" frame that makes it look like an embedded widget. Use the same max-width (e.g. `max-w-5xl` or `max-w-6xl` as in page) and same section spacing as Hero and Proof Flow.

**Step 2:** Ensure headings in the loop use the same font and size pattern as the rest of the landing (e.g. `font-serif`, existing text sizes). Ensure "Interactive Demo" / "The loop that makes private DeFi work" and step labels use the same mono/serif as other sections.

**Step 3:** Run build and a full scroll-through of the landing. Confirm the loop reads as one continuous page.

**Step 4:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx
git commit -m "style(loop): unify section styling with landing"
```

---

## Task 9: Error and loading handling

**Files:**
- Modify: `frontend/src/components/marketing/CapitalOSSection.tsx`
- Modify: `frontend/src/components/marketing/AgentExecutionLoop.tsx` (if not already)

**Step 1:** Step 1: if wallet connect fails, show inline message; "Generate random" remains clickable. If reputation fetch fails, fall back to seeded demo data (existing behavior).

**Step 2:** Step 2: if oracle fetch fails, show retry or short message; Accept in Step 3 disabled when there is no `oracleResult`.

**Step 3:** Step 3: if execute or proof-of-performance fails, show error below CTA and allow retry. When API returns should_execute false, use designed blocked state (amber, rejection receipt, proof-gate copy) per design doc ? not generic error. Receipt only shown on success for execute path; show rejection receipt for blocked path.

**Step 4:** Run build. Manually test failure cases (e.g. disconnect network for one request) if feasible.

**Step 5:** Commit.

```bash
git add frontend/src/components/marketing/CapitalOSSection.tsx [and AgentExecutionLoop if modified]
git commit -m "fix(loop): error and loading handling for all steps"
```

---

## Task 10: Smoke test and docs

**Files:**
- Modify: `docs/plans/2026-03-18-loop-demo-refactor-design.md` (add "Implemented" note or leave as-is)
- Optional: `README.md` or `docs/` ? one line on "Landing Loop demo: connect or guest ? risk ? accept ? receipt ? stream."

**Step 1:** Full manual pass: Connect wallet ? set risk ? see oracle ? Accept ? see receipt ? scroll to stream and teaser. Then: Generate random ? same flow. Confirm no regressions on mobile viewport (single column, no overflow).

**Step 2:** If the project has E2E or integration tests for the landing, run them and add one test that clicks "Generate random" and checks for reputation or Step 2 visibility (optional).

**Step 3:** Commit any doc updates.

```bash
git add [docs if changed]
git commit -m "docs: loop demo refactor implemented"
```

---

## Execution summary

| Task | Summary |
|------|--------|
| 1 | Add identity address/source state in CapitalOSSection |
| 2 | Step 1 Try as guest primary, Connect secondary; identity reveal |
| 3 | Wire Starknet wallet connect (if missing) |
| 4 | Step 2 linear, no dead zone: risk then oracle below |
| 5 | Step 3 Accept weight, proof summary, receipt frame, blocked state, stream intro |
| 6 | IntelligentStream below receipt |
| 7 | Capital OS teaser below stream |
| 8 | Unify section styling with landing |
| 9 | Error and loading handling |
| 10 | Smoke test and docs |

---

**Plan complete and saved to `docs/plans/2026-03-18-loop-demo-refactor.md`.**

Two execution options:

1. **Subagent-driven (this session)** ? I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel session (separate)** ? Open a new session with executing-plans and run through the plan with checkpoints.

Which approach do you want?
