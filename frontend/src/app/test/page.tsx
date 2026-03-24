import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { PublicProofDashboardStrip } from "@/components/marketing/PublicProofDashboardStrip";
import { STARKNET_CONTRACTS, voyagerContractUrl } from "@/content/deployedContracts";

export const metadata: Metadata = {
  title: "Check the receipts — zkde.fi",
  description:
    "Plain-language guide to what zkde.fi puts on-chain, plus links to verify contracts and recent public mirror receipts yourself.",
};

const ETHEREUM_CONTRACTS = [
  { name: "Halo2Verifier", hash: "0x8a3f…c901", type: "EVM" },
  { name: "ModelBridgeVerifier", hash: "0x6b2e…d405", type: "EVM" },
  { name: "ReceiptRegistry", hash: "0x4c1d…e607", type: "EVM" },
  { name: "BridgeRelay", hash: "0x9f0a…b203", type: "EVM" },
] as const;

const FLOW_STEPS = [
  {
    title: "Suggestion or score",
    body: "An agent or model proposes something—risk, routing, a trade idea. That is not proof by itself.",
  },
  {
    title: "Proof binds the claim",
    body: "The stack turns the relevant output into a proof-shaped commitment you can check, not just a log line in our database.",
  },
  {
    title: "Policy says yes or no",
    body: "Vault rules, reputation tiers, and other constraints decide whether that intent is allowed to execute.",
  },
  {
    title: "Execution settles",
    body: "When it runs, it does so on-chain or through flows that leave receipts you can trace.",
  },
  {
    title: "You keep the receipt",
    body: "Explorers and the table below are how you confirm what happened—without taking our word for it.",
  },
] as const;

const PROOF_TYPES = [
  {
    name: "Groth16 SNARKs",
    count: 31,
    desc: "Privacy commitments, nullifiers, membership, and range proofs—the bread and butter of shielded flows.",
    status: "live",
  },
  {
    name: "EZKL Halo2 KZG",
    count: 5,
    desc: "On-chain checks that a model output matches a committed circuit—useful for credit-style and agent-skill gates.",
    status: "live",
  },
  {
    name: "Noir HONK",
    count: 1,
    desc: "Bridge-friendly proofs when we need UltraHonk-shaped verification in the loop.",
    status: "live",
  },
  {
    name: "STARK path (Stone today)",
    count: null,
    desc: "Execution integrity wrapped in STARKs via the current production path. Starknet’s S-two line is the next efficiency step on the roadmap—not something we claim in production today.",
    status: "live",
  },
] as const;

export default function TestPage() {
  return (
    <main id="main-content" className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader compact />

      <section className="px-6 pb-20 pt-16 sm:pb-28 sm:pt-24">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to home
          </Link>

          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
            Verification & receipts
          </p>
          <h1 className="mt-2 font-serif text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Check the receipts
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-400">
            This page is for anyone who wants to see what we actually deploy and how to confirm it in a block explorer.
            No insider access required—if we point to a hash, you can paste it into Voyager or Etherscan the same way we
            would.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#live-receipts"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
            >
              See live public receipts
            </a>
            <a
              href="#on-chain-addresses"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              Jump to contract addresses
            </a>
          </div>

          {/* Plain flow */}
          <div id="how-flow" className="mt-14 scroll-mt-24">
            <h2 className="font-serif text-2xl font-bold tracking-tight text-zinc-100">
              What happens end to end
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
              zkde.fi is built so suggestions from models and agents are not the same thing as settled, trusted action.
              Here is the shape of the pipeline, in normal words.
            </p>
            <ol className="mt-8 space-y-5 border-l border-zinc-800 pl-6">
              {FLOW_STEPS.map((step, i) => (
                <li key={step.title} className="relative">
                  <span
                    className="absolute -left-6 top-0.5 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 font-mono text-[10px] font-bold text-zinc-500"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <h3 className="text-sm font-semibold text-zinc-200">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-500">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* Settlement path */}
          <div className="mt-14 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              Where settlement lands
            </p>
            <p className="mt-3 font-mono text-lg tracking-wide sm:text-xl">
              <span className="text-emerald-400">Madara L3</span>
              <span className="mx-2 text-zinc-700">→</span>
              <span className="text-blue-400">Starknet L2</span>
              <span className="mx-2 text-zinc-700">→</span>
              <span className="text-violet-400">Ethereum L1</span>
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Work can start in a fast L3 environment; public mirrors and L1 hooks are how independent observers follow
              the trail. Use the explorers to trace txs and events—counts move over time, so we do not hard-code a number
              here.
            </p>
          </div>

          {/* Live receipts */}
          <div id="live-receipts" className="mt-16 scroll-mt-24">
            <h2 className="font-serif text-2xl font-bold tracking-tight">Live public receipts</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
              When our backend has a fresh research report, we surface a small, explorer-safe slice: public Starknet mirror
              transactions and similar receipts you can open yourself. Nothing here is a stand-in for a private or internal
              run—only what we are comfortable showing on a public block explorer.
            </p>
            <div className="mt-8">
              <PublicProofDashboardStrip />
            </div>
          </div>

          {/* Contracts */}
          <div id="on-chain-addresses" className="mt-16 scroll-mt-24">
            <h2 className="font-serif text-2xl font-bold tracking-tight">On-chain addresses</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Starknet Sepolia links go straight to Voyager. Ethereum rows show shortened hashes—paste the full address from
              your deployment records or the main site contract panel into Etherscan Sepolia.
            </p>

            <div className="mt-8 space-y-8">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-400" aria-hidden="true" />
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Starknet L2 (Sepolia)
                  </h3>
                </div>
                <div className="divide-y divide-zinc-800/50 rounded-lg border border-zinc-800 bg-zinc-900/20">
                  {STARKNET_CONTRACTS.map((item) => (
                    <div
                      key={item.name}
                      className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/60" aria-hidden="true" />
                        <span className="text-sm font-medium text-zinc-200">{item.name}</span>
                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                          Cairo
                        </span>
                      </div>
                      <a
                        href={voyagerContractUrl(item.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 break-all rounded bg-zinc-900 px-2 py-1 font-mono text-[10px] text-emerald-400/90 underline decoration-emerald-500/30 underline-offset-2 hover:decoration-emerald-400 sm:text-[11px]"
                      >
                        {item.address}
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only"> (opens on Voyager)</span>
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-400" aria-hidden="true" />
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Ethereum L1 (Sepolia)
                  </h3>
                </div>
                <div className="divide-y divide-zinc-800/50 rounded-lg border border-zinc-800 bg-zinc-900/20">
                  {ETHEREUM_CONTRACTS.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between gap-4 px-5 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/60" aria-hidden="true" />
                        <span className="truncate text-sm font-medium text-zinc-200">{item.name}</span>
                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                          {item.type}
                        </span>
                      </div>
                      <span className="shrink-0 rounded bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-600">
                        {item.hash}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Madara L3 — OBSQRA_PROOF_CHAIN
                  </h3>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-zinc-200">ObsqraFactRegistry</span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                      <span className="font-mono text-[10px] text-emerald-400">Live</span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600">
                    Fast blocks for hash-verified receipts before public mirroring—verify L2/L1 contracts above for what
                    visitors can browse on public explorers.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Proof systems */}
          <div className="mt-16">
            <h2 className="font-serif text-2xl font-bold tracking-tight">Proof families in the stack</h2>
            <p className="mt-2 text-sm text-zinc-500">
              Different jobs ask for different proof systems. This is not a race between brands—it is what each layer is
              responsible for.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {PROOF_TYPES.map((pt) => (
                <div key={pt.name} className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-zinc-200">{pt.name}</h3>
                    {pt.count != null ? (
                      <span className="font-serif text-lg font-bold text-emerald-400/60">{pt.count}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">{pt.desc}</p>
                  <span className="mt-3 inline-block rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                    {pt.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* How to verify */}
          <div className="mt-16 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <h2 className="font-serif text-xl font-bold tracking-tight">How to verify (three steps)</h2>
            <div className="mt-4 space-y-4 text-sm text-zinc-400">
              <p>
                <strong className="text-zinc-200">1. Choose something concrete</strong> — a Starknet contract link from the
                table, or a transaction hash from the live receipts section when it is populated.
              </p>
              <p>
                <strong className="text-zinc-200">2. Open it in the right explorer</strong> —{" "}
                <a
                  href="https://sepolia.voyager.online"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:decoration-blue-400"
                >
                  Voyager Sepolia
                  <span className="sr-only"> (opens in new tab)</span>
                </a>{" "}
                for Starknet,{" "}
                <a
                  href="https://sepolia.etherscan.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 underline decoration-violet-400/30 underline-offset-2 hover:decoration-violet-400"
                >
                  Etherscan Sepolia
                  <span className="sr-only"> (opens in new tab)</span>
                </a>{" "}
                for Ethereum.
              </p>
              <p>
                <strong className="text-zinc-200">3. Follow events and calldata</strong> — verified contracts expose what
                they verified. If something does not match what we describe in the docs, that is a bug we want to know
                about.
              </p>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center gap-4">
            <Link
              href="/docs/"
              className="inline-flex items-center gap-2.5 rounded-lg bg-white px-7 py-3.5 text-sm font-semibold text-zinc-950 transition-all hover:bg-zinc-200"
            >
              Read the Docs
              <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden="true" />
            </Link>
            <a
              href="https://github.com/Obsqra-Labs/zkdefi"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-7 py-3.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              View Source
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in new tab)</span>
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
