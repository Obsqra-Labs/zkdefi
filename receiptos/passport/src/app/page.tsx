"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { Shield, Loader2 } from "lucide-react";
import { WalletBar } from "@/components/WalletBar";
import { VectorDisplay } from "@/components/VectorDisplay";
import { ClaimButton } from "@/components/ClaimButton";
import type { ReputationVector } from "@/lib/types";

export default function PassportPage() {
  const { address, status: walletStatus } = useAccount();
  const [vector, setVector] = useState<ReputationVector | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVector = useCallback(async (addr: string) => {
    setLoading(true);
    setError(null);
    setVector(null);
    try {
      const res = await fetch(`/api/vector?address=${addr}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load vector (${res.status})`);
      }
      const data: ReputationVector = await res.json();
      setVector(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vector");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch when wallet connects
  useEffect(() => {
    if (walletStatus === "connected" && address) {
      fetchVector(address);
    } else {
      setVector(null);
      setError(null);
    }
  }, [walletStatus, address, fetchVector]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-cyan-400" />
          <h1 className="text-lg font-bold text-zinc-100">ReceiptOS Passport</h1>
        </div>
        <WalletBar />
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Connect your wallet to view your on-chain reputation vector and claim a receipt.
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
                onClick={() => fetchVector(address)}
                className="mt-2 text-xs text-red-300 underline"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Vector + Claim */}
        {vector && !loading && (
          <>
            <VectorDisplay vector={vector} />
            <ClaimButton walletAddress={vector.wallet_address} />
          </>
        )}

        {/* Not connected */}
        {walletStatus === "disconnected" && !loading && (
          <div className="py-16 text-center">
            <Shield className="mx-auto h-12 w-12 text-zinc-700" />
            <p className="mt-4 text-sm text-zinc-500">
              Connect an Argent or Braavos wallet to get started
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
