# Signed Risk Disclosure in Onboarding — Scope

## Goal

Make users **sign** the risk disclosure with their wallet as part of the onboarding/setup bundle so there is a verifiable proof (signature) that they acknowledged the risks. This supports compliance and auditability.

## Current State

- **OnboardingWizard** (agent page): 6 steps — Connect, Configure, Claims, Authorize, Fund, Complete. Shown when `zkdefi_onboarded_${address}` is not set. On complete we set that in localStorage.
- **RiskDisclosure** (global): Modal shown once per device when `risk-acknowledged` is not in localStorage. Click "I understand" only; no signature.
- No backend endpoint today that accepts or stores a "setup bundle" or risk signature.

## Proposed Flow

### Step order change

Insert a **Sign Risk Disclosure** step **after Connect, before Configure**:

| Step | Title        | What happens |
|------|--------------|--------------|
| 1    | Connect      | Connect wallet (unchanged) |
| 2    | Risk Disclosure | Show risk text; user must **sign with wallet** to continue |
| 3    | Configure    | Constraints (unchanged) |
| 4    | Claims       | Reputation claims (unchanged) |
| 5    | Authorize    | Generate STARK proofs (unchanged) |
| 6    | Fund         | Deposit (unchanged) |
| 7    | Complete     | Done (unchanged) |

So we go from 6 to **7 steps**. Step 2 is the new signed risk disclosure.

### What gets signed (TypedData)

Use **Starknet TypedData** (EIP-712 style) so the wallet shows a readable message. Suggested structure:

- **Domain**: `name: "zkde.fi"`, `version: "1"`, `chainId`: current chain (e.g. `SN_SEPOLIA`).
- **Primary type**: e.g. `RiskDisclosure`.
- **Message**:
  - `statement`: short string or hash of the risk disclosure text (e.g. "I have read and accept the Risk Disclosure at https://zkde.fi/terms#risk").
  - `version`: e.g. `"2026-02"` (policy version).
  - `timestamp`: optional; when they signed (seconds or string).

Wallets (ArgentX, Braavos) will show this in their sign UI. Keep the message short and unambiguous.

### Frontend implementation

1. **OnboardingWizard**
   - Add step 2: "Risk Disclosure" UI with:
     - Same risk bullets as in `RiskDisclosure.tsx` (or a short summary + link to `/terms#risk`).
     - Button: "Sign with wallet". On click call `signTypedDataAsync(riskDisclosureTypedData)`.
   - Use **`useSignTypedData`** from `@starknet-react/core`. Call `signTypedDataAsync(args)` at sign time with the TypedData above (params can be passed at call time).
   - On success: store the signature + metadata (see below), then `setStep(3)`.
   - Renumber steps 3–6 to 4–7 (Configure, Claims, Authorize, Fund, Complete). Update `STEPS` array and all `step === N` checks.

2. **Storage of the signature (client)**
   - Key: `zkdefi_risk_sig_${address}`.
   - Value: JSON, e.g. `{ signature: { r, s }, messageHash?, signedAt: ISO8601 }`. Include whatever the wallet returns (e.g. `r`, `s`, and if available a message hash for verification).
   - Persist in localStorage so we don't ask again for that address. If user disconnects and reconnects same wallet, step 2 can be skipped when this key exists (optional shortcut).

3. **Optional: skip global RiskDisclosure modal for onboarded users**
   - If `zkdefi_onboarded_${address}` is set, we can treat risk as already accepted (they signed in onboarding). Optionally also set `risk-acknowledged` when they complete the onboarding so the global modal never shows for them.

4. **Include signature in setup bundle**
   - When we later add an "onboarding complete" or "register user" API call, the request body can include `risk_disclosure_signature` (and optionally `risk_disclosure_message_hash`, `signed_at`) so the backend has a record. No backend change required for the minimal scope; this is the extension point.

### Backend (optional for v1)

- **Minimal v1**: No backend change. Signature is stored only in the frontend (localStorage) and optionally included in any future "onboarding complete" payload.
- **Optional later**: New endpoint, e.g. `POST /api/v1/zkdefi/onboarding/risk_disclosure`, body: `{ user_address, signature_r, signature_s, message_hash, signed_at }`. Backend stores (DB or append-only log) for audit. Verification can be off-chain (recover signer from signature + message hash) if needed.

### Verification (for audits)

- **Off-chain**: Given the TypedData message and the signature `(r, s)`, use Starknet.js (or equivalent) to verify that the signer matches `address`. No on-chain call required.
- **On-chain**: Only if we later want to enforce "signed risk" in a contract; not in initial scope.

## What we don't do in this scope

- On-chain storage of the signature or a commitment.
- Changing the Terms or Privacy policy content (only adding a stable "statement" string for signing).
- Backend persistence of the signature (unless we add the optional endpoint above).

## Implementation checklist

- Define `riskDisclosureTypedData` (domain, types, primaryType, message) in a small frontend util or inside the wizard.
- Add step 2 to OnboardingWizard: Risk Disclosure + "Sign with wallet" using `useSignTypedData` and `signTypedDataAsync`.
- On success: save to `zkdefi_risk_sig_${address}`, advance to step 3.
- Renumber steps 3–6 to 4–7; update STEPS and all step logic.
- Optional: if `zkdefi_risk_sig_${address}` already exists, skip step 2 (or show "Already signed" and Continue).
- Optional: set `risk-acknowledged` when onboarding completes so global RiskDisclosure modal is skipped for that user.
- Optional: add backend endpoint and include `risk_disclosure_signature` in any onboarding-complete API call.

## Files to touch

- `frontend/src/components/zkdefi/OnboardingWizard.tsx` — add step 2, useSignTypedData, storage, step renumber.
- `frontend/src/components/RiskDisclosure.tsx` — optional: don't show modal if user completed onboarding (already signed).
- New (optional): `frontend/src/lib/riskDisclosureTypedData.ts` — single source of truth for TypedData and statement text.
- Backend (optional): new route and model for storing risk disclosure signature.

## Dependencies

- `@starknet-react/core`: `useSignTypedData` (already in package.json).
- Wallet must support `wallet_signTypedData` (ArgentX, Braavos do).
