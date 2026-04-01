# Portfolio Mainnet UX And Adapter Roadmap

## Current Product Read

`/portfolio` is now functionally capable:

- wallet-connected mainnet portfolio scan
- AI-backed token rebalance recommendation
- 13-circuit gate check plus policy controls
- wallet-signed swap and token-only rebalance execution
- receipt trail with drift and monitor context

The remaining problem is not raw capability. It is clarity.

The page needs to feel like one operating surface:

1. Set the target portfolio.
2. Validate it through the gate.
3. Sign or prepare the resulting action.

Everything else should support that loop rather than compete with it.

## UX Direction

The strongest reference pattern across modern DeFi operating surfaces is:

- current state
- target state
- exact actions required to close the gap
- explicit automation / monitoring status

That pattern is stronger than a generic dashboard because it reduces ambiguity.

For `zkde.fi/portfolio`, that means:

- keep one dominant action panel
- keep policy and venue readiness in a thinner right rail
- separate “what the AI wants” from “what the user set”
- show the exact execution path before signing
- tell the truth about venue readiness

## Venue Truth Model

The page should distinguish between three things:

1. Observed market universe  
   Protocols we can scan, rank, and recommend against.

2. Execution-ready venues  
   Protocols we can actually turn into wallet calls today.

3. Next adapters  
   Venues that already have enough repo coverage to justify wiring into `/portfolio`.

That distinction matters because fake readiness destroys trust.

## Adapter Rollout Order

### 1. Ekubo LP

This is the best next adapter.

Why:

- calldata builder already exists in `backend/app/services/ekubo_lp_service.py`
- LP positions are already part of the scanner and adjacent product surfaces
- it fits the current “review target -> gate -> sign” model better than lending

What is still missing:

- `/portfolio` intent type for LP add/remove liquidity
- policy rules for LP-specific risk and position sizing
- wallet review card for LP range / fee tier / token split
- receipt lifecycle for LP actions

### 2. STRK staking

This is plausible next, but it is not as clean as LP yet.

Why:

- wallet-call builders already exist in `backend/app/services/staking/native_staking.py`
- staking pools and positions already have API surfaces

What is still missing:

- mainnet cleanup for the staking service, which still exposes Sepolia-oriented assumptions in parts of the stack
- a portfolio-native “delegate / claim / exit” flow
- gate rules specific to staking operations

### 3. Nostra / Vesu lending

This should come after LP and staking.

Why:

- lending positions and market context are already indexed in scans and opportunity services
- there is reusable lending-related logic in `backend/app/services/lending_service.py`

What is still missing:

- a clean mainnet lending execution adapter scoped to a real venue
- wallet-call review surface for supply / withdraw / repay / borrow
- policy and gate rules for collateral, health factor, and withdrawal safety

This is not out of scope, but it is not a “turn it on” adapter either.

## Recommendation Scope For Mainnet V1

The AI recommendation on `/portfolio` should stay scoped to what the page can actually execute.

That means:

- recommend target token allocations
- explain why the wallet drifted
- show the swap path needed to reach the target

It should not imply that LP, staking, or lending sleeves are directly executable until those adapters are actually wired into the gate and wallet flow.

## Immediate Next Build Order

1. Keep polishing the `/portfolio` operating layout.
2. Add Ekubo LP as the first non-spot adapter.
3. Clean up mainnet staking assumptions and wire staking actions into `/portfolio`.
4. Add a real lending adapter only after the health / collateral model is explicit in the gate.
