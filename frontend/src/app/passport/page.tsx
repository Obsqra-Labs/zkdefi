"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { Shield, Loader2 } from "lucide-react";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { ScoreBanner } from "@/components/zkdefi/passport/ScoreBanner";
import { VectorDisplay } from "@/components/zkdefi/passport/VectorDisplay";
import { GateGrid } from "@/components/zkdefi/passport/GateGrid";
import { TierProgress } from "@/components/zkdefi/passport/TierProgress";
import { ClaimButton } from "@/components/zkdefi/passport/ClaimButton";
import { BuilderProfileCard } from "@/components/zkdefi/passport/BuilderProfileCard";
import { fetchProfile, fetchActivity, fetchBuilderProfile } from "@/lib/receiptos/vector";
import type { ReputationProfile, ActivityEntry, BuilderProfile } from "@/lib/receiptos/types";

export default function PassportPage() {
  const { address, status: walletStatus } = useAccount();
  const [profile, setProfile] = useState<ReputationProfile | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [builder, setBuilder] = useState<BuilderProfile | null>(null);
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
        fetchBuilderProfile(addr),
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-cyan-400" />
        <h1 className="text-lg font-bold text-zinc-100">
          ReceiptOS Passport
        </h1>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Your on-chain reputation profile — score, tier, gates, and receipt claims.
      </p>

      <div className="mt-8 space-y-6">
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
            <ScoreBanner profile={profile} />
            <GateGrid gates={profile.gates} activity={activity} />
            {builder && <BuilderProfileCard builder={builder} />}
            <TierProgress profile={profile} />
            <VectorDisplay vector={profile} />
            <ClaimButton walletAddress={profile.wallet_address} />
          </>
        )}

        {/* Not connected */}
        {walletStatus === "disconnected" && !loading && (
          <div className="py-16 text-center">
            <Shield className="mx-auto h-12 w-12 text-zinc-700" />
            <p className="mt-4 text-sm text-zinc-500">
              Connect your wallet to get started
            </p>
            <div className="mt-6 flex justify-center">
              <ConnectButton />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
