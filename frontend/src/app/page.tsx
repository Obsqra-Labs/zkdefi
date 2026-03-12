import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileCheck,
  Layers,
  Shield,
  Cpu,
  Lock,
  BarChart3,
  X,
  Zap,
  Globe,
  GitBranch,
  Box,
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
    status: "upcoming" as const,
    items: [
      "SNARK-in-STARK recursive proof composition",
      "Batch N zkML proofs → single Starknet verification",
      "Cross-chain portable risk profiles via BridgeRelay",
      "Noir HONK bridge + native Cairo KZG lanes",
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
          {/* Problem-first hook */}
          <p className="mb-6 text-sm font-medium tracking-wide text-zinc-500">
            DeFi automation requires exposing too much information.
          </p>

          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
            <span className="bg-gradient-to-r from-white via-emerald-100 to-white bg-clip-text text-transparent">
              Private decisions.
            </span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              Verifiable execution.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-lg text-zinc-300">
            Strategy logic, model signals, and execution intent stay private.
            Proofs — not disclosure — govern what capital is allowed to do.
          </p>

          <div className="mx-auto mt-5 flex items-center justify-center gap-3">
            <span className="font-mono text-xl tracking-wide text-zinc-400 sm:text-2xl">
              trust = <span className="text-emerald-400">Σ</span>(receipts)<span className="text-amber-400">*</span>
            </span>
          </div>
          <p className="mt-1 text-[10px] text-zinc-600 italic">
            <span className="text-amber-400">*</span>earned over time, never assumed
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
              href="#capital-os"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-medium text-zinc-200 transition-colors hover:border-emerald-500/50 hover:text-white"
            >
              See the Demo
              <ChevronDown className="h-4 w-4" />
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

      {/* ═══ Live Starknet Data Bar ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-900/30 px-6 py-3">
        <div className="mx-auto max-w-6xl">
          <LiveStatsBanner />
        </div>
      </section>

      {/* ═══ Capital OS: AI Brain + Live Demo ═══ */}
      <section id="capital-os" className="scroll-mt-8 border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <CapitalOSSection />
        </div>
      </section>

      {/* ═══ States of Trust: How It Works ═══ */}
      <section className="border-b border-zinc-800 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold md:text-4xl">States of Trust</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              Not every action needs the same trust guarantee. Our tri-chain architecture lets you
              choose — from fully trustless on-chain verification to delegated execution within
              proof-gated bounds.
            </p>
          </div>

          {/* 3-column: Prove → Verify → Execute */}
          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
            <article className="relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600/20">
                <Lock className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold">
                1
              </div>
              <h3 className="text-xl font-semibold">Prove It</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                zkML models run inference off-chain and produce cryptographic commitments. The
                ModelBridge binds model output, proof hash, value bounds, and timestamp into a
                verifiable attestation. Your strategy stays private.
              </p>
            </article>

            <article className="relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600/20">
                <Shield className="h-6 w-6 text-cyan-300" />
              </div>
              <div className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold">
                2
              </div>
              <h3 className="text-xl font-semibold">Verify It</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                On-chain contracts check the proof. Garaga verifies KZG pairings in Cairo. Stone
                proves the execution trace as a STARK — the same prover infrastructure that secures
                Starknet blocks. The SNARK lives inside the STARK.
              </p>
            </article>

            <article className="relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600/20">
                <FileCheck className="h-6 w-6 text-violet-400" />
              </div>
              <div className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold">
                3
              </div>
              <h3 className="text-xl font-semibold">Execute It</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Verified proofs unlock execution — vault deposits, LP positions, agent trades. An
                auditable trust receipt is written to the chain. No valid proof means no execution,
                ever. Trust is earned, not assumed.
              </p>
            </article>
          </div>

          {/* Trust mode matrix */}
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

      {/* ═══ What We've Built ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">What We&apos;ve Built</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              Concrete infrastructure running across three chains — not a pitch deck.
              Every claim is backed by on-chain evidence and API-verifiable endpoints.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <PillarCard
              icon={<Layers className="h-6 w-6 text-emerald-400" />}
              iconBg="bg-emerald-600/20"
              title="Tri-Chain ModelBridge"
              body="Converts any ONNX model output into a Groth16 or STARK commitment. Bridges proofs across Madara L3 → Starknet L2 → Ethereum L1 via BridgeRelay. Open source."
              tag="Core"
              tagColor="emerald"
              stats={[
                { value: "3", label: "chains" },
                { value: "Dual", label: "SNARK + STARK" },
                { value: "Open", label: "source" },
              ]}
              details={[
                "EZKL KZG proof → Garaga Cairo pairing check",
                "Stone prover wraps execution in STARK envelope",
                "Madara L3 → Starknet L2 state diff → Ethereum L1",
                "Halo2Verifier (1,904 lines, auto-generated)",
              ]}
            />
            <PillarCard
              icon={<Shield className="h-6 w-6 text-cyan-300" />}
              iconBg="bg-cyan-600/20"
              title="Privacy Commitment Rails"
              body="Three-tier privacy: Strict (full proof, no relayer), Standard (relayer + delay), Express (optimistic batch). All tiers flow through commitment → Merkle root → nullifier → selective disclosure."
              tag="Live"
              tagColor="cyan"
              stats={[
                { value: "3", label: "tiers" },
                { value: "3/3", label: "rails proved" },
                { value: "L3", label: "dark settlement" },
              ]}
              details={[
                "Shielded → Nullifier → Claim Hash pipeline",
                "Relayer withdraw queued with ETA",
                "Madara L3 dark settlement verification",
                "Private voting & lending via proof rails",
              ]}
            />
            <PillarCard
              icon={<Cpu className="h-6 w-6 text-violet-400" />}
              iconBg="bg-violet-600/20"
              title="Agent Composition"
              body="Multi-processor pipelines: risk_scoring, correlation_risk, twap_position run in parallel. Each opportunity screened by 13 skill circuits. Composition only executes when all proofs pass."
              tag="Live"
              tagColor="violet"
              stats={[
                { value: "13", label: "skills / opp" },
                { value: "5/5", label: "batch proofs" },
                { value: "15", label: "listed skills" },
              ]}
              details={[
                "risk_score, anomaly_detection, yield_optimality",
                "strategy_integrity, execution_integrity",
                "il_predictor, slippage_bound, mev_protection",
                "Batch proof runtime: all 5 succeed w/ hashes",
              ]}
            />
            <PillarCard
              icon={<BarChart3 className="h-6 w-6 text-amber-400" />}
              iconBg="bg-amber-600/20"
              title="Prediction Market"
              body="Snapshot forecaster with commit → reveal → score lifecycle. Multi-horizon predictions (5m, 30m, 4h) with probability distributions. Trust verified via zkML proofs with full explainability."
              tag="Novel"
              tagColor="amber"
              stats={[
                { value: "0.109", label: "Brier score" },
                { value: "100%", label: "directional" },
                { value: "3", label: "horizons" },
              ]}
              details={[
                "Returns: 0.56% (5m), 0.91% (30m), 1.39% (4h)",
                "Score receipt: 0x030c…1904",
                "Trust mode: offchain_ezkl_verified",
                "Natural-language explainability output",
              ]}
            />
            <PillarCard
              icon={<Zap className="h-6 w-6 text-rose-400" />}
              iconBg="bg-rose-600/20"
              title="Trust Receipt Pipeline"
              body="Every proof-gated action writes an auditable receipt: proof hash, tx hash, and execution metadata. SHA-256 commitments bind model output to timestamped on-chain evidence."
              tag="Live"
              tagColor="rose"
              stats={[
                { value: "136+", label: "receipts" },
                { value: "31", label: "circuits" },
                { value: "SHA-256", label: "commitment" },
              ]}
              details={[
                "Credit eligibility: verified=true, hash=0xc614…3acc",
                "Receipt stream via /api/v1/receipts",
                "31 circom circuits with WASM + zkey (dual-ready)",
                "Poseidon worker + persistent hash service",
              ]}
            />
            <PillarCard
              icon={<Box className="h-6 w-6 text-teal-400" />}
              iconBg="bg-teal-600/20"
              title="Stone Prover Pipeline"
              body="Same STARK prover infrastructure that secures Starknet blocks. Cairo programs + inputs → cpu_air_prover → STARK proof → cpu_air_verifier. Production-grade, battle-tested."
              tag="Core"
              tagColor="teal"
              stats={[
                { value: "Stone", label: "prover" },
                { value: "Cairo", label: "programs" },
                { value: "STARK", label: "proofs" },
              ]}
              details={[
                "cpu_air_prover → cpu_air_verifier pipeline",
                "Same infra as Starknet block proofs",
                "Integrated with Garaga for KZG pairing checks",
                "SNARK verification embedded inside STARK envelope",
              ]}
            />
          </div>
        </div>
      </section>



      {/* ═══ Tri-Chain Deployment ═══ */}
      <section className="border-b border-zinc-800 bg-zinc-950/50 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Tri-Chain Deployment</h2>
            <p className="mt-3 text-zinc-400">
              11 contracts across Ethereum L1, Starknet L2, and Madara L3. Every hash is queryable via RPC.
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

      {/* ═══ Architecture ═══ */}
      <section className="border-b border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">What We Compose</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              Individual tools solve pieces. We wire the full trust pipeline — from model inference to
              L1 settlement.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                tool: "EZKL",
                provides: "KZG proof of ML inference",
                weAdd: "Stateful registry, receipt layer, policy gate binding",
                color: "border-violet-500/30",
              },
              {
                tool: "Garaga",
                provides: "KZG pairing check in Cairo",
                weAdd: "Calldata transform from EZKL proof format → Cairo-native input",
                color: "border-cyan-500/30",
              },
              {
                tool: "Stone",
                provides: "STARK prover for Cairo",
                weAdd: "SNARK verification embedded inside STARK envelope — heterogeneous composition",
                color: "border-emerald-500/30",
              },
              {
                tool: "obsqra",
                provides: "The composition layer",
                weAdd: "ModelBridge + BridgeRelay + tri-chain settlement + trust receipt pipeline",
                color: "border-amber-500/30",
              },
            ].map((item) => (
              <div key={item.tool} className={`rounded-xl border ${item.color} bg-zinc-900/40 p-5`}>
                <h4 className="text-sm font-bold text-zinc-200">{item.tool}</h4>
                <p className="mt-1 text-xs text-zinc-500">{item.provides}</p>
                <div className="mt-3 border-t border-zinc-800/50 pt-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    {item.tool === "obsqra" ? "What we ship" : "What we add"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{item.weAdd}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Why Starknet ═══ */}
      <section className="border-b border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold md:text-4xl">Why Starknet</h2>
            <p className="mx-auto mt-3 max-w-3xl text-zinc-400">
              Proof-gated private finance needs an L2 purpose-built for
              scalable verification and complex off-chain computation.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Scalable proof verification",
                desc: "Native STARK verification at L2 cost. Garaga enables KZG pairing checks in Cairo — the same curve math that secures Ethereum's blob commitments.",
                color: "border-cyan-500/20 bg-cyan-950/5",
                accent: "text-cyan-400",
              },
              {
                title: "Private execution logic",
                desc: "Cairo programs can enforce arbitrary policy constraints without revealing the underlying rules. Strategy logic compiles to provable traces, not public bytecode.",
                color: "border-emerald-500/20 bg-emerald-950/5",
                accent: "text-emerald-400",
              },
              {
                title: "Complex computation verified on-chain",
                desc: "ML inference, risk models, and multi-step strategies run off-chain but settle on-chain through STARK proofs — the same infra that secures Starknet blocks.",
                color: "border-violet-500/20 bg-violet-950/5",
                accent: "text-violet-400",
              },
            ].map((item) => (
              <div key={item.title} className={`rounded-xl border ${item.color} p-6`}>
                <h4 className={`text-sm font-bold ${item.accent}`}>{item.title}</h4>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{item.desc}</p>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-zinc-600">
            The Re&#123;define&#125; Privacy track highlights private DeFi, private voting,
            confidential financial workflows, and private prediction markets.
            zkde.fi demonstrates that a single architecture can support all of these simultaneously.
          </p>
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
                          : phase.status === "upcoming"
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
                              : phase.status === "upcoming"
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-zinc-700/50 text-zinc-400"
                        }`}
                      >
                        {phase.status === "done"
                          ? "Complete"
                          : phase.status === "active"
                            ? "In Progress"
                            : phase.status === "upcoming"
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

/* ─── helper components ────────────────────────────────────────────── */

const TAG_COLORS: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-400",
};

function PillarCard({
  icon,
  iconBg,
  title,
  body,
  tag,
  tagColor = "emerald",
  stats,
  details,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  body: string;
  tag: string;
  tagColor?: string;
  stats?: { value: string; label: string }[];
  details?: string[];
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7 transition-colors hover:border-emerald-500/30">
      <div className="mb-4 flex items-center justify-between">
        <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${iconBg}`}>
          {icon}
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${TAG_COLORS[tagColor] ?? TAG_COLORS.emerald}`}>
          {tag}
        </span>
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>

      {stats && stats.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg bg-zinc-800/50 px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-emerald-400">{s.value}</p>
              <p className="text-[10px] text-zinc-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {details && details.length > 0 && (
        <ul className="mt-3 flex-1 space-y-1 border-t border-zinc-800/50 pt-3">
          {details.map((d) => (
            <li key={d} className="flex items-start gap-1.5 text-xs text-zinc-500">
              <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
              <span className="font-mono">{d}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
