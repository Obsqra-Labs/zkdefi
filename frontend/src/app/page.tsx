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
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { CapitalOSSection } from "@/components/marketing/CapitalOSSection";
import { LiveStatsBanner } from "@/components/marketing/LiveStatsBanner";

/* ─── data ─────────────────────────────────────────────────────────── */

const TRUST_MODES = [
  {
    mode: "Trustless",
    desc: "Full on-chain verification. Stone STARK proof + Garaga KZG pairing check. No relayer, no intermediary.",
    color: "text-emerald-400",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    examples: "On-chain settlement, vault execution, privacy pool deposits",
  },
  {
    mode: "Trust-minimized",
    desc: "Off-chain zkML proof, on-chain receipt + hash commitment. Verifiable but batched for throughput.",
    color: "text-cyan-400",
    border: "border-cyan-500/30",
    bg: "bg-cyan-500/10",
    examples: "Agent execution, strategy analysis, risk scoring",
  },
  {
    mode: "Delegated",
    desc: "Session-key delegation with policy constraints. The agent acts within proof-gated bounds you define.",
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
    ],
  },
] as const;

/* ─── page ─────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader />

      {/* ═══ Hero ═══ */}
      <section className="relative overflow-hidden border-b border-zinc-800 px-6 py-24">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-950/30 via-transparent to-cyan-950/30" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(16,185,129,0.16),transparent_52%)]" />

        <div className="relative mx-auto max-w-5xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            <span className="bg-gradient-to-r from-white via-emerald-100 to-white bg-clip-text text-transparent">
              Proof-gated execution
            </span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              for private finance on Starknet.
            </span>
          </h1>

          <div className="mx-auto mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {[
              { value: "11", label: "contracts deployed" },
              { value: "31", label: "circuits" },
              { value: "3", label: "chains" },
              { value: "136+", label: "on-chain receipts" },
            ].map((s) => (
              <div key={s.label} className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold text-emerald-400 sm:text-xl">{s.value}</span>
                <span className="text-sm text-zinc-500">{s.label}</span>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-zinc-300">
            Your strategy stays private. Your reputation is portable.
            <br className="hidden sm:block" />
            Your agents prove they behaved correctly.
            <br className="hidden sm:block" />
            All on Starknet. Every action verified on-chain.
          </p>

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
            zkde.fi is a reference implementation of{" "}
            <a href="https://obsqra.xyz" target="_blank" rel="noopener noreferrer" className="text-zinc-500 underline decoration-zinc-700 hover:text-zinc-400">Obsqra Labs</a>{" "}
            proving infrastructure.{" "}
            <a href="https://starkforge.xyz" target="_blank" rel="noopener noreferrer" className="text-zinc-500 underline decoration-zinc-700 hover:text-zinc-400">StarkForge</a>{" "}
            is the infra layer. This is one app built on top of it.
          </p>
        </div>
      </section>

      {/* ═══ The Loop: Reputation → Oracle → Execution ═══ */}
      <section id="capital-os" className="scroll-mt-8 border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <CapitalOSSection />
        </div>
      </section>

      {/* ═══ Live Starknet Data Bar ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-900/30 px-6 py-3">
        <div className="mx-auto max-w-6xl">
          <LiveStatsBanner />
        </div>
      </section>

      {/* ═══ Problem → Insight Bridge ═══ */}
      <section className="border-b border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* The Problem */}
            <div className="rounded-2xl border border-rose-500/15 bg-rose-950/5 p-7">
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600/20">
                  <Lock className="h-4 w-4 text-rose-400" />
                </span>
                <h3 className="text-sm font-bold uppercase tracking-wider text-rose-400">The Problem</h3>
              </div>
              <p className="text-sm leading-relaxed text-zinc-300">
                Automated strategies, AI models, and coordinated capital all require
                <strong className="text-white"> exposing execution intent on-chain</strong>.
                Other participants can front-run, copy, or exploit that visibility.
              </p>
              <div className="mt-4 space-y-2">
                {[
                  "Strategy logic visible → gets front-run or copied",
                  "Off-chain infra is opaque → users must trust blindly",
                  "Privacy tools hide balances but don't govern execution",
                ].map((line) => (
                  <div key={line} className="flex items-start gap-2 text-xs text-zinc-500">
                    <X className="mt-0.5 h-3 w-3 shrink-0 text-rose-500/60" />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs italic text-zinc-600">
                Users must choose: privacy without automation, or automation without privacy.
              </p>
            </div>

            {/* The Insight */}
            <div className="rounded-2xl border border-emerald-500/15 bg-emerald-950/5 p-7">
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/20">
                  <Shield className="h-4 w-4 text-emerald-400" />
                </span>
                <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">The Insight</h3>
              </div>
              <p className="text-sm leading-relaxed text-zinc-300">
                Privacy should not just hide information — it should
                <strong className="text-white"> govern execution</strong>.
                Proofs can verify that conditions are satisfied without revealing the underlying logic.
              </p>
              <div className="mt-4 rounded-lg border border-emerald-500/10 bg-emerald-950/20 p-3">
                <pre className="text-[11px] leading-relaxed text-emerald-300/80">
{`strategy / AI signal
  ↓  proof verification
  ↓  policy gate
  ↓  execution
  ↓  receipt`}
                </pre>
              </div>
              <p className="mt-4 text-xs text-zinc-500">
                Capital moves only when proofs pass. Strategy logic stays confidential.
                Every action produces an auditable receipt.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Why the Proofs Are Real ═══ */}
      <section className="border-b border-zinc-800 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Why the Proofs Are Real</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              Every technical claim on this page settles through two independent
              verification systems across three chains. No single point of trust.
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-3xl space-y-6">
            {/* Garaga */}
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/5 p-6">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/20">
                  <Shield className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100">SNARK Verification — Garaga</h3>
                  <p className="text-xs text-zinc-500">Groth16 KZG pairing check in Cairo</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-zinc-400">
                Garaga verifies the SNARK (Groth16) in Cairo — the same curve math
                that secures Ethereum blob commitments. EZKL generates the proof,
                Garaga checks the pairing on-chain. The verifier contract is
                auto-generated (1,904 lines of Halo2 verification logic).
              </p>
            </div>

            {/* Stone */}
            <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/5 p-6">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600/20">
                  <Lock className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100">STARK Envelope — Stone</h3>
                  <p className="text-xs text-zinc-500">Same prover that secures Starknet blocks</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-zinc-400">
                Stone wraps the execution trace in a STARK envelope — the same
                prover infrastructure that secures Starknet blocks. The SNARK
                lives inside the STARK. Both must pass. Neither can be faked
                without compromising Ethereum L1 finality.
              </p>
            </div>

            {/* Settlement path */}
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
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
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
        </div>
      </section>

      {/* ═══ What This Enables ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">What This Enables</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              The proof infrastructure unlocks capabilities that aren&apos;t possible
              when trust is assumed.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600/20">
                <Shield className="h-5 w-5 text-cyan-300" />
              </div>
              <h3 className="font-semibold text-zinc-100">Private Capital Flows</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Three-tier privacy rails — strict, standard, and express — all
                flowing through commitment → Merkle root → nullifier → selective
                disclosure. Dark settlement on Madara L3.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                3 tiers proved · Shielded → Nullifier → Claim Hash pipeline
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600/20">
                <Cpu className="h-5 w-5 text-violet-400" />
              </div>
              <h3 className="font-semibold text-zinc-100">zkML-Gated Agent Decisions</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Multi-processor pipelines screen every opportunity through 13 skill
                circuits. Batch composition only executes when all proofs pass.
                Agents prove behavior, not just intent.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                13 skills per opportunity · 5/5 batch proofs passing
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-600/20">
                <BarChart3 className="h-5 w-5 text-amber-400" />
              </div>
              <h3 className="font-semibold text-zinc-100">Verifiable Prediction Markets</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Commit → reveal → score lifecycle with multi-horizon forecasts.
                Trust verified via zkML proofs with full explainability and
                on-chain scoring receipts.
              </p>
              <p className="mt-3 text-xs text-zinc-600">
                0.109 Brier score · 100% directional accuracy · 3 horizons
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Tri-Chain Deployment ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Tri-Chain Deployment</h2>
            <p className="mt-3 text-zinc-400">
              Every technical claim on this page is backed by deployed contracts.
              Here they are — 11 across Ethereum L1, Starknet L2, and Madara L3.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
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
                  Settlement path: L3 state diff → Starknet L2 → Ethereum L1 finality
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Roadmap ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Roadmap</h2>
            <p className="mx-auto mt-3 max-w-2xl text-zinc-400">
              Where we are — and where we&apos;re going.
            </p>
          </div>

          <div className="relative">
            <div className="absolute left-4 top-0 hidden h-full w-px bg-zinc-800 md:block" />

            <div className="space-y-8">
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
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                    <div className="mb-3 flex items-center gap-3">
                      <h3 className="text-lg font-semibold">{phase.phase}</h3>
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
                    <ul className="space-y-1.5">
                      {phase.items.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-zinc-400">
                          <CheckCircle2
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
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

      {/* ═══ Why Starknet ═══ */}
      <section className="border-b border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Why Starknet</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              Proof-gated private finance needs an L2 purpose-built for
              scalable verification.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                title: "Scalable proof verification",
                desc: "Native STARK verification at L2 cost. Garaga enables KZG pairing checks in Cairo — the same curve math that secures Ethereum's blob commitments.",
                color: "border-cyan-500/20 bg-cyan-950/5",
                accent: "text-cyan-400",
              },
              {
                title: "Private execution logic",
                desc: "Cairo programs enforce policy constraints without revealing the rules. Strategy logic compiles to provable traces, not public bytecode.",
                color: "border-emerald-500/20 bg-emerald-950/5",
                accent: "text-emerald-400",
              },
              {
                title: "Complex computation on-chain",
                desc: "ML inference, risk models, and multi-step strategies run off-chain but settle on-chain through STARK proofs — the same infra that secures Starknet blocks.",
                color: "border-violet-500/20 bg-violet-950/5",
                accent: "text-violet-400",
              },
            ].map((item) => (
              <div key={item.title} className={`rounded-xl border ${item.color} p-5`}>
                <h4 className={`text-sm font-bold ${item.accent}`}>{item.title}</h4>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Build on zkde.fi ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-900/30 px-6 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold md:text-3xl">Building on zkde.fi?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
            The full API surface, circuit specs, and integration docs are
            available. The ModelBridge is open source. The proving
            infrastructure is StarkForge.
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
      </section>

      {/* ═══ Footer ═══ */}
      <section className="px-6 py-12">
        <div className="mx-auto max-w-5xl">
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
            <div className="flex items-center gap-4">
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
                Built on Starknet · Infra by Obsqra · Powered by Stone + Garaga + EZKL
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
