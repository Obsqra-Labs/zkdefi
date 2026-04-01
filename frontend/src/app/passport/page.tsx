"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "@starknet-react/core";
import { Shield, Loader2, Download } from "lucide-react";
import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { Reveal } from "@/components/marketing/Reveal";
import { ScoreBanner } from "@/components/zkdefi/passport/ScoreBanner";
import { GateGrid } from "@/components/zkdefi/passport/GateGrid";
import { TierProgress } from "@/components/zkdefi/passport/TierProgress";
import { ClaimButton } from "@/components/zkdefi/passport/ClaimButton";
import { BuilderActivityCard } from "@/components/zkdefi/passport/BuilderProfileCard";
import { usePortablePassport } from "@/hooks/usePortablePassport";
import {
  fetchActivity,
  fetchBuilderActivity,
} from "@/lib/receiptos/vector";
import type { ReputationProfile, ActivityEntry, BuilderActivity } from "@/lib/receiptos/types";
import type { PortablePassportProfile } from "@/lib/passport/portable";

/** Map PPP → ReputationProfile compat shape for existing components. */
function pppToReputationProfile(ppp: PortablePassportProfile): ReputationProfile {
  const tier = ppp.reputation.tier;
  const rep = ppp.reputation;
  return {
    wallet_address: ppp.subject.starknet_address,
    scanned_at: ppp.provenance.generated_at,
    signals: [],
    reputation_score: typeof rep.score === "number" ? rep.score : 0,
    tier,
    tier_name: rep.tier_name,
    gates: rep.gates ?? {},
    upgrade_eligible: rep.upgrade_eligible ?? false,
    upgrade_requirements: rep.upgrade_requirements ?? null,
    transaction_count: rep.transaction_count ?? 0,
    successful_txns: rep.successful_txns ?? 0,
    failed_txns: rep.failed_txns ?? 0,
    total_volume_eth: rep.total_volume_eth ?? 0,
    tenure_days: rep.tenure_days ?? 0,
    collateral_eth: rep.collateral_eth ?? 0,
  };
}

export default function PassportPage() {
  const { address, status: walletStatus } = useAccount();
  const { passport: ppp, loading: pppLoading, error: pppError, refetch: refetchPpp } = usePortablePassport(address);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [builder, setBuilder] = useState<BuilderActivity | null>(null);
  const [sideLoading, setSideLoading] = useState(false);

  const profile = useMemo(() => (ppp ? pppToReputationProfile(ppp) : null), [ppp]);

  // Fetch supplementary timeline data not in PPP
  useEffect(() => {
    if (walletStatus !== "connected" || !address) {
      setActivity([]);
      setBuilder(null);
      return;
    }
    let cancelled = false;
    setSideLoading(true);
    Promise.all([fetchActivity(address), fetchBuilderActivity(address)])
      .then(([act, b]) => {
        if (cancelled) return;
        setActivity(act);
        setBuilder(b);
      })
      .catch(() => {
        if (cancelled) return;
        setActivity([]);
        setBuilder(null);
      })
      .finally(() => {
        if (!cancelled) setSideLoading(false);
      });
    return () => { cancelled = true; };
  }, [walletStatus, address]);

  const loading = pppLoading || sideLoading;
  const error = pppError ? (pppError.message ?? "Failed to load passport") : null;

  const gatesUnlocked = profile
    ? Object.values(profile.gates).filter(Boolean).length
    : 0;
  const totalGates = profile ? Object.keys(profile.gates).length : 0;

  return (
    <div className="min-h-screen bg-zinc-950">
      <AppNavbar />
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Header */}
      <Reveal delay={0}>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
          Reputation Profile
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Shield className="h-7 w-7 text-cyan-400" />
          <h1 className="font-serif text-2xl font-bold tracking-tight text-zinc-100">
            ReceiptOS Passport
          </h1>
        </div>
        <p className="mt-1.5 text-xs text-zinc-500">
          Score breakdown, protocol gates, tier progression, and on-chain receipt claims.
        </p>
      </Reveal>

      {/* Summary strip — only when profile loaded */}
      {profile && !loading && (
        <Reveal delay={80}>
          <div className="mt-5 flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-4 py-2 text-[10px] text-zinc-500">
            <span>
              Score <span className="font-semibold text-zinc-300">{profile.reputation_score}</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              Tier <span className="font-semibold text-zinc-300">{profile.tier_name}</span>
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              <span className="font-semibold text-zinc-300">{gatesUnlocked}</span>/{totalGates} gates
            </span>
            {ppp && (
              <>
                <span className="text-zinc-700">·</span>
                <span>
                  <span className="font-semibold text-zinc-300">{ppp.activity.defi.protocol_count}</span> protocols
                </span>
                {Number(ppp.activity.defi.tvl_usd ?? 0) > 0 && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>
                      $<span className="font-semibold text-zinc-300">{Number(ppp.activity.defi.tvl_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> TVL
                    </span>
                  </>
                )}
                {ppp.activity.on_chain && ppp.activity.on_chain.starknet_nonce > 0 && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>
                      <span className="font-semibold text-zinc-300">{ppp.activity.on_chain.starknet_nonce}</span> txns
                    </span>
                  </>
                )}
                {ppp.activity.on_chain && ppp.activity.on_chain.bridge_deposit_count > 0 && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>
                      <span className="font-semibold text-zinc-300">{ppp.activity.on_chain.bridge_total_eth.toFixed(2)}</span> bridged ETH
                    </span>
                  </>
                )}
              </>
            )}
            {builder && builder.totalReceipts > 0 && (
              <>
                <span className="text-zinc-700">·</span>
                <span>
                  <span className="font-semibold text-zinc-300">{builder.totalReceipts}</span> receipts
                </span>
              </>
            )}
          </div>
        </Reveal>
      )}

      <div className="mt-8 space-y-8">
        {/* Wallet connecting / loading data */}
        {(loading || walletStatus === "connecting" || walletStatus === "reconnecting" || (walletStatus === "connected" && !profile && !error)) && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {walletStatus === "connecting" || walletStatus === "reconnecting"
              ? "Connecting wallet…"
              : "Scanning wallet…"}
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4">
            <p className="text-sm text-red-400">{error}</p>
            {address && (
              <button
                onClick={() => refetchPpp()}
                className="mt-2 text-xs text-red-300 underline"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Full Profile */}
        {profile && !loading && (
          <>
            <Reveal delay={100}>
              <ScoreBanner
                profile={profile}
                protocolCount={ppp?.activity?.defi?.protocol_count}
                walletValueUsd={ppp?.activity?.defi?.wallet_value_usd}
              />
            </Reveal>

            <div className="section-sep" />

            <Reveal delay={200}>
              <GateGrid gates={profile.gates} currentTier={profile.tier} activity={activity} />
            </Reveal>

            {builder && (
              <>
                <div className="section-sep" />
                <Reveal delay={300}>
                  <BuilderActivityCard profile={profile} activity={builder} />
                </Reveal>
              </>
            )}

            {/* On-Chain Activity — real data from Starknet mainnet */}
            {ppp?.activity?.on_chain && (ppp.activity.on_chain.starknet_nonce > 0 || ppp.activity.on_chain.bridge_deposit_count > 0) && (
              <>
                <div className="section-sep" />
                <Reveal delay={350}>
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5">
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                      On-Chain Activity
                    </h3>
                    <p className="mt-1 text-[10px] text-zinc-600">
                      Real data from Starknet mainnet via RPC
                    </p>
                    {/* Stats grid */}
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                        <p className="text-[10px] text-zinc-600">Transactions</p>
                        <p className="text-lg font-semibold text-zinc-200">
                          {ppp.activity.on_chain.starknet_nonce}
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                        <p className="text-[10px] text-zinc-600">Total Value</p>
                        <p className="text-lg font-semibold text-zinc-200">
                          ${Number(ppp.activity.defi.tvl_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      {(ppp.activity.on_chain.swap_count ?? 0) > 0 && (
                        <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                          <p className="text-[10px] text-zinc-600">Swaps</p>
                          <p className="text-lg font-semibold text-zinc-200">
                            {ppp.activity.on_chain.swap_count}
                          </p>
                        </div>
                      )}
                      {(ppp.activity.on_chain.account_age_days ?? 0) > 0 && (
                        <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                          <p className="text-[10px] text-zinc-600">Account Age</p>
                          <p className="text-lg font-semibold text-zinc-200">
                            {ppp.activity.on_chain.account_age_days}d
                          </p>
                        </div>
                      )}
                      {ppp.activity.on_chain.bridge_deposit_count > 0 && (
                        <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                          <p className="text-[10px] text-zinc-600">Bridged ETH</p>
                          <p className="text-lg font-semibold text-zinc-200">
                            {ppp.activity.on_chain.bridge_total_eth.toFixed(4)}
                          </p>
                        </div>
                      )}
                    </div>
                    {/* Protocol breakdown */}
                    {ppp.activity.defi.protocols_active && ppp.activity.defi.protocols_active.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-zinc-600">Active Protocols</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {ppp.activity.defi.protocols_active.map((p) => (
                            <span
                              key={p}
                              className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2 py-0.5 text-[10px] font-medium text-cyan-400"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* DeFi position breakdown */}
                    {((ppp.activity.defi.lending_value_usd ?? 0) > 0 || (ppp.activity.defi.staking_value_usd ?? 0) > 0 || (ppp.activity.defi.wallet_value_usd ?? 0) > 0) ? (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                          <p className="text-[10px] text-zinc-600">Lending</p>
                          <p className="text-sm font-medium text-zinc-300">
                            ${(ppp.activity.defi.lending_value_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                          <p className="text-[10px] text-zinc-600">Staking</p>
                          <p className="text-sm font-medium text-zinc-300">
                            ${(ppp.activity.defi.staking_value_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2">
                          <p className="text-[10px] text-zinc-600">Wallet</p>
                          <p className="text-sm font-medium text-zinc-300">
                            ${(ppp.activity.defi.wallet_value_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {/* Bridge deposit history */}
                    {ppp.activity.on_chain.bridge_deposits.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-zinc-600">Recent Bridge Deposits</p>
                        <div className="mt-1 space-y-1">
                          {ppp.activity.on_chain.bridge_deposits.slice(0, 5).map((d, i) => (
                            <div
                              key={d.tx_hash || i}
                              className="flex items-center justify-between rounded border border-zinc-800/30 bg-zinc-950/30 px-3 py-1.5 text-[10px]"
                            >
                              <span className="text-zinc-500">
                                Block #{d.block_number}
                              </span>
                              <span className="font-medium text-zinc-300">
                                {d.amount_eth.toFixed(4)} ETH
                              </span>
                              {d.tx_hash && (
                                <a
                                  href={`https://starkscan.co/tx/${d.tx_hash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-cyan-500 hover:text-cyan-400"
                                >
                                  View
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Reveal>
              </>
            )}

            <div className="section-sep" />

            <Reveal delay={400}>
              <TierProgress profile={profile} />
            </Reveal>

            <div className="section-sep" />

            <Reveal delay={600}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ClaimButton walletAddress={profile.wallet_address} />
                <button
                  onClick={() => {
                    if (!ppp) return;
                    const blob = new Blob(
                      [JSON.stringify(ppp, null, 2)],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `passport-${ppp.subject.starknet_address.slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                >
                  <Download className="h-4 w-4" />
                  Export Passport
                </button>
              </div>
            </Reveal>
          </>
        )}

        {/* Not connected */}
        {walletStatus === "disconnected" && !loading && (
          <Reveal delay={100}>
            <div className="py-16 text-center">
              <div className="relative mx-auto h-16 w-16">
                <div className="hero-glow absolute -inset-8" />
                <Shield className="relative h-16 w-16 text-zinc-700" />
              </div>
              <p className="mt-6 text-sm text-zinc-500">
                Connect your wallet to view your reputation passport
              </p>
              <div className="mt-6 flex justify-center">
                <ConnectButton />
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </div>
    </div>
  );
}
