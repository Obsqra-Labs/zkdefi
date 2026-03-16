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
  Fingerprint,
} from "lucide-react";

import { SiteHeader } from "@/components/marketing/SiteHeader";
import { CapitalOSSection } from "@/components/marketing/CapitalOSSection";
import { LiveStatsBanner } from "@/components/marketing/LiveStatsBanner";
import { Reveal, RevealStagger } from "@/components/marketing/Reveal";

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
          1. HERO — dark, editorial, typographic confidence
      ═══════════════════════════════════════════════════════════════ */}
      <section className="section-dark relative overflow-hidden px-6 pb-32 pt-24 sm:pb-40 sm:pt-32">
        {/* Background grid pattern */}
        <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        {/* Glow orb */}
        <div className="hero-glow absolute -left-48 -top-48 sm:-left-24 sm:-top-24" aria-hidden="true" />

        <div className="relative mx-auto max-w-5xl">
          <Reveal delay={100}>
            <p className="mb-8 font-mono text-xs font-medium uppercase tracking-[0.25em] text-zinc-500">
              DeFi makes you choose: be private or be trusted.
            </p>
          </Reveal>

          <Reveal delay={200}>
            <h1 className="font-serif text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              <span className="text-white">
                Hide everything.
              </span>
              <br />
              <span className="text-emerald-400">
                Prove anything.
              </span>
            </h1>
          </Reveal>

          {/* The formula — typographic sculpture */}
          <Reveal delay={350}>
            <div className="mt-12 sm:mt-16">
              <p className="font-serif text-3xl font-bold tracking-tight text-zinc-300 sm:text-4xl md:text-5xl">
                trust = <span className="text-emerald-400">Σ</span>(receipts)<span className="text-zinc-500">*</span>
              </p>
              <p className="mt-3 font-serif text-sm italic text-zinc-600 sm:text-base">
                <span className="text-zinc-500">*</span>earned over time, never assumed
              </p>
            </div>
          </Reveal>

          <Reveal delay={450}>
            <p className="mt-10 max-w-2xl text-lg leading-relaxed text-zinc-400 sm:text-xl sm:leading-relaxed">
              Build an anonymous reputation anchored by ZK receipts.
              Your strategy stays hidden. Your AI agents prove they behaved.
              Your track record travels with you — without revealing who you are.
            </p>
          </Reveal>

          {/* Stats — editorial data display, massive gradient numbers */}
          <div className="mt-16 flex flex-wrap items-end gap-8 sm:gap-12 md:gap-16">
            {[
              { value: "11", label: "contracts" },
              { value: "31", label: "circuits" },
              { value: "3", label: "chains" },
              { value: "136+", label: "receipts" },
            ].map((s, i) => (
              <Reveal key={s.label} delay={550 + i * 100}>
                <div className="flex flex-col">
                  <span className="stat-gradient font-serif text-3xl font-black tabular-nums tracking-tight sm:text-4xl md:text-5xl">
                    {s.value}
                  </span>
                  <span className="mt-1 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-600">
                    {s.label}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>

          {/* CTAs */}
          <Reveal delay={700}>
            <div className="mt-14 flex flex-wrap items-center gap-4">
              <Link
                href="/agent"
                className="cta-glow inline-flex items-center gap-2.5 rounded-lg bg-emerald-600 px-7 py-3.5 text-sm font-semibold tracking-wide transition-all hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20"
              >
                Launch App
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="/test"
                className="inline-flex items-center gap-2.5 rounded-lg border border-zinc-700 px-7 py-3.5 text-sm font-medium text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-white"
              >
                Verify Every Claim
              </a>
              <a
                href="https://github.com/Obsqra-Labs/zkdefi"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
              >
                GitHub
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </Reveal>

          <Reveal delay={800}>
            <p className="mt-10 text-xs leading-relaxed text-zinc-700">
              <span className="text-zinc-500">zkde.fi</span> is the protocol.{" "}
              <a href="https://obsqra.xyz" target="_blank" rel="noopener noreferrer" className="text-zinc-600 underline decoration-zinc-800 underline-offset-2 hover:text-zinc-400">Obsqra Labs</a>{" "}
              builds it.{" "}
              <a href="https://starkforge.xyz" target="_blank" rel="noopener noreferrer" className="text-zinc-600 underline decoration-zinc-800 underline-offset-2 hover:text-zinc-400">StarkForge</a>{" "}
              is the proving layer underneath.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          2. THE PROOF FLOW — visual diagram, the product in one image
      ═══════════════════════════════════════════════════════════════ */}
      <div className="section-sep" aria-hidden="true" />
      <section className="bg-zinc-950 px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              How it works
            </p>
            <h2 className="font-serif text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
              Five steps. One receipt.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-500 sm:text-lg">
              Every action produces a cryptographic proof that feeds back into your reputation.
            </p>
          </Reveal>

          {/* Proof flow — 5 steps as refined cards with connecting dots */}
          <div className="mt-16 grid grid-cols-1 gap-0 sm:grid-cols-5">
            {[
              {
                num: "01",
                label: "Strategy",
                desc: "Your private conditions compile into a provable circuit",
                color: "text-zinc-400",
                accent: "border-zinc-700",
                dotColor: "bg-zinc-600",
              },
              {
                num: "02",
                label: "Proof",
                desc: "EZKL generates a Halo2 SNARK — conditions met, nothing revealed",
                color: "text-zinc-400",
                accent: "border-zinc-700",
                dotColor: "bg-zinc-600",
              },
              {
                num: "03",
                label: "Verify",
                desc: "Garaga checks the proof on-chain using pairing math",
                color: "text-zinc-400",
                accent: "border-zinc-700",
                dotColor: "bg-zinc-600",
              },
              {
                num: "04",
                label: "Execute",
                desc: "Capital moves only if both proof systems agree",
                color: "text-emerald-400",
                accent: "border-emerald-500/30",
                dotColor: "bg-emerald-500",
              },
              {
                num: "05",
                label: "Receipt",
                desc: "On-chain evidence feeds back into your reputation score",
                color: "text-emerald-400",
                accent: "border-emerald-500/30",
                dotColor: "bg-emerald-500",
              },
            ].map((step, i) => (
              <Reveal key={step.num} delay={i * 100}>
                <div className="relative flex flex-col">
                  {/* Connector dot on the top border */}
                  {i > 0 && (
                    <div className={`absolute -top-[5px] left-6 hidden h-2.5 w-2.5 rounded-full ${step.dotColor} ring-4 ring-zinc-950 sm:block`} />
                  )}
                  <div className={`border-t-2 ${step.accent} px-4 pb-6 pt-5 sm:px-5`}>
                    <span className="font-serif text-3xl font-bold tracking-tight text-zinc-800 sm:text-4xl">
                      {step.num}
                    </span>
                    <h3 className={`mt-2 text-sm font-bold uppercase tracking-wider ${step.color}`}>
                      {step.label}
                    </h3>
                    <p className="mt-2 font-mono text-[11px] leading-relaxed text-zinc-600">
                      {step.desc}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          3. THE LOOP — interactive demo  (CapitalOSSection)
             Show it, let them play.
      ═══════════════════════════════════════════════════════════════ */}
      <div className="section-sep" aria-hidden="true" />
      <section id="capital-os" className="scroll-mt-8 px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              Live Demo
            </p>
            <h2 className="mb-12 font-serif text-3xl font-bold tracking-tight sm:text-4xl">
              The Loop
            </h2>
          </Reveal>
          <Reveal delay={200}>
            <CapitalOSSection />
          </Reveal>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          4. THE PROBLEM + WHY NOW  (context for those who want it)
      ═══════════════════════════════════════════════════════════════ */}
      <div className="section-sep" aria-hidden="true" />
      <section className="px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-5xl">

          <Reveal>
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              The problem
            </p>
          </Reveal>

          {/* Problem / Insight side-by-side */}
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
            <Reveal delay={100}>
              <div>
                <h2 className="font-serif text-2xl font-bold leading-tight tracking-tight text-zinc-100 sm:text-3xl">
                  Transparency is the&nbsp;tax.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-zinc-400">
                  To use DeFi today, you reveal everything — what you&apos;re buying,
                  how much, and when. Others see it before you execute.
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    "Your trading strategy is visible to everyone",
                    "AI agents can't prove they're acting honestly",
                    "Your track record doesn't follow you between protocols",
                  ].map((line) => (
                    <div key={line} className="flex items-start gap-3 text-sm text-zinc-500">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            <Reveal delay={250}>
              <div>
                <h2 className="font-serif text-2xl font-bold leading-tight tracking-tight text-emerald-400 sm:text-3xl">
                  Privacy as&nbsp;control.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-zinc-400">
                  What if privacy didn&apos;t just hide information — but
                  <strong className="text-zinc-200"> controlled what&apos;s allowed to happen?</strong>{" "}
                  Proofs replace trust. Receipts replace promises.
                </p>
                <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
                  <pre className="font-mono text-xs leading-loose text-zinc-500">
{`your strategy  →  private
proof           →  "conditions met"
execution       →  capital moves
receipt         →  on-chain evidence`}
                  </pre>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Competitive diff */}
          <Reveal>
            <div className="mt-14 border-t border-zinc-800 pt-8">
              <p className="font-serif text-xl leading-relaxed text-zinc-300 sm:text-2xl">
                On-chain reputation scores exist. <strong className="text-emerald-400">ZK-proved reputation that travels cross-protocol without disclosure doesn&apos;t.</strong>
              </p>
            </div>
          </Reveal>

          {/* Why Now — 3 bullets */}
          <div className="mt-16">
            <Reveal>
              <p className="mb-6 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
                Why now
              </p>
            </Reveal>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {[
                {
                  title: "Privacy is becoming the default.",
                  body: "Every major L2 is shipping privacy features. The question isn't if DeFi goes private — it's who builds the proof layer first.",
                },
                {
                  title: "Proving costs dropped 100×.",
                  body: "S-two prover replaced Stone. Verifiable execution at scale is economically viable.",
                },
                {
                  title: "Agents are moving real money.",
                  body: "EigenLayer, Coinbase AgentKit, ElizaOS — none can prove their agents behaved. We can.",
                },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 100}>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">{item.title}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{item.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          5. HOW WE PROVE IT — massive typographic checks, the credibility moment
      ═══════════════════════════════════════════════════════════════ */}
      <div className="section-sep" aria-hidden="true" />
      <section className="section-dark px-6 py-28 sm:py-36">
        <div className="mx-auto max-w-5xl">

          <Reveal>
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              Dual verification
            </p>
            <h2 className="font-serif text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
              How We Prove It
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-500">
              Two independent proof systems check every claim.
              Both must pass. Neither can be faked.
            </p>
          </Reveal>

          {/* Check 1 — massive typographic statement */}
          <Reveal delay={200}>
            <div className="mt-20 border-t border-zinc-800 pt-10">
              <div className="flex items-start gap-6 sm:gap-10">
                <span className="font-serif text-6xl font-bold leading-none tracking-tighter text-zinc-800/50 sm:text-7xl md:text-[88px]">
                  1
                </span>
                <div className="pt-2 sm:pt-4">
                  <h3 className="font-serif text-2xl font-bold text-zinc-100 sm:text-3xl">
                    The math proof
                  </h3>
                  <p className="mt-1 font-mono text-xs text-blue-400">
                    Garaga verifies the SNARK on Starknet
                  </p>
                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
                    Your AI model runs off-chain and produces a cryptographic proof.
                    Garaga checks that proof on-chain using the same math that
                    secures Ethereum. If the math doesn&apos;t check out, nothing executes.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Check 2 — massive typographic statement */}
          <Reveal delay={100}>
            <div className="mt-16 border-t border-zinc-800 pt-10">
              <div className="flex items-start gap-6 sm:gap-10">
                <span className="font-serif text-6xl font-bold leading-none tracking-tighter text-zinc-800/50 sm:text-7xl md:text-[88px]">
                  2
                </span>
                <div className="pt-2 sm:pt-4">
                  <h3 className="font-serif text-2xl font-bold text-zinc-100 sm:text-3xl">
                    The execution proof
                  </h3>
                  <p className="mt-1 font-mono text-xs text-blue-400">
                    Stone wraps everything in a STARK
                  </p>
                  <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
                    The same prover that secures Starknet blocks wraps your
                    entire execution in a second proof. The first proof lives
                    inside this one. Both pass or nothing happens.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Settlement path */}
          <Reveal>
            <div className="mt-16 border-t border-zinc-800 pt-8">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
                Settlement path
              </p>
              <p className="mt-4 font-mono text-lg tracking-wide sm:text-xl">
                <span className="text-emerald-400">Madara L3</span>
                <span className="mx-2 text-zinc-700">→</span>
                <span className="text-blue-400">Starknet L2</span>
                <span className="mx-2 text-zinc-700">→</span>
                <span className="text-violet-400">Ethereum L1</span>
              </p>
              <p className="mt-2 text-sm text-zinc-600">
                136+ receipts on-chain. Every hash queryable via RPC.{" "}
                <a href="/test" className="text-emerald-400 underline decoration-emerald-400/30 underline-offset-2 hover:decoration-emerald-400">
                  Verify every claim →
                </a>
              </p>
            </div>
          </Reveal>

          {/* Trust modes — minimal */}
          <div className="mt-20 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 md:grid-cols-3">
            {TRUST_MODES.map((tm, i) => (
              <Reveal key={tm.mode} delay={i * 100}>
                <div className="h-full bg-zinc-950 p-6">
                  <h4 className="font-serif text-lg font-bold text-zinc-100">{tm.mode}</h4>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{tm.desc}</p>
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-zinc-700">
                    {tm.examples}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* How we're different */}
          <div className="mt-20">
            <Reveal>
              <p className="mb-8 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
                Competitive positioning
              </p>
            </Reveal>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {[
                {
                  title: "zkML proofs, not analytics",
                  body: "Cred Protocol, Spectral, and ArcX score wallets. We prove the score in ZK — it travels cross-protocol without revealing your data.",
                },
                {
                  title: "Agents gated, not just attested",
                  body: "EigenAI and Lagrange prove inference. We gate capital movement on it. The proof unlocks or blocks the trade.",
                },
                {
                  title: "Math, not hardware trust",
                  body: "TEE-based compute trusts the chip manufacturer. ZK proofs trust math. Post-Tornado-Cash, that distinction matters.",
                },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 100}>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">{item.title}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{item.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          {/* Why Starknet — same minimal treatment */}
          <div className="mt-20 border-t border-zinc-800 pt-10">
            <Reveal>
              <p className="mb-8 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
                Why Starknet
              </p>
            </Reveal>
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
              {[
                {
                  title: "Cheap proof verification",
                  desc: "Native STARK verification at L2 cost. The same math that secures Ethereum runs on-chain for pennies.",
                },
                {
                  title: "Private by design",
                  desc: "Cairo enforces rules without revealing them. Your strategy compiles into something provable, not readable.",
                },
                {
                  title: "Real computation",
                  desc: "ML models settle on-chain through the same proofs that secure Starknet blocks. S-two prover: 100× more efficient.",
                },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 100}>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-200">{item.title}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{item.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          6. WHAT'S LIVE — dashboard-style contracts + use cases
      ═══════════════════════════════════════════════════════════════ */}
      <div className="section-sep" aria-hidden="true" />
      <section className="px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              Deployed infrastructure
            </p>
            <h2 className="font-serif text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
              What&apos;s Live
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-500">
              11 contracts, 3 chains, 136+ receipts — everything below is deployed and queryable right now.
            </p>
          </Reveal>

          {/* Live stats — inline */}
          <Reveal delay={200}>
            <div className="mt-10 border-t border-zinc-800 pt-6">
              <LiveStatsBanner />
            </div>
          </Reveal>

          {/* Use cases — clean cards */}
          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
            {[
              {
                icon: <Shield className="h-5 w-5 text-emerald-400/60" />,
                title: "Move Money Privately",
                body: "Deposit, withdraw, and transfer without revealing amounts or destinations. Three privacy levels — from full proof to optimistic batching.",
                detail: "3 privacy tiers · All proved · Dark L3 settlement",
              },
              {
                icon: <Cpu className="h-5 w-5 text-blue-400/60" />,
                title: "AI Agents That Prove Their Work",
                body: "Every agent decision runs through 13 skill checks before execution. The agent can't act unless all proofs pass.",
                detail: "13 checks per trade · All must pass · Receipts on-chain",
              },
              {
                icon: <BarChart3 className="h-5 w-5 text-violet-400/60" />,
                title: "Predictions You Can Check",
                body: "Predictions committed on-chain before the outcome, then scored publicly. No cherry-picking. Every forecast has a receipt.",
                detail: "0.109 Brier score · 100% direction calls · 3 time horizons",
              },
            ].map((uc, i) => (
              <Reveal key={uc.title} delay={i * 120}>
                <div className="group rounded-lg border border-zinc-800/50 bg-zinc-900/20 p-6 transition-colors hover:border-zinc-700/80 hover:bg-zinc-900/40">
                  <div className="mb-3">{uc.icon}</div>
                  <h3 className="font-serif text-lg font-bold text-zinc-100">{uc.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{uc.body}</p>
                  <p className="mt-3 font-mono text-[10px] text-zinc-600">{uc.detail}</p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Tri-chain contracts — dashboard layout */}
          <div className="mt-20">
            <Reveal>
              <p className="mb-8 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
                Tri-chain deployment
              </p>
            </Reveal>
            <Reveal delay={150}>
              <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800 md:grid-cols-3">
              {/* Starknet L2 */}
              <div className="bg-zinc-950">
                <div className="border-b border-zinc-800 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">Starknet L2</span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-zinc-600">7 Cairo contracts</p>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {STARKNET_CONTRACTS.map((c) => (
                    <div key={c.name} className="flex items-center justify-between px-5 py-2.5">
                      <span className="text-xs font-medium text-zinc-300">{c.name}</span>
                      <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-600">{c.hash}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ethereum L1 */}
              <div className="bg-zinc-950">
                <div className="border-b border-zinc-800 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-400" />
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">Ethereum L1</span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-zinc-600">4 EVM contracts</p>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {ETHEREUM_CONTRACTS.map((c) => (
                    <div key={c.name} className="px-5 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-300">{c.name}</span>
                        <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-600">{c.hash}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-zinc-600">{c.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Madara L3 */}
              <div className="bg-zinc-950">
                <div className="border-b border-zinc-800 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">Madara L3</span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-zinc-600">OBSQRA_PROOF_CHAIN</p>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  <div className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-xs font-medium text-zinc-300">ObsqraFactRegistry</span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      <span className="font-mono text-[10px] text-emerald-400">Live</span>
                    </span>
                  </div>
                  <div className="px-5 py-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="font-serif text-xl font-bold text-zinc-200">5 s</span>
                        <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Block time</p>
                      </div>
                      <div>
                        <span className="font-serif text-xl font-bold text-zinc-200">0</span>
                        <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">Gas cost</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          7. ROADMAP  (clean timeline)
      ═══════════════════════════════════════════════════════════════ */}
      <div className="section-sep" aria-hidden="true" />
      <section className="px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              Progress
            </p>
            <h2 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">
              Roadmap
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-500">
              Where we are — and where we&apos;re going.
            </p>
          </Reveal>

          <div className="relative mt-14">
            <div className="absolute left-4 top-0 hidden h-full w-px bg-zinc-800 md:block" />

            <div className="space-y-8">
              {ROADMAP.map((phase, i) => (
                <Reveal key={phase.phase} delay={i * 100}>
                  <div className="relative md:pl-12">
                    <div
                    className={`absolute left-2.5 top-2 hidden h-3 w-3 rounded-full md:block ${
                      phase.status === "done"
                        ? "bg-emerald-400"
                        : phase.status === "active"
                          ? "bg-blue-400 ring-4 ring-blue-400/20"
                          : phase.status === "planned"
                            ? "bg-zinc-600"
                            : "bg-zinc-700"
                    }`}
                  />
                  <div className="border-t border-zinc-800 pt-6">
                    <div className="mb-3 flex items-center gap-3">
                      <h3 className="font-serif text-base font-bold text-zinc-200">{phase.phase}</h3>
                      <span
                        className={`font-mono text-[10px] uppercase tracking-widest ${
                          phase.status === "done"
                            ? "text-emerald-400"
                            : phase.status === "active"
                              ? "text-blue-400"
                              : "text-zinc-600"
                        }`}
                      >
                        {phase.status === "done"
                          ? "Complete"
                          : phase.status === "active"
                            ? "In Progress"
                            : "Next"}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {phase.items.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-500">
                          <CheckCircle2
                            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                              phase.status === "done"
                                ? "text-emerald-500/60"
                                : phase.status === "active"
                                  ? "text-blue-500/60"
                                  : "text-zinc-700"
                            }`}
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          8. CTA + FOOTER — dark close, editorial
      ═══════════════════════════════════════════════════════════════ */}
      <div className="section-sep" aria-hidden="true" />
      <section className="section-dark relative overflow-hidden px-6 py-28 sm:py-36">
        {/* Subtle bottom glow */}
        <div className="pointer-events-none absolute bottom-0 left-1/2 h-[400px] w-[800px] -translate-x-1/2 translate-y-1/2 rounded-full bg-emerald-500/[0.04] blur-[100px]" aria-hidden="true" />

        <div className="relative mx-auto max-w-3xl">
          <Reveal>
            <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              Get started
            </p>
            <h2 className="font-serif text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl">
              The infrastructure is live.<br />
              <span className="text-emerald-400">Build on it.</span>
            </h2>
          </Reveal>
          <Reveal delay={150}>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-zinc-500">
              API docs, circuit specs, and the open-source ModelBridge
              are all available. The infrastructure layer is StarkForge.
            </p>
          </Reveal>
          <Reveal delay={300}>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/docs"
                className="cta-glow inline-flex items-center gap-2.5 rounded-lg bg-white px-7 py-3.5 text-sm font-semibold text-zinc-950 transition-all hover:bg-zinc-200"
              >
                Documentation
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/Obsqra-Labs/zkdefi"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-7 py-3.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
              >
                GitHub
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <a
                href="https://starkforge.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
              >
                StarkForge
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </Reveal>
        </div>

        {/* Footer */}
        <Reveal>
          <div className="mx-auto mt-24 max-w-5xl border-t border-zinc-800 pt-10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-widest text-zinc-700">
              {["Starknet L2", "Ethereum L1", "Madara L3", "SNARK-in-STARK", "Open Source"].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-serif text-sm text-zinc-500">
                zkde.fi <span className="text-zinc-700">by</span> Obsqra Labs
              </span>
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="https://github.com/Obsqra-Labs/zkdefi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-zinc-700 transition-colors hover:text-zinc-400"
                >
                  github.com/Obsqra-Labs/zkdefi
                </a>
                <a
                  href="/docs/why.html"
                  className="font-mono text-[10px] text-zinc-700 transition-colors hover:text-emerald-400"
                >
                  Why we built this →
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
