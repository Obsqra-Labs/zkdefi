# GATE-1: Governed Autonomous Trustless Execution

**Version:** 1.0.0  
**Status:** Draft  
**Author:** Obsqra Labs  
**Created:** 2026-02-02

## Framework: zkDE

**zkDE | Zero-Knowledge Deterministic Engine.** The infrastructure where execution is proof-gated and verification is deterministic; ZK proofs verify without revealing.

**GATE | Governed Autonomous Trustless Execution.** The standard for how agents operate in the zkDE engine: interfaces, proof formats, session key structures, intent commitments, and verification flows.

GATE-1 implements zkDE. They work well together: zkDE is the engine; GATE is the agent standard within it.

## Abstract

GATE-1 defines a standard interface for privacy-preserving autonomous agents on Starknet under the zkDE framework. It specifies proof formats, session key structures, intent commitments, and verification flows for agents that execute on behalf of users while maintaining privacy.

The name GATE reflects the core primitive: execution is *gated* by proof — no proof, no execution.

## Motivation

DeFi agents need:
1. **Delegation** — Users grant limited permissions
2. **Verification** — Actions must be provably correct
3. **Privacy** — Intent and strategy stay hidden
4. **Safety** — Malicious actions are prevented

Current approaches lack standardization. GATE-1 provides a common interface for zkDE-compatible agents and interoperability between agents, protocols, and verification systems.

## Key Interfaces

### Session Key Format

```cairo
struct SessionKey {
    session_key: ContractAddress,
    owner: ContractAddress,
    max_position: u256,
    allowed_protocols: u8,
    expiry: u64,
    is_active: bool,
    created_at: u64,
}
```

### Agent Execution Interface

```cairo
trait IGateAgent {
    fn execute_with_proofs(
        receipt_commitment: felt252,
        intent_hash: felt252,
        zkml_proof_calldata: Span<felt252>,
        execution_proof_hash: felt252,
        action_calldata: Span<felt252>
    );
    
    fn execute_with_session(
        session_id: felt252,
        proof_hash: felt252,
        action_calldata: Span<felt252>
    );
}
```

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| GATE_INVALID_SESSION | Session invalid | Session expired, revoked, or non-existent |
| GATE_INVALID_PROOF | Proof invalid | Proof verification failed |
| GATE_REPLAY_DETECTED | Replay attack | Intent commitment already used |
| GATE_RISK_TOO_HIGH | Risk check failed | Risk score above threshold |
| GATE_ANOMALY_DETECTED | Anomaly found | Pool/protocol flagged as unsafe |

## Reference Implementation

See [github.com/obsqra-labs/zkdefi](https://github.com/obsqra-labs/zkdefi):

- contracts/src/proof_gated_yield_agent.cairo
- contracts/src/session_key_manager.cairo
- contracts/src/intent_commitment.cairo

## Copyright

Copyright 2026 Obsqra Labs. Licensed under Apache-2.0.
