Portfolio Frontend Spec
=======================

Purpose
-------
Define the frontend contract for `zkde.fi/portfolio` as a narrow mainnet-v1 product surface.

This spec assumes the current scoped implementation:
1. Mainnet wallet-signed spot swaps
2. Mainnet token-only rebalances
3. Offchain gate + receipts + monitoring
4. No direct LP / lending / staking execution in the primary flow yet

Design Goal
-----------
The current page works, but it behaves like an operator console. The redesign should behave like a consumer allocation desk.

The user mental model should be:
1. What do I have?
2. What should I do?
3. Why?
4. What will happen if I sign?
5. Is it safe?

Not:
1. What venue is selected?
2. Which executor mode am I in?
3. What are the raw system receipts?
4. What internal proof or monitoring subsystem fired?

Product Contract
----------------
The main surface should only present:
1. Current holdings
2. Current allocation
3. User target or AI target
4. Why the rebalance is being suggested
5. Exact trades that will happen
6. Clear safety state
7. One primary action

Everything else is secondary.

Above-the-Fold Rule
-------------------
At first render on desktop, the user should see the following without scrolling:
1. portfolio value
2. current vs target allocation
3. one recommendation
4. exact plan summary
5. one dominant primary CTA
6. current safety state

If a component does not support one of those six things, it does not belong above the fold.

Page Information Architecture
-----------------------------
Use a 3-zone layout.

1. Header strip
   - wallet identity
   - portfolio value
   - drift state
   - one-line trust state

2. Main desk
   - current vs target
   - AI recommendation
   - trade plan
   - primary CTA

3. Right rail
   - balances
   - guardrails
   - recent activity

Advanced system detail should move into drawers, not stay in the main desk.

Primary States
--------------
The desk should only expose three top-level working states:
1. `Drafting`
2. `Ready to sign`
3. `Submitted`

Optional fourth state:
4. `Needs adjustment`

Do not expose backend or infra states as first-class product states.

Do not use these as primary labels:
1. `prepared`
2. `preview-only`
3. `executor preview`
4. `allowed`
5. `blocked`

Use these instead:
1. `Safe to sign`
2. `Needs adjustment`
3. `Wallet signing mode`
4. `Submitted`
5. `Confirmed`

Locked Product Vocabulary
-------------------------
Do not improvise alternative status language in implementation.

Allowed safety labels:
1. `Safe to sign`
2. `Needs adjustment`
3. `Quote expired`
4. `Wallet mismatch`
5. `Submitted`
6. `Confirmed`

Allowed economic labels:
1. `Safe, but expensive for size`
2. `Too small to execute efficiently`
3. `Exceeds slippage limit`
4. `Exceeds max action size`
5. `Insufficient gas reserve`

Do not invent adjacent labels such as:
1. `healthy`
2. `ready`
3. `trusted`
4. `protected`
5. `preview`
6. `normal`

Trust vs Safety
---------------
Do not merge trust and safety into a single concept.

Definitions:
1. `Trust` = historical profile quality or reputation
2. `Safety` = whether the current action is signable right now

UI rule:
1. trust may appear as a profile-grade or historical indicator
2. safety must appear as the current execution state
3. they must never share one badge or one label

Drift Vocabulary
----------------
Use user-facing drift labels instead of soft internal language.

Allowed labels:
1. `On target`
2. `Drifted`
3. `Rebalance suggested`

Mapping guidance:
1. allocator `aligned` -> `On target`
2. allocator `watch` -> `Drifted`
3. allocator `rebalance` -> `Rebalance suggested`

Do not expose `watch` as the primary user-facing drift label.

Component Tree
--------------
Suggested main tree:

1. `PortfolioPageShell`
2. `PortfolioHeaderStrip`
3. `PortfolioMainDesk`
4. `PortfolioRightRail`
5. `SafetyDrawer`
6. `ActivityDrawer`

Current implementation reference:
`frontend/src/app/portfolio/page.tsx`

Component Spec
--------------

### 1. `PortfolioPageShell`
Role:
Own page fetch lifecycle and top-level responsive layout.

Inputs:
1. wallet connection state
2. portfolio snapshot
3. policy snapshot
4. recommendation
5. gate result
6. receipts
7. telemetry

Responsibilities:
1. fetch and refresh backend data
2. hold proposal draft state
3. hold last checked proposal state
4. orchestrate background gate checking
5. pass normalized props into child components

Should not render:
1. raw system explanations
2. giant inline logs
3. duplicated state summaries

### 2. `PortfolioHeaderStrip`
Role:
Give the user immediate orientation.

Content:
1. wallet short address
2. total tracked value
3. drift badge
4. trust badge
5. safety badge
5. refresh action

Optional secondary meta:
1. wallet assets count
2. last updated time

Should not include:
1. protocol count as a hero metric
2. executor preview/live details
3. raw chain labels as dominant copy

Copy guidance:
1. `Portfolio value`
2. `Drift status`
3. `Wallet signing mode`
4. `Safety status`
5. `Last updated`

### 3. `PortfolioMainDesk`
Role:
The primary product surface.

Child sections:
1. `TargetModeSwitch`
2. `AllocationOverviewCard`
3. `RebalanceIntentBar`
4. `TargetEditor`
5. `AIRecommendationCard`
6. `ExecutionPlanCard`
7. `PrimaryActionTray`

This is the only area users should need for the happy path.

One Dominant Action Rule
------------------------
At any point in the happy path, there must be exactly one dominant primary action.

Allowed pattern:
1. one primary CTA
2. one secondary helper action at most
3. all other actions must be visually subordinate

Do not allow competing primary actions such as:
1. `Review`
2. `Refresh`
3. `Simulate`
4. `Execute`
all appearing with equal visual weight.

### 4. `TargetModeSwitch`
Role:
Toggle between `Swap` and `Rebalance`.

Requirements:
1. one compact segmented control
2. no extra helper copy
3. selection changes the editor below

### 5. `AllocationOverviewCard`
Role:
Show the three important mixes:
1. current
2. your target
3. AI target

Visual:
1. stacked horizontal allocation rails
2. same asset colors across the page
3. dense legend

Each row should show:
1. asset
2. current %
3. target %
4. delta arrow

Do not render this as three separate cards.

Visual hierarchy rules:
1. current allocation is visually strongest
2. user target is second
3. AI target is ghosted, dashed, or otherwise subordinate
4. asset order must remain identical everywhere on the page
5. asset color mapping must remain identical everywhere on the page

Do not let this component become a spreadsheet.

### 6. `RebalanceIntentBar`
Role:
Fast starting points for users who do not want to edit percentages manually.

Allowed presets:
1. `Conservative`
2. `Market Neutral`
3. `Aggressive`
4. `Match AI` when available

Behavior:
1. applying a preset changes only user target
2. AI remains separate

### 7. `TargetEditor`
Role:
The main input module.

Rebalance mode:
One dense table-like editor.

Per asset row:
1. asset symbol
2. current balance
3. current allocation
4. target allocation input
5. slider
6. AI target ghost value
7. move needed

Swap mode:
Two-token ticket.

Fields:
1. sell asset
2. buy asset
3. amount
4. max slippage

Required UX:
1. show available balance inline
2. show quick amount shortcuts or slider
3. show minimum effective amount inline
4. never hide why an action is unavailable
5. make target edits feel immediate and low-friction

### 8. `AIRecommendationCard`
Role:
Present one intelligent suggestion in human terms.

This is not a system dump and not a sleeve explorer.

Must show:
1. recommendation headline
2. short reason
3. suggested target mix
4. top changes
5. likely trade path

Actions:
1. `Use AI target`
2. `Check AI plan`

Must not show on the main surface:
1. genome bars
2. proof provenance pills
3. allocator sleeves
4. LP or lending sleeves unless directly executable in this product

If future sleeves exist, mention them only in advanced details.

Ownership rule:
1. user target should feel owned and editable
2. AI target should feel suggested and optional
3. AI and user target must never compete as equal primaries

### 9. `ExecutionPlanCard`
Role:
Translate the chosen target into exact trades.

Must show:
1. assets sold
2. assets bought
3. estimated receive
4. venue used
5. estimated network cost
6. whether STRK gas reserve is being preserved

This should feel like a trade ticket, not a developer trace.

For rebalance:
1. show numbered trade rows
2. show total value moved
3. show residual gap after execution if available

Hard limit:
This component must not show:
1. route hash
2. quote hash
3. adapter state matrix
4. backend preview flags
5. executor mode internals

The plan card is the confidence center of the product.

### 10. `PrimaryActionTray`
Role:
One compact action surface under the plan.

Should contain:
1. one primary CTA
2. one small secondary action for refresh / re-check if needed
3. one compact status strip

Primary CTA states:
1. `Review rebalance`
2. `Sign in wallet`
3. `Submitted`
4. `Needs adjustment`

Status strip should only communicate:
1. main blocker
2. main warning
3. wallet mismatch
4. live tx progress

Do not stack multiple warning boxes here.

Exact CTA copy:
Swap:
1. `Review swap`
2. `Sign swap`
3. `Swap submitted`
4. `Needs adjustment`

Rebalance:
1. `Review rebalance`
2. `Sign rebalance`
3. `Rebalance submitted`
4. `Needs adjustment`

### 11. `PortfolioRightRail`
Role:
Secondary operational context.

Child sections:
1. `BalanceRailSection`
2. `GuardrailsRailSection`
3. `ActivityRailSection`

This rail should be sticky on desktop and collapsible on mobile.

Right rail restraint rules:
1. balances visible by default
2. guardrails collapsed to summary by default
3. activity limited to the last 3 items by default
4. the right rail must never compete visually with the main desk

### 12. `BalanceRailSection`
Role:
Show balances and wallet composition.

Must show:
1. asset balances
2. USD values
3. current weights

Can optionally show:
1. wallet assets count
2. tracked protocols count

Should not dominate above the main desk.

### 13. `GuardrailsRailSection`
Role:
Summarize active policy only.

Must show:
1. allowed assets
2. max slippage
3. cooldown
4. max action size
5. pause state

Advanced-only, not visible by default:
1. policy hash
2. route hash
3. executor readiness matrix
4. backend live-submit flags

### 14. `ActivityRailSection`
Role:
Tell the story of what recently happened.

Groups:
1. `user`
2. `gate`
3. `system`

Important:
These group labels are for expanded history only.
Do not require users to think in these buckets in the compact rail.

User-facing labels:
1. `Swap sent`
2. `Rebalance ready to sign`
3. `Guardrails updated`
4. `Agent drift review`

Each row should show:
1. event title
2. one-line summary
3. timestamp
4. tx link only when relevant

Do not show raw receipt jargon by default.

### 15. `SafetyDrawer`
Role:
Hide detail until the user asks for it.

Default closed.

Summary-first content:
1. passed checks count
2. warnings count
3. blockers count

Expanded content:
1. failed checks first
2. warnings second
3. full matrix last

This is where zkML advisory detail belongs, not in the core desk.

Strict hierarchy:
1. blockers
2. warnings
3. passed checks summary
4. full matrix

Do not turn this drawer into a raw system dump.

### 16. `ActivityDrawer`
Role:
Expanded recent-history view.

Use only when the right rail compact section is not enough.

Should include:
1. filter by `user / gate / system`
2. expandable event rows
3. links to tx / receipt IDs

Component Mapping From Current File
-----------------------------------
Current implementation pieces that should survive conceptually:
1. `StatCard`
2. `RailSection`
3. `TargetEditorRow`
4. `AllocationMixRow`
5. `MatrixStat`
6. `StatusPill`
7. `EventGroupPill`

Current implementation pieces that should be re-scoped:
1. `Panel`
   - too generic, use product-named components
2. `ProgressStep`
   - should become a slimmer state strip
3. `CompactVenueRow`
   - move into advanced or plan context, not primary hero state
4. `TelemetryStat`
   - secondary only

Current concepts that should be demoted or hidden:
1. executor readiness as a first-class product concept
2. detailed venue-readiness blocks
3. raw proof mode and route hash in default view
4. allocator sleeves on the main AI card
5. provenance / genome on the primary surface

Anti-Duplication Rules
----------------------
The same information must not appear in multiple components with different wording.

Explicit rules:
1. balances should not be repeated in both the header and right rail
2. safety state should not be repeated in header, action tray, and drawer with different labels
3. venue information should not appear as hero state, plan detail, and rail detail at the same time
4. drift should have one primary summary and one optional detailed explanation, not multiple summaries
5. recommendation rationale should not be restated in both the AI card and plan card unless each serves a different purpose

Behavior Spec
-------------

### Proposal flow
1. User edits swap or rebalance target
2. App auto-runs gate in background after debounce
3. Desk updates to one of:
   - `Drafting`
   - `Checking`
   - `Ready to sign`
   - `Needs adjustment`
4. If safe:
   - primary CTA becomes `Sign in wallet`
5. After sign:
   - state becomes `Submitted`
6. Receipt worker later updates:
   - `Accepted`
   - `Confirmed`

### AI flow
1. AI target remains separate from user target
2. AI never silently overwrites user inputs
3. User may:
   - inspect AI target
   - apply AI target
   - gate-check AI target

### Safety flow
1. Warnings should not feel like hard stops
2. Blockers should be short and specific
3. Advisory zkML issues stay behind the safety drawer unless directly relevant

### Economic warnings
1. If trade is allowed but inefficient:
   - say `Safe, but expensive for size`
2. If blocked:
   - say `Too small to execute efficiently`
3. Always show estimated fee and fee share when available

Motion Rules
------------
Do not make the desk feel twitchy or reactive-for-the-sake-of-reactive.

Rules:
1. target edits should feel immediate
2. gate checking should feel calm and stable, not jittery
3. CTA state changes should animate subtly and deliberately
4. drawers should slide or expand smoothly, not pop harshly
5. submitted state should feel deliberate and final

Copy Rules
----------
Do:
1. use human labels
2. describe actions in asset terms
3. keep system terminology out of the first screen

Do not:
1. say `prepared calldata`
2. say `proof mode advisory` in primary UI
3. say `preview-only` when wallet signing is available
4. surface raw hashes without user intent

Responsive Rules
----------------
Desktop:
1. sticky right rail
2. main desk remains dominant

Mobile:
1. right rail collapses below desk
2. safety becomes drawer / accordion
3. activity is one compact list with expand-on-tap

Empty-State Rules
-----------------
Define exact behavior for the following states.

1. Wallet disconnected
   - show connect prompt
   - hide trade actions
   - keep page structure visible

2. No portfolio yet
   - show zero-state allocation shell
   - explain that wallet balances will appear after scan
   - AI card should be suppressed

3. No AI recommendation available
   - keep the main desk usable
   - show a compact unavailable state, not an error panel

4. No drift
   - show `On target`
   - suppress rebalance urgency language

5. Unsupported asset mix
   - explain that `/portfolio` mainnet-v1 supports ETH, STRK, and USDC only
   - demote unsupported holdings from the main execution path

6. Gate unavailable
   - show one calm retry state
   - do not explode the page into error chrome

7. No recent activity
   - show one-line empty history state in the rail

De-Scoped For Mainnet V1
------------------------
Do not treat these as main-surface features yet:
1. LP provisioning
2. lending
3. staking
4. strategy sleeve exploration
5. advanced executor mode management
6. session key management

These can exist in docs or advanced settings, but not in the primary desk.

Suggested File Split
--------------------
Current file:
`frontend/src/app/portfolio/page.tsx`

Recommended split:
1. `frontend/src/app/portfolio/page.tsx`
2. `frontend/src/components/portfolio/PortfolioHeaderStrip.tsx`
3. `frontend/src/components/portfolio/PortfolioMainDesk.tsx`
4. `frontend/src/components/portfolio/TargetEditor.tsx`
5. `frontend/src/components/portfolio/AIRecommendationCard.tsx`
6. `frontend/src/components/portfolio/ExecutionPlanCard.tsx`
7. `frontend/src/components/portfolio/PrimaryActionTray.tsx`
8. `frontend/src/components/portfolio/PortfolioRightRail.tsx`
9. `frontend/src/components/portfolio/SafetyDrawer.tsx`
10. `frontend/src/components/portfolio/ActivityRail.tsx`
11. `frontend/src/components/portfolio/types.ts`
12. `frontend/src/components/portfolio/formatters.ts`

Acceptance Criteria
-------------------
The redesign is successful if:
1. a first-time user understands the rebalance flow without reading system copy
2. the page no longer reads like a backend dashboard
3. AI recommendation feels like advice, not internal allocator leakage
4. the happy path is visible without opening drawers
5. warnings feel distinct from blockers
6. swap and rebalance both feel like one coherent product, not two bolted-on tools

First-Render Removal List
-------------------------
The following must not appear on first render of the main desk:
1. raw proof mode
2. route hash
3. policy hash
4. executor readiness matrix
5. backend live-submit flags
6. allocator sleeves
7. provenance badges
8. genome bars
9. raw receipt IDs
10. raw reason codes

Current Engineering Priority
----------------------------
While the surface is redesigned, backend mechanics should keep moving on:
1. spot-swap / token-rebalance reliability
2. fee-efficiency and gas-reserve logic
3. receipt lifecycle
4. telemetry
5. adapter expansion only after the spot lane is fully trustworthy
