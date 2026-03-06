# Hybrid Risk Engine Architecture - Deep Dive

## TL;DR: Your Most Viable Options

**Recommended Hybrid Architecture:**

1. **On-chain Cairo (Simple)**: Basic constraint checks + threshold enforcement  
2. **zkML via Giza (Complex)**: AI risk scoring + anomaly detection with verifiable proofs  
3. **Oracle-Driven Updates**: Pragma feeds trigger risk recalculations  
4. **AI Agent Orchestration**: Combines all signals to make rebalancing decisions

**Key Insight**: Don't run a node. Use oracles + event monitoring + periodic polling.

See full document at: /opt/obsqra.starknet/zkdefi/HYBRID_RISK_ENGINE_DEEP_DIVE.md
