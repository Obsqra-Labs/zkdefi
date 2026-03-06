# zkde.fi Agent Flow: UX and Session Keys

**zkde.fi** is a privacy-preserving autonomous agent for DeFi. This doc describes the UX flow for delegating to the agent via session keys, proof-gated execution, and privacy.

---

## User Journey

### Step 1: Connect and delegate

**Screen: Landing → Connect wallet**

```
┌─────────────────────────────────────────────────────────────┐
│  zkde.fi                                          [Connect]  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│          Privacy-preserving autonomous agent for DeFi       │
│                                                              │
│  [  Connect wallet to delegate to agent  ]                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Action:** User connects Argent or Braavos wallet (native session key support).

---

### Step 2: Grant session key (delegate to agent)

**Screen: Agent page → Session setup**

```
┌─────────────────────────────────────────────────────────────┐
│  zkde.fi · Autonomous agent                   [0x1234...]   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Delegate to agent                                     │ │
│  │                                                        │ │
│  │  Grant session key so the agent can:                  │ │
│  │  • Execute deposits and rebalances on your behalf     │ │
│  │  • Manage positions across protocols (Jedi, Ekubo)    │ │
│  │  • Stay within your constraints                       │ │
│  │                                                        │ │
│  │  Session constraints:                                  │ │
│  │  Max position:     [10,000 STRK      ]               │ │
│  │  Allowed protocols: [Jedi ✓] [Ekubo ✓] [Pools ✓] │ │
│  │  Expiry:           [7 days           ]               │ │
│  │                                                        │ │
│  │  [  Grant session key  ]                              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Action:** User sets constraints and clicks "Grant session key" → wallet prompts for session signature (one-time). Agent is now authorized to act within constraints.

**Privacy note:** Session granting is on-chain (visible), but agent's **future intents** (what it will do, when, how much) stay **hidden** until execution.

---

### Step 3: Agent operates (autonomous execution)

**Screen: Agent dashboard**

```
┌─────────────────────────────────────────────────────────────┐
│  zkde.fi · Agent active                       [0x1234...]   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Session active: 6 days remaining              [Revoke]     │
│  Max position: 10,000 STRK · Used: 2,450 STRK (24%)        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Agent status         [●] Active · Monitoring          │ │
│  │                                                        │ │
│  │  Current allocation:                                   │ │
│  │  JediSwap    1,200 STRK  (49%)   [Proof-gated ✓]     │ │
│  │  Ekubo       1,250 STRK  (51%)   [Proof-gated ✓]     │ │
│  │                                                        │ │
│  │  Last action: 2 hours ago                             │ │
│  │  Rebalanced → 49/51 allocation                        │ │
│  │  Proof: 0xabc123... [View on Starkscan]              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Agent actions (proof-gated)                          │ │
│  │                                                        │ │
│  │  • Monitors risk/APY across protocols                 │ │
│  │  • Generates allocation decision (AI risk engine)     │ │
│  │  • Requests proof (constraints satisfied)             │ │
│  │  • Executes rebalance (proof-gated, session-keyed)   │ │
│  │                                                        │ │
│  │  All intents hidden until execution.                  │ │
│  │  All actions require on-chain proof verification.     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**What happens behind the scenes:**

1. **Agent monitors** protocols (risk, APY) → decides to rebalance
2. **Agent generates proof** (allocation decision satisfies user constraints) via Stone → Integrity
3. **Agent executes** via session key + proof_hash:
   ```cairo
   account.execute_with_session(
       session_key,
       proof_hash,  // from Integrity
       [deposit_call, withdraw_call]  // multicall
   )
   ```
4. **On-chain validation:** Session valid? ✓ Proof valid (Integrity)? ✓ → Execute

**Privacy:** Agent's **intent** (rebalance decision, timing, amounts) was not broadcast; only the **execution** is visible (and can be confidential via Garaga).

---

### Step 4: Compliance and disclosure

**Screen: Compliance panel**

```
┌─────────────────────────────────────────────────────────────┐
│  Compliance / Selective disclosure                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Prove compliance without revealing agent strategy:          │
│                                                              │
│  Statement: "Agent stayed within max position"              │
│  Threshold:  10,000 STRK                                    │
│  Result:     true                                           │
│                                                              │
│  [  Generate compliance proof  ]                            │
│                                                              │
│  ──────────────────────────────────────────────────────────  │
│                                                              │
│  Proof ready: 0xdef456...                                   │
│  [  Register on-chain  ] (for auditor/regulator)            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Use case:** Auditor asks: "Did your agent follow the rules?" You prove "Agent stayed within max position" without revealing full allocation history, timing, or strategy.

---

### Step 5: Private positions (optional)

**Screen: Private tab**

```
┌─────────────────────────────────────────────────────────────┐
│  Private positions (Garaga)                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Agent can hold confidential positions (amount-hiding).     │
│                                                              │
│  Current private balance: [Hidden]                          │
│  Commitment: 0x7f8a9b...                                    │
│                                                              │
│  [  Agent: Deposit privately  ]                             │
│  [  Agent: Withdraw privately ]                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Privacy:** Agent's position amounts are hidden (only commitments visible on-chain). Agent can still execute and prove compliance via selective disclosure.

---

## Technical Flow (Session Keys + Proof-Gating)

```mermaid
sequenceDiagram
    participant User
    participant Wallet as Wallet/Account
    participant Agent as zkde.fi_Agent
    participant Prover as Stone_Prover
    participant Integrity as Integrity_Contract
    participant Protocol as Ekubo/Jedi

    User->>Wallet: Grant session key (constraints)
    Wallet->>Agent: Session authorized
    
    Note over Agent: Agent monitors risk/APY
    Agent->>Agent: Decide: rebalance to 49/51
    Agent->>Prover: Prove allocation satisfies constraints
    Prover->>Integrity: Submit proof
    Integrity-->>Agent: Fact registered (proof_hash)
    
    Agent->>Wallet: Execute via session + proof_hash
    Wallet->>Integrity: Check is_valid(proof_hash)
    Integrity-->>Wallet: Valid ✓
    Wallet->>Protocol: Deposit/withdraw (rebalance)
    Protocol-->>User: Position updated
    
    Note over User,Protocol: Intent was hidden; execution is verified
```

**Key insight:** Agent needs **both** session key (permission) **and** proof (verification) to execute. Session key alone is not enough — this is **proof-gated session keys**, a novel combination.

---

## Layout Flow (Full Agent Experience)

### Layout 1: Onboarding

**Hero section:**
- "Privacy-preserving autonomous agent for DeFi"
- "Delegate once, agent acts with proof-gating"
- [Connect wallet]

**Value props (three pillars):**
- Intent-hiding execution (agent's decisions stay hidden)
- Confidential positions (agent holdings are private)
- Selective disclosure (agent proves compliance)

---

### Layout 2: Delegation

**Session key setup:**
- Set constraints (max position, allowed protocols, expiry)
- Preview: "Agent can execute deposits/rebalances within these limits"
- [Grant session key] → wallet signature

**After delegation:**
- "Agent authorized ✓"
- "Agent will monitor and act on your behalf"
- [View agent dashboard]

---

### Layout 3: Agent Dashboard

**Top:**
- Session status (active, days remaining, revoke button)
- Position summary (total value, breakdown by protocol)

**Center:**
- Agent status ("Active · Monitoring" or "Executing...")
- Current allocation (JediSwap X%, Ekubo Y%, with "Proof-gated ✓" badges)
- Last action (timestamp, proof hash, Starkscan link)

**Bottom:**
- Activity log (agent actions, proofs, tx hashes)
- Compliance panel (generate/register disclosure proofs)
- Private tab (optional confidential positions)

---

### Layout 4: Compliance (Selective Disclosure)

**Form:**
- Statement type: "Agent stayed within max position"
- Threshold: 10,000 STRK
- [Generate proof]

**After proof:**
- Proof hash displayed
- [Register on-chain] (for auditor/regulator)
- Success: "Compliance proven without revealing strategy"

---

## Marketing/BD Positioning

**Tagline:** "Privacy-preserving autonomous agent for DeFi on Starknet"

**One-liner:** "zkde.fi is an AI agent that manages DeFi positions with privacy: session keys for delegation, proof-gating for verification, confidential transactions for privacy, selective disclosure for compliance."

**Three-pillar pitch:**
1. **Agent intents stay hidden** (no one sees what the agent will do next; only execution is visible)
2. **Agent positions can be confidential** (amount-hiding via Garaga/MIST)
3. **Agent proves compliance** (selective disclosure: "I followed the rules" without revealing strategy)

**Starknet-native:** Built on account abstraction (session keys); uses Integrity (SHARP fact registry); integrates with Jedi/Ekubo; Garaga for privacy.

**Novel combination:** Proof-gated session keys = agent needs **permission (session key)** **and verification (proof)** to execute. That's a new primitive for trustless autonomous agents.

---

## Why This Wins Privacy Track

**Privacy + agents = natural fit.** Autonomous agents **need** privacy:
- You don't want to broadcast the agent's strategy (front-running, competitive advantage)
- You want verifiable execution (proof that agent followed constraints)
- You want selective disclosure (prove compliance without revealing full strategy)

**Starknet-native.** Uses AA (session keys), Integrity (fact registry), and privacy primitives (Garaga/MIST). Shows deep understanding of Starknet.

**Positioning:** Not just "private DeFi app" — **privacy-preserving autonomous agent**. That's a **platform primitive** (other agents can use this pattern). Stronger narrative for grants, GTM, ecosystem alignment.

---

## Next Steps (Post-Delegation)

**For hackathon (docs/narrative only):**
- [x] Update README, FOR_JUDGES with agent framing
- [x] Create AGENT_FLOW.md with UX mockups
- [ ] Update SUBMISSION video script with agent narrative
- [ ] Add diagram to ARCHITECTURE showing session keys + proof-gating flow

**For build (post-hackathon start):**
- Implement session key interface (Argent `@argent/x-sessions` or custom)
- Extend account contract or ProofGatedYieldAgent with `execute_with_session_and_proof`
- Wire frontend: "Grant session key" → "Agent active" dashboard
- Optional: Add autonomous monitoring (agent checks risk/APY, auto-rebalances when thresholds hit)
