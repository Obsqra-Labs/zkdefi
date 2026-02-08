# Privacy Features Guide

This guide covers zkde.fi's privacy features in detail, with practical examples and use cases.

## Overview

zkde.fi provides three layers of privacy:

1. **Confidential Transfers** — Hide amounts on deposits and withdrawals
2. **Selective Disclosure** — Prove statements without revealing data
3. **Position Aggregation** — Prove total value without revealing breakdown

---

## 1. Confidential Transfers

### Private Deposits

When you make a private deposit, the amount is hidden using a cryptographic commitment.

**How it works:**

1. Enter the amount you want to deposit
2. zkde.fi generates a commitment: `commitment = hash(amount, nonce)`
3. Only the commitment is stored on-chain — not the amount
4. You keep the nonce privately to later prove ownership

**What's visible on-chain:**
- Commitment hash (visible)
- Amount (hidden)
- Your balance (hidden)

**Example:**

```
User deposits 1000 USDC privately

On-chain record:
  commitment: 0x7a8b9c...
  amount: (hidden)

Only the user knows:
  amount: 1000 USDC
  nonce: 0x123456...
```

### Private Withdrawals

To withdraw from a private commitment:

1. **Select a commitment** — Choose from your list of commitments
2. **Enter withdrawal amount** — Must be <= commitment balance
3. **Generate proof** — Proves ownership and sufficient balance
4. **Nullifier creation** — Prevents double-spend

**What's visible on-chain:**
- Nullifier (visible, prevents reuse)
- Commitment being spent (visible)
- Withdrawal amount (hidden)
- Remaining balance (hidden)

**Example:**

```
User withdraws 300 USDC from commitment 0x7a8b9c...

On-chain record:
  nullifier: 0xdef123...
  commitment: 0x7a8b9c...
  amount: (hidden)

The nullifier ensures this commitment portion can't be spent again.
```

---

## 2. Selective Disclosure

Prove statements about your portfolio without revealing the underlying data.

### Available Statement Types

#### Yield Above Threshold

Prove your yield exceeds a value.

**Use cases:**
- Access yield-based protocol tiers
- Prove performance to investors
- Qualify for rewards programs

**Example:**
```
Statement: "My 30-day yield > 10%"
Proof registered on-chain
Actual yield (15.7%) remains private
```

#### Balance Above Threshold

Prove your balance exceeds a value.

**Use cases:**
- Access balance-gated features
- Prove solvency to lenders
- Qualify for premium tiers

#### Risk Compliance

Prove your portfolio risk is below a threshold.

**Supported metrics:**
- **Value at Risk (VaR)** — Maximum expected loss
- **Sharpe Ratio** — Risk-adjusted returns
- **Max Drawdown** — Largest peak-to-trough decline

**Use cases:**
- Meet institutional risk limits
- Prove conservative strategy
- Regulatory compliance

**Example:**
```
Statement: "Portfolio VaR < 20%"
Proof: Verified
Actual risk profile remains private
```

#### Performance Proofs

Prove your APY exceeded a threshold over a period.

**Use cases:**
- Qualify for advanced protocol features
- Demonstrate trading skill
- Access professional tools

**Example:**
```
Statement: "30-day APY > 15%"
Proof: Verified
Actual APY and trades remain private
```

#### KYC Eligibility

Prove financial standing for regulatory compliance.

**Use cases:**
- Accredited investor verification
- Regulatory compliance
- Access to restricted protocols

**Example:**
```
Statement: "Total holdings > $100,000"
Proof: Verified
Exact holdings remain private
```

#### Portfolio Aggregation

Prove total value across protocols without revealing breakdown.

**Use cases:**
- Prove total value for protocol access
- Multi-protocol tier qualification
- Privacy-preserving wealth attestation

**Example:**
```
Statement: "Total across Ekubo + JediSwap + Private > $50,000"
Proof: Verified
Individual protocol amounts remain private
```

---

## 3. Position Aggregation

The portfolio view supports a privacy toggle:

### Public View
- Shows pie chart with protocol breakdown
- Displays individual protocol amounts
- Full allocation visibility

### Private View
- Shows only total aggregated value
- Displays count of positions (not amounts)
- No breakdown visible
- "Generate Aggregation Proof" button

**When to use Private View:**
- Sharing screen with others
- Demonstrating total value without strategy
- Regulatory attestations

---

## Privacy Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend                              │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │ Private       │  │ Selective     │  │ Position    │ │
│  │ Transfer      │  │ Disclosure    │  │ Chart       │ │
│  │ Panel         │  │ Panel         │  │ (Toggle)    │ │
│  └───────┬───────┘  └───────┬───────┘  └──────┬──────┘ │
└──────────┼──────────────────┼─────────────────┼────────┘
           │                  │                 │
           ▼                  ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│                    Backend API                           │
│  /private_deposit    /disclosure/risk    /position/     │
│  /private_withdraw   /disclosure/perf    aggregate      │
│  /private_commitments                                   │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Starknet Contracts                       │
│  ┌─────────────────┐  ┌────────────────┐               │
│  │ Confidential    │  │ Selective      │               │
│  │ Transfer        │  │ Disclosure     │               │
│  │ (Garaga)        │  │ (Integrity)    │               │
│  └─────────────────┘  └────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

---

## Best Practices

### For Maximum Privacy

1. **Use private deposits** for all sensitive amounts
2. **Enable privacy mode** in portfolio view when sharing
3. **Use selective disclosure** instead of revealing actual values
4. **Generate proofs** for third-party verification

### For Compliance

1. **Register disclosures on-chain** for audit trail
2. **Use KYC eligibility proofs** for regulated access
3. **Generate risk compliance proofs** for institutional requirements
4. **Keep shareable proof links** for verifiers

### For DeFi Operations

1. **Check commitment balances** before withdrawing
2. **Store nonces securely** — needed for withdrawals
3. **Use aggregation proofs** for multi-protocol tier access
4. **Monitor nullifiers** to track spent commitments

---

## API Reference

### Private Transfers

```
POST /api/v1/zkdefi/private_deposit
POST /api/v1/zkdefi/private_withdraw
GET  /api/v1/zkdefi/private_commitments/{address}
```

### Selective Disclosure

```
POST /api/v1/zkdefi/disclosure/generate
POST /api/v1/zkdefi/disclosure/risk_compliance
POST /api/v1/zkdefi/disclosure/performance
POST /api/v1/zkdefi/disclosure/kyc_eligibility
POST /api/v1/zkdefi/disclosure/aggregation
```

### Position Aggregation

```
GET /api/v1/zkdefi/position/aggregate/{address}
```

---

Next: [Contracts](/contracts)
