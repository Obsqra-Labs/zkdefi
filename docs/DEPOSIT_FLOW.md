# Deposit Flow — Where Do the Funds Go?

**Short answer:** In zkde.fi, a proof-gated deposit sends your tokens **to the agent contract**. The contract holds them and credits your position for the protocol you chose (Pools / Ekubo / JediSwap). There is **no** automatic second step that moves funds from the agent into external pools (e.g. Ekubo or JediSwap). So: one place (the agent), no “then waits to go to a pool” in this app.

---

## Step-by-step (what actually happens)

1. **You choose** action = Deposit, protocol = Pools (or Ekubo or JediSwap), amount, optional max position.
2. **You click “Deposit with proof”**  
   - Frontend calls backend `POST /api/v1/zkdefi/deposit`.  
   - Backend asks the prover (obsqra.fi) for a proof that this deposit obeys your constraints (e.g. amount ≤ max position).  
   - You get back a `proof_hash` and calldata.
3. **You click “Sign & Deposit”**  
   - Your wallet calls the **ProofGatedYieldAgent** contract:  
     `deposit_with_proof(protocol_id, amount, proof_hash)`.
4. **On-chain, the contract:**
   - Checks `Integrity.is_valid(proof_hash)` → if invalid, revert.
   - Checks your constraints (e.g. current + amount ≤ max position).
   - Pulls tokens from you: `token.transfer_from(caller, get_contract_address(), amount)` → **tokens move from your wallet to the agent contract**.
   - Updates its ledger: `positions[(you, protocol_id)] += amount`.

So in this flow, **funds end in exactly one place: the ProofGatedYieldAgent contract.**  
The `protocol_id` (0 = Pools, 1 = Ekubo, 2 = JediSwap) is only a **label** for how your balance is accounted for inside that contract. The agent does **not** call StrategyRouter, Ekubo, or JediSwap; it doesn’t send tokens to external pools in this path.

---

## “One place, then waits to go to a pool? With automation?”

- **One place:** Yes. Your deposit goes to the **agent contract** and stays there (until you withdraw or some other flow moves it).
- **Then waits to go to a pool?** In **this** (zkde.fi) app there is no built-in “step 2” that automatically sends agent-held tokens into external liquidity pools. So there’s no “wait to go to a pool” in the current implementation — the agent is the custodian; Pools/Ekubo/JediSwap are allocation buckets on its ledger.
- **With automation?** The **Rebalancer** (and session keys + proofs) can change how your position is *allocated across those buckets* (e.g. move from “Pools” to “JediSwap” in the ledger), but that still happens inside the same agent contract (positions and token custody). It does not, in the current zkdefi codebase, push tokens out to external AMM contracts.

If you later add or integrate a flow that moves agent-held tokens into real Ekubo/JediSwap pools (e.g. via a StrategyRouter or operator), that would be a **separate** path from this deposit flow.

---

## Summary

| Step | What happens |
|------|-------------------------------|
| 1 | You request a proof (constraints + amount + protocol_id). |
| 2 | Backend/prover returns proof_hash; you get calldata. |
| 3 | You sign `deposit_with_proof(protocol_id, amount, proof_hash)`. |
| 4 | Tokens go **user → ProofGatedYieldAgent**. |
| 5 | Contract updates your **position** for that protocol_id (Pools=0, Ekubo=1, JediSwap=2). |
| 6 | No further automatic move to external pools in this flow. |

So: deposit = “send tokens to the agent, proof-gated, and have them credited to the chosen protocol bucket.” One place (the agent); no automatic “then to a pool” in this app.
