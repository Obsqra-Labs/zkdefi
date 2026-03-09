import { ProductCategory, ProductDefinition } from "@/lib/products/types";

export const DEFAULT_DEMO_ADDRESS = "0x03a4f2b98c4e5d6172839405aa6bbccddeeff00112233445566778899aabbcc";

const ETH_TOKEN = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const STRK_TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    id: "private-ledger-vault",
    title: "Private Ledger & Vault",
    description: "Private capital rails, internal settlement, and policy-first vault controls.",
  },
  {
    id: "private-defi",
    title: "Private DeFi",
    description: "Swaps, LP, staking, governance, and private execution controls under one operating layer.",
  },
  {
    id: "private-lending-zk-trust",
    title: "Private Lending & ZK Trust",
    description: "Lending intelligence plus reputation, trust packs, and wallet identity primitives.",
  },
  {
    id: "automation-infra",
    title: "Automation & Infrastructure",
    description: "Mission control, proofs, orchestration, relayer, and agent automation surfaces.",
  },
];

export const PRODUCTS: ProductDefinition[] = [
  {
    slug: "private-vault",
    title: "Private Vault",
    status: "BUILT",
    categoryId: "private-ledger-vault",
    summary: "The operating vault for private capital, policy-gated execution, and auditable outcomes.",
    description:
      "Private Vault is the primary capital operating surface for deposits, withdrawals, and position management with privacy policies enforced by proof-aware gates.",
    capabilities: [
      "Vault status + deposit history APIs for auditable state inspection.",
      "Policy-gated execution path connected to live strategy deployment endpoints.",
      "Position reporting through canonical vault execution routes.",
      "Supports advanced private settlement rails.",
    ],
    docsHref: "/docs/agent-dashboard",
    advancedLink: { href: "/agent?v=vault", label: "Open advanced vault workspace" },
    featured: true,
    standaloneActions: [
      {
        id: "vault-status",
        title: "Fetch vault status",
        description: "Pull liquid/deployed balances and APY estimate from the vault service.",
        method: "GET",
        endpointCandidates: ["/api/v1/vault/status"],
        sampleQuery: { user_address: "__ADDRESS__" },
      },
      {
        id: "vault-operator",
        title: "Get operator deposit address",
        description: "Return the currently configured operator address for verified vault deposits.",
        method: "GET",
        endpointCandidates: ["/api/v1/vault/operator-address"],
      },
      {
        id: "vault-positions",
        title: "Inspect deployed positions",
        description: "Fetch position snapshots via vault execution routes.",
        method: "GET",
        endpointCandidates: ["/api/v1/vault/positions/__ADDRESS__"],
      },
    ],
  },
  {
    slug: "privacy-pools",
    title: "Vault Rails (Advanced)",
    status: "BUILT",
    categoryId: "private-ledger-vault",
    summary: "Commitment and nullifier rails for advanced private capital flows.",
    description:
      "Vault Rails package commitment, Merkle root, and nullifier mechanics into one advanced private execution surface with selective disclosure support.",
    capabilities: [
      "Commitment registration and Merkle root reconciliation endpoints.",
      "Disclosure routes for proving pool membership without full position reveal.",
      "Built for private deposits and withdrawals in proof-gated workflows.",
      "Supports multiple private routing methods under one rail primitive.",
    ],
    docsHref: "/docs/privacy-features",
    advancedLink: { href: "/agent?v=vault&sub=portfolio", label: "Open advanced vault rails workspace" },
    featured: true,
    standaloneActions: [
      {
        id: "pool-root",
        title: "Read active Merkle root",
        description: "Fetch the latest known private rail Merkle root.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/full_privacy/merkle/root"],
      },
      {
        id: "pool-leaves",
        title: "Inspect pool leaves",
        description: "List leaves currently tracked by the full privacy service.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/full_privacy/merkle/leaves"],
      },
      {
        id: "pool-membership-proof",
        title: "Run pool membership disclosure",
        description: "Attempt a selective disclosure check for pool membership.",
        method: "POST",
        endpointCandidates: ["/api/v1/zkdefi/full_privacy/disclosure/pool_membership"],
        sampleBody: {
          user_address: "__ADDRESS__",
          commitment: "0x1234",
          merkle_root: "0x5678",
          reveal_fields: ["membership"],
        },
      },
    ],
  },
  {
    slug: "privacy-pools",
    title: "Private Settlement Queue",
    status: "BUILT",
    categoryId: "private-ledger-vault",
    summary: "Internal private settlement rail for low-footprint capital movement.",
    description:
      "Private Settlement Queue exposes internal transfer history and relayer-linked settlement activity without forcing full on-chain movement disclosure for every operation.",
    capabilities: [
      "Ledger transfer feed API for private settlement visibility.",
      "Relayer ledger event stream for payout and claim monitoring.",
      "Mission-control timeline integration for receipt-grade history.",
      "Designed for private capital routing inside vault strategy workflows.",
    ],
    docsHref: "/docs/privacy-features",
    advancedLink: { href: "/agent?v=vault&sub=ledger", label: "Open advanced settlement queue workspace" },
    featured: true,
    standaloneActions: [
      {
        id: "ledger-transfers",
        title: "Read ledger transfers",
        description: "Pull paginated transfer rows for a wallet.",
        method: "GET",
        endpointCandidates: [
          "/api/v1/zkdefi/ledger/transfers",
          "/api/v1/zkdefi/ledger/ledger/transfers",
        ],
        sampleQuery: { user_address: "__ADDRESS__", limit: 20, offset: 0 },
      },
      {
        id: "ledger-events",
        title: "Stream relayer ledger events",
        description: "Inspect queued/executed ledger events from the relayer queue.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/relayer/ledger/events"],
      },
      {
        id: "ledger-timeline",
        title: "Load receipt timeline",
        description: "Read memory-lane timeline entries through mission control.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/mc/receipts/timeline/__ADDRESS__"],
      },
    ],
  },
  {
    slug: "private-swaps",
    title: "Private Swaps",
    status: "BUILT",
    categoryId: "private-defi",
    summary: "Private trade desk for swaps, LP, limits, and DCA execution paths.",
    description:
      "Private Swaps is the execution layer for intent-protected trading with policy-aware routing and slippage controls across swap/LP/limit/DCA contexts.",
    capabilities: [
      "DEX token + pool discovery endpoints for route preparation.",
      "Quote and swap-calldata builders for wallet execution.",
      "Shared intent context with LP/limits/DCA strategy paths.",
      "Policy constraints and proof gates remain enforceable at execution time.",
    ],
    docsHref: "/docs/agent-dashboard",
    advancedLink: { href: "/agent?v=vault&sub=trade", label: "Open advanced private swaps workspace" },
    featured: true,
    standaloneActions: [
      {
        id: "swap-tokens",
        title: "List available trade tokens",
        description: "Fetch DEX token metadata for routing.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/dex/tokens"],
        sampleQuery: { page_size: 24 },
      },
      {
        id: "swap-quote",
        title: "Build swap quote",
        description: "Estimate amount out using the live DEX quote route.",
        method: "POST",
        endpointCandidates: ["/api/v1/zkdefi/dex/quote"],
        sampleBody: {
          token_in: ETH_TOKEN,
          token_out: STRK_TOKEN,
          amount_in: "10000000000000000",
        },
      },
      {
        id: "swap-calldata",
        title: "Generate swap calldata",
        description: "Get calldata payload for wallet execution.",
        method: "POST",
        endpointCandidates: ["/api/v1/zkdefi/dex/swap-calldata"],
        sampleBody: {
          token_in: ETH_TOKEN,
          token_out: STRK_TOKEN,
          amount_in: "10000000000000000",
          slippage_bps: 50,
          user_address: "__ADDRESS__",
        },
      },
    ],
  },
  {
    slug: "private-lp-yield",
    title: "Private LP + Yield",
    status: "BUILT",
    categoryId: "private-defi",
    summary: "Liquidity and yield allocation with proof-aware safety and optimization checks.",
    description:
      "Private LP + Yield combines recommendation, analysis, and deployment primitives for policy-constrained capital allocation across LP and yield venues.",
    capabilities: [
      "Strategy analysis endpoints with deterministic zkML pool evaluation.",
      "Deployment execution health checks for production deploy paths.",
      "Supports yield allocation workflows in private vault orchestration.",
      "Compatible with anomaly/risk model gates in strategy engine.",
    ],
    docsHref: "/docs/rebalancing",
    advancedLink: { href: "/agent?v=vault&sub=yield", label: "Open advanced LP + yield workspace" },
    standaloneActions: [
      {
        id: "lp-strategy-health",
        title: "Check strategy engine health",
        description: "Quick health probe for strategy recommendation service.",
        method: "GET",
        endpointCandidates: ["/api/v1/strategies/health"],
      },
      {
        id: "lp-deploy-health",
        title: "Check deployment engine health",
        description: "Verify deployment executor readiness.",
        method: "GET",
        endpointCandidates: ["/api/v1/deployments/health"],
      },
      {
        id: "lp-analyze",
        title: "Run pool analysis",
        description: "Trigger zkML-backed pool analysis for a profile.",
        method: "POST",
        endpointCandidates: ["/api/v1/strategies/analyze"],
        sampleBody: {
          user_address: "__ADDRESS__",
          deposit_amount: 1000000000,
          risk_profile: "BALANCED",
        },
      },
    ],
  },
  {
    slug: "private-staking",
    title: "Private Staking",
    status: "BUILT",
    categoryId: "private-defi",
    summary: "Delegation + rewards operations integrated with private policy posture.",
    description:
      "Private Staking brings delegation and APY monitoring into the same proof-aware private capital stack as swaps, lending, and vault execution.",
    capabilities: [
      "Native staking pool discovery and APY overview.",
      "User position inspection with pending exit and rewards context.",
      "Stake/unstake calldata builders for wallet execution paths.",
      "Integrated with private vault operating model and tier controls.",
    ],
    docsHref: "/docs/agent-dashboard",
    advancedLink: { href: "/agent?v=vault&sub=staking", label: "Open advanced staking workspace" },
    standaloneActions: [
      {
        id: "staking-pools",
        title: "List staking pools",
        description: "Fetch currently available delegation pools.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/staking/pools", "/api/v1/zkdefi/staking/staking/pools"],
      },
      {
        id: "staking-positions",
        title: "Inspect staking positions",
        description: "Read per-wallet staking positions.",
        method: "GET",
        endpointCandidates: [
          "/api/v1/zkdefi/staking/positions/__ADDRESS__",
          "/api/v1/zkdefi/staking/staking/positions/__ADDRESS__",
        ],
      },
      {
        id: "staking-apy",
        title: "Read network staking APY",
        description: "Fetch current APY and network staking overview.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/staking/apy", "/api/v1/zkdefi/staking/staking/apy"],
      },
    ],
  },
  {
    slug: "private-governance",
    title: "Private Governance",
    status: "READY",
    categoryId: "private-defi",
    summary: "Governance rails with privacy semantics and proof-backed vote workflows.",
    description:
      "Private Governance productizes DAO proposal and voting endpoints for proof-aware governance with configurable proposal and voting operations.",
    capabilities: [
      "DAO proposal listing and details routes.",
      "Proof generation endpoint for private voting flow.",
      "Voting power and tally/execute governance lifecycle APIs.",
      "Composable with trust tier and proof-gated policies.",
    ],
    docsHref: "/docs/agent-dashboard",
    advancedLink: { href: "/governance", label: "Open advanced governance workspace" },
    featured: true,
    standaloneActions: [
      {
        id: "governance-list",
        title: "List governance proposals",
        description: "Fetch current DAO proposal feed.",
        method: "GET",
        endpointCandidates: ["/api/v1/dao/dao/proposals"],
      },
      {
        id: "governance-voting-power",
        title: "Read wallet voting power",
        description: "Fetch voting power for a wallet address.",
        method: "GET",
        endpointCandidates: ["/api/v1/dao/dao/voting_power/__ADDRESS__"],
      },
      {
        id: "governance-create",
        title: "Create proposal (demo)",
        description: "Submit a governance proposal payload using demo values.",
        method: "POST",
        endpointCandidates: ["/api/v1/dao/dao/proposals"],
        sampleBody: {
          proposer_address: "__ADDRESS__",
          proposal_type: "adapter_limit",
          target_address: "0x123",
          new_value: 6500,
          vote_duration_seconds: 604800,
        },
      },
    ],
  },
  {
    slug: "private-lending",
    title: "Private Lending",
    status: "BUILT",
    categoryId: "private-lending-zk-trust",
    summary: "Supply/borrow workflows with policy-aware risk posture and attestation gates.",
    description:
      "Private Lending exposes core lending pool, position, and health factor primitives for proof-aware borrow/supply operations.",
    capabilities: [
      "Lending pool stats and position endpoints.",
      "Borrow/supply/repay calldata builders with attestation inputs.",
      "Wallet health factor visibility for liquidation safety posture.",
      "Composable with Risk Passport and trust pack attestations.",
    ],
    docsHref: "/docs/reputation-system",
    advancedLink: { href: "/agent?v=vault&sub=lending", label: "Open advanced lending workspace" },
    featured: true,
    standaloneActions: [
      {
        id: "lending-pool",
        title: "Read lending pool stats",
        description: "Fetch TVL, utilization, and APY level pool metrics.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/lending/pool", "/api/v1/zkdefi/lending/lending/pool"],
      },
      {
        id: "lending-positions",
        title: "Inspect lending positions",
        description: "Fetch supplies and loans for a wallet.",
        method: "GET",
        endpointCandidates: [
          "/api/v1/zkdefi/lending/positions/__ADDRESS__",
          "/api/v1/zkdefi/lending/lending/positions/__ADDRESS__",
        ],
      },
      {
        id: "lending-health",
        title: "Compute health factor",
        description: "Retrieve current health factor for active lending positions.",
        method: "GET",
        endpointCandidates: [
          "/api/v1/zkdefi/lending/health-factor/__ADDRESS__",
          "/api/v1/zkdefi/lending/lending/health-factor/__ADDRESS__",
        ],
      },
    ],
  },
  {
    slug: "risk-passport",
    title: "Risk Passport",
    status: "READY",
    categoryId: "private-lending-zk-trust",
    summary: "Portable trust and risk attestations for policy-driven private finance.",
    description:
      "Risk Passport turns wallet behavior and receipts into portable trust context with tier and score outputs consumable by other protocol surfaces.",
    capabilities: [
      "User-level passport scoring and receipt trace context.",
      "Pool passport lens for anomaly/safety outputs.",
      "L3 proving path capabilities and verification hooks.",
      "Designed for selective disclosure and cross-surface policy checks.",
    ],
    docsHref: "/docs/risk-passport",
    advancedLink: { href: "/profile?tab=trust", label: "Open advanced risk passport workspace" },
    featured: true,
    standaloneActions: [
      {
        id: "passport-user",
        title: "Read user risk passport",
        description: "Fetch trust score, tier, and receipt context for a wallet.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/user/__ADDRESS__"],
      },
      {
        id: "passport-l3-capabilities",
        title: "Check L3 proving capabilities",
        description: "Inspect current proving path capabilities for L3/L2 verification.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/l3/capabilities"],
      },
      {
        id: "passport-l3-stats",
        title: "Read L3 proving stats",
        description: "Fetch L3 proving path operational statistics.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/l3/stats"],
      },
    ],
  },
  {
    slug: "zk-trust-packs",
    title: "ZK Trust Packs",
    status: "READY",
    categoryId: "private-lending-zk-trust",
    summary: "Proof-pack workflows for risk, reputation, and circuit-backed trust assertions.",
    description:
      "ZK Trust Packs groups trust-relevant endpoints for reputation tiering, risk-passport verification, and zkML status in one standalone verification console.",
    capabilities: [
      "Reputation score + tier extraction for trust posture.",
      "Risk Passport score and receipt linkage in one call path.",
      "zkML circuit readiness monitoring for trust proof generation.",
      "Can be used as pre-check gate before lending or governance actions.",
    ],
    docsHref: "/docs/REPUTATION_PROOF_API.md",
    standaloneActions: [
      {
        id: "trust-reputation",
        title: "Read reputation profile",
        description: "Fetch reputation tier, volume, and upgrade eligibility.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/reputation/user/__ADDRESS__"],
      },
      {
        id: "trust-passport",
        title: "Read trust passport",
        description: "Fetch composite trust score and wallet passport context.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/user/__ADDRESS__"],
      },
      {
        id: "trust-zkml-status",
        title: "Check zkML proof readiness",
        description: "Inspect zkML service/circuit readiness.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/zkml/status"],
      },
    ],
  },
  {
    slug: "session-keys",
    title: "Session Keys",
    status: "READY",
    categoryId: "private-lending-zk-trust",
    summary: "Delegated execution scopes with revocation and validation controls.",
    description:
      "Session Keys productizes delegated execution control so users can grant scoped authority, inspect active sessions, and validate allowed actions.",
    capabilities: [
      "Session grant + confirmation routes for delegated execution.",
      "Session list and validation routes for runtime checks.",
      "Revocation flow for fast permission rollback.",
      "Foundation for assisted/autonomous execution across the stack.",
    ],
    docsHref: "/docs/agent-dashboard",
    standaloneActions: [
      {
        id: "session-list",
        title: "List active sessions",
        description: "Fetch all sessions tied to a wallet.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/session_keys/list/__ADDRESS__"],
      },
      {
        id: "session-validate",
        title: "Validate session action",
        description: "Check whether a sample action is allowed for a session.",
        method: "POST",
        endpointCandidates: ["/api/v1/zkdefi/session_keys/validate"],
        sampleBody: {
          session_id: "session_demo",
          protocol_id: 1,
          amount: 10000000000000000,
        },
      },
      {
        id: "session-grant",
        title: "Request session grant",
        description: "Generate a scoped session grant payload.",
        method: "POST",
        endpointCandidates: ["/api/v1/zkdefi/session_keys/grant"],
        sampleBody: {
          owner_address: "__ADDRESS__",
          session_key_address: "0x123",
          max_position: 5000000000000000000,
          allowed_protocols: ["ekubo", "lending"],
          duration_hours: 24,
        },
      },
    ],
  },
  {
    slug: "identity-link",
    title: "Identity Link",
    status: "READY",
    categoryId: "private-lending-zk-trust",
    summary: "Cross-address linking and identity-attested context for trust-aware execution.",
    description:
      "Identity Link provides wallet-link controls for Starknet to EVM address context, feeding cross-chain reputation and trust computations.",
    capabilities: [
      "Get/set linked address map across chains.",
      "Supports trust and reputation baseline enrichment.",
      "Hooks into identity commitment lookup routes.",
      "Used by profile/trust systems for better policy decisions.",
    ],
    docsHref: "/docs/reputation-system",
    standaloneActions: [
      {
        id: "identity-get-linked",
        title: "Read linked addresses",
        description: "Fetch linked cross-chain addresses for a Starknet wallet.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/linked_addresses/__ADDRESS__"],
      },
      {
        id: "identity-update-linked",
        title: "Update linked addresses",
        description: "Patch linked address mappings for a wallet.",
        method: "PUT",
        endpointCandidates: ["/api/v1/zkdefi/linked_addresses"],
        sampleBody: {
          starknet_address: "__ADDRESS__",
          eth: "0x0000000000000000000000000000000000000000",
          arb: "0x0000000000000000000000000000000000000000",
          base: "0x0000000000000000000000000000000000000000",
        },
      },
      {
        id: "identity-commitment",
        title: "Resolve identity commitment",
        description: "Lookup an identity commitment record from identity service.",
        method: "GET",
        endpointCandidates: ["/api/v1/identity/commitment/0x1234"],
      },
    ],
  },
  {
    slug: "mission-control",
    title: "Mission Control",
    status: "READY",
    categoryId: "automation-infra",
    summary: "Unified execution-state, policy, and receipt timeline control plane.",
    description:
      "Mission Control exposes live execution flow state, timeline receipts, opportunities, and policy/constraint endpoints as a single operational surface.",
    capabilities: [
      "Current execution pipeline state endpoint.",
      "Memory-lane style receipt timeline and receipt detail APIs.",
      "Unified opportunity feed blending oracle and strategy signals.",
      "Constraint + policy load/save endpoints for control-plane operations.",
    ],
    docsHref: "/docs/plans/2026-03-06-mission-control-ux-refactor-design.md",
    standaloneActions: [
      {
        id: "mc-execution",
        title: "Read execution flow state",
        description: "Fetch current intent-policy-proof-agent-execution state.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/mc/execution/current/__ADDRESS__"],
      },
      {
        id: "mc-opportunities",
        title: "Load opportunities feed",
        description: "Pull ranked opportunity feed from mission control.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/mc/opportunities/feed"],
      },
      {
        id: "mc-timeline",
        title: "Load receipt timeline",
        description: "Fetch memory-lane receipt history for a wallet.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/mc/receipts/timeline/__ADDRESS__"],
      },
    ],
  },
  {
    slug: "proofs-hub",
    title: "Proofs Hub",
    status: "READY",
    categoryId: "automation-infra",
    summary: "Unified proof inventory, model readiness, and on-chain submission surface.",
    description:
      "Proofs Hub centralizes proof stats, model status, proof verification, and sequencer diagnostics for operational proof management.",
    capabilities: [
      "Proof listing and aggregate stats endpoints.",
      "Model readiness surface for provable ML artifacts.",
      "Proof verify + submit APIs for registry workflows.",
      "Sequencer telemetry endpoint for forwarding diagnostics.",
    ],
    docsHref: "/docs/REPUTATION_PROOF_API.md",
    standaloneActions: [
      {
        id: "proofs-stats",
        title: "Read proof statistics",
        description: "Fetch total proof count and verification stats.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/proofs/stats", "/api/v1/zkdefi/proofs/proofs/stats"],
      },
      {
        id: "proofs-models",
        title: "List provable models",
        description: "Inspect model registry + proving artifact readiness.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/proofs/models", "/api/v1/zkdefi/proofs/proofs/models"],
      },
      {
        id: "proofs-sequencer",
        title: "Check sequencer status",
        description: "Read proof sequencer forwarding status and logs.",
        method: "GET",
        endpointCandidates: [
          "/api/v1/zkdefi/proofs/sequencer-status",
          "/api/v1/zkdefi/proofs/proofs/sequencer-status",
        ],
      },
    ],
  },
  {
    slug: "agent-studio",
    title: "Agent Studio",
    status: "READY",
    categoryId: "automation-infra",
    summary: "Agent creation, model selection, and execution marketplace surface.",
    description:
      "Agent Studio productizes model catalog, agent creation, and execution controls for composed strategy agents.",
    capabilities: [
      "Model catalog and marketplace stats endpoints.",
      "Agent create/read/execute route family.",
      "Featured model curation for quick-start workflows.",
      "Integrated with rebalancer, policy, and proof surfaces.",
    ],
    docsHref: "/docs/agent-dashboard",
    standaloneActions: [
      {
        id: "agent-models",
        title: "List agent models",
        description: "Fetch available marketplace models for agent composition.",
        method: "GET",
        endpointCandidates: ["/api/v1/agents/models/list"],
      },
      {
        id: "agent-market-stats",
        title: "Read marketplace stats",
        description: "Fetch model type counts and marketplace summary.",
        method: "GET",
        endpointCandidates: ["/api/v1/agents/marketplace/stats"],
      },
      {
        id: "agent-featured",
        title: "List featured models",
        description: "Fetch featured model set for quick starts.",
        method: "GET",
        endpointCandidates: ["/api/v1/agents/marketplace/featured"],
      },
    ],
  },
  {
    slug: "autonomous-rebalancer",
    title: "Autonomous Rebalancer",
    status: "READY",
    categoryId: "automation-infra",
    summary: "Autonomous portfolio monitoring and zkML-gated rebalance orchestration.",
    description:
      "Autonomous Rebalancer combines analyze/propose/check/execute controls and long-running autonomous status monitoring for policy-bounded reallocation.",
    capabilities: [
      "Portfolio analyze + proposal generation.",
      "zkML gate checks before execution.",
      "Autonomous agent lifecycle endpoints.",
      "Proposal introspection per wallet.",
    ],
    docsHref: "/docs/rebalancing",
    standaloneActions: [
      {
        id: "rebalancer-all",
        title: "List autonomous agents",
        description: "Fetch all autonomous rebalancer states.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/rebalancer/autonomous/all"],
      },
      {
        id: "rebalancer-status",
        title: "Read wallet autonomous status",
        description: "Fetch autonomous monitor status for a wallet.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/rebalancer/autonomous/status/__ADDRESS__"],
      },
      {
        id: "rebalancer-analyze",
        title: "Analyze portfolio",
        description: "Run a sample portfolio analysis call.",
        method: "POST",
        endpointCandidates: ["/api/v1/zkdefi/rebalancer/analyze"],
        sampleBody: {
          user_address: "__ADDRESS__",
          positions: {
            "1": 250000000000000000,
            "2": 350000000000000000,
          },
        },
      },
    ],
  },
  {
    slug: "market-intelligence",
    title: "Market Intelligence",
    status: "READY",
    categoryId: "automation-infra",
    summary: "Market data, APY curves, and recommendation rails for execution timing.",
    description:
      "Market Intelligence provides oracle snapshots, APY curves, and risk-based recommendation feeds for strategy timing and venue selection.",
    capabilities: [
      "Live oracle snapshot retrieval.",
      "Pool APY surface by risk profile.",
      "Risk-tolerance based recommendation engine.",
      "History + manual sync endpoints for market state.",
    ],
    docsHref: "/docs/agent-dashboard",
    standaloneActions: [
      {
        id: "market-snapshot",
        title: "Fetch market snapshot",
        description: "Read latest oracle snapshot for Ekubo context.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/oracle/market-data"],
      },
      {
        id: "market-apy",
        title: "Fetch pool APYs",
        description: "Read conservative/neutral/aggressive APY projections.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/oracle/pool-apys"],
      },
      {
        id: "market-recommendation",
        title: "Get risk recommendation",
        description: "Fetch recommendation output for a selected risk tolerance.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/oracle/recommendation"],
        sampleQuery: { risk_tolerance: 50 },
      },
    ],
  },
  {
    slug: "relayer-rail",
    title: "Relayer Rail",
    status: "READY",
    categoryId: "automation-infra",
    summary: "Queue-driven private settlement and claim execution relayer surface.",
    description:
      "Relayer Rail exposes queue state, pending operations, and execution telemetry for relayed deposits, withdrawals, claims, and wallet payouts.",
    capabilities: [
      "Queue state and pending item inspection.",
      "Ledger claims/events stream visibility.",
      "Execution/cancel route families across queue types.",
      "Tier-aware relayer operations integrated with ledger.",
    ],
    docsHref: "/docs/privacy-features",
    standaloneActions: [
      {
        id: "relayer-stats",
        title: "Read relayer stats",
        description: "Fetch queue depth and relayer operational metrics.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/relayer/stats"],
      },
      {
        id: "relayer-pending",
        title: "Inspect pending requests",
        description: "Fetch pending relay queue entries for a wallet.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/relayer/pending/__ADDRESS__"],
      },
      {
        id: "relayer-ledger-events",
        title: "Read ledger event stream",
        description: "Fetch relayer ledger events for audits.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/relayer/ledger/events"],
      },
    ],
  },
  {
    slug: "adapters",
    title: "Adapters",
    status: "ADAPTER",
    categoryId: "automation-infra",
    summary: "Composable integration layer for protocol-specific private strategy modules.",
    description:
      "Adapters are the extension layer for integrating external strategy logic into zkde.fi proof-gated execution without forking core policy and privacy primitives.",
    capabilities: [
      "Adapter-oriented strategy health probes.",
      "Phase4A contract/function metadata endpoints.",
      "Reusable extension point for protocol-specific strategy rails.",
      "Designed for teams shipping bespoke strategy logic on top of core rails.",
    ],
    docsHref: "/docs/developers",
    advancedLink: { href: "/docs/developers", label: "Open adapter developer docs" },
    standaloneActions: [
      {
        id: "adapter-strategy-health",
        title: "Check strategy adapter health",
        description: "Verify core strategy API health before adapter routing.",
        method: "GET",
        endpointCandidates: ["/api/v1/strategies/health"],
      },
      {
        id: "adapter-contracts",
        title: "List phase4a contracts",
        description: "Inspect exposed contracts in phase4a integration routes.",
        method: "GET",
        endpointCandidates: ["/api/v1/phase4a/contracts"],
      },
      {
        id: "adapter-functions",
        title: "List phase4a function map",
        description: "Inspect available function signatures for adapter integration.",
        method: "GET",
        endpointCandidates: ["/api/v1/phase4a/functions"],
      },
    ],
  },
  {
    slug: "proof-chain",
    title: "Proof Chain (L3)",
    status: "BUILT",
    categoryId: "automation-infra",
    summary: "Dedicated Madara L3 appchain for zero-gas proof verification and fact settlement.",
    description:
      "The Obsqra Proof Chain is a Madara-based Starknet L3 sequencer dedicated to proof-fact registration, on-chain verification via Garaga and Integrity verifiers, and batched settlement to Starknet L2. 5-second blocks, zero gas, 3 proving paths.",
    capabilities: [
      "Live block production at 5s cadence with zero-gas fee model.",
      "Groth16 on-chain verification via Garaga (31 circuits).",
      "STARK on-chain verification via Integrity (6 programs).",
      "Hash-only fallback with circuit breaker for emergency ops.",
      "L3 → L2 state-diff settlement with validity proofs.",
      "Public RPC, block explorer, and wallet add-network support.",
    ],
    docsHref: "/docs/developers",
    advancedLink: { href: "https://starknet.obsqra.fi/forge", label: "Open Forge explorer" },
    featured: true,
    standaloneActions: [
      {
        id: "l3-health",
        title: "Check L3 health",
        description: "Query Madara node health, block height, chain ID, and sync status.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/settlement/madara/health"],
      },
      {
        id: "l3-capabilities",
        title: "List proving capabilities",
        description: "Inspect all 3 proving paths, contracts, and circuit coverage.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/l3/capabilities"],
      },
      {
        id: "l3-stats",
        title: "Read L3 proving stats",
        description: "Fetch fact registration count, proving path usage, and settlement metrics.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/l3/stats"],
      },
      {
        id: "l3-settlement-config",
        title: "View settlement config",
        description: "Check which settlement layer is primary and L2 fallback status.",
        method: "GET",
        endpointCandidates: ["/api/v1/zkdefi/risk_passport/settlement/config"],
      },
    ],
  },
];

export const PRODUCTS_BY_CATEGORY: Record<string, ProductDefinition[]> = PRODUCT_CATEGORIES.reduce(
  (acc, category) => {
    acc[category.id] = PRODUCTS.filter((product) => product.categoryId === category.id);
    return acc;
  },
  {} as Record<string, ProductDefinition[]>,
);

export function getProductBySlug(slug: string): ProductDefinition | undefined {
  return PRODUCTS.find((product) => product.slug === slug);
}

export function getCategoryById(id: string): ProductCategory | undefined {
  return PRODUCT_CATEGORIES.find((category) => category.id === id);
}
