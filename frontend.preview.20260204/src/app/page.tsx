"use client";

import Link from "next/link";
import { Shield, Lock, Eye, ArrowRight, CheckCircle2, ExternalLink, Zap, Users, FileCheck } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-surface-0 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg">zkde.fi</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/agent" className="text-sm text-zinc-400 hover:text-white transition-colors">Dashboard</Link>
            <a href="https://docs.zkde.fi" target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-400 hover:text-white transition-colors">Docs</a>
            <a href="https://github.com/obsqra-labs/zkdefi" target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-400 hover:text-white transition-colors">GitHub</a>
          </nav>
          <Link
            href="/agent"
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-emerald-500/20 flex items-center gap-2"
          >
            Launch App
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 relative overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/30 via-transparent to-violet-950/30" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.15),transparent_50%)]" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <p className="text-xs font-mono text-zinc-500 tracking-wider mb-4 uppercase">
            Starknet Re{"{define}"} Hackathon · Privacy track
          </p>
          
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 mb-8">
            <span className="text-sm font-mono text-emerald-400">zkDE + GATE</span>
            <span className="text-xs text-zinc-500">Zero-Knowledge Deterministic Engine + Governed Autonomous Trustless Execution</span>
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6 tracking-tight">
            <span className="bg-gradient-to-r from-white via-emerald-100 to-white bg-clip-text text-transparent">
              Your DeFi.
            </span>
            <br />
            <span className="bg-gradient-to-r from-emerald-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
              Invisible. Verifiable.
            </span>
          </h1>

          <p className="text-xl text-zinc-300 mb-6 leading-relaxed max-w-2xl mx-auto">
            Proof-gated autonomous agent for private DeFi on Starknet. Delegate once via session keys. Every action verified on-chain.
          </p>
          
          <p className="text-lg text-emerald-400/80 font-mono mb-10">
            No proof, no execution.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/agent"
              className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-emerald-500/25 flex items-center gap-2"
            >
              Launch App
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="https://docs.zkde.fi"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 border border-zinc-700 hover:border-emerald-500/50 rounded-lg font-medium transition-all flex items-center gap-2"
            >
              Read the Docs
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* What We're Building */}
      <section className="px-6 py-16 border-t border-zinc-800 bg-zinc-950/50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4 text-zinc-200">Trustless AI as a New Asset Class</h2>
          <p className="text-zinc-400 leading-relaxed max-w-3xl mx-auto">
            We're building infrastructure for AI-driven execution that doesn't rely on "trust me." Every decision is cryptographically verified before it touches the chain. zkde.fi is the first app in this class — a privacy-preserving autonomous agent that proves its decisions are correct without revealing your strategy.
          </p>
        </div>
      </section>

      {/* Privacy Pillars */}
      <section className="px-6 py-20 border-t border-zinc-800">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Privacy by Design</h2>
            <p className="text-zinc-400 max-w-2xl mx-auto">
              Three pillars of privacy in the zkDE engine. GATE defines how agents run — governed by proof.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="rounded-2xl border border-zinc-800 p-8 hover:border-emerald-500/30 transition-all group bg-zinc-900/50">
              <div className="w-14 h-14 rounded-xl bg-emerald-600/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Shield className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Intent Hiding</h3>
              <p className="text-zinc-400 leading-relaxed">Agent decisions stay hidden until execution. No broadcast until proven valid. MEV and front-running protection built in.</p>
            </div>

            <div className="rounded-2xl border border-zinc-800 p-8 hover:border-violet-500/30 transition-all group bg-zinc-900/50">
              <div className="w-14 h-14 rounded-xl bg-violet-600/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Lock className="w-7 h-7 text-violet-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Confidential Transactions</h3>
              <p className="text-zinc-400 leading-relaxed">Amount-hiding transfers using Garaga Groth16. Only commitments visible on-chain. Your balance stays private.</p>
            </div>

            <div className="rounded-2xl border border-zinc-800 p-8 hover:border-cyan-500/30 transition-all group bg-zinc-900/50">
              <div className="w-14 h-14 rounded-xl bg-cyan-600/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Eye className="w-7 h-7 text-cyan-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Selective Disclosure</h3>
              <p className="text-zinc-400 leading-relaxed">Prove compliance without revealing strategy. Show you followed the rules without exposing your full history.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-6 py-20 border-t border-zinc-800 bg-zinc-950/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-zinc-400">zkDE is the engine. GATE is the standard. Proof-gated execution unlocks trustless AI.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="relative rounded-2xl border border-zinc-800 p-8 text-center bg-zinc-900/50">
              <div className="w-12 h-12 rounded-full bg-emerald-600 flex items-center justify-center mx-auto mb-4">
                <span className="text-xl font-bold">1</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">Set Constraints</h3>
              <p className="text-sm text-zinc-400">Define max position, allowed protocols, risk limits. Grant a session key once.</p>
            </div>

            <div className="relative rounded-2xl border border-zinc-800 p-8 text-center bg-zinc-900/50">
              <div className="w-12 h-12 rounded-full bg-emerald-600 flex items-center justify-center mx-auto mb-4">
                <span className="text-xl font-bold">2</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">Agent Decides</h3>
              <p className="text-sm text-zinc-400">zkML models (risk + anomaly) gate decisions. Proof generated for every action.</p>
            </div>

            <div className="relative rounded-2xl border border-zinc-800 p-8 text-center bg-zinc-900/50">
              <div className="w-12 h-12 rounded-full bg-emerald-600 flex items-center justify-center mx-auto mb-4">
                <span className="text-xl font-bold">3</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">Verified Execution</h3>
              <p className="text-sm text-zinc-400">Contract checks proof on-chain. No proof, no execution. Receipt stored for audit.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="px-6 py-16 border-t border-zinc-800">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-2">Hybrid Proof System</h2>
            <p className="text-zinc-500">Each proof type optimized for its purpose.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-zinc-800 p-6 bg-zinc-900/50">
              <div className="flex items-center gap-3 mb-4">
                <Zap className="w-5 h-5 text-violet-400" />
                <span className="font-semibold">Privacy Layer</span>
              </div>
              <p className="text-sm text-zinc-400 mb-2">Garaga (Groth16/SNARK)</p>
              <p className="text-xs text-zinc-500">zkML proofs, confidential transfers. Hides model outputs and amounts.</p>
            </div>
            
            <div className="rounded-xl border border-zinc-800 p-6 bg-zinc-900/50">
              <div className="flex items-center gap-3 mb-4">
                <FileCheck className="w-5 h-5 text-emerald-400" />
                <span className="font-semibold">Execution Layer</span>
              </div>
              <p className="text-sm text-zinc-400 mb-2">Integrity (STARK)</p>
              <p className="text-xs text-zinc-500">Constraint proofs, receipts. Native Starknet verification, no trusted setup.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Indicators */}
      <section className="px-6 py-12 border-t border-zinc-800 bg-zinc-950/50">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Starknet Sepolia</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Open source</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Integrity + Garaga</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>zkDE + GATE</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Obsqra Labs</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-6 py-8">
        <div className="max-w-7xl mx-auto text-center space-y-3">
          <p className="text-sm text-zinc-400">
            <span className="font-semibold">zkde.fi</span> by{" "}
            <a href="https://obsqra.xyz" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">
              Obsqra Labs
            </a>
          </p>
          <p className="text-xs text-zinc-500 max-w-lg mx-auto">
            zkDE (Zero-Knowledge Deterministic Engine) is the infrastructure. GATE (Governed Autonomous Trustless Execution) is the agent standard. zkde.fi is the first GATE-compatible app.
          </p>
          <div className="flex items-center justify-center gap-4 pt-2 flex-wrap">
            <a href="https://github.com/obsqra-labs/zkdefi" target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-500 hover:text-zinc-300">GitHub</a>
            <span className="text-zinc-700">|</span>
            <a href="https://docs.zkde.fi" target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-500 hover:text-zinc-300">Docs</a>
            <span className="text-zinc-700">|</span>
            <Link href="/privacy" className="text-xs text-zinc-500 hover:text-zinc-300">Privacy</Link>
            <span className="text-zinc-700">|</span>
            <Link href="/terms" className="text-xs text-zinc-500 hover:text-zinc-300">Terms</Link>
            <span className="text-zinc-700">|</span>
            <span className="text-xs text-zinc-600">Apache-2.0</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
