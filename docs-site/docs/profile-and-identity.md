# Profile And Identity (`/profile`)

`/profile` is the trust cockpit for a wallet address. Check it before running sensitive execution flows.

## Canonical Tabs

- `trust`
- `reputation`
- `compliance`
- `connections`

Canonical URLs:

- `/profile?tab=trust`
- `/profile?tab=reputation`
- `/profile?tab=compliance`
- `/profile?tab=connections`

## What Each Tab Answers

### `trust`

- Is this wallet ready for controlled execution paths?

### `reputation`

- What tier is the user in, and what improves access/posture?

### `compliance`

- What disclosure artifacts are available for partner workflows?

### `connections`

- Which addresses and relayer-related contexts are linked?

## Why This Page Matters

- Prevents blind execution without trust context
- Explains blocked/gated states before a user hits execute
- Centralizes reputation and disclosure data used by integrators

## Typical APIs Behind Profile

- `GET /api/v1/zkdefi/risk_profile/{address}`
- `GET /api/v1/zkdefi/reputation/user/{address}`
- `GET /api/v1/zkdefi/risk_passport/user/{address}`
- `GET /api/v1/zkdefi/compliance/profiles/{user_address}`
- `GET /api/v1/zkdefi/linked_addresses/{address}`

Next: [Reputation System](/reputation-system) | [Privacy And Unlocks](/privacy-features) | [Capital OS](/capital-os)
