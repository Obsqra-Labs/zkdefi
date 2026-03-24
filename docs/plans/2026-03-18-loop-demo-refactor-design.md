# Loop Demo Refactor — Design

**Date:** 2026-03-18  
**Status:** Approved (Approach A) · Updated with designer feedback (tempo, hierarchy, reveal, dead zone, Accept weight, receipt frame, stream intro, semantic progress, blocked state).  
**Goal:** Make the landing "Loop" demo feel part of the site, with a single linear flow: identity → risk → data → accept → receipt → continue down — and with distinct *tempo* and *weight* per step.

---

## 1. Requirements (validated)

| Requirement | Choice |
|-------------|--------|
| Step 1 entry | Two flows: **Connect wallet** or **Generate random** (guest). **Primary CTA = Try as guest** (full width, dominant); Connect wallet = secondary (smaller, lower, or to the side). |
| Step 2 layout | **Linear flow:** pick risk appetite first, then oracle stream below. **No dead zone:** preload balanced results; oracle updates *while* slider moves (real-time). |
| Step 3 CTA | Single **Accept recommendation** with **proof summary line above** and **full-width weight**; receipt below with **visual frame** and **Voyager link as endpoint**. |
| After receipt | **One intro line** before IntelligentStream (e.g. "Your agent, running."); then stream; then Capital OS teaser. |
| Progress | **Semantic:** dots/labels reflect "what just happened" — identity dot fills when identity resolves; receipt dot fills when receipt appears. Mini receipt of the demo. |
| Blocked trade | **Designed state:** when `should_execute: False`, amber (not red), copy "The proof gate blocked this trade. Risk threshold exceeded." Show **rejection receipt**; proves the system *decides*. |
| Integration | **Approach A:** Single scroll, steps unfold in place. Same section styling as Hero/Proof Flow (no iframe, no heavy demo box). |

---

## 2. Tempo (speed of each step)

The loop has four rhythms. Design the *speed* of each step, not just the layout.

| Step | Tempo | Design implication |
|------|--------|---------------------|
| **Identity** | **Slow, deliberate** | Feels personal. No loading spinner; use a **reveal** (tier → score → credential hash → "verified") over ~600ms so it feels *discovered*, not fetched. |
| **Oracle / risk** | **Fast, responsive** | Feels alive. Preload balanced results; **animate the delta** as the user moves the risk slider. No dead zone between "I moved the slider" and "results update." |
| **Execution** | **Weighty, final** | Accept button is the most consequential interaction. Full width, slightly larger, with proof summary line above. Receipt has a **visual frame** (border/background/verified badge); Voyager link is the **visual endpoint** — the moment the demo becomes real. |
| **Stream** | **Passive, ongoing** | Feels continuous. One intro line ("Your agent, running.") then the feed. No urgency; the loop doesn't stop at the receipt. |

---

## 3. Architecture

- **Location:** Landing page section "The Loop" (`#capital-os`) remains the home; content and layout of `CapitalOSSection` (and its children) are refactored.
- **State:** One React tree. Step 1 outcome (connected address vs demo address), Step 2 risk config, and Step 3 oracle result + execution state live in `CapitalOSSection` (or a dedicated wrapper). No route changes.
- **APIs:** Unchanged. Demo reputation by address, TrustDemo/oracle by risk config, simulate-and-execute, proof-of-performance. For "Connect wallet" we use the connected address; for "Generate random" we keep using a fixed demo address (or a newly generated one if we add that).
- **New/repurposed UI:** IntelligentStream and optional "Capital OS preview" (strip + link to /agent) appear below the receipt in Step 3.

---

## 3. Step-by-step flow

### Step 1 — Identity (wallet or guest)

- **Hierarchy:** Lead with the frictionless path. **Try as guest** is the **dominant CTA** — full width, immediate, primary styling. **Connect wallet** is **secondary** — smaller, lower, or to the side (power-user option). Visitors who need convincing should feel zero friction to start.
- **Copy:** Single block that emphasizes the guest path (e.g. "Try the loop in one click" with "Connect wallet" as a text or secondary button below).
- **After either path — identity reveal, not load:** Do **not** show a loading spinner. The identity card is the first climax: it should feel *discovered*, not fetched. **Sequential reveal** (~600ms): tier appears first, then score, then credential hash, then a subtle "verified" state. The user should feel *recognized*, not that a profile loaded. Reuse or slim `ReputationProfile` content but animate its appearance.
- **No FlowConnector** — next content is simply the next block down (risk picker).

### Step 2 — Risk and intelligent data (linear)

- **Risk picker first:** Slider and/or presets (Conservative / Balanced / Aggressive). Same semantics as CapitalBrain `riskTolerance`; optionally skills/weights in "Advanced."
- **No dead zone:** The moment between "I moved the slider" and "results update" must not read as broken. **Preload balanced results** and **animate the delta** when risk changes — the visitor should see oracle results change *while* they move the slider. If full real-time is costly, fallback: a skeleton that clearly says "Recalculating…" (not "Loading…"). Prefer real-time; it proves the system is alive.
- **Oracle stream below:** When risk (and optionally other settings) are set, the oracle results appear directly underneath: pool cards or table, primary recommendation, proof hashes. This is the current TrustDemo content, reflowed into a single column. No sidebar; layout is vertical. Optional: short line like "62+ pools · 13 circuit checks" to keep the proof story visible.
- **Cause-effect:** The narrative is "I set risk → here’s what the system shows me." Same typography and spacing as the rest of the landing.

### Step 3 — Accept and receipt, then continue down

- **Recommendation block:** Top opportunity clearly shown (pool, APY, risk, one-line reasoning).
- **Proof summary line:** Directly above the button, one line: e.g. *"13 circuits screened · risk within bounds · ready to execute."* The user reads the summary, clicks the button, knows exactly what they authorized.
- **Accept button — consequential weight:** Not a form submit. Full width within its column, slightly larger than surrounding text. Visually distinct from every other button on the landing — the most consequential interaction (proof generation, execution, receipt). It should feel like a confirmation of everything that came before.
- **Single CTA:** One button: "Accept recommendation." On click: run existing execute + proof flow (simulate-and-execute → proof-of-performance). Show loading state (e.g. "Executing…" / "Generating receipt…").
- **Receipt — visual frame and endpoint:** Do not drop a raw receipt into the scroll. It needs a **visual frame**: subtle border treatment, different background tone within the same palette, or a small "verified" badge before the hash. Signal "stop here, this matters." The **tx hash linking to Voyager** is the last element in the receipt block — the moment the demo becomes real; make it the visual endpoint, not an afterthought.
- **Blocked trade state:** When the API returns `should_execute: False`, do **not** treat as a generic error. **Designed state:** amber (not red), one line: *"The proof gate blocked this trade. Risk threshold exceeded."* Show the **rejection receipt** anyway. The visitor learns that the system doesn't just execute — it *decides*. Make the blocked state a feature; it's the strongest demo moment for the proof gate.
- **Continue down:** One **intro line** before the stream (e.g. *"Your agent, running."* or *"The system doesn't stop at execution."*). Then **IntelligentStream** — feed of events (onboarded, session_key_issued, trade, proof_generated, etc.) for the current identity. Poll existing `/api/v1/demo/stream/{address}` (or equivalent). Gives "AI continues to monitor" feel.
  - **Capital OS teaser (optional):** Short line + strip-style preview: "This is what you’d see in Capital OS" with link to `/agent`. Can reuse strip data from `demoCapitalOS` or a minimal inline summary.
- **Scroll:** No jump to another section; user scrolls down to see stream and teaser. Story doesn’t end at the receipt.

---

## 4. Visual and UX consistency

- **Sections:** Use same `section-*`, max-width, and spacing as Hero and Proof Flow. No iframe, no thick border or "app" frame around the loop.
- **Typography:** Reuse existing landing font stack and sizes (e.g. font-serif for headings, font-mono for addresses/code).
- **Colors:** Existing zinc/emerald/cyan/violet/fuchsia palette; passport/identity can keep fuchsia/violet accents; oracle/receipt stay cyan/emerald where they already do.
- **Progress indicator — semantic, not decorative:** Not just "where am I" but "what just happened." After identity resolves, the identity dot fills or changes color permanently. After receipt (or rejection receipt), the execution dot fills. The progress indicator becomes a **receipt of the demo itself** — a mini proof that each stage completed. On-brand; gives returning visitors an immediate read of their state.

---

## 5. Components to refactor / introduce

| Component | Action |
|-----------|--------|
| `CapitalOSSection` | Refactor into the single-scroll flow: Step 1 (two CTAs + identity summary), Step 2 (risk + oracle in one column), Step 3 (Accept + receipt + stream + teaser). Owns state for address, risk config, oracle result, execution result. |
| Wallet connect | Add or reuse a Starknet connect (e.g. in header or inline). When connected, pass address into CapitalOSSection for reputation and stream. |
| Step 1 block | New or extracted: "Connect wallet" + "Generate random" CTAs; compact identity summary after either path. |
| Step 2 block | Risk picker (from CapitalBrain) + TrustDemo content below, single column. Optionally collapse skills/weights into "Advanced." |
| Step 3 block | Recommendation card + "Accept recommendation" CTA; receipt below; then IntelligentStream + optional Capital OS teaser. |
| AgentExecutionLoop | Keep execute + proof logic; optionally rename or reuse as "execution block" that only renders the CTA + receipt (no duplicate oracle UI). |
| IntelligentStream | Use below receipt; feed it the current identity address (connected or demo). |
| FlowConnector | Remove or replace with simple spacing; no dashed "↓" between steps. |

---

## 6. Data flow

- **Identity:** `address: string` (connected wallet or demo address). Set by Step 1.
- **Reputation:** Fetched when identity is set; `GET /api/v1/demo/reputation/{address}`. Stored and passed to Step 3 (and optionally shown in Step 2 for context).
- **Risk config:** `riskTolerance` (and optionally `enabledSkills`, `protocolWeights`) from Step 2; triggers TrustDemo/oracle fetch. Same API as today.
- **Oracle result:** `AnalysisResult` from TrustDemo; drives "top opportunity" and Accept → execute.
- **Execution:** POST simulate-and-execute, then POST proof-of-performance; receipt + proof shown below CTA.
- **Stream:** GET demo stream by `address` for IntelligentStream below receipt.

---

## 7. Error and loading

- **Step 1:** If wallet connect fails, show inline message; "Generate random" always available. If reputation fetch fails, fall back to seeded demo data (as today).
- **Step 2:** If oracle fetch fails, show retry or message; don’t block Step 3 UI (e.g. disable Accept if no oracle result).
- **Step 3:** If execute or proof fails (generic error), show error below CTA; allow retry. Receipt only shown on success.
- **Step 3 — blocked trade:** When API returns `should_execute: False`, use the **designed blocked state** (amber, rejection receipt, proof-gate copy), not the generic error state. See Step 3 flow above.

---

## 8. Out of scope for this design

- Changing backend demo APIs.
- Adding a full "wizard" stepper (Back/Next) or route-based steps.
- Redesigning the rest of the landing (Hero, Proof Flow, etc.) beyond ensuring the loop uses the same section styling.

---

## 9. Success criteria

- User can complete the loop in one scroll: identity (connect or guest) → set risk → see oracle data → Accept → see receipt → see stream and Capital OS teaser.
- The loop feels part of the landing (same layout and style), not an embedded app.
- Cause-effect is clear: "I did this → it affected this → next thing below."
- Technical integrations preserved: wallet (when used), demo reputation, oracle, simulate-and-execute, proof-of-performance, stream API.

---

## Designer feedback (2026-03) — incorporated

1. **Tempo:** Four speeds — slow (identity) → fast (oracle/risk) → slow (execution) → ambient (stream). Design the *speed* of each step.
2. **Step 1 hierarchy:** Try as guest = primary CTA (full width, dominant); Connect wallet = secondary (power-user). Lead with frictionless path.
3. **Identity card:** Reveal, not load — no spinner; sequential reveal (~600ms): tier → score → hash → verified. Feels *discovered*.
4. **Step 2 dead zone:** Preload balanced results; animate delta as slider moves. Real-time response or "Recalculating…" skeleton.
5. **Accept button:** Consequential weight — full width, slightly larger; proof summary line above. Not a form submit.
6. **Receipt:** Visual frame (border/background/verified badge); tx hash → Voyager as last element (visual endpoint).
7. **Stream intro:** One line before IntelligentStream (e.g. "Your agent, running.") so stream reads as the point.
8. **Progress indicator:** Semantic — dots reflect "what just happened"; fill when stage completes. Mini receipt of the demo.
9. **Blocked trade:** Designed state when `should_execute: False` — amber, rejection receipt, copy "The proof gate blocked this trade…". Feature, not error.

---

*Next: implementation plan via writing-plans skill.*
