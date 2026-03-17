import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Shield, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata: Metadata = {
  title: "Verify Every Claim — zkde.fi",
  description:
    "Independently verify every proof, receipt, and on-chain claim made by zkde.fi. All hashes are queryable via RPC.",
};

const VERIFICATION_TARGETS = [
  {
    category: "Starknet L2 Contracts",
    chain: "blue",
    items: [
      { name: "ReputationRegistry", hash: "0x03a1…3f8a", type: "Cairo" },
      { name: "FullPrivacyPoolV2", hash: "0xce55…f117", type: "Cairo" },
      { name: "ReceiptRegistry", hash: "0x02db…9e01", type: "Cairo" },
      { name: "VaultController", hash: "0x04e7…9061", type: "Cairo" },
      { name: "GaragaVerifier", hash: "0x04e7…9061", type: "Cairo" },
      { name: "ModelBridgeVerifier", hash: "0x037c…626f", type: "Cairo" },
      { name: "ZkmlVerifier", hash: "0x068a…8923", type: "Cairo" },
    ],
  },
  {
    category: "Ethereum L1 Contracts",
    chain: "violet",
    items: [
      { name: "Halo2Verifier", hash: "0x8a3f…c901", type: "EVM" },
      { name: "ModelBridgeVerifier", hash: "0x6b2e…d405", type: "EVM" },
      { name: "ReceiptRegistry", hash: "0x4c1d…e607", type: "EVM" },
      { name: "BridgeRelay", hash: "0x9f0a…b203", type: "EVM" },
    ],
  },
] as const;

const PROOF_TYPES = [
  {
    name: "Groth16 SNARKs",
    count: 31,
    desc: "Privacy commitments, nullifier proofs, membership inclusion, range proofs",
    status: "live",
  },
  {
    name: "EZKL Halo2 KZG",
    count: 5,
    desc: "zkML model verification — credit scoring, risk profiling, agent skill checks",
    status: "live",
  },
  {
    name: "Noir HONK",
    count: 1,
    desc: "Cross-chain bridge verification via UltraHonk proving system",
    status: "live",
  },
  {
    name: "Stone STARKs",
    count: null,
    desc: "Execution wrapping — every transaction batch gets a STARK proof via the prover pipeline",
    status: "live",
  },
] as const;

export default function TestPage() {
  return (
    <main id="main-content" className="min-h-screen bg-zinc-950 text-white">
      <SiteHeader compact />

      <section className="px-6 pb-20 pt-16 sm:pb-28 sm:pt-24">
        <div className="mx-auto max-w-4xl">
          {/* Breadcrumb */}
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to home
          </Link>

          <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Verify Every Claim
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-400">
            Every number on the landing page maps to a deployed contract, a
            committed proof, or an on-chain receipt. This page lets you check
            them yourself.
          </p>

          {/* Settlement path */}
          <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-600">
              Settlement path
            </p>
            <p className="mt-3 font-mono text-lg tracking-wide sm:text-xl">
              <span className="text-emerald-400">Madara L3</span>
              <span className="mx-2 text-zinc-700">→</span>
              <span className="text-blue-400">Starknet L2</span>
              <span className="mx-2 text-zinc-700">→</span>
              <span className="text-violet-400">Ethereum L1</span>
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              136+ receipts on-chain. Every hash queryable via RPC.
            </p>
          </div>

          {/* Contracts */}
          <div className="mt-16">
            <h2 className="font-serif text-2xl font-bold tracking-tight">
              Deployed Contracts
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              11 contracts across 3 chains. Each hash can be verified on the
              respective block explorer.
            </p>

            <div className="mt-8 space-y-8">
              {VERIFICATION_TARGETS.map((group) => (
                <div key={group.category}>
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        group.chain === "blue"
                          ? "bg-blue-400"
                          : "bg-violet-400"
                      }`}
                      aria-hidden="true"
                    />
                    <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
                      {group.category}
                    </h3>
                  </div>
                  <div className="divide-y divide-zinc-800/50 rounded-lg border border-zinc-800 bg-zinc-900/20">
                    {group.items.map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center justify-between gap-4 px-5 py-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <CheckCircle2
                            className="h-3.5 w-3.5 shrink-0 text-emerald-500/60"
                            aria-hidden="true"
                          />
                          <span className="text-sm font-medium text-zinc-200 truncate">
                            {item.name}
                          </span>
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
              ))}

              {/* Madara L3 */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-emerald-400"
                    aria-hidden="true"
                  />
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Madara L3 — OBSQRA_PROOF_CHAIN
                  </h3>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-200">
                      ObsqraFactRegistry
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                        aria-hidden="true"
                      />
                      <span className="font-mono text-[10px] text-emerald-400">
                        Live
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600">
                    5s block time · 0 gas cost · Hash-verified receipt pipeline
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Proof systems */}
          <div className="mt-16">
            <h2 className="font-serif text-2xl font-bold tracking-tight">
              Proof Systems
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              37 circuits across 4 proving systems. Each proof type serves a
              different verification need.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {PROOF_TYPES.map((pt) => (
                <div
                  key={pt.name}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-5"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-200">
                      {pt.name}
                    </h3>
                    {pt.count && (
                      <span className="font-serif text-lg font-bold text-emerald-400/60">
                        {pt.count}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                    {pt.desc}
                  </p>
                  <span className="mt-3 inline-block rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-emerald-400">
                    {pt.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* How to verify */}
          <div className="mt-16 rounded-lg border border-zinc-800 bg-zinc-900/30 p-6">
            <h2 className="font-serif text-xl font-bold tracking-tight">
              How to Verify
            </h2>
            <div className="mt-4 space-y-3 text-sm text-zinc-400">
              <p>
                <strong className="text-zinc-200">1. Pick a contract hash</strong>{" "}
                — copy any hash from the tables above.
              </p>
              <p>
                <strong className="text-zinc-200">2. Query the explorer</strong>{" "}
                — paste it into{" "}
                <a
                  href="https://sepolia.voyager.online"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:decoration-blue-400"
                >
                  Voyager
                  <span className="sr-only"> (opens in new tab)</span>
                </a>{" "}
                (Starknet) or{" "}
                <a
                  href="https://sepolia.etherscan.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 underline decoration-violet-400/30 underline-offset-2 hover:decoration-violet-400"
                >
                  Etherscan
                  <span className="sr-only"> (opens in new tab)</span>
                </a>{" "}
                (Ethereum).
              </p>
              <p>
                <strong className="text-zinc-200">3. Check the receipts</strong>{" "}
                — every transaction emits events you can trace end-to-end.
              </p>
            </div>
          </div>

          {/* CTA */}
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
