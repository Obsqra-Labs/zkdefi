# Internal Accounting — Not Later, Next

*Internal accounting is already partly built. This doc states what’s done and what’s next so it stops getting pushed back.*

---

## What “internal accounting” means here

Settlement via **our ledger**: no public token transfer to the recipient. Recipient and amount stay off the public chain; we credit an internal balance and optionally pay out later to a shielded commitment (batch or on-demand).

---

## What’s already done

| Piece | Status | Where |
|-------|--------|--------|
| **Ledger DB** | Done | SQLite: `ledger_accounts`, `ledger_transfers`, `ledger_events`, `claim_requests`. `LedgerService`: credit_balance, debit_balance, get_balance, list_transfers. |
| **Credit on claim (internal mode)** | Done | When `LEDGER_PAYOUT_MODE=internal`, runner verifies claim on-chain, returns "ledger-only", calls `mark_claim_executed` → API credits `ledger.credit_balance(recipient, amount_wei, request_id, reason="tier2h_claim")`. No on-chain payout; recipient/amount never hit the chain. |
| **Ledger API** | Done | `GET /relayer/ledger/balance/{address}`, `GET /relayer/ledger/transfers`, `GET /relayer/ledger/claims`, `GET /relayer/ledger/events`. |
| **Config** | Done | `LEDGER_PAYOUT_MODE` = `onchain` (default) or `internal`. `LEDGER_ENABLED`, `LEDGER_DB_PATH`. |

So: **crediting internal balance on Tier-2H claim is implemented.** When you set `LEDGER_PAYOUT_MODE=internal`, claim payout does not call escrow/ConfidentialTransfer; it only verifies the claim on-chain and credits the recipient’s ledger balance.

---

## What’s missing (concrete next steps)

### 1. Pool D UI: show ledger balance

- **Goal:** User sees “Ledger balance: X ETH” in the Pool D panel so internal balance is visible.
- **How:** Call `GET /api/v1/zkdefi/relayer/ledger/balance/{address}` when the user is connected; show the value in the Pool D “Ledger audit” section or a small “Your ledger balance” line.
- **Files:** `frontend/src/components/zkdefi/HashedWithdrawPoolPanel.tsx`.

### 2. Withdraw-from-ledger API

- **Goal:** User can pull ledger balance into a shielded commitment (one payout to ConfidentialTransfer.private_deposit).
- **How:** New endpoint, e.g. `POST /relayer/ledger/withdraw` or `POST /relayer/ledger/payout`: body = `{ "address", "amount_wei", "commitment_low", "commitment_high" }` (or we generate commitment server-side). Logic: (a) check ledger balance ≥ amount, (b) debit ledger, (c) call ConfidentialTransfer.private_deposit (or escrow path) for that commitment/amount, (d) return tx hash or “queued” for runner.
- **Files:** `backend/app/api/relayer.py`, optionally `backend/app/services/relayer_runner.py` if payout is async via runner.

### 3. Pool D UI: “Withdraw from ledger”

- **Goal:** User can trigger a payout from ledger balance to a shielded commitment.
- **How:** In Pool D, “Withdraw from ledger” section: input amount (max = ledger balance), generate or select commitment, submit to the new ledger-withdraw API; show pending/success and tx link.
- **Files:** `frontend/src/components/zkdefi/HashedWithdrawPoolPanel.tsx`.

### 4. Docs and env

- **Goal:** Internal accounting is documented as “in progress” and how to enable it.
- **How:** In RELAYER_POOL_D_UI_SCOPE.md or ENV.md: set `LEDGER_PAYOUT_MODE=internal` for internal-only settlement; document that balance is visible at `/relayer/ledger/balance/{address}` and that withdraw-from-ledger is the next step.

---

## Order of work

1. **Show ledger balance in Pool D** (small, unblocks visibility).
2. **Withdraw-from-ledger API** (backend: debit + one shielded payout).
3. **Withdraw-from-ledger UI** (Pool D: amount, commitment, submit).
4. **Docs** (ENV + scope: internal mode, balance, withdraw).

---

## Why it kept getting pushed back

- Product plan and scope docs listed “internal accounting” under “later” or “decide on” without tying it to the existing ledger and internal-mode credit path.
- The credit path is already there; the missing pieces are **visibility** (balance in UI) and **withdraw** (API + UI to move ledger → shielded). That’s a small, bounded scope, not a vague “someday” item.

Use this doc to keep internal accounting in the “next” list and to implement the four steps above.
