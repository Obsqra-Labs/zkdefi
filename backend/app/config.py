"""
Backend configuration for zkde.fi

Architecture:
- zkde.fi owns: Agents, Models, Orchestrator, all business logic
- obsqra.fi provides: STONE prover (cloud proof generation only)

All agent/model logic runs locally via LocalOrchestrator.
Only STONE proof generation calls out to obsqra.fi prover API.
"""

import os

# ==============================================================================
# STARKNET RPC
# ==============================================================================
# Blast API deprecated; use Alchemy (run_tests.sh / e2e default). Set in .env to override.
STARKNET_RPC_URL = os.getenv(
    "STARKNET_RPC_URL",
    "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/EvhYN6geLrdvbYHVRgPJ7",
)
STARKNET_CHAIN_ID = os.getenv("STARKNET_CHAIN_ID", "0x534e5f5345504f4c4941")  # SN_SEPOLIA

# ==============================================================================
# OBSQRA PROVER (Cloud STONE proof generation ONLY)
# This is the ONLY external dependency - used for heavy proof computation.
# All agent/model/orchestration logic lives in zkde.fi.
#
# API contract (starknet.obsqra.fi):
#   GET  {base}/        → liveness (200 when API is up)
#   POST {base}/proofs/generate → Stone proof generation (backend reachable via nginx)
# ==============================================================================
OBSQRA_PROVER_URL = os.getenv("OBSQRA_PROVER_URL", "https://starknet.obsqra.fi/api/v1")
OBSQRA_PROVER_API_KEY = os.getenv("OBSQRA_PROVER_API_KEY", "")

# Legacy names (deprecated - use above instead)
OBSQRA_PROVER_API_URL = os.getenv("OBSQRA_PROVER_API_URL", OBSQRA_PROVER_URL)
OBSQRA_API_KEY = os.getenv("OBSQRA_API_KEY", OBSQRA_PROVER_API_KEY)

# ==============================================================================
# CONTRACT ADDRESSES (Starknet Sepolia)
# ==============================================================================
PROOF_GATED_AGENT_ADDRESS = os.getenv("PROOF_GATED_AGENT_ADDRESS", "")
SELECTIVE_DISCLOSURE_ADDRESS = os.getenv("SELECTIVE_DISCLOSURE_ADDRESS", "")
CONFIDENTIAL_TRANSFER_ADDRESS = os.getenv("CONFIDENTIAL_TRANSFER_ADDRESS", "")
GARAGA_VERIFIER_ADDRESS = os.getenv("GARAGA_VERIFIER_ADDRESS", "")
MERKLE_TREE_ADDRESS = os.getenv("MERKLE_TREE_ADDRESS", "")
FULLY_SHIELDED_POOL_ADDRESS = os.getenv("FULLY_SHIELDED_POOL_ADDRESS", "")

# ObsqraFactRegistry: on-chain persistence for STARK facts (dual-proof). Use this as
# fact_registry in ProofGatedYieldAgent / TieredAgentController constructor. Implements
# is_valid(fact_hash) and get_all_verifications_for_fact_hash(fact_hash). See docs/DUAL_PROOF_ARCHITECTURE.md.
OBSQRA_FACT_REGISTRY_ADDRESS = os.getenv(
    "OBSQRA_FACT_REGISTRY_ADDRESS",
    "0x059b65ad723c1f0dcb2643f34d2e03292b366c987a63b2177d4f7ea40ba664a8",
)

# ==============================================================================
# LOCAL ZKDE.FI SERVICES (no external dependencies)
# ==============================================================================
# Backend API port
ZKDEFI_API_PORT = int(os.getenv("ZKDEFI_API_PORT", "8003"))

# Enable/disable zkML services
ENABLE_ZKML_RISK = os.getenv("ENABLE_ZKML_RISK", "true").lower() == "true"
ENABLE_ZKML_CORRELATION = os.getenv("ENABLE_ZKML_CORRELATION", "true").lower() == "true"
ENABLE_ZKML_TWAP = os.getenv("ENABLE_ZKML_TWAP", "true").lower() == "true"
ENABLE_ZKML_DIVERSIFICATION = os.getenv("ENABLE_ZKML_DIVERSIFICATION", "true").lower() == "true"

# Proof generation mode: "groth16" (fast, local) or "stone" (cloud, via obsqra)
DEFAULT_PROOF_MODE = os.getenv("DEFAULT_PROOF_MODE", "groth16")
