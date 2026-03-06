# Pools vs Deposits: Terminology

**TL;DR:** **Deposit** is the *action* (put funds in). **Pools** is one of three *destinations* (protocols) you can deposit into. They’re on different axes.

---

## The Two Axes

| Axis | Meaning | Options in the app |
|------|--------|---------------------|
| **Action** | What you’re doing | **Deposit** (add funds), **Withdraw** (remove funds), **Private** (stealth deposit/withdraw) |
| **Protocol** | Where the funds go / come from | **Pools** (protocol_id 0), **Ekubo** (1), **JediSwap** (2) |

So:

- **Deposit** = “I want to add funds” (action).
- **Pools** = “I want to use protocol slot 0” (destination). Same idea as choosing Ekubo or JediSwap.

Flow: pick **action** (e.g. Deposit) → pick **protocol** (Pools, Ekubo, or JediSwap) → run the flow (e.g. proof-gated deposit into that protocol).

---

## Why it’s confusing

1. **“Pools”** is a generic DeFi word (usually “liquidity pools”). Here it’s used as the **name of one protocol tab** (protocol_id 0). So “Pools” can sound like “all pools” or “the pool product,” while Ekubo and JediSwap are also pool protocols.
2. **“Deposit”** is clear as the action, but if “Pools” and “Deposit” sit next to each other in the UI, it can look like two parallel things instead of “action” vs “destination.”

---

## What “Pools” (protocol_id 0) is

In the contracts and backend, **protocol_id** is just 0, 1, or 2. Positions are stored per `(user, protocol_id)`.

- **0 = Pools** — First slot; in the current app this is the default/generic allocation bucket (no separate external protocol like Ekubo/JediSwap).
- **1 = Ekubo** — Ekubo protocol.
- **2 = JediSwap** — JediSwap protocol.

So “Pools” here means “protocol slot 0,” not “all liquidity pools.” If we want to avoid confusion, we can rename the tab to something like **“Default”** or **“Vault”** in the UI, or add a short tooltip: “Default allocation (protocol 0).”

---

## Suggested UI copy

- Under the **Deposit / Withdraw** tabs: add a line like **“Choose protocol”** or **“Where to allocate”** above Pools | Ekubo | JediSwap so it’s clear those are destinations, not actions.
- For the **Pools** tab specifically: either rename to **“Default”** or add a tooltip: “Default allocation bucket (protocol 0).”

This keeps the model (action vs protocol) and only clarifies the labels.
