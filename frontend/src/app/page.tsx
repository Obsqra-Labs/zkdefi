"use client";
// zkde.fi Landing Page - Premium Positioning
// "Private strategy. Provable execution."
// Positioned as the bridge between privacy protocols and deterministic execution

import Link from "next/link";
import { useState } from "react";
import {
  Shield,
  Lock,
  Eye,
  ArrowRight,
  ExternalLink,
  Zap,
  FileCheck,
  CheckCircle2,
  Code,
  Layers,
  TrendingUp,
  ChevronDown,
} from "lucide-react";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export default function Home() {
  const [expandedTier, setExpandedTier] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const featuredProducts = [
    {
      name: "Privacy Pools",
      href: "/products/privacy-pools",
      copy: "Tiered commitment and nullifier pools for private capital entry and exit.",
      accent: "border-emerald-500/30 text-emerald-300",
    },
    {
      name: "Dark Ledger",
      href: "/products/dark-ledger",
      copy: "Private settlement rail for execution paths that minimize public traces.",
      accent: "border-violet-500/30 text-violet-300",
    },
    {
      name: "Risk Passport",
      href: "/products/risk-passport",
      copy: "Portable proof-backed risk and reputation layer for policy-aware finance.",
      accent: "border-cyan-500/30 text-cyan-300",
    },
    {
      name: "Private Governance",
      href: "/products/private-governance",
      copy: "Private voting and proposal workflows with cryptographic integrity.",
      accent: "border-amber-500/30 text-amber-300",
    },
  ];

  const privacyTiers = [
    {
      tier: "Tier 1",
      name: "Unlinkability",
      desc: "Breaks deposit↔withdraw links. Addresses still visible.",
      color: "emerald",
      forWho: "DeFi Traders & Retail Users",
      painPoints: [
        "Competitors can track your trading patterns",
        "Market makers front-run based on your address history",
        "Whale watching tools expose your positions",
      ],
      benefits: [
        "Hide trading strategy from competitors",
        "Prevent MEV-based front-running",
        "Avoid personal security risks from address tracking",
      ],
      useCase: "A trader wants to buy 1000 ETH without market makers seeing the pattern and front-running before execution. Tier 1 breaks the link between deposit and withdrawal, so observers can't tell the transaction came from that address.",
      complexity: "Simple, minimal on-chain footprint",
    },
    {
      tier: "Tier 2",
      name: "Hidden Withdrawer",
      desc: "Relayer hides sender identity. Recipient visible.",
      color: "violet",
      forWho: "Protocol Teams & Treasury Managers",
      painPoints: [
        "Treasury movements are publicly visible, inviting attacks",
        "Large transfers trigger price movements when detected",
        "Regulators can track organizational funding flows",
      ],
      benefits: [
        "Hide treasury operations from attackers",
        "Execute large transfers without slippage impact",
        "Obscure fund flows for operational security",
      ],
      useCase: "A DAO treasury needs to transfer governance tokens to fund a new proposal without moving the market. Tier 2 hides that the transfer came from the treasury, but the recipient is known.",
      complexity: "Requires relayer infrastructure",
    },
    {
      tier: "Tier 3",
      name: "Hidden Depositor",
      desc: "Relayer hides depositor. Withdrawal chain visible.",
      color: "cyan",
      forWho: "Institutions & Compliance Officers",
      painPoints: [
        "Regulators require knowing withdrawal destinations",
        "Source fund tracking is mandatory for compliance",
        "Circular tracking prevents regulatory scrutiny",
      ],
      benefits: [
        "Meet regulatory 'know your customer' requirements",
        "Hide fund sources while tracking goes to known recipients",
        "Compliance-friendly privacy (not source-hiding, not fully dark)",
      ],
      useCase: "An institution needs to settle trades but hide which portfolio it came from, while staying compliant by showing clear withdrawal trails. Tier 3 hides the source but keeps withdrawal audit trails.",
      complexity: "Compliance-grade privacy",
    },
    {
      tier: "Tier 2H",
      name: "Hashed Claims",
      desc: "On-chain claim hides recipient & amount. Payout via escrow ledger.",
      color: "emerald",
      forWho: "Quants, Algo Traders & Hedging Funds",
      painPoints: [
        "Contract execution amounts are visible on-chain",
        "Arbitrage opportunities can be ripped by watching contracts",
        "Complex strategies leak through transaction amounts",
      ],
      benefits: [
        "Hide execution amounts and recipients until settlement",
        "Prevent arbitrageurs from extracting MEV mid-execution",
        "Hashed claims verify without exposing details",
      ],
      useCase: "A quant fund executes a complex arbitrage across 5 pools. Tier 2H hides the amounts and the recipient addresses on-chain via a hashed claim, but the escrow ledger confirms settlement privately.",
      complexity: "Escrow-based settlement, advanced",
    },
    {
      tier: "Coming",
      name: "Internal Accounting",
      desc: "Private settlement. No public ERC-20 transfers. Full confidentiality.",
      color: "violet",
      forWho: "VIP Traders, Proprietary Desks & Dark Pools",
      painPoints: [
        "Even hashed claims leave on-chain footprint",
        "Full execution details must remain completely hidden",
        "Fully private settlement is the ultimate requirement",
      ],
      benefits: [
        "No on-chain traces of execution, settlement, or amounts",
        "Complete confidentiality for ultra-large trades",
        "Internal ledger keeps records, public blockchain shows nothing",
      ],
      useCase: "A proprietary trading desk executes a $100M+ trade where zero on-chain evidence should exist. Internal Accounting keeps everything off the public ledger—settlement happens privately with full audit trail.",
      complexity: "Full confidentiality (no public transfers)",
    },
  ];

  return (
    <main className="min-h-screen flex flex-col bg-zinc-950 text-white">
      <SiteHeader />

      {/* HERO SECTION */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/30 via-transparent to-violet-950/30" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.12),transparent_50%)]" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-block mb-6 px-4 py-2 rounded-full bg-emerald-600/10 border border-emerald-500/30">
            <span className="text-emerald-400 text-sm font-semibold">The privacy-execution layer for Starknet</span>
          </div>
          
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6 tracking-tight">
            <span className="block mb-2">Private strategy.</span>
            <span className="bg-gradient-to-r from-emerald-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">Provable execution.</span>
          </h1>
          
          <p className="text-xl sm:text-2xl text-zinc-300 font-medium mb-8 max-w-3xl mx-auto leading-relaxed">
            Build and automate on Starknet with an execution layer where actions are private and constraints are provable.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/agent"
              prefetch={false}
              className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-emerald-500/25 flex items-center gap-2"
            >
              Launch App
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 border border-zinc-700 hover:border-emerald-500/50 rounded-lg font-medium transition-all hover:bg-zinc-900/50 flex items-center gap-2"
            >
              Explore Documentation
              <ExternalLink className="w-4 h-4" />
            </a>
            <a
              href="#developers"
              className="px-8 py-4 border border-zinc-700 hover:border-emerald-500/50 rounded-lg font-medium transition-all hover:bg-zinc-900/50 flex items-center gap-2"
            >
              For Developers
              <Code className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* FEATURED PRODUCTS */}
      <section className="px-6 py-12 border-t border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
            <h2 className="text-2xl font-bold">Featured product surfaces</h2>
            <Link href="/products" prefetch={false} className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              View all products
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {featuredProducts.map((product) => (
              <Link
                key={product.name}
                href={product.href}
                prefetch={false}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 hover:border-zinc-600 transition-colors"
              >
                <div className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${product.accent}`}>
                  Product
                </div>
                <h3 className="text-lg font-semibold mt-3">{product.name}</h3>
                <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{product.copy}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm text-emerald-300">
                  Explore
                  <ArrowRight className="w-4 h-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* THE PROBLEM */}
      <section className="px-6 py-20 border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6 text-center">The problem with transparent chains</h2>
          <div className="space-y-4 text-zinc-300 text-lg leading-relaxed">
            <p>
              <span className="text-emerald-400 font-semibold">99% of blockchains put your financial life on display.</span> Every transaction exposes who called, what they called, and token movements. This breaks automation: strategies leak. MEV bots extract. Competitive edges vanish.
            </p>
            <p>
              As AI agents and complex strategies move on-chain, the need for <span className="text-emerald-400 font-semibold">privacy with policy enforcement</span> becomes critical. You need to hide your intent. But the protocol still needs to prove your execution is safe.
            </p>
            <p>
              Most privacy protocols solve hiding. Few solve provable execution. zkde.fi does both.
            </p>
          </div>
        </div>
      </section>

      {/* THE SOLUTION - KEY DIFFERENTIATORS */}
      <section id="solution" className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">Why zkde.fi is different</h2>
          <p className="text-center text-zinc-400 mb-16 max-w-2xl mx-auto">Four capabilities that no other privacy protocol combines.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* PROGRAMMABLE PRIVACY */}
            <div className="rounded-2xl border border-zinc-800 p-8 bg-zinc-950/50 hover:border-emerald-500/30 transition-all hover:shadow-lg hover:shadow-emerald-500/10">
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 flex items-center justify-center mb-5">
                <Lock className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-white">Programmable Privacy</h3>
              <p className="text-zinc-400 mb-4 text-sm leading-relaxed">
                You choose how much to hide. Escalating tiers from unlinkability (break deposit↔withdraw links) to hashed claims (hidden recipient & amount) to internal accounting (coming soon—private settlement with no public transfers).
              </p>
              <p className="text-emerald-400 text-xs font-semibold">Unlike simple mixers. You get policy, not just pooling.</p>
              <Link href="/agent?v=vault" prefetch={false} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium mt-3 transition-colors">
                Explore in Vault <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {/* PROOF-GATED EXECUTION */}
            <div className="rounded-2xl border border-zinc-800 p-8 bg-zinc-950/50 hover:border-violet-500/30 transition-all hover:shadow-lg hover:shadow-violet-500/10">
              <div className="w-12 h-12 rounded-xl bg-violet-600/20 flex items-center justify-center mb-5">
                <FileCheck className="w-6 h-6 text-violet-400" />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-white">Proof-Gated Execution</h3>
              <p className="text-zinc-400 mb-4 text-sm leading-relaxed">
                Execution only happens when a zero-knowledge proof verifies your constraints (risk scores, portfolio rules, policy). If you can prove it, the contract executes. No proof = no execution. Deterministic. Trustless.
              </p>
              <p className="text-violet-400 text-xs font-semibold">Unique among privacy protocols. Privacy + policy enforcement.</p>
              <Link href="/agent?v=brain&sub=pipeline" prefetch={false} className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 font-medium mt-3 transition-colors">
                View Pipeline <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {/* RISK PASSPORT */}
            <div className="rounded-2xl border border-zinc-800 p-8 bg-zinc-950/50 hover:border-cyan-500/30 transition-all hover:shadow-lg hover:shadow-cyan-500/10">
              <div className="w-12 h-12 rounded-xl bg-cyan-600/20 flex items-center justify-center mb-5">
                <TrendingUp className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-white">Risk Passport</h3>
              <p className="text-zinc-400 mb-4 text-sm leading-relaxed">
                A portable, cryptographically verifiable proof object summarizing your portfolio health and risk behavior. Other protocols read your score and enforce policy—without accessing sensitive data.
              </p>
              <p className="text-cyan-400 text-xs font-semibold">Beyond dashboards. A programmable constraint primitive.</p>
              <Link href="/profile" prefetch={false} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium mt-3 transition-colors">
                View Profile <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {/* STARKNET NATIVE */}
            <div className="rounded-2xl border border-zinc-800 p-8 bg-zinc-950/50 hover:border-emerald-500/30 transition-all hover:shadow-lg hover:shadow-emerald-500/10">
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 flex items-center justify-center mb-5">
                <Layers className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-white">Starknet-Native & Composable</h3>
              <p className="text-zinc-400 mb-4 text-sm leading-relaxed">
                Built entirely on Starknet. Integrates with account abstraction, session keys, zkML co-processors, and existing DeFi tools. No bridges. No isolated chains. Full on-chain composability.
              </p>
              <p className="text-emerald-400 text-xs font-semibold">Like Railgun&apos;s on-chain simplicity. For Starknet.</p>
              <Link href="/agent?v=brain&sub=models" prefetch={false} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium mt-3 transition-colors">
                Explore Models <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* PRIVACY TIERS VISUAL LADDER */}
      <section className="px-6 py-20 border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">Privacy tiers: Your choice</h2>
          <p className="text-center text-zinc-400 mb-12">Choose the level of privacy that fits your use case. Click any tier to see who needs it and what problems it solves.</p>
          
          <div className="space-y-3">
            {privacyTiers.map((item, idx) => {
              const isExpanded = expandedTier === item.tier;
              const colorMap: Record<string, { border: string; text: string; bg: string; badge: string }> = {
                emerald: { border: "border-emerald-500/50", text: "text-emerald-300", bg: "bg-emerald-500/10", badge: "bg-emerald-500/20 text-emerald-300" },
                violet: { border: "border-violet-500/50", text: "text-violet-300", bg: "bg-violet-500/10", badge: "bg-violet-500/20 text-violet-300" },
                cyan: { border: "border-cyan-500/50", text: "text-cyan-300", bg: "bg-cyan-500/10", badge: "bg-cyan-500/20 text-cyan-300" },
              };
              const style = colorMap[item.color] || colorMap.emerald;

              return (
                <div
                  key={idx}
                  className={`border-l-4 ${style.border} rounded-r-lg bg-zinc-950/50 hover:bg-zinc-900/50 transition-all overflow-hidden`}
                >
                  <button
                    onClick={() => setExpandedTier(isExpanded ? null : item.tier)}
                    className="w-full px-6 py-4 flex items-start justify-between hover:bg-zinc-900/50 transition-colors text-left"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-zinc-500">{item.tier}</div>
                      <h3 className={`text-lg font-semibold ${style.text}`}>{item.name}</h3>
                      <p className="text-zinc-400 text-sm mt-1">{item.desc}</p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      {item.tier === "Coming" && (
                        <span className={`text-xs px-3 py-1 rounded-full ${style.badge} font-semibold whitespace-nowrap`}>Coming soon</span>
                      )}
                      <ChevronDown
                        className={`w-5 h-5 text-zinc-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
                  </button>

                  {/* EXPANDED CONTENT */}
                  {isExpanded && (
                    <div className={`px-6 pb-6 pt-2 border-t ${style.border} space-y-6`}>
                      {/* FOR WHO */}
                      <div>
                        <div className={`text-sm font-semibold ${style.text} mb-2 flex items-center gap-2`}>
                          <Eye className="w-4 h-4" />
                          For: {item.forWho}
                        </div>
                      </div>

                      {/* PAIN POINTS */}
                      <div>
                        <div className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                          <Zap className="w-4 h-4 text-orange-400" />
                          Problems it solves:
                        </div>
                        <ul className="space-y-2">
                          {item.painPoints.map((point, i) => (
                            <li key={i} className="text-sm text-zinc-400 flex gap-3">
                              <span className="text-orange-500 font-bold">•</span>
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* BENEFITS */}
                      <div>
                        <div className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          What you get:
                        </div>
                        <ul className="space-y-2">
                          {item.benefits.map((benefit, i) => (
                            <li key={i} className="text-sm text-zinc-400 flex gap-3">
                              <span className="text-emerald-500 font-bold">✓</span>
                              <span>{benefit}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* USE CASE */}
                      <div>
                        <div className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-2">
                          <Layers className="w-4 h-4 text-violet-400" />
                          Real-world example:
                        </div>
                        <p className="text-sm text-zinc-400 italic">{item.useCase}</p>
                      </div>

                      {/* COMPLEXITY */}
                      <div className="pt-4 border-t border-zinc-800">
                        <div className={`text-xs px-3 py-1.5 rounded-full w-fit ${style.bg} ${style.text}`}>
                          Complexity: {item.complexity}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-12 p-6 rounded-lg border border-zinc-800 bg-zinc-950/50">
            <p className="text-zinc-400 mb-4 text-center">
              <span className="font-semibold text-white">Escalating privacy</span> as you move down the tiers. Start with what you need, upgrade as your use case requires.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-center text-xs text-zinc-500">
              <div>Simple link-breaking</div>
              <div>→</div>
              <div>Sender hiding</div>
              <div>→</div>
              <div>Full confidentiality</div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-12 text-center">How it works: Three steps</h2>
          {(() => {
            const flowSteps = [
              {
                title: "Set constraints",
                short: "Define your risk limits, portfolio rules, and what your agent can do.",
                detail: "Configure maximum position sizes, risk score thresholds, allowed adapters (Ekubo, Vesu, Staking), and slippage bounds. These constraints are encoded as circuit inputs for your Groth16 proof.",
                privacy: "Constraints are private witnesses — only the pass/fail result is visible on-chain.",
                link: "/agent?v=brain&sub=agent",
                linkText: "Configure in Brain",
              },
              {
                title: "Generate proof",
                short: "Off-chain prover runs your logic (STARK + Groth16). Proofs bind via Fact Registry.",
                detail: "The prover evaluates zkML risk models (Cairo perceptron, anomaly detector, slippage bound) against your constraints. A Groth16 proof on BN254 is generated in ~10-15 seconds, attesting all checks passed.",
                privacy: "Proof reveals nothing about your positions, strategy, or risk profile — only that constraints are satisfied.",
                link: "/agent?v=brain&sub=pipeline",
                linkText: "View Pipeline",
              },
              {
                title: "Execute",
                short: "Contract verifies proofs. Valid = execution. Invalid = revert. Deterministic.",
                detail: "The Garaga verifier contract checks the proof against the VaultController's policy root. Valid proofs trigger execution through adapters (Ekubo LP, lending, staking). A ConstraintReceipt is produced on-chain.",
                privacy: "Execution uses shielded vault balances — adapters see a commitment, not a wallet address or balance.",
                link: "/agent?v=vault&sub=activity",
                linkText: "View Activity",
              },
            ];
            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {flowSteps.map((step, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveStep(idx)}
                      className={`text-left rounded-2xl border p-6 transition-all duration-300 ${
                        activeStep === idx
                          ? "border-emerald-500/50 bg-emerald-950/20 shadow-lg shadow-emerald-500/10"
                          : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700"
                      }`}
                    >
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 font-bold text-xl transition-colors duration-300 ${
                        activeStep === idx ? "bg-emerald-600/40 text-emerald-300" : "bg-emerald-600/20 text-emerald-400"
                      }`}>
                        {idx + 1}
                      </div>
                      <h3 className="text-lg font-semibold mb-3 text-white text-center">{step.title}</h3>
                      <p className="text-zinc-400 text-sm leading-relaxed text-center">{step.short}</p>
                    </button>
                  ))}
                </div>

                <div className="mt-8 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-6 max-w-2xl mx-auto">
                  <p className="text-sm text-zinc-300 leading-relaxed mb-4">{flowSteps[activeStep].detail}</p>
                  <div className="flex items-start gap-2 mb-4">
                    <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-400/80">{flowSteps[activeStep].privacy}</p>
                  </div>
                  <Link
                    href={flowSteps[activeStep].link}
                    prefetch={false}
                    className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                  >
                    {flowSteps[activeStep].linkText}
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </>
            );
          })()}
        </div>
      </section>

      {/* RISK PASSPORT DEEP DIVE */}
      <section className="px-6 py-20 border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6 text-center">Risk Passport: A new primitive</h2>
          <div className="rounded-2xl border border-cyan-500/30 p-8 bg-cyan-950/10">
            <p className="text-zinc-200 text-lg leading-relaxed mb-6">
              The Risk Passport is not a dashboard. It&apos;s a <span className="text-cyan-300 font-semibold">cryptographically verifiable attestation</span> of your portfolio health and risk behavior. Other protocols can read your score and enforce policy without accessing sensitive data.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-semibold">Portable</p>
                    <p className="text-zinc-400 text-sm">Move between protocols while keeping your score.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-semibold">Trustless</p>
                    <p className="text-zinc-400 text-sm">Cryptographic proof. No intermediaries.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-semibold">Programmable</p>
                    <p className="text-zinc-400 text-sm">Other contracts gate actions on your score.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-white font-semibold">Private</p>
                    <p className="text-zinc-400 text-sm">Your strategy stays hidden. Score is public.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARISON TABLE */}
      <section className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">How zkde.fi compares</h2>
          <p className="text-center text-zinc-400 mb-12">zkde.fi isn&apos;t a mixer or a new chain. It&apos;s the privacy-execution layer for Starknet.</p>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left py-4 px-4 font-semibold text-white">Tool</th>
                  <th className="text-left py-4 px-4 font-semibold text-white">Strengths</th>
                  <th className="text-left py-4 px-4 font-semibold text-white">Limitations</th>
                  <th className="text-left py-4 px-4 font-semibold text-emerald-400">zkde.fi</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-800 hover:bg-zinc-900/30 transition-colors">
                  <td className="py-4 px-4 font-semibold text-zinc-200">Mixers (Tornado)</td>
                  <td className="py-4 px-4 text-zinc-400">Hide deposit↔withdraw links</td>
                  <td className="py-4 px-4 text-zinc-400">No execution gating, no strategy privacy</td>
                  <td className="py-4 px-4 text-emerald-400">+ Proof-gated execution + programmable privacy</td>
                </tr>
                <tr className="border-b border-zinc-800 hover:bg-zinc-900/30 transition-colors">
                  <td className="py-4 px-4 font-semibold text-zinc-200">Privacy chains (Secret, Aleo)</td>
                  <td className="py-4 px-4 text-zinc-400">Full privacy smart contracts</td>
                  <td className="py-4 px-4 text-zinc-400">Requires new chain; limited Starknet composability</td>
                  <td className="py-4 px-4 text-emerald-400">+ Native to Starknet + full DeFi integration</td>
                </tr>
                <tr className="hover:bg-zinc-900/30 transition-colors">
                  <td className="py-4 px-4 font-semibold text-zinc-200">Shielded pools (Railgun)</td>
                  <td className="py-4 px-4 text-zinc-400">On-chain privacy + view keys</td>
                  <td className="py-4 px-4 text-zinc-400">No deterministic policy enforcement; identity/amount leaks</td>
                  <td className="py-4 px-4 text-emerald-400">+ Proof-gated execution + risk passports + escrow settlement</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section className="px-6 py-20 border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">Who it&apos;s for</h2>
          <p className="text-center text-zinc-400 mb-12">zkde.fi solves different problems for different users.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-zinc-800 p-6 hover:border-emerald-500/30 transition-all hover:bg-zinc-900/50">
              <div className="flex gap-3 mb-3">
                <Zap className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <h3 className="text-lg font-semibold text-white">Private Traders</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Hide your strategy from MEV bots and block builders. Execute trades that only work in private. Keep your returns.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 p-6 hover:border-violet-500/30 transition-all hover:bg-zinc-900/50">
              <div className="flex gap-3 mb-3">
                <Brain className="w-5 h-5 text-violet-400 flex-shrink-0" />
                <h3 className="text-lg font-semibold text-white">Quant Funds & AI Agents</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Program complex strategies with deterministic risk gates. Automate confidently. Prove compliance without exposure.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 p-6 hover:border-cyan-500/30 transition-all hover:bg-zinc-900/50">
              <div className="flex gap-3 mb-3">
                <Code className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                <h3 className="text-lg font-semibold text-white">Protocols & DAOs</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Embed proof-gated execution and risk passports into your dApps. Add privacy and policy to your operations.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 p-6 hover:border-emerald-500/30 transition-all hover:bg-zinc-900/50">
              <div className="flex gap-3 mb-3">
                <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <h3 className="text-lg font-semibold text-white">Institutions & Compliance</h3>
              </div>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Achieve privacy without sacrificing policy enforcement or auditability. Proof-backed compliance. Full transparency.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DEVELOPERS */}
      <section id="developers" className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">For developers</h2>
          <p className="text-center text-zinc-400 mb-12">Build on top of zkde.fi&apos;s proof-gated execution and risk primitives.</p>
          
          <div className="rounded-2xl border border-zinc-800 p-8 bg-zinc-950/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <h3 className="text-lg font-semibold text-emerald-300 mb-3">SDK & Templates</h3>
                <p className="text-zinc-400 text-sm leading-relaxed mb-4">
                  Ready-to-use contract templates and SDKs for integrating proof-gated execution into your dApp.
                </p>
                <a href="https://github.com/obsqra-labs/zkdefi" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 text-sm font-semibold inline-flex items-center gap-1">
                  GitHub <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-violet-300 mb-3">Documentation</h3>
                <p className="text-zinc-400 text-sm leading-relaxed mb-4">
                  Complete guides on privacy tiers, risk passports, proof generation, and Starknet composability.
                </p>
                <a href="/docs" className="text-violet-400 hover:text-violet-300 text-sm font-semibold inline-flex items-center gap-1">
                  Read docs <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-cyan-300 mb-3">Tutorials & Examples</h3>
                <p className="text-zinc-400 text-sm leading-relaxed mb-4">
                  Build your first proof-gated contract, integrate risk passports, and compose with Starknet DeFi.
                </p>
                <a href="/docs" className="text-cyan-400 hover:text-cyan-300 text-sm font-semibold inline-flex items-center gap-1">
                  Explore tutorials <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          <p className="text-center text-zinc-400 mt-8">
            Full Starknet composability. Account abstraction. Session keys. Integration with all Starknet DeFi.
          </p>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-6 py-24 border-t border-zinc-800">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to execute privately?</h2>
          <p className="text-xl text-zinc-300 mb-10">
            Experience private, provable DeFi on Starknet. Launch zkde.fi now.
          </p>
          <div className="flex flex-col gap-4">
            <Link
              href="/agent"
              prefetch={false}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-emerald-500/25"
            >
              Launch App
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="https://discord.gg/obsqra"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-zinc-300 text-sm font-semibold"
            >
              Join our community
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-800 px-6 py-8 bg-zinc-950">
        <div className="max-w-7xl mx-auto text-center space-y-3">
          <p className="text-sm text-zinc-400">
            <span className="font-semibold text-zinc-300">zkde.fi</span>
            {" — private strategy. provable execution."}
          </p>
          <p className="text-xs text-zinc-500">
            Built by <a href="https://obsqra.xyz" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 transition-colors">Obsqra Labs</a> · Starknet Sepolia · Open source
          </p>
          <div className="flex items-center justify-center gap-4 pt-4 flex-wrap text-xs text-zinc-500">
            <a href="https://github.com/obsqra-labs/zkdefi" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">GitHub</a>
            <a href="/docs" className="hover:text-zinc-300 transition-colors">Docs</a>
            <a href="https://zkd.app" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">zkd.app</a>
            <Link href="/privacy" className="hover:text-zinc-300 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-zinc-300 transition-colors">Terms</Link>
            <span className="text-zinc-700">Apache-2.0</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

// Helper icon component
function Brain(props: any) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m3.34-5H2m15.66-2v5m-5.66 0v5" />
    </svg>
  );
}
