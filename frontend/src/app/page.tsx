import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Shield,
  Cpu,
  Lock,
  BarChart3,
  X,
  Globe,
  Zap,
  Clock,
  Bot,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { CapitalOSSection } from "@/components/marketing/CapitalOSSection";
import { LiveStatsBanner } from "@/components/marketing/LiveStatsBanner";

/* ─── data ─────────────────────────────────────────────────────────── */

const TRUST_MODES = [
  {
    mode: "Trustless",
    desc: "Both proofs verified on-chain. No intermediary. The contract won't execute unless the math checks out.",
    color: "text-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    examples: "Vault deposits, privacy pool entries, on-chain settlement",
  },
  {
    mode: "Trust-minimized",
    desc: "Proof generated off-chain, receipt committed on-chain. You can verify it anytime — it's batched for speed.",
    color: "text-cyan-400",
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/10",
    examples: "Agent trades, risk scoring, strategy analysis",
  },
  {
    mode: "Delegated",
    desc: "You set the rules, the agent acts within them. Like a session key — but proof-gated.",
    color: "text-amber-400",
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    examples: "Auto-rebalancing, LP management, yield harvesting",
  },
] as const;

const STARKNET_CONTRACTS = [
  { name: "ReputationRegistry", hash: "0x03a1…3f8a" },
  { name: "FullPrivacyPoolV2", hash: "0xce55…f117" },
  { name: "ReceiptRegistry", hash: "0x02db…9e01" },
  { name: "VaultController", hash: "0x04e7…9061" },
  { name: "GaragaVerifier", hash: "0x04e7…9061" },
  { name: "ModelBridgeVerifier", hash: "0x037c…626f" },
  { name: "ZkmlVerifier", hash: "0x068a…8923" },
] as const;

const ETHEREUM_CONTRACTS = [
  { name: "Halo2Verifier", hash: "0x8a3f…c901", note: "EZKL KZG auto-generated" },
  { name: "ModelBridgeVerifier", hash: "0x6b2e…d405", note: "Stateful registry" },
  { name: "ReceiptRegistry", hash: "0x4c1d…e607", note: "Composable receipts" },
  { name: "BridgeRelay", hash: "0x9f0a…b203", note: "Cross-chain sync" },
] as const;

const ROADMAP = [
  {
    phase: "Phase 1 — Foundation",
    status: "done" as const,
    items: [
      "Double-entry vault ledger + note tracking",
      "Privacy commitment & nullifier rails",
      "31 circom circuits with WASM + zkey",
      "7 contracts deployed on Starknet Sepolia",
      "Groth16 + STARK dual-proof lanes",
    ],
  },
  {
    phase: "Phase 2 — ModelBridge",
    status: "done" as const,
    items: [
      "Open-source ModelBridge (zkML → circuit proof gate)",
      "L3 hash-verified receipt pipeline on Madara",
      "Garaga on-chain KZG pairing verifier",
      "4 EVM contracts on Ethereum Sepolia",
      "Stone prover integration (same infra as Starknet blocks)",
    ],
  },
  {
    phase: "Phase 3 — Intelligence Layer",
    status: "active" as const,
    items: [
      "zkML-gated agent composition (13 skill circuits per opportunity)",
      "Trust receipt pipeline with SHA-256 commitments",
      "Private prediction market with commit-reveal-score lifecycle",
      "Signal pass service with typed risk reports",
      "Tri-chain settlement: Madara L3 → Starknet L2 → Ethereum L1",
    ],
  },
  {
    phase: "Phase 4 — Fully Recursive",
    status: "active" as const,
    items: [
      "SNARK-in-STARK recursive proof composition",
      "Batch N zkML proofs → single Starknet verification",
      "Cross-chain portable risk profiles via BridgeRelay",
      "Noir HONK bridge + native Cairo KZG lanes ✓",
      "Recursive trust receipts with composable attestations",
    ],
  },
  {
    phase: "Phase 5 — Mainnet + Capital OS",
    status: "planned" as const,
    items: [
      "Capital OS: full portfolio management, auto-rebalance, LP orchestration",
      "Starknet mainnet contract deployment",
      "Ethereum mainnet bridge finalization",
      "Production Madara L3 with economic security",
      "DAO governance with private voting",
      "Public ModelBridge SDK + developer docs",
      "StarkForge S-two integration — 100x proving cost reduction as Starknet transitions from Stone to S-two prover",
    ],
  },
] as const;

/* ─── page ─────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader />

      {/* ═══════════════════════════════════════════════════════════════
          1. HERO
      ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden border-b border-zinc-800 px-6 py-24">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-950/30 via-transparent to-cyan-950/30" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(16,185,129,0.16),transparent_52%)]" />

        <div className="relative mx-auto max-w-5xl text-center">
          <p className="mb-6 text-sm font-medium tracking-wide text-zinc-500">
            DeFi makes you choose: be private or be trusted.
          </p>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            <span className="bg-gradient-to-r from-white via-emerald-100 to-white bg-clip-text text-transparent">
              Hide everything.
            </span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              Prove anything.
            </span>
          </h1>

          <div className="mx-auto mt-8 flex items-center justify-center gap-3">
            <span className="font-mono text-3xl tracking-wide text-zinc-300 sm:text-4xl md:text-5xl">
              trust = <span className="text-emerald-400">Σ</span>(receipts)<span className="text-amber-400">*</span>
            </span>
          </div>
          <p className="mt-2 text-xs italic text-zinc-600">
            <span className="text-amber-400">*</span>earned over time, never assumed
          </p>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-zinc-300">
            Build an anonymous reputation anchored by ZK receipts.
            Your strategy stays hidden. Your AI agents prove they behaved.
            Your track record travels with you — without revealing who you are.
          </p>

          <div className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {[
              { value: "11", label: "contracts" },
              { value: "31", label: "circuits" },
              { value: "3", label: "chains" },
              { value: "136+", label: "receipts" },
            ].map((s) => (
              <div key={s.label} className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold text-emerald-400 sm:text-xl">{s.value}</span>
                <span className="text-sm text-zinc-500">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/agent"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 font-semibold transition-colors hover:bg-emerald-500"
            >
              Launch App
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="/test"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/50 px-6 py-3 font-medium text-emerald-300 transition-colors hover:border-emerald-400 hover:text-white"
            >
              Verify Every Claim
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href="https://github.com/Obsqra-Labs/zkdefi"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-medium text-zinc-200 transition-colors hover:border-cyan-500/50 hover:text-white"
            >
              GitHub
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <p className="mt-6 text-xs text-zinc-600">
            zkde.fi by{" "}
            <a href="https://obsqra.xyz" target="_blank" rel="noopener noreferrer" className="text-zinc-500 underline decoration-zinc-700 hover:text-zinc-400">Obsqra Labs</a>.
            Infra layer:{" "}
            <a href="https://starkforge.xyz" target="_blank" rel="noopener noreferrer" className="text-zinc-500 underline decoration-zinc-700 hover:text-zinc-400">StarkForge</a>.
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          2. THE PROBLEM + WHY NOW  (merged)
      ═══════════════════════════════════════════════════════════════ */}
      <section className="border-b border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">

          {/* Problem / Insight side-by-side */}
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-rose-500/15 bg-rose-950/5 p-7">
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600/20">
                  <Lock className="h-4 w-4 text-rose-400" />
                </span>
                <h3 className="text-sm font-bold uppercase tracking-wider text-rose-400">The Problem</h3>
              </div>
              <p className="text-sm leading-relaxed text-zinc-300">
                To use DeFi today, you reveal everything — what you&apos;re buying,
                how much, and when. Others see it before you execute.
              </p>
              <div className="mt-4 space-y-2">
                {[
                  "Your trading strategy is visible to everyone",
                  "AI agents can't prove they're acting honestly",
                  "Your track record doesn't follow you between protocols",
                ].map((line) => (
                  <div key={line} className="flex items-start gap-2 text-xs text-zinc-500">
                    <X className="mt-0.5 h-3 w-3 shrink-0 text-rose-500/60" />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-500/15 bg-emerald-950/5 p-7">
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/20">
                  <Shield className="h-4 w-4 text-emerald-400" />
                </span>
                <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">The Insight</h3>
              </div>
              <p className="text-sm leading-relaxed text-zinc-300">
                What if privacy didn&apos;t just hide information — but
                <strong className="text-white"> controlled what&apos;s allowed to happen?</strong>{" "}
                Proofs replace trust. Receipts replace promises.
              </p>
              <div className="mt-4 rounded-lg border border-emerald-500/10 bg-emerald-950/20 p-3">
                <pre className="text-[11px] leading-relaxed text-emerald-300/80">
{`your strategy (private)
  ↓  proof: "conditions met"
  ↓  execution: capital moves
  ↓  receipt: on-chain evidence`}
                </pre>
              </div>
            </div>
          </div>

          {/* Competitive diff line */}
          <div className="mt-6 rounded-xl border border-emerald-500/10 bg-emerald-950/5 px-6 py-4 text-center">
            <p className="text-sm leading-relaxed text-zinc-300">
              On-chain credit scores exist. <strong className="text-emerald-400">ZK-proved credit scores that travel cross-protocol without disclosure don&apos;t.</strong> Until now.
            </p>
          </div>

          {/* Why Now — 3 bullets below the problem */}
          <div className="mt-10">
            <h3 className="mb-5 text-center text-lg font-bold text-zinc-200">
              Why this is solvable <span className="text-emerald-400">now</span>
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                {
                  icon: <Zap className="h-4 w-4 text-rose-400" />,
                  iconBg: "bg-rose-500/10",
                  title: "Privacy became a race.",
                  body: "Aztec launched ($170M). Starknet shipped STRK20. The first-mover window is now.",
                },
                {
                  icon: <Clock className="h-4 w-4 text-cyan-400" />,
                  iconBg: "bg-cyan-500/10",
                  title: "Proving costs dropped 100×.",
                  body: "S-two prover replaced Stone. Verifiable execution at scale is economically viable.",
                },
                {
                  icon: <Bot className="h-4 w-4 text-amber-400" />,
                  iconBg: "bg-amber-500/10",
                  title: "Agents are moving real money.",
                  body: "EigenLayer, Coinbase AgentKit, ElizaOS — none can prove their agents behaved. We can.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-5 py-4"
                >
                  <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${item.iconBg}`}>
                    {item.icon}
                  </div>
                  <h4 className="text-xs font-bold text-zinc-200">{item.title}</h4>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          3. THE LOOP — interactive demo  (CapitalOSSection)
      ═══════════════════════════════════════════════════════════════ */}
      <section id="capital-os" className="scroll-mt-8 border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <CapitalOSSection />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          4. HOW WE PROVE IT  (absorbs competitive + trust modes + Why Starknet)
      ═══════════════════════════════════════════════════════════════ */}
      <section className="border-b border-zinc-800 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">How We Prove It</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              Two independent proof systems check every claim.
              Both must pass. Neither can be faked.
            </p>
          </div>

          {/* Dual proof system */}
          <div className="mx-auto mt-12 max-w-3xl space-y-6">
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/5 p-6">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/20">
                  <Shield className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100">Check #1 — The math proof</h3>
                  <p className="text-xs text-zinc-500">Garaga verifies the SNARK on Starknet</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-zinc-400">
                Your AI model runs off-chain and produces a cryptographic proof.
                Garaga checks that proof on-chain using the same math that
                secures Ethereum. If the math doesn&apos;t check out, nothing executes.
              </p>
            </div>

            <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/5 p-6">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600/20">
                  <Lock className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100">Check #2 — The execution proof</h3>
                  <p className="text-xs text-zinc-500">Stone wraps everything in a STARK</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-zinc-400">
                The same prover that secures Starknet blocks wraps your
                entire execution in a second proof. The first proof lives
                inside this one. Both pass or nothing happens.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Settlement Path</p>
              <p className="mt-3 font-mono text-sm text-emerald-400">
                Madara L3 → Starknet L2 → Ethereum L1
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                136+ receipts on-chain. Every hash queryable via RPC.
              </p>
              <a
                href="/test"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300"
              >
                Verify every claim →
              </a>
            </div>
          </div>

          {/* Trust mode tiers */}
          <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
            {TRUST_MODES.map((tm) => (
              <div
                key={tm.mode}
                className={`rounded-xl border ${tm.border} ${tm.bg} p-5`}
              >
                <h4 className={`text-sm font-bold ${tm.color}`}>{tm.mode}</h4>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{tm.desc}</p>
                <p className="mt-3 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Examples
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">{tm.examples}</p>
              </div>
            ))}
          </div>

          {/* How we're different — folded competitive positioning */}
          <div className="mt-14">
            <h3 className="mb-6 text-center text-lg font-bold text-zinc-200">How we&apos;re different</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                {
                  title: "zkML proofs, not analytics",
                  body: "Cred Protocol, Spectral, and ArcX score wallets. We prove the score in ZK — it travels cross-protocol without revealing your data.",
                  accent: "border-emerald-500/15",
                },
                {
                  title: "Agents gated, not just attested",
                  body: "EigenAI and Lagrange prove inference. We gate capital movement on it. The proof unlocks or blocks the trade.",
                  accent: "border-cyan-500/15",
                },
                {
                  title: "Math, not hardware trust",
                  body: "TEE-based compute trusts the chip manufacturer. ZK proofs trust math. Post-Tornado-Cash, that distinction matters.",
                  accent: "border-violet-500/15",
                },
              ].map((item) => (
                <div key={item.title} className={`rounded-xl border ${item.accent} bg-zinc-900/30 p-5`}>
                  <h4 className="text-sm font-bold text-zinc-100">{item.title}</h4>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Why Starknet — compact 3-col */}
          <div className="mt-14 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
            <h3 className="mb-4 text-center text-sm font-bold uppercase tracking-wider text-zinc-400">Why Starknet</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                {
                  title: "Cheap proof verification",
                  desc: "Native STARK verification at L2 cost. The same math that secures Ethereum runs on-chain for pennies.",
                  accent: "text-cyan-400",
                },
                {
                  title: "Private by design",
                  desc: "Cairo enforces rules without revealing them. Your strategy compiles into something provable, not readable.",
                  accent: "text-emerald-400",
                },
                {
                  title: "Real computation",
                  desc: "ML models settle on-chain through the same proofs that secure Starknet blocks. S-two prover: 100× more efficient.",
                  accent: "text-violet-400",
                },
              ].map((item) => (
                <div key={item.title}>
                  <h4 className={`text-xs font-bold ${item.accent}`}>{item.title}</h4>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          5. WHAT'S LIVE  (merges Live Stats + Use Cases + Tri-Chain)
      ═══════════════════════════════════════════════════════════════ */}
      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">What&apos;s Live</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              11 contracts, 3 chains, 136+ receipts — everything below is deployed and queryable right now.
            </p>
          </div>

          {/* Live stats bar — inline */}
          <div className="mb-10 rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
            <LiveStatsBanner />
          </div>

          {/* Use cases — what the proof system enables */}
          <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600/20">
                <Shield className="h-5 w-5 text-cyan-300" />
              </div>
              <h3 className="font-semibold text-zinc-100">Move Money Privately</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Deposit, withdraw, and transfer without revealing amounts or
                destinations. Three privacy levels — from full proof to
                optimistic batching.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                3 privacy tiers · All proved · Dark L3 settlement
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600/20">
                <Cpu className="h-5 w-5 text-violet-400" />
              </div>
              <h3 className="font-semibold text-zinc-100">AI Agents That Prove Their Work</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Every agent decision runs through 13 skill checks before
                execution. The agent can&apos;t act unless all proofs pass.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                13 checks per trade · All must pass · Receipts on-chain
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600/20">
                <BarChart3 className="h-5 w-5 text-amber-400" />
              </div>
              <h3 className="font-semibold text-zinc-100">Predictions You Can Check</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Predictions committed on-chain before the outcome, then
                scored publicly. No cherry-picking. Every forecast has a receipt.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                0.109 Brier score · 100% direction calls · 3 time horizons
              </p>
            </div>
          </div>

          {/* Tri-chain deployment */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Starknet L2 */}
            <div className="rounded-xl border border-zinc-800 overflow-hidden">
              <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-cyan-500" />
                  <h3 className="text-sm font-semibold text-zinc-200">Starknet Sepolia (L2)</h3>
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-600">7 Cairo contracts</p>
              </div>
              <div className="divide-y divide-zinc-800/50">
                {STARKNET_CONTRACTS.map((c) => (
                  <div key={c.name} className="flex items-center justify-between px-4 py-2">
                    <span className="text-xs text-zinc-300">{c.name}</span>
                    <span className="font-mono text-[10px] text-zinc-600">{c.hash}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Ethereum L1 */}
            <div className="rounded-xl border border-zinc-800 overflow-hidden">
              <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                  <h3 className="text-sm font-semibold text-zinc-200">Ethereum Sepolia (L1)</h3>
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-600">4 EVM contracts</p>
              </div>
              <div className="divide-y divide-zinc-800/50">
                {ETHEREUM_CONTRACTS.map((c) => (
                  <div key={c.name} className="px-4 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-300">{c.name}</span>
                      <span className="font-mono text-[10px] text-zinc-600">{c.hash}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-zinc-600">{c.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Madara L3 */}
            <div className="rounded-xl border border-zinc-800 overflow-hidden">
              <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  <h3 className="text-sm font-semibold text-zinc-200">Madara L3 (Proof Chain)</h3>
                </div>
                <p className="mt-0.5 text-[10px] text-zinc-600">OBSQRA_PROOF_CHAIN</p>
              </div>
              <div className="divide-y divide-zinc-800/50">
                <div className="px-4 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300">ObsqraFactRegistry</span>
                    <span className="text-[10px] text-emerald-400">Live</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-600">Receipt storage + hash verification</p>
                </div>
                <div className="px-4 py-3">
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div>
                      <p className="text-sm font-bold text-emerald-400">5 s</p>
                      <p className="text-[10px] text-zinc-600">Block time</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-emerald-400">0</p>
                      <p className="text-[10px] text-zinc-600">Gas cost</p>
                    </div>
                  </div>
                </div>
                <div className="px-4 py-2 text-xs text-zinc-500">
                  Settlement: L3 → Starknet L2 → Ethereum L1
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          6. ROADMAP  (compact)
      ═══════════════════════════════════════════════════════════════ */}
      <section className="border-b border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Roadmap</h2>
            <p className="mx-auto mt-3 max-w-2xl text-zinc-400">
              Where we are — and where we&apos;re going.
            </p>
          </div>

          <div className="relative">
            <div className="absolute left-4 top-0 hidden h-full w-px bg-zinc-800 md:block" />

            <div className="space-y-6">
              {ROADMAP.map((phase) => (
                <div key={phase.phase} className="relative md:pl-12">
                  <div
                    className={`absolute left-2.5 top-1.5 hidden h-3 w-3 rounded-full md:block ${
                      phase.status === "done"
                        ? "bg-emerald-500"
                        : phase.status === "active"
                          ? "bg-cyan-400 ring-4 ring-cyan-400/20"
                          : phase.status === "planned"
                            ? "bg-amber-500/60"
                            : "bg-zinc-600"
                    }`}
                  />
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="text-base font-semibold">{phase.phase}</h3>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          phase.status === "done"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : phase.status === "active"
                              ? "bg-cyan-500/20 text-cyan-400"
                              : phase.status === "planned"
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-zinc-700/50 text-zinc-400"
                        }`}
                      >
                        {phase.status === "done"
                          ? "Complete"
                          : phase.status === "active"
                            ? "In Progress"
                            : phase.status === "planned"
                              ? "Next"
                              : "Planned"}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {phase.items.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-zinc-400">
                          <CheckCircle2
                            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                              phase.status === "done"
                                ? "text-emerald-500"
                                : phase.status === "active"
                                  ? "text-cyan-500"
                                  : "text-zinc-600"
                            }`}
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          7. BUILDER CTA + FOOTER  (merged)
      ═══════════════════════════════════════════════════════════════ */}
      <section className="px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold md:text-3xl">Want to build on this?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
            API docs, circuit specs, and the open-source ModelBridge
            are all available. The infrastructure layer is StarkForge.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/50 px-5 py-2.5 text-sm font-medium text-emerald-300 transition-colors hover:border-emerald-400 hover:text-white"
            >
              Documentation
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/Obsqra-Labs/zkdefi"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              GitHub
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href="https://starkforge.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              StarkForge
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="mx-auto mt-12 max-w-5xl border-t border-zinc-800 pt-8">
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-400">
            {[
              { icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, text: "Starknet L2" },
              { icon: <CheckCircle2 className="h-4 w-4 text-violet-400" />, text: "Ethereum L1" },
              { icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, text: "Madara L3" },
              { icon: <Shield className="h-4 w-4 text-cyan-400" />, text: "SNARK-in-STARK" },
              { icon: <Globe className="h-4 w-4 text-amber-400" />, text: "Open Source" },
            ].map((b) => (
              <div key={b.text} className="flex items-center gap-2">
                {b.icon}
                <span>{b.text}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-center gap-2">
            <span className="text-sm font-medium text-zinc-400">
              zkde.fi <span className="text-zinc-600">by</span> Obsqra Labs
            </span>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href="https://github.com/Obsqra-Labs/zkdefi"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
              >
                github.com/Obsqra-Labs/zkdefi
              </a>
              <span className="text-zinc-800">·</span>
              <span className="text-xs text-zinc-600">
                Built on Starknet · Infra by Obsqra · Powered by Stone → S-two + Garaga + EZKL
              </span>
              <span className="text-zinc-800">·</span>
              <a
                href="/docs/why"
                className="text-xs text-zinc-600 transition-colors hover:text-emerald-400"
              >
                Why we built this →
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
