# FAQ

## Who is zkde.fi for?

Users who want DeFi allocation (e.g. across pools or protocols) with **privacy** and **verifiability**: intent-hiding, confidential balances, and the ability to prove compliance or eligibility without revealing their full history. Suited for DAOs, funds, and individuals who care about MEV protection and selective disclosure.

## Is my data private?

- **Proof-gated execution**: Your intent (e.g. “deposit 100 into pool A”) is not broadcast until the proof is ready and you sign. The chain sees the verified action, not your raw strategy.
- **Confidential transfers**: Amounts and balances are hidden behind commitments. Only you (and anyone you share the opening with) can see the real amounts.
- **Selective disclosure**: You choose what to prove (e.g. “yield above X”). The rest of your history is not revealed.

## What is a “proof-gated” deposit?

A deposit that the smart contract only executes if you provide a **valid proof** that the action satisfies your constraints (e.g. max position, allowed protocols). The proof is verified on-chain via Integrity. So the chain never executes an out-of-policy action.

## What chain is zkde.fi on?

**Starknet** (Sepolia for the demo; mainnet when we ship). You need a Starknet wallet (e.g. ArgentX, Braavos) and Sepolia ETH for gas.

## Is it open source?

Yes. The app and contracts are open source. See the [GitHub repo](https://github.com/obsqra-labs/zkdefi) and [For developers](/developers) for more.

Next: [For developers](/developers)
