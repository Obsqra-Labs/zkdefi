# zkde.fi — 3‑Minute Demo Script (Privacy-Focused)

**By Obsqra Labs · Live: [zkde.fi](https://zkde.fi)**

---

## [0:00–0:30] Hook — privacy is the product

**[~30 sec]**

"zkde.fi is **privacy-first DeFi on Starknet**. Not privacy as an add-on — privacy as the operating model. Our privacy methods are what unlock **private pools**, **private LP**, **private lending**, **private staking**, and anything we attach an **adapter** to. Same primitives: commitments, nullifiers, proofs. Capital enters through privacy pools; execution goes through adapters. So every strategy we support — Ekubo LP, lending, staking — runs **privately** because the pool layer is private first."

---

## [0:30–1:00] What that unlocks: pools, adapters, private governance

**[~30 sec]**

"**Private pools** hold the capital. **Adapters** — Ekubo LP, lending, staking — are what we plug into those pools. When you deploy to an adapter, the move is proof-gated and relayer-backed; the public chain sees verification, not your size or timing. Because the pools are private, **governance can be private too**. We have **private DAO voting**: you vote with ZK proofs. Your vote direction is hidden; the tally is public and verifiable. So the same privacy that protects deposits and LP protects who voted and how — that’s how privacy pools can be governed by **private votes** without leaking positions or preferences."

---

## [1:00–1:35] zkML + portable identity + selective disclosure

**[~35 sec]**

"**zkML** respects privacy. Risk scoring and anomaly checks run inside the proof — we only reveal what’s needed: tier, pass/fail, or a gating signal. No raw history, no model inputs. **Portable identity** and **selective disclosure** complete the picture. You prove things like ‘credit above X’ or ‘reputation tier at least Y’ without revealing the underlying data. Credentials and attestations travel with the wallet. Protocols can gate access or improve terms on **proofs**, not on your full chain history. Risk Passport and Credit Hub are the product surfaces for that."

---

## [1:35–2:25] Demo: Capital OS — five lanes (privacy in the UI)

**[~50 sec]**

"Connect wallet — Starknet Sepolia. [Connect.]

This is **Capital OS** — five lanes, one flow. Left: **Identity Badge** — your tier, trust score, credit gauge. Right: **Agent Controls** — start/stop the autonomous agent, constraints, session key status.

**Overview** tab — total capital, deployed breakdown across privacy pools and Ekubo LP, oracle signals, recent activity. Everything at a glance.

Click **Capital** — this is the core. **Privacy Pools** are the hero: Conservative, Moderate, Aggressive. Real TVL, APR, utilization. Each pool has an inline oracle hint. Below: active positions — your Ekubo LP and pool commitments in one list. Below that: opportunities — LP, swaps, staking, all fed by the same private pool layer.

Click **Lend** — credit profile front and center. FICO-style gauge, tier, trust, borrowing power. The system computes your LTV and rate from reputation — not hardcoded, computed. P2P lending market below.

Click **Govern** — voting power from your LP + pools + staking. Vote on proposals with ZK proofs — vote direction hidden, tally public. Create proposals to control pool parameters.

Click **Activity** — unified stream of receipts, decisions, proofs, deposits, votes. Filter, search, date-grouped."

---

## [2:25–2:50] Killer features in one breath

**[~25 sec]**

"**Tiered privacy**: shielded pools with nullifier sets, or full-privacy Merkle commitments — you choose the level. **Proof-gated**: no proof, no execution. **Dark ledger**: internal moves, no public trail. **Private governance**: ZK voting so pool parameters and emergency controls stay community-run without doxxing voters. **zkML**: risk and anomaly in-ZK; only signals out. **Portable identity + selective disclosure**: prove what’s needed, hide the rest; credentials that protocols can verify without seeing your data."

---

## [2:50–3:00] Close

**[~10 sec]**

"Privacy-first execution, adapters on private pools, private governance, zkML that respects privacy, portable identity and selective disclosure. By Obsqra Labs on Starknet Sepolia. **zkde.fi** — docs at **docs.zkde.fi**. Questions?"

---

## Backup one-liners (if asked)

- **Why adapters?** Adapters are the strategy layer — LP, lending, staking. We don’t make the pool public and then add privacy; the pool is private first. So every adapter we stick on gets private execution by default.
- **Why private voting?** So LPs can govern pool parameters — adapter limits, asset whitelist, emergency controls — without revealing position size or vote direction. ZK proof: valid vote, no double-vote; tally is public.
- **zkML and privacy?** Risk score and anomaly run inside the proof. Output is tier or gating signal. No raw history or model inputs leave the proof.
- **Selective disclosure in practice?** You prove “credit line ≥ X” or “reputation tier ≥ Y.” Verifier checks the proof; they never see balance or history. Same for governance eligibility, execution gates, lending terms.
- **What’s the stack?** Garaga (SNARK) for privacy and zkML; Integrity (STARK) for execution. Shielded and fully-shielded pool contracts; adapter contracts per strategy; private vote circuit; portable identity and credential APIs.
- **Who is it for?** Users and protocols that want private execution, private LP, and private governance with verifiable outcomes — no full exposure, no opaque automation.
- **What’s next?** More adapters, L3 settlement, deeper zkML gating, and more selective-disclosure templates for partners.

---

*Timing is approximate; adjust by speaking pace. Aim to land the close at 3:00.*
