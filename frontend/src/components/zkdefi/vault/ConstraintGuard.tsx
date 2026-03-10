"use client";

/**
 * ConstraintGuard — compact display of user's constraint bounds.
 * Shows what the agent is allowed to do: risk profile, max position,
 * session validity, and ZKML proof status.
 *
 * Fetches from /api/v1/zkdefi/constraints/{address} and onboarding state.
 */

import { useState, useEffect } from "react";
import { ShieldCheck, AlertTriangle, Clock, Lock, Fingerprint } from "lucide-react";
import { API_BASE } from "@/lib/api/client";

interface ConstraintData {
  risk_profile: string;
  risk_tolerance: number;
  max_position_usd: number;
  session_duration_hours: number;
  session_valid: boolean;
  identity_verified: boolean;
  constraint_hash: string;
  onboarded: boolean;
}

function profileColor(p: string) {
  const lower = (p || "").toLowerCase();
  if (lower === "conservative") return "text-blue-400";
  if (lower === "aggressive") return "text-amber-400";
  return "text-emerald-400";
}

function profileBg(p: string) {
  const lower = (p || "").toLowerCase();
  if (lower === "conservative") return "bg-blue-500/10 border-blue-500/20";
  if (lower === "aggressive") return "bg-amber-500/10 border-amber-500/20";
  return "bg-emerald-500/10 border-emerald-500/20";
}

export interface ConstraintGuardProps {
  address: string | undefined;
}

export function ConstraintGuard({ address }: ConstraintGuardProps) {
  const [data, setData] = useState<ConstraintData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }

    let dead = false;

    const fetchConstraints = async () => {
      try {
        // Fetch constraints + onboarding state in parallel
        const [constraintsRes, onboardingRes] = await Promise.allSettled([
          fetch(`${API_BASE}/v1/zkdefi/constraints/${address}`, {
            signal: AbortSignal.timeout(6000),
          }),
          fetch(`${API_BASE}/v1/zkdefi/onboarding/state/${address}`, {
            signal: AbortSignal.timeout(6000),
          }),
        ]);

        if (dead) return;

        let constraintData: any = null;
        if (constraintsRes.status === "fulfilled" && constraintsRes.value.ok) {
          constraintData = await constraintsRes.value.json();
        }

        let onboardingData: any = null;
        if (onboardingRes.status === "fulfilled" && onboardingRes.value.ok) {
          onboardingData = await onboardingRes.value.json();
        }

        // Merge both sources
        const maxPosWei = onboardingData?.max_position_wei ?? constraintData?.max_position_wei ?? "0";
        const maxPosUsd = Number(BigInt(maxPosWei || "0")) / 1e18 * 2500; // rough ETH→USD

        const riskTolerance = onboardingData?.risk_tolerance ?? constraintData?.risk_tolerance ?? 50;
        const riskProfile = riskTolerance <= 35 ? "conservative" : riskTolerance >= 65 ? "aggressive" : "balanced";
        const sessionHours = onboardingData?.session_duration_hours ?? 24;

        // Check session validity
        const onboardedAt = onboardingData?.onboarded_at ?? 0;
        const elapsedH = onboardedAt > 0 ? (Date.now() / 1000 - onboardedAt) / 3600 : 0;
        const sessionValid = onboardedAt > 0 && elapsedH <= sessionHours;

        const identityVerified = Boolean(onboardingData?.fact_hash) && Boolean(onboardingData?.identity_commitment);

        const constraintHash = constraintData?.constraint_hash ?? onboardingData?.constraint_hash ?? "";

        setData({
          risk_profile: riskProfile,
          risk_tolerance: riskTolerance,
          max_position_usd: maxPosUsd,
          session_duration_hours: sessionHours,
          session_valid: sessionValid,
          identity_verified: identityVerified,
          constraint_hash: constraintHash,
          onboarded: Boolean(onboardingData?.agent_initialized),
        });
      } catch {
        /* best-effort */
      } finally {
        if (!dead) setLoading(false);
      }
    };

    fetchConstraints();
    return () => { dead = true; };
  }, [address]);

  if (loading) return null;
  if (!address || !data) return null;

  // If not onboarded, show a nudge
  if (!data.onboarded) {
    return (
      <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 px-3 py-2 text-xs flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-amber-300/80">
          Complete onboarding to set your constraint bounds. The agent cannot execute until constraints are registered.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-medium text-zinc-400">Agent Constraints</span>
        <span className="ml-auto text-[10px] text-zinc-600 font-mono truncate max-w-[120px]">
          {data.constraint_hash ? `${data.constraint_hash.slice(0, 10)}…` : ""}
        </span>
      </div>

      <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {/* Risk profile */}
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">Profile:</span>
          <span className={`px-1.5 py-0.5 rounded border ${profileBg(data.risk_profile)} ${profileColor(data.risk_profile)} font-medium capitalize`}>
            {data.risk_profile}
          </span>
        </div>

        {/* Max position */}
        <div className="flex items-center gap-1">
          <Lock className="w-3 h-3 text-zinc-500" />
          <span className="text-zinc-500">Max pos:</span>
          <span className="text-zinc-300">
            {data.max_position_usd > 0 ? `$${data.max_position_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "No limit"}
          </span>
        </div>

        {/* Session */}
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-zinc-500" />
          <span className="text-zinc-500">Session:</span>
          <span className={data.session_valid ? "text-emerald-400" : "text-rose-400"}>
            {data.session_valid ? `Active (${data.session_duration_hours}h)` : "Expired"}
          </span>
        </div>

        {/* Identity */}
        <div className="flex items-center gap-1">
          <Fingerprint className="w-3 h-3 text-zinc-500" />
          <span className="text-zinc-500">Identity:</span>
          <span className={data.identity_verified ? "text-emerald-400" : "text-rose-400"}>
            {data.identity_verified ? "Verified" : "Pending"}
          </span>
        </div>
      </div>
    </div>
  );
}
