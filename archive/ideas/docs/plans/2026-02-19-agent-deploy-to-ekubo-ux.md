# Agent / Deploy to Ekubo — Holistic UX Plan

**Date:** 2026-02-19  
**By:** Obsqra Labs (zkde.fi)  
**Status:** Implemented. Real integration: receipts persisted to `backend/data/orchestration_receipts.json`; fallback calldata when Ekubo API fails (fixed Sepolia pool params) so you get real Router.swap calldata and Sign & execute; user signs → real L2 tx.

---

## 1. Current /agent UI flow (summary)

- **Tabs:** Dashboard | Allocation Pools | DEX | Agent Controls | zkML Models | Disclosure.
- **Dashboard:** Live Market Data (JediSwap/Ekubo), Current Allocation (AllocationPools), Private Transfer (PrivateTransferPanel). Sidebar: Reputation Tier, Relayer Health, PositionChart, ActivityLog.
- **Pools:** Shielded (A), Full Privacy (B/C), Hashed Withdraw (D). Each panel has deposit/withdraw; Full Privacy has note-unlinkable flow.
- **DEX:** DexPanel — Ekubo Sepolia pairs, swap UI.
- **Agent Controls:** BrainVisualizer, SessionKeyManager, AgentRebalancer (propose → zkML check → prepare → execute).
- **MVP page:** risk → recommendation → deploy via `strategies/execute-advanced`; success shows positions and "When does AI redeploy?" + link to /agent.

**Gap:** No first-class "Deploy to Ekubo" flow on /agent. Orchestration backend (`POST /api/v1/zkdefi/orchestration/deploy`) is implemented; frontend does not call it or surface it.

---

## 2. Holistic design

**Principle:** One clear path for "I want to deploy (my deployable amount) to Ekubo Sepolia" that uses the orchestration layer (recommend → execute → receipt), without exposing private balance. User supplies amount; backend does Ekubo-only recommend + execute + receipt.

**Primary surface:** Dashboard on /agent — new **"Deploy to Ekubo"** card between Current Allocation and Private Transfer.

- **Copy:** "Deploy to Ekubo — Recommend → execute → receipt. Ekubo Sepolia only."
- **Inputs:** Deployable amount (number, required), Risk profile (conservative | balanced | aggressive).
- **Action:** "Deploy" → `POST /api/v1/zkdefi/orchestration/deploy` with `user_address`, `deployable_amount`, `risk_profile`.
- **Result:** Show `deployment_id`, positions (strategy, amount, status), `receipt_id`. Optional: "View receipt" link when receipt/passport UI exists.

**Secondary surface:** Pools tab — CTA under Full Privacy (Pool B): "Deploy from Full Privacy → Ekubo" that links to Dashboard and scrolls to the Deploy card (`/agent` + `#deploy-to-ekubo` or `?tab=dashboard` + scroll to id).

**Optional:** MVP page — after recommendation, add secondary button "Deploy via Ekubo orchestration" that calls `orchestration/deploy` with `recommendation.total_amount` and `recommendation.risk_profile`, and shows the same result shape (deployment_id, positions, receipt_id). Keeps MVP simple; power users get Ekubo-only + receipt in one click.

**Agent rebalancer:** No change in this phase. Later, autonomous mode can call orchestration when it decides to "deploy to Ekubo" (Phase 2).

---

## 3. Implementation tasks

| # | Task | Status | Files |
|---|------|--------|--------|
| 1 | Create `DeployToEkuboCard` component: form (amount, risk_profile), submit → orchestration/deploy, show result | Done | `frontend/src/components/zkdefi/DeployToEkuboCard.tsx` |
| 2 | Add DeployToEkuboCard to Agent page Dashboard tab (with id="deploy-to-ekubo") | Done | `frontend/src/app/agent/page.tsx` |
| 3 | Pools tab: add CTA "Deploy from Full Privacy → Ekubo" linking to `#deploy-to-ekubo` on /agent | Done | `frontend/src/app/agent/page.tsx` |
| 4 | Deep link: when `?highlight=deploy` or hash `#deploy-to-ekubo`, ensure Dashboard tab is active and scroll to card | Done | `frontend/src/app/agent/page.tsx` |
| 5 | (Optional) MVP: add "Or deploy via Ekubo orchestration" button calling orchestration/deploy with recommendation | Done | `frontend/src/app/mvp/page.tsx` |
| 6 | (Optional) Backend/docs: EKUBO_CHAIN_ID in .env.example and ENV.md | ENV.md done | `docs/ENV.md` |

---

## 4. API contract

- **Request:** `POST /api/v1/zkdefi/orchestration/deploy`  
  Body: `{ "user_address": string, "deployable_amount": number, "risk_profile": "conservative" | "balanced" | "aggressive" }`
- **Response (200):** `{ "deployment_id": string, "positions": [{ "strategy", "amount", "status", "tx_hash"?, "tx_calldata"?, "tx_calldata_error"? }], "receipt_id": string, "target": "ekubo", "recommendation_id"?: string }` — When EKUBO_BUILD_CALLDATA is true, each position may include `tx_calldata` (for client to sign) or `tx_calldata_error`; when EXECUTOR_LIVE_SUBMIT is set, backend may submit and set `tx_hash`.
- **Error (400):** `{ "detail": string }` (e.g. deployable_amount must be positive, no Ekubo pools).

---

## 5. Verification checklist (UI)

Run through with backend (`:8003`) and frontend (`:3001`) up. Wallet connected (Starknet Sepolia).

| # | Step | Expected |
|---|------|----------|
| 1 | Go to `/agent` → **Dashboard** tab | See "Deploy to Ekubo" card between Current Allocation and Private Transfer. |
| 2 | Enter amount (e.g. `100`), select risk (e.g. Balanced), click **Deploy** | Loading → success: deployment_id, positions list, receipt_id; "Deploy again" appears. |
| 3 | Go to **Allocation Pools** tab → scroll to Full Privacy (Pool B) | See CTA "Deploy from Full Privacy → Ekubo". |
| 4 | Click "Deploy from Full Privacy → Ekubo" | Navigate to `/agent` with Dashboard active and view scrolls to "Deploy to Ekubo" card. |
| 5 | Go to `/agent` then append `?highlight=deploy` or `#deploy-to-ekubo` | Dashboard tab active; scroll to Deploy card. |
| 6 | Go to `/mvp` → complete risk + recommendation step | See "Deploy" and "Or deploy via Ekubo (orchestration)" buttons. |
| 7 | Click "Or deploy via Ekubo (orchestration)" | Loading → success: message with receipt_id; positions list; "When does the AI redeploy?" + link to /agent. |

**Backend:** `POST /api/v1/zkdefi/orchestration/deploy` must be mounted (orchestration router in `main.py`). If 404, check backend mounts `app.api.routes.orchestration`.

---

## 6. Extension: real Ekubo execution

**Current state:** Orchestration and vault_execute return placeholder tx hashes; no on-chain swap/LP yet.

**To wire real execution:**

1. **Config / env**
   - Set `EKUBO_CHAIN_ID` for Starknet Sepolia in backend env (see [ENV.md](../ENV.md)). Used by `ekubo_client`, `real_pool_aggregator`, DEX routes.
   - Addresses are in `backend/app/services/ekubo_config.py` (Core, Router, Positions).

2. **Swap path (Router or Core#lock)**
   - Use Ekubo Router V3.0.13 for swaps: build calldata (route from `/pair/.../pools`, amounts, slippage), invoke Router entrypoint from a funded account (user or relayer).
   - Alternative: implement a Cairo contract with `locked` callback that performs approve + swap; call Core#lock from that contract.
   - Wire: `vault_execute_service` or a dedicated `ekubo_swap_executor` → build Router (or lock) calldata → return tx payload for frontend to sign, or use relayer/session key to submit.

3. **LP path (Positions)**
   - `ekubo_executor.EkuboContractExecutor` has `create_lp_position`, `collect_fees`, `remove_liquidity`; currently mock. Replace with real calls: approve token(s), call Positions.mint_and_deposit (pool key, tick range, amounts). Use `ekubo_config.EKUBO_POSITIONS_SEPOLIA` and Core address.
   - Wire: when orchestration/vault_execute allocation is "LP" (e.g. strategy indicates add liquidity), call executor with pool params from API (`/pair/.../pools`); return tx for sign or submit via relayer.

4. **Receipt / proof**
   - Keep orchestration receipt (receipt_id, proof_hash) as-is. When real tx is submitted, optionally update receipt with `tx_hash` via existing receipt confirm flow.

**References:** [EKUBO_SEPOLIA_INTEGRATION_SCOPE.md](../EKUBO_SEPOLIA_INTEGRATION_SCOPE.md), [design §2.3–2.4](2026-02-19-privacy-ekubo-orchestration-design.md), `ekubo_executor.py`, `ekubo_config.py`.

---

## 7. Sepolia token addresses (fix: contract not deployed)

Deploy/Sign & execute failed with "Requested contract address 0x053c... is not deployed" because we used **mainnet USDC** (0x053c...) on Starknet Sepolia. On Sepolia we now use:

- **USDC:** Circle testnet USDC on Starknet Sepolia: `0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080`
- **ETH / STRK:** Same as docs (native tokens on Sepolia)

Defined in `ekubo_config.py`; `ekubo_execution_service` uses them for strategy pairs and fallback calldata. **Gated execution was not the cause** — the Router was called correctly; the wrong token address was in calldata.

**If you still see "0x053c... is not deployed":** (1) Restart the backend (`pm2 restart zkdefi-backend`) so it serves calldata with Sepolia USDC. (2) Do a **new** Deploy (enter amount, click Deploy again); do **not** use "Sign & execute" on an old deploy result — the old result has 0x053c... in calldata. (3) Sign & execute only on the **new** deploy result.

**USDC not showing in wallet:** Many wallets don’t auto-list testnet tokens. Add Sepolia USDC manually: contract `0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080` (Starknet Sepolia). Get testnet USDC from [Circle faucet](https://faucet.circle.com/).

**NOT_INITIALIZED:** The Ekubo API returns 500 for Sepolia pair/pools. When the API fails, we run **on-chain pool discovery**: we call Ekubo Core `get_pool_price(pool_key)` via RPC for (fee, tick_spacing) combos (0.05%/1000, 0.3%/60, 1%/60); the first pool that returns non-zero sqrt_ratio is used to build Router.swap calldata. So you get valid calldata when a pool exists on Sepolia (e.g. STRK/USDC 0.05%/1000). If no combo is initialized, we return: "Ekubo API unavailable for Sepolia; no pool data. Swap at app.ekubo.org (Starknet Sepolia)." See [EKUBO_SEPOLIA_POOL_DATA_SOURCES.md](../EKUBO_SEPOLIA_POOL_DATA_SOURCES.md).

**u256_sub Overflow (STRK contract):** If execution fails with `u256_sub Overflow` in the STRK token contract, your **STRK balance** or **Router allowance** is less than the swap amount. Ensure your wallet has at least the swap amount of the input token (STRK or USDC) and approve the Ekubo Router for at least that amount before signing.

**STRK → USDC:** To get USDC from testnet STRK: `POST /api/v1/zkdefi/orchestration/swap-strk-to-usdc` with `{ "amount_strk_wei": "<STRK wei>" }`. Returns Router.swap calldata; sign in wallet (approve STRK → Router, then Router.swap).

**ETH airdrop:** `POST /api/v1/zkdefi/orchestration/faucet/eth` with `{ "to_address": "0x..." }`. Backend sends a small amount of ETH from the executor account (EXECUTOR_LIVE_SUBMIT + funded account). Rate limit: one claim per address per 24h. Env: `FAUCET_ETH_AMOUNT_WEI` (default 0.001 ETH), `FAUCET_ETH_COOLDOWN_SEC` (default 86400).

## 7.1 Pool data sources (when API returns 500)

**Ekubo API:** `GET /pair/{chainId}/{tokenA}/{tokenB}/pools` (OpenAPI: https://prod-api.ekubo.org/openapi.json). chainId can be hex or decimal string. For Sepolia we use hex `0x534e5f5345504f4c4941`; API returns **500** for pair/pools and overview/pairs. Starknet Sepolia decimal (~3.93e23) exceeds OpenAPI int64 max (9.2e18) for some endpoints — Sepolia may not be supported or API may expect a different internal chain id. See Ekubo indexer (github.com/EkuboProtocol/starknet-indexer, `.env.sepolia`) or Discord #devs.

**On-chain (implemented):** We call **Ekubo Core** on Sepolia (`0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384`) view `get_pool_price(pool_key)` via `starknet_call`. PoolKey from EkuboProtocol/starknet-contracts `src/types/keys.cairo` (token0, token1, fee u128, tick_spacing, extension). PoolPrice: sqrt_ratio (u256), tick (i129); non-zero sqrt_ratio = initialized. We try (0.05%, 1000), (0.3%, 60), (1%, 60); use first that returns initialized. Implemented in `backend/app/services/ekubo_execution_service.py` (discover_pool_on_chain, _call_core_get_pool_price). See [EKUBO_SEPOLIA_POOL_DATA_SOURCES.md](../EKUBO_SEPOLIA_POOL_DATA_SOURCES.md) and [Reading pool price](https://docs.ekubo.org/integration-guides/reference/reading-pool-price).

**Manual:** Use [app.ekubo.org](https://app.ekubo.org) on Starknet Sepolia; URL for new position/swap includes fee and tickSpacing for live pools. Copy those into config until API or on-chain discovery is wired.

## 8. Real vs mock (verified)

- **Receipt:** Persisted to `backend/data/orchestration_receipts.json`; survives restart; verifiable via `GET /api/v1/zkdefi/orchestration/receipt/{receipt_id}`.
- **Calldata:** When Ekubo API fails (e.g. 500 for pair/pools), we run on-chain discovery (Core get_pool_price for 0.05%/1000, 0.3%/60, 1%/60); if an initialized pool is found we build Router.swap calldata with that pool. So you get **tx_calldata** when a pool exists on Sepolia (e.g. STRK/USDC) and can use **Sign & execute**. If no pool is found we return tx_calldata_error and suggest app.ekubo.org.
- **On-chain:** User signs in wallet → real L2 tx; backend can optionally submit via EXECUTOR_LIVE_SUBMIT. No mock tx hashes.

## 9. Next steps (post–real execution wiring)

- **Verify:** Run backend with `EKUBO_CHAIN_ID` set; hit Deploy to Ekubo from /agent; confirm positions show `tx_calldata` (or `tx_calldata_error` if no pools/chain). Optional: set `EXECUTOR_LIVE_SUBMIT` + account/key and confirm `tx_hash` and Starkscan link. *Tests assert position shape (tx_hash, tx_calldata, or tx_calldata_error).*
- **Client signing:** Wire wallet (e.g. starknet.js) to sign and send `tx_calldata` when "Calldata ready — sign in wallet" is shown. *Done: DeployToEkuboCard "Sign & execute" per position (approve token_in → Router.swap); toast + Starkscan link; receipt confirm called after success.*
- **LP path:** When strategy is add-liquidity (not just swap), use Extension §3 (Positions.mint_and_deposit) and return/submit LP calldata. *Stub/doc added in `ekubo_execution_service.py`; not implemented yet.*
- **Receipt:** Optionally attach `tx_hash` to receipt when real tx is submitted. *Done: `POST /api/v1/zkdefi/orchestration/receipt/confirm` with `receipt_id`, `tx_hash`; frontend calls it after Sign & execute success.*

---

## 10. References

- Backend orchestration: `docs/plans/2026-02-19-privacy-ekubo-orchestration-implementation.md`
- Real execution: `backend/app/services/ekubo_execution_service.py`, vault_execute_service allocations path, ENV.md (EKUBO_BUILD_CALLDATA, EXECUTOR_LIVE_SUBMIT).
- Design: `docs/plans/2026-02-19-privacy-ekubo-orchestration-design.md`
- PROJECT_STATUS: `docs/PROJECT_STATUS.md`
- Env vars (including EKUBO_CHAIN_ID): `docs/ENV.md`
- **Pool data:** Ekubo API OpenAPI: https://prod-api.ekubo.org/openapi.json. API returns 500 for Sepolia pair/pools (hex or decimal chainId). On-chain: call Ekubo Core on Sepolia with pool key to discover initialized pools (docs.ekubo.org/integration-guides/reference/reading-pool-price). Ekubo indexer: github.com/EkuboProtocol/starknet-indexer (.env.sepolia). Manual: app.ekubo.org on Sepolia — URL has fee and tickSpacing for live pools.

---

## 11. Plan addendum — Programmable Privacy (replace static Pool A-D UX)

### 11.1 Product decision

Move from static "pick Pool A/B/C/D" to **Programmable Privacy Policy**:

- User still deposits into one private vault lane.
- Privacy behavior is selected by policy constraints, not by separate product silos.
- Existing pools remain as **presets** for one release cycle, then become advanced options.

### 11.2 Presets mapping (backward compatible)

Static pools map to policy presets so current flows are preserved:

- Pool A (shielded) -> `preset_unlinkable_basic`
- Pool B/C (full privacy variants) -> `preset_hidden_flow`
- Pool D (hashed claims) -> `preset_hashed_claims`

These presets are editable in policy UI (not hard-coded one-way paths).

### 11.3 Canonical policy object

Add one user-level object consumed by onboarding, profile, dashboard, and agent execution:

```ts
type PrivacySettlementMode = "public_transfer" | "hashed_claim" | "internal_ledger";
type PrivacyRelayMode = "none" | "optional" | "required";

interface PrivacyPolicyProfile {
  profile_id: string;
  user_address: string;
  preset: "custom" | "unlinkable_basic" | "hidden_flow" | "hashed_claims";
  hide_amounts: boolean;
  hide_recipient: boolean;
  hide_sender: boolean;
  use_nullifier: boolean;
  settlement_mode: PrivacySettlementMode;
  relay_mode: PrivacyRelayMode;
  max_relayer_delay_seconds: number;
  disclosure_scope: {
    allow_balance_proof: boolean;
    allow_risk_proof: boolean;
    allow_performance_proof: boolean;
  };
  execution_scope: {
    manual_wallet_allowed: boolean;
    autonomous_allowed: boolean;
    session_key_allowed: boolean;
  };
  updated_at: string;
}
```

### 11.4 UX changes

1. Replace "Allocation Pools" mental model for privacy with **Privacy Policy Studio**:
   - Preset cards (A-D mapped labels).
   - Advanced toggles (amount visibility, sender/recipient visibility, relay, settlement mode).
   - "What this means" preview (human-readable execution path).
2. Onboarding Wizard:
   - Add privacy step that writes `PrivacyPolicyProfile`.
   - Remove localStorage-only onboarding truth as source of authority.
3. Profile:
   - Add "Privacy Policy" section as canonical edit surface.
4. Dashboard:
   - Show active privacy policy badge in Execution Control Rail.
   - Use one deposit entry card; route determined by policy compiler.

### 11.5 Execution compiler

Add backend policy compiler that resolves user intent to concrete proof/contract path:

- Input: `action_intent + PrivacyPolicyProfile + execution mode (manual/autonomous)`.
- Output: `PrivacyExecutionPlan`:
  - proof type(s) required
  - contract entrypoint(s)
  - whether relayer is required
  - whether hashed claims or internal ledger settlement is required

Matrix examples:

- `hide_amounts=true`, `hide_recipient=false`, `settlement=public_transfer` -> shielded deposit/withdraw path.
- `hide_amounts=true`, `hide_recipient=true`, `settlement=hashed_claim` -> hashed-claim flow.
- `settlement=internal_ledger` -> internal accounting path (when available).

### 11.6 API additions

Add policy endpoints:

- `GET /api/v1/zkdefi/privacy/policy/{user_address}`
- `PUT /api/v1/zkdefi/privacy/policy/{user_address}`
- `POST /api/v1/zkdefi/privacy/compile`
- `POST /api/v1/zkdefi/privacy/preview`

Compiler response should include user-readable guidance for UI:

- `path_label`
- `required_proofs`
- `requires_relayer`
- `estimated_steps`
- `warnings`

### 11.7 Gated execution integration

Policy remains aligned with execution policy v2:

- Manual wallet actions: no pre-block; advisory post-submit.
- Autonomous/session actions: hard gate (risk + anomaly + policy constraints).
- Privacy compiler runs before gate checks to ensure selected route is policy-valid.

### 11.8 Migration plan

1. Keep current Pool panels behind `NEXT_PUBLIC_PRIVACY_PRESETS_LEGACY=true`.
2. Introduce programmable policy UI and compiler behind `NEXT_PUBLIC_PRIVACY_POLICY_V1=true`.
3. Auto-migrate stored pool commitments to preset-tagged policy state where possible.
4. Remove static Pool A-D as primary IA after one release cycle.

### 11.9 Acceptance criteria

1. User can deposit once and manage privacy behavior via policy controls (no forced pool silo choice).
2. Existing Pool A-D actions still function via preset mapping during migration.
3. Onboarding, Profile, and Dashboard all read/write the same privacy policy object.
4. Execution path shown to user matches compiled policy route.
5. Autonomous/session execution respects privacy constraints and remains proof-gated.

---

## 12. Immediate UX backlog (added 2026-02-24)

1. **Unified Withdraw Console (new)**
   - Problem: users cannot reliably discover/execute withdraw across legacy pools after policy-driven deposits.
   - Build: one withdraw surface that aggregates all withdraw-eligible commitments/notes by route (`shielded`, `full_privacy`, `hashed_claims`) and provides a single primary CTA.
   - Requirements:
     - Show withdrawable balance/entries grouped by route and token.
     - Explicit privacy mode label used at deposit time.
     - One-path withdraw action with route-specific internals hidden behind advanced details.
     - History event on submit/confirm/fail with `execution_path` and `tx_hash`.

2. **Vault Funding card parity with policy UX**
   - Add explicit in-card privacy preset toggle (`Basic Shielded`, `Full Privacy`, `Hashed Claims`) and deposit/withdraw mode switch.
   - Keep manual wallet flow as primary, advisory-only warnings, no pre-block.

3. **Deposit/withdraw state reconciliation**
   - Move withdraw visibility to backend authority (receipts + commitment index), not local browser artifacts.
   - Add deterministic endpoint for withdraw-ready entries per user.

4. **Timeline correctness**
   - Ensure all manual wallet privacy actions write normalized events (`manual_wallet_action`) and reconcile optimistic frontend entries by `tx_hash`/`receipt_id`.

5. **Mode A demo path hardening**
   - Keep `/agent` default focused on: `policy -> fund -> swap/LP/deploy -> history`.
   - Keep Mode B/legacy pools in Expert drawer until unified withdraw console is stable.
