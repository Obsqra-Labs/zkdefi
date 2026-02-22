# Hackathon Ideas vs zkde.fi — Status Matrix

Objective mapping of hackathon idea categories to what zkde.fi **tackles** or **attempts**. Status: ✅ Done / 🔄 Attempted (partial) / 📋 Planned / ❌ Not in scope.

---

## ZK PROTOCOL IMPLEMENTATIONS

| Idea | Status | Notes |
|------|--------|--------|
| **Implement Semaphore on Starknet** | ❌ Not in scope | No Semaphore port. We use Merkle + nullifier (Tornado-style) in Cairo; no anonymous group signaling. |
| **Port the Semaphore protocol to Cairo** | ❌ Not in scope | Same as above. |
| **Build Cairo verifiers for Sigma protocols** | 🔄 Partial | We verify **Groth16 (Circom)** in Cairo via Garaga verifiers (deposit, withdraw, full-privacy, zkML). Not “Sigma protocols” in the classical sense. |
| **Mental Poker implementation** | ❌ Not in scope | No card shuffle / hidden-info game circuits. |
| **Anonymous credentials system** | 🔄 Partial | **Selective disclosure** (prove threshold/statement without revealing raw data); reputation/session constraints. Not full anonymous credentials (e.g. age/membership). |

---

## GAMES WITH PRIVATE STATE

| Idea | Status | Notes |
|------|--------|--------|
| **Poker / card game with hidden hands** | ❌ Not in scope | No poker or card-game logic. |
| **Strategy game with fog of war** | ❌ Not in scope | No game state or fog-of-war. |
| **Liar's poker or bluffing games** | ❌ Not in scope | No bluffing-game mechanics. |

---

## PRIVATE DEFI & COMMERCE

| Idea | Status | Notes |
|------|--------|--------|
| **Sealed-bid auction** | ❌ Not in scope | No auction contract or sealed-bid flow. |
| **Dark pool / private orderbook** | 🔄 Partial | **Relayer Tier 2/3** hides recipient/amount and depositor; no orderbook or MEV-style dark pool. |
| **Private prediction market** | ❌ Not in scope | No prediction market. (Contract has “prediction” in a different sense — zkML prediction stats.) |

---

## PRIVATE GOVERNANCE

| Idea | Status | Notes |
|------|--------|--------|
| **Private voting system** | ❌ Not in scope | No voting or tally; no vote-hiding. |

---

## CONFIDENTIAL TRANSACTIONS

| Idea | Status | Notes |
|------|--------|--------|
| **Private payment app using Tongo** | ❌ Not in scope | No Tongo/ElGamal; we use Circom/Groth16 + Merkle commitments. |
| **Shielded wallet UI** | ✅ Done | **ShieldedPoolPanel** + **FullPrivacyPoolPanel** (Pool B/C): deposit / withdraw / transfer flows; Starknet SDK; relayer option. |
| **Privacy-first DeFi frontend** | ✅ Done | Private pools (A/B/C), agent dashboard, protocol tabs (Ekubo, JediSwap), compliance panel; amount-hiding and relayer flows. |

---

## ZK PROOF VERIFICATION

| Idea | Status | Notes |
|------|--------|--------|
| **Verify Noir proofs on Starknet** | ❌ Not in scope | We use **Circom + Garaga**, not Noir. |
| **Verify Circom/Groth16 proofs on Starknet** | ✅ Done | **Garaga** BN254 verifiers on Starknet for: PrivateDeposit, PrivateWithdraw, FullPrivacyWithdraw (and WithChange), zkML (Risk, Anomaly, etc.). Circuits in Circom; snarkjs Groth16; Garaga formatter → Cairo verifier. |

---

## Summary counts

| Category | Done | Attempted / Partial | Planned | Not in scope |
|----------|------|--------------------|--------|--------------|
| ZK protocol implementations | 0 | 2 | 0 | 3 |
| Games with private state | 0 | 0 | 0 | 3 |
| Private DeFi & commerce | 0 | 1 | 0 | 2 |
| Private governance | 0 | 0 | 0 | 1 |
| Confidential transactions | 2 | 0 | 0 | 1 |
| ZK proof verification | 1 | 0 | 0 | 1 |
| **Total** | **3** | **3** | **0** | **11** |

**Tackled (done or attempted): 6**  
**Relevant ideas we do not tackle: 11**

---

## What we actually focus on

- **Confidential transfers**: Shielded + full-privacy (Merkle) pools; deposit/withdraw/relayer (Tier 2/3); Garaga Groth16 on Starknet.
- **Privacy-first frontend**: Pool UIs, agent, protocols (Ekubo, JediSwap), compliance.
- **Circom/Groth16 on Starknet**: Multiple circuits (deposit, withdraw, full-privacy, zkML); Garaga verifiers deployed and used in flows.
- **Selective disclosure / reputation**: Prove statements without revealing raw data; session keys and constraints (not full anonymous credentials).
- **Relayer privacy**: Hiding recipient/amount (T2) and depositor (T3); no sealed-bid auction or dark orderbook.

References: [PRIVACY_TIERS.md](PRIVACY_TIERS.md), [POOL_TYPES_AND_ROADMAP.md](POOL_TYPES_AND_ROADMAP.md), [ARCHITECTURE.md](ARCHITECTURE.md).
