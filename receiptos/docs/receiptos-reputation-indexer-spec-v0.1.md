# ReceiptOS v0.1 - Build Execution Plan

For: Claude Code agent or solo developer
Reference: receiptos-reputation-indexer-spec-v0.1.md (this file)
Repo: github.com/Obsqra-Labs/zkdefi
Chain: Starknet mainnet (Sepolia for testing)
Stack: Cairo 2.15 contracts, TypeScript/Node indexer + attester, Next.js passport page
Timeline: 4 weeks, gated by verification steps

## Ground Rules

1. No step proceeds until its prerequisite gate passes. If a gate fails, stop and resolve before continuing.
2. Every external data source (contract address, event selector, RPC endpoint) must be verified against live mainnet before writing code that depends on it.
3. Test against real wallets, not mocks. Pick 10 Starknet mainnet wallets with varied profiles at the start and use them throughout.
4. Commit after every completed step. Small, working commits.
5. This spec is the source of truth for scope. If marked deferred to v0.2, do not build it in v0.1.

## Phase 0: Setup and Verification

This phase produces no feature code. It confirms all live dependencies.

### Step 0.1: Select Test Wallets

Pick 10 Starknet mainnet wallet addresses with known profiles:
- heavy_defi
- fresh_wallet
- bridge_heavy
- lending_no_liquidations
- lending_with_liquidations
- privacy_user
- single_protocol_bot
- staker
- argent_wallet
- braavos_wallet

Store in: `receiptos/indexer/test/fixtures/test-wallets.json`

Gate:
- File exists with 10 real mainnet addresses and manual verification notes.

### Step 0.2: Resolve Contract Addresses

Resolve and verify at minimum:
- StarkGate
- Ekubo
- Vesu
- one of Endur/Nostra

Store in: `receiptos/config/mainnet-contracts.json`

Gate:
- At least 4 protocol addresses resolved and verified.
- Unresolved protocols remain with `"verified": false`.

### Step 0.3: Resolve Event Selectors

For each verified contract, resolve selectors and data layout. Record one sample tx for each selector.

Required gate coverage:
- StarkGate deposit
- Ekubo swap
- Vesu supply
- Vesu liquidation

Store in: `receiptos/config/event-selectors.json`

### Step 0.4: Resolve Account Class Hashes

Resolve class hashes for Argent, Braavos, OpenZeppelin account contracts from real wallets.

Store in: `receiptos/config/account-class-hashes.json`

Gate:
- Argent and Braavos class hashes confirmed against 2+ wallets each.

### Step 0.5: Test RPC Queries

Validate manually against one test wallet:
- `starknet_getNonce`
- `starknet_getClassHashAt`
- `starknet_getEvents`

Record rate-limit observations.

Store in: `receiptos/indexer/test/fixtures/rpc-test-results.json`

Gate:
- All three methods return expected data for at least one wallet.

### Step 0.6: Fill Coverage Table

Create and fill: `receiptos/docs/COVERAGE_TABLE.md`

Each row includes:
- protocol
- category
- mainnet contract address or unresolved
- event selector or unresolved
- event name
- verified checkbox
- sample tx hash
- last verified block

Gate:
- Coverage table committed with at least 6 fully verified rows.

## Phase 1: Indexer Core

### Step 1.1: Project Structure

Use the existing scaffold under `receiptos/`:
- `indexer/`
- `attester/`
- `contracts/`
- `passport/`
- `config/`
- `docs/`

Gate:
- `npm run build` succeeds in `receiptos/indexer`.

### Step 1.2: RPC Client

Implement `receiptos/indexer/src/rpc-client.ts` with:
- provider from `STARKNET_RPC_URL`
- `getNonce`
- `getClassHashAt`
- paginated `getEvents`
- exponential backoff for rate limits
- request counting

Gate:
- Live check passes for one real wallet and one verified contract event path.

### Step 1.3: Type Definitions

Implement and keep aligned:
- `ReputationVector`
- `BridgeInflow`
- `SignalResult`

Gate:
- strict TypeScript compile passes with no `any` in core vector surface.

### Step 1.4: Signal Implementations

Build signals as independent modules:
- Signal 3 `tx-count.ts`
- Signal 2 `account-type.ts`
- Signal 1 `wallet-age.ts`
- Signal 4 `protocol-breadth.ts`
- Signal 5 `liquidations.ts`
- Signal 6 `bridge-inflow.ts`

Important behavior:
- `liquidation_count = null` means no lending activity.
- `liquidation_count = 0` means lending activity with no liquidations.

Gate per signal:
- Tested against fixture wallets and manually spot-checked against explorer evidence.

### Step 1.5: Vector Assembly

Implement `computeVector` in `receiptos/indexer/src/index.ts`.

Gate:
- Runs for all 10 wallets.
- Save outputs in `receiptos/indexer/test/fixtures/vector-outputs/`.

### Step 1.6: Performance Baseline

Measure per wallet:
- total RPC calls
- wall time
- populated vs null signals

Gate:
- each wallet under 30 seconds with documented optimization if exceeded.

## Phase 2: Attester + Contracts

### Step 2.1: Policy Hash Computation

Implement deterministic policy hash over fixed field order in `receiptos/attester/src/policy-hash.ts`.

Gate:
- same vector hashes identically across repeated runs.
- different vectors yield different hashes.

### Step 2.2: Attester Signer

Implement signer in `receiptos/attester/src/signer.ts`.

Gate:
- local sign + verify using same Stark key passes.

### Step 2.3: Cairo Contract - ReceiptRegistry v0.1

Implement under `receiptos/contracts/receipt_registry_v01/` as a new contract family, separate from existing repo contracts.

Required functions:
- `issue_attested_receipt`
- `consume_receipt`
- `verify_receipt`
- `upgrade`

Gate:
- `scarb build` and `scarb test` pass with minimum test coverage for signature validity, replay protection, verify semantics, and upgrade auth.

### Step 2.4: Key Compatibility Test

Critical cross-language test:
- TypeScript signs hash
- Cairo verifies same signature/hash/key

Gate:
- cross-language verification passes.
- exact npm package version and method usage documented.

### Step 2.5: Deploy to Sepolia

Record deployment details:
- class hash
- contract address
- deploy tx hash
- attester pubkey

Gate:
- live call to issue and verify receipt succeeds.

Status note (2026-03-25): ReceiptRegistry v0.1 is deployed on Sepolia. Remaining work is the live issuance and verification transaction path.

### Step 2.6: End-to-End Sepolia Test

Flow:
- compute vector
- compute policy hash
- sign
- submit receipt
- verify receipt

Gate:
- full path succeeds and artifacts are logged.

## Phase 3: Passport Page

### Step 3.1: Page Setup

Build isolated pilot in `receiptos/passport` first, then integrate route after Sepolia success.

### Step 3.2: Wallet Connect

Support Argent and Braavos wallet connection.

Gate:
- mainnet wallet connect works and address displays.

### Step 3.3: Indexer API

Expose vector generation through server-side API endpoint.

Gate:
- reputation endpoint returns valid vector JSON for a wallet query.

### Step 3.4: Display Component

Render six signals clearly.
Null values are rendered as missing/not enough data, never as zero.

Do not show:
- aggregate score
- good/bad color ranking
- percentile language

Gate:
- works for dense and sparse wallets.

### Step 3.5: Claim Flow

Claim endpoint recomputes vector server-side, signs, and submits to registry.

Gate:
- end-to-end claim from UI succeeds on Sepolia.

### Step 3.6: Deploy Passport

Target URL:
- `https://zkde.fi/passport`

Gate:
- wallet connect, vector view, and claim all work in deployed environment.

## Phase 4: Mist Integration

### Step 4.1: Integration Package

Prepare in `receiptos/integration/`:
- `README.md`
- ABI JSON
- Cairo and TypeScript verify examples
- deployed addresses

Gate:
- new external developer can integrate in under one hour.

### Step 4.2: Send Integration Package

Share package and offer Sepolia-first testing path.

### Step 4.3: Support Integration

Handle ABI/toolchain compatibility and receipt usage semantics.

### Step 4.4: First Gated Withdrawal

Gate:
- one Sepolia tx shows integrator calling `verify_receipt` against registry.

### Step 4.5: Mainnet Deployment

Promote after Sepolia stability:
- deploy mainnet registry
- update passport and integration package
- complete first mainnet integrated flow

## Phase 5: Post-Launch

### Step 5.1: Monitor

Track:
- receipts issued/day
- unique claiming wallets
- consumed receipts by protocol
- indexer errors/latency
- RPC usage/cost

### Step 5.2: Outreach

Use one live integration as proof point for protocol outreach.

### Step 5.3: v0.2 Planning

Use observed demand and verified data availability to choose deferred signals and trust-model upgrades.

## Dependency Checklist

Environment:
- Node.js 18+
- Rust + Scarb
- starkli
- Starknet RPC URL
- attester keypair
- gas-funded Starknet wallet for test/deploy

NPM baseline:
- starknet
- get-starknet-core
- next
- react
- typescript

Cairo baseline:
- starknet 2.15.0
- OpenZeppelin Cairo contracts as needed for upgrade/admin patterns

## Explicitly Out of Scope in v0.1

- L3 or Madara additions
- zkML / EZKL / ModelBridge integrations
- Garaga verifier integration
- privacy behavior scoring
- exchange hot wallet detection
- USD conversion
- global reputation score
- token/tokenomics work
- circuit compilation tracks
- multi-chain scope
- unrelated zkde.fi product surfaces

Build the six signals, attester flow, registry, and passport pilot first.
