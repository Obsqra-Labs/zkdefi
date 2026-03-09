# Quick Start (First 15 Minutes)

This guide takes you from wallet connect to first controlled execution.

## 1) Connect Wallet

1. Install ArgentX or Braavos.
2. Switch to Starknet Sepolia for test flows.
3. Open `https://zkde.fi` and connect.

Expected result:
- Wallet shows connected.
- App routes are available (`/profile`, `/agent`, `/trade`).

## 2) Set Trust Context In Profile

1. Open `/profile`.
2. Confirm identity/binding status.
3. Check trust/reputation state and any gating warnings.

Why this is first:
- Borrowing, automation, and some execution paths are policy/gate dependent.

## 3) Prepare In Capital OS

1. Open `/agent`.
2. In Capital Ledger, confirm your capital posture.
3. In Control Plane, confirm system health and readiness.
4. Decide your mode: guided/manual first, automation later.

Expected result:
- You can hand off to Trade Desk with a clear posture and policy state.

## 4) Execute In Trade Desk

1. Open `/trade`.
2. Pick an opportunity from the stream/list.
3. Select adapter route (do not skip this).
4. Run simulation with explicit slippage settings.
5. Execute via wallet signature.

Expected result:
- Tx hash/receipt is produced.
- Opportunity state refreshes after confirmation.

## 5) Verify Outcome

1. Return to `/profile` and check updated trust/reputation context.
2. Review receipts/history and confirm result matches simulation intent.
3. Adjust constraints or strategy and repeat.

## Common Mistakes

- Executing before profile/trust checks.
- Ignoring adapter route and slippage.
- Forcing execution through a mismatched gate state.

Next: [Capital OS](/capital-os) | [Trade Desk](/trade-desk) | [How Systems Work](/how-systems-work)
