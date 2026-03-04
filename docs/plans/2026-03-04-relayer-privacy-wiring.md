# Relayer Privacy Wiring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the full-privacy withdrawal path through the relayer so a separate wallet signs the on-chain withdraw transaction, breaking the deposit-withdrawal link for an on-chain observer.

**Architecture:** The contract (`withdraw_relayed_u256`), backend queue (`POST /relayer/request`), and relayer runner (`RelayerRunner._submit_withdrawal`) already exist and work. Two things are broken: (1) the frontend `withdrawNullifierSet` always calls `withdraw_u256` directly, ignoring the `useRelayer` toggle; (2) the relayer wallet is the same as the deployer/user wallet (`0x05fe812...`), making the privacy gain zero. This plan wires the frontend relayer path, generates a dedicated relayer keypair, and adds relay status feedback.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Python (FastAPI backend), starknet-py, starkli, Cairo contracts (deployed, no changes needed).

---

## What Already Exists (No Changes Needed)

| Component | Location | Status |
|-----------|----------|--------|
| `withdraw_relayed_u256` contract entrypoint | `contracts/src/fully_shielded_pool.cairo:347-377` | Deployed, reads recipient from proof public inputs |
| `POST /relayer/request` queue endpoint | `backend/app/api/relayer.py:354-382` | Working, accepts `RelayWithdrawRequest` |
| `RelayerRunner._submit_withdrawal` | `backend/app/services/relayer_runner.py:301-331` | Invokes `withdraw_relayed_u256` via starkli/starknet-py |
| `RelayerRunner.process_once` loop | `backend/app/services/relayer_runner.py:471-531` | Polls `relay_queue`, submits ready withdrawals |
| ZK circuits with `recipient` public input | `circuits/FullPrivacyWithdraw.circom:91`, `FullPrivacyWithdrawWithChange.circom:88` | Compiled, verifier deployed |
| Backend proof gen with `recipient` param | `backend/app/api/routes/full_privacy.py:71-83` | `WithdrawProofRequest.recipient` field |
| `useRelayer` toggle + recipient input in UI | `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx:741-769` | Rendered, wired to state |
| PM2 relayer runner process | `ecosystem.config.cjs:38-46` | `zkdefi-relayer-runner` |

---

## What's Broken

### 1. Frontend ignores relayer toggle for nullifier_set / hashed_proof

`withdrawNullifierSet` (WithdrawPanel.tsx:300-445) always constructs calldata for `withdraw_u256` and calls `account.execute()` directly. It never checks `useRelayer`. Only `withdrawCommitmentShield` (lines 232-298) conditionally switches between `private_withdraw_u256` and `request_relayed_withdraw`.

### 2. Relayer wallet = user wallet

```
# backend/.env
FULL_PRIVACY_MERKLE_TREE_ADMIN_ADDRESS=0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
RELAYER_ADDRESS=0x05fe812551bec726f1bf5026d5fb88f06ed411a753fb4468f9e19ebf8ced1b3d
```

Same key signs deposits and relayer-submitted withdrawals. An on-chain observer sees the same address on both sides — the relayer provides zero additional privacy.

---

### Task 1: Generate a Dedicated Relayer Keypair

**Files:**
- Modify: `backend/.env` (lines 30-31)
- Modify: `backend/run_relayer_runner.sh` (no code changes, just verify it picks up new env)

**Step 1: Generate new Starknet keypair via starkli**

```bash
cd /opt/obsqra.starknet/zkdefi
starkli signer keystore new /root/.starkli/keystores/relayer_keystore.json
```

Note the new private key. Then create an account descriptor:

```bash
starkli account oz init \
  --keystore /root/.starkli/keystores/relayer_keystore.json \
  /root/.starkli/accounts/relayer_account.json
```

Deploy the account (needs ETH on sepolia):

```bash
starkli account deploy \
  --keystore /root/.starkli/keystores/relayer_keystore.json \
  /root/.starkli/accounts/relayer_account.json \
  --network sepolia
```

**Step 2: Fund the relayer wallet**

Transfer a small amount of ETH (0.01-0.05 ETH) from the deployer wallet to the new relayer address for gas fees.

**Step 3: Update `.env` with new relayer credentials**

Replace lines 30-31 in `backend/.env`:

```
RELAYER_ADDRESS=<new_relayer_address>
RELAYER_PRIVATE_KEY=<new_relayer_private_key>
```

**Step 4: Update `RELAYER_STARKLI_ACCOUNT` path in `run_relayer_runner.sh`**

Line 66 currently falls back to `deployer_starkli.json`. Add explicit relayer account:

```bash
if [ -z "${RELAYER_STARKLI_ACCOUNT:-}" ] && [ -f "/root/.starkli/accounts/relayer_account.json" ]; then
  export RELAYER_STARKLI_ACCOUNT="/root/.starkli/accounts/relayer_account.json"
fi
```

**Step 5: Verify relayer runner starts with new wallet**

```bash
RELAYER_DRY_RUN=true bash backend/run_relayer_runner.sh
```

Expected: Runner starts, logs new relayer address, polls with no errors.

**Step 6: Commit**

```bash
git add backend/run_relayer_runner.sh
git commit -m "infra: configure dedicated relayer keypair path"
```

Do NOT commit `.env` (contains secrets).

---

### Task 2: Wire `withdrawNullifierSet` to Use Relayer

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx:300-445`

**Step 1: Add relayer queue function**

After the existing `withdrawNullifierSet` function (around line 445), before `withdrawDarkLedger`, add:

```typescript
async function queueRelayerWithdraw(
  nullLow: string,
  nullHigh: string,
  rootLow: string,
  rootHigh: string,
  poolType: number,
  proofFelts: string[],
) {
  const res = await fetch(`${API_BASE}/api/v1/zkdefi/relayer/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requester: address,
      nullifier_low: nullLow,
      nullifier_high: nullHigh,
      root_low: rootLow,
      root_high: rootHigh,
      pool_type: poolType,
      proof_calldata: proofFelts,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Relayer queue failed");
  }
  return data;
}
```

**Step 2: Modify `withdrawNullifierSet` to branch on `useRelayer`**

After the proof generation and calldata parsing section (after line 397, where `setWithdrawSteps(updateStep(withdrawSteps, 2, "active", "Sign in wallet..."))` is called), add the relayer branch:

Replace the block from "Sign in wallet..." through `return txHash` with:

```typescript
if (useRelayer) {
  setWithdrawSteps(
    updateStep(withdrawSteps, 2, "active", "Queuing via relayer..."),
  );

  const relayData = await queueRelayerWithdraw(
    nullLow,
    nullHigh,
    rootLow,
    rootHigh,
    poolType,
    proofFelts,
  );

  setWithdrawSteps(
    updateStep(withdrawSteps, 3, "done", `Queued (relay #${relayData.request_id})`),
  );
  return relayData.request_id?.toString() || "";
} else {
  setWithdrawSteps(
    updateStep(withdrawSteps, 2, "active", "Sign in wallet..."),
  );
  if (!account) throw new Error("Wallet not connected");

  // ... existing direct withdrawal logic (calldata construction + account.execute) ...
}
```

**Step 3: Pass `recipientAddress` to proof generation when relayer is on**

In the proof generation `fetch` body (line 348-363), change the `recipient` field:

```typescript
recipient: useRelayer && recipientAddress ? recipientAddress : address,
```

This embeds the user's chosen fresh address into the ZK proof as a public input. The contract's `withdraw_relayed_u256` reads recipient from the proof — the relayer cannot redirect funds.

**Step 4: Verify build**

```bash
cd frontend && npx next build
```

Expected: No type errors, build succeeds.

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/vault/WithdrawPanel.tsx
git commit -m "feat: wire nullifier_set/hashed_proof withdraw through relayer queue"
```

---

### Task 3: Relayer Status Feedback

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx` (withdraw handler + toast)

**Step 1: Update toast for relayed withdrawals**

In `handleWithdraw` (line 477), after the `switch` block, differentiate between direct tx hash and relayer request ID:

```typescript
const isRelayed = useRelayer && method !== "dark_ledger" && method !== "commitment_shield";

if (isRelayed) {
  toastSuccess(
    `Withdrawal queued via relayer (request #${txHash})`,
    {
      action: {
        label: "Check status",
        onClick: () =>
          window.open(
            `${API_BASE}/api/v1/zkdefi/relayer/request/${txHash}`,
            "_blank",
          ),
      },
    },
  );
} else if (txHash) {
  toastSuccess(
    `Withdrawal of ${amount} ${selectedCommitment.asset} submitted`,
    {
      action: {
        label: "View tx",
        onClick: () =>
          window.open(sepoliaVoyagerTxUrl(txHash), "_blank"),
      },
    },
  );
}
```

**Step 2: Update activity log event for relayed withdrawals**

```typescript
addActivityEvent(setActivityFeed, {
  type: "withdraw",
  pool: method === "dark_ledger" ? "dark_ledger" : method === "commitment_shield" ? "shielded" : "full_privacy",
  text: isRelayed
    ? `Queued relayed withdrawal of ${amount} ${selectedCommitment.asset} via ${METHOD_LABELS[method]}`
    : `Withdrew ${amount} ${selectedCommitment.asset} via ${METHOD_LABELS[method]}`,
  txHash: isRelayed ? undefined : txHash,
});
```

**Step 3: Verify build**

```bash
cd frontend && npx next build
```

**Step 4: Commit**

```bash
git add frontend/src/components/zkdefi/vault/WithdrawPanel.tsx
git commit -m "feat: relayer status toast and activity log for queued withdrawals"
```

---

### Task 4: Relayer Toggle UX — Show for All Privacy Tiers

**Files:**
- Modify: `frontend/src/components/zkdefi/vault/WithdrawPanel.tsx` (render section)

**Step 1: Adjust relayer toggle visibility**

Currently (line 741): `{userTier >= 1 && (...)}` — the toggle only shows if the user has reputation tier >= 1. Update to also hide for `dark_ledger` (which has its own flow) and `commitment_shield` (which already has its own relayer path):

```typescript
{userTier >= 1 && (method === "nullifier_set" || method === "hashed_proof") && (
```

This makes the relayer toggle only appear for the tiers that route through `withdrawNullifierSet`, where the new relayer wiring lives.

For `commitment_shield`, the existing `withdrawCommitmentShield` already handles `useRelayer` internally. The toggle condition should also include `commitment_shield`:

```typescript
{userTier >= 1 && method !== "dark_ledger" && (
```

**Step 2: Add privacy explanation when relayer is toggled on**

Below the recipient address input (after line 767), add:

```tsx
{useRelayer && (
  <div className="text-[11px] text-emerald-400/80 leading-relaxed">
    A separate relayer wallet will submit the withdrawal transaction.
    Your depositing address will not appear on the withdraw tx.
    The recipient is cryptographically bound in the ZK proof — the relayer cannot redirect funds.
  </div>
)}
```

**Step 3: Require recipient address when relayer is on**

Update `canSubmit` (line 570-571) to require a recipient when relayer is toggled:

```typescript
const canSubmit =
  !busy &&
  !!selectedCommitment &&
  !selectedIsStale &&
  !!amount &&
  parseFloat(amount) > 0 &&
  (!useRelayer || (recipientAddress && recipientAddress.startsWith("0x")));
```

**Step 4: Verify build**

```bash
cd frontend && npx next build
```

**Step 5: Commit**

```bash
git add frontend/src/components/zkdefi/vault/WithdrawPanel.tsx
git commit -m "ux: relayer toggle visibility, privacy explainer, recipient validation"
```

---

### Task 5: End-to-End Verification

**Step 1: Start the relayer runner**

```bash
pm2 restart zkdefi-relayer-runner
pm2 logs zkdefi-relayer-runner --lines 20
```

Expected: Runner starts with the new relayer address (different from `0x05fe812...`).

**Step 2: Make a test deposit (nullifier_set)**

Deposit a small amount via the Vault UI using Nullifier Set tier.

**Step 3: Withdraw with relayer toggled ON**

1. Select the deposit in WithdrawPanel
2. Toggle "Use relayer"
3. Enter a fresh recipient address (can be same wallet for testing, but ideally a different one)
4. Click "Withdraw Privately"
5. Verify: No wallet signing popup (the proof is generated, queued, and the relayer handles the on-chain call)
6. Verify: Toast shows "Withdrawal queued via relayer (request #N)"

**Step 4: Verify relayer processes the withdrawal**

```bash
pm2 logs zkdefi-relayer-runner --lines 30
```

Expected: "Relayed withdraw N tx=0x..." with the transaction signed by the NEW relayer address.

**Step 5: Verify on Voyager**

Open the withdrawal transaction on Voyager. Confirm:
- The transaction signer is the relayer address (NOT `0x05fe812...`)
- The `withdraw_relayed_u256` entrypoint was called
- The recipient received the funds at the address specified in the proof

**Step 6: Commit verification notes**

```bash
git add docs/plans/2026-03-04-relayer-privacy-wiring.md
git commit -m "docs: relayer privacy wiring plan — verified end-to-end"
```

---

## Privacy Model After This Plan

| Tier | Deposit signer | Withdraw signer | Linkable? |
|------|---------------|-----------------|-----------|
| commitment_shield (relayer off) | User wallet | User wallet | Yes (same signer) |
| commitment_shield (relayer on) | User wallet | User wallet (request_relayed_withdraw is on-chain queue, still user-signed) | Partially (request is user-signed, execution is relayer-signed) |
| nullifier_set / hashed_proof (relayer off) | User wallet | User wallet | Yes (same signer) |
| **nullifier_set / hashed_proof (relayer on)** | User wallet | **Relayer wallet** | **No** (different signer, recipient from proof) |
| dark_ledger | User wallet | Backend (off-chain) | No (off-chain ledger) |

The key privacy improvement: for nullifier_set and hashed_proof with relayer on, the on-chain withdrawal transaction is signed by a completely separate relayer wallet. The recipient address is cryptographically bound inside the Groth16 proof — the relayer provably cannot redirect funds. The depositing wallet address never appears on the withdrawal transaction.

**Remaining operational privacy considerations (out of scope for this plan):**
- Anonymity set size: More depositors = harder to link. Currently small.
- Timing correlation: If deposit at T and withdrawal at T+30s with relayer, timing analysis may still link them. Solution: configurable delay (already exists in relayer: `_tier_delay_seconds`).
- Amount correlation: Fixed denomination deposits would strengthen privacy. Currently arbitrary amounts.
- IP correlation: Frontend and relayer should not share IP logs. Out of scope.
