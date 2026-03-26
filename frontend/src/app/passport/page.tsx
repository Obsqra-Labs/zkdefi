"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { Shield, Loader2, Download } from "lucide-react";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { Reveal } from "@/components/marketing/Reveal";
import { ScoreBanner } from "@/components/zkdefi/passport/ScoreBanner";
import { VectorDisplay } from "@/components/zkdefi/passport/VectorDisplay";
import { GateGrid } from "@/components/zkdefi/passport/GateGrid";
import { TierProgress } from "@/components/zkdefi/passport/TierProgress";
import { ClaimButton } from "@/components/zkdefi/passport/ClaimButton";
import { BuilderActivityCard } from "@/components/zkdefi/passport/BuilderProfileCard";
import { fetchProfile, fetchActivity, fetchBuilderActivity } from "@/lib/receiptos/vector";
import type { ReputationProfile, ActivityEntry, BuilderActivity } from "@/lib/receiptos/types";

export default function PassportPage() {
  const { address, status: walletStatus } = useAccount();
  const [profile, setProfile] = useState<ReputationProfile | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [builder, setBuilder] = useState<BuilderActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async (addr: string) => {
    setLoading(true);
    setError(null);
    setProfile(null);
    setActivity([]);
    setBuilder(null);
    try {
      const [p, act, b] = await Promise.all([
        fetchProfile(addr),
        fetchActivity(addr),
        fetchBuilderActivity(addr),
      ]);
      setProfile(p);
      setActivity(act);
      setBuilder(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (walletStatus === "connected" && address) {
      scan(address);
    } else {
      setProfile(null);
      setActivity([]);
      setBuilder(null);
      setError(null);
    }
  }, [walletStatus, address, scan]);

  const gatesUnlocked = profile
    ? Object.values(profile.gates).filter(Boolean).length
    : 0;
  const totalGates = profile ? Object.keys(profile.gates).length : 0;

  return (
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
          Score, tier, protocol gates, builder facets, and on-chain receipt claims.
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
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Scanning wallet…
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4">
            <p className="text-sm text-red-400">{error}</p>
            {address && (
              <button
                onClick={() => scan(address)}
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
              <ScoreBanner profile={profile} />
            </Reveal>

            <div className="section-sep" />

            <Reveal delay={200}>
              <GateGrid gates={profile.gates} activity={activity} />
            </Reveal>

            {builder && (
              <>
                <div className="section-sep" />
                <Reveal delay={300}>
                  <BuilderActivityCard profile={profile} activity={builder} />
                </Reveal>
              </>
            )}

            <div className="section-sep" />

            <Reveal delay={400}>
              <TierProgress profile={profile} />
            </Reveal>

            <div className="section-sep" />

            <Reveal delay={500}>
              <VectorDisplay vector={profile} />
            </Reveal>

            <div className="section-sep" />

            <Reveal delay={600}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ClaimButton walletAddress={profile.wallet_address} />
                <button
                  onClick={() => {
                    const blob = new Blob(
                      [JSON.stringify({ profile, builder, activity }, null, 2)],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `passport-${profile.wallet_address.slice(0, 10)}.json`;
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
  );
}
