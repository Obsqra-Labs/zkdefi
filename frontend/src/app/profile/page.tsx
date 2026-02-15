"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { useProfileReputation, useOnboardingStatus, useRiskPassport, useLinkedAddresses } from "@/hooks/useProfile";
import { Shield, TrendingUp, Lock, Coins, ArrowUp, Send, Clock, CheckCircle, AlertTriangle, Brain, FileCheck, Star, Award, Link2, Info } from "lucide-react";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { ProofTimeline } from "@/components/zkdefi/ProofTimeline";
import { toastSuccess, toastError } from "@/lib/toast";
import { MyAgents } from "@/components/zkdefi/MyAgents";
import { ProfileJourneyBanner } from "@/components/zkdefi/ProfileJourneyBanner";
import { ProfileProtocolStatus } from "@/components/zkdefi/ProfileProtocolStatus";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";

interface RelayRequest {
  request_id: string;
  amount_wei: string;
  destination: string;
  status: string;
  created_at: number;
}

type ProfileTab = "overview" | "collateral" | "relayer" | "agents" | "compliance";

export default function ProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const { userRep, error: userRepError, refetch: refetchUserRep } = useProfileReputation(address ?? undefined);
  const { status: onboardingStatus } = useOnboardingStatus(address ?? undefined);
  const { passport, loading: passportLoading, error: passportError } = useRiskPassport(address ?? undefined);
  const { linked: linkedAddresses, draft: linkedDraft, setDraft: setLinkedDraft, save: saveLinkedAddresses, loading: linkedLoading, saving: linkedSaving } = useLinkedAddresses(address ?? undefined);

  const [mounted, setMounted] = useState(false);
  const [tiers, setTiers] = useState<any[]>([]);
  const [stakeAmount, setStakeAmount] = useState("0.1");
  const [isLoading, setIsLoading] = useState(false);
  const tabFromUrl = searchParams.get("tab") as ProfileTab | null;
  const [activeTabState, setActiveTabState] = useState<ProfileTab>("overview");
  const activeTab: ProfileTab = (tabFromUrl && ["overview", "collateral", "relayer", "agents", "compliance"].includes(tabFromUrl) ? tabFromUrl : activeTabState);
  const setActiveTab = (t: ProfileTab) => {
    setActiveTabState(t);
    router.replace(`/profile?tab=${t}`, { scroll: false });
  };
  const [relayAmount, setRelayAmount] = useState("0.01");
  const [relayDestination, setRelayDestination] = useState("");
  const [pendingRelays, setPendingRelays] = useState<RelayRequest[]>([]);
  const [creditTier, setCreditTier] = useState<any>(null);
  const [complianceProfiles, setComplianceProfiles] = useState<any[]>([]);
  const [loadingBailout, setLoadingBailout] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["overview", "collateral", "relayer", "agents", "compliance"].includes(tab)) {
      setActiveTabState(tab as ProfileTab);
    }
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => setLoadingBailout(true), 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/zkdefi/reputation/tiers`).then(r => r.json()).then(setTiers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!address) return;
    fetch(`${API_BASE}/api/v1/zkdefi/relayer/pending/${address}`).then(r => r.json()).then(setPendingRelays).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!address) return;
    fetch(`${API_BASE}/api/v1/zkdefi/onboarding/status/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then((onb: any) => {
        const commitment = onb?.identity_commitment;
        if (!commitment) {
          setCreditTier(null);
          return;
        }
        return fetch(`${API_BASE}/api/v1/identity/commitment/${commitment}`).then(r => r.json());
      })
      .then((data: any) => {
        if (data?.found) setCreditTier(data);
        else setCreditTier(null);
      })
      .catch(() => setCreditTier(null));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    fetch(`${API_BASE}/api/v1/zkdefi/compliance/profiles/${address}`)
      .then(r => r.json())
      .then(setComplianceProfiles)
      .catch(() => setComplianceProfiles([]));
  }, [address]);

  const handleStakeCollateral = async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const amountWei = Math.floor(parseFloat(stakeAmount) * 1e18);
      const res = await fetch(
        `${API_BASE}/api/v1/zkdefi/reputation/stake-collateral?address=${encodeURIComponent(address)}&amount_wei=${amountWei}`,
        { method: "POST" }
      );
      if (res.ok) {
        toastSuccess("Collateral staked");
        refetchUserRep();
      } else {
        throw new Error("Failed");
      }
    } catch {
      toastError("Failed to stake collateral");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestUpgrade = async () => {
    if (!address) return;
    const currentTier = userRep?.tier ?? 0;
    const targetTier = Math.min(currentTier + 1, 2);
    if (targetTier <= currentTier) {
      toastError("Already at max tier");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/reputation/upgrade-tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          target_tier: targetTier,
          upgrade_proof_hash: "0x0",
        }),
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess(`Upgraded to ${data.new_tier_name}`);
        refetchUserRep();
      } else {
        toastError(data.message || "Upgrade failed");
      }
    } catch {
      toastError("Failed to upgrade tier");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRelayRequest = async () => {
    if (!address || !relayDestination) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/relayer/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          amount_wei: (parseFloat(relayAmount) * 1e18).toString(),
          destination: relayDestination,
        }),
      });
      const data = await res.json();
      if (data.request_id) {
        toastSuccess("Relay requested");
        setPendingRelays([...pendingRelays, data]);
        setRelayDestination("");
      } else {
        throw new Error(data.error || "Failed");
      }
    } catch (e: any) {
      toastError(e.message || "Relay request failed");
    } finally {
      setIsLoading(false);
    }
  };

  const canUpgrade = userRep && userRep.tier < 2 && userRep.successful_txns >= (userRep.tier === 0 ? 5 : 20);
  const canUseRelayer = userRep && userRep.tier >= 1;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-lg">zkde.fi</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              <Link href="/agent" className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all">Dashboard</Link>
              <Link href="/profile" className="px-3 py-1.5 text-sm font-medium text-white bg-zinc-800 rounded-lg">Profile</Link>
            </nav>
          </div>
          <ConnectButton />
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {!mounted || ((!walletSettled && !isConnected) && !loadingBailout) ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-400">{mounted ? "Restoring session…" : "Loading…"}</p>
          </div>
        ) : !isConnected ? (
          <div className="text-center py-20">
            <Shield className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
            <h2 className="text-2xl font-bold mb-2">Connect Wallet</h2>
            <p className="text-zinc-400 mb-6">Connect your wallet to view your reputation profile</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-2 mb-6 border-b border-zinc-800 pb-4">
              <button onClick={() => setActiveTab("overview")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "overview" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <TrendingUp className="w-4 h-4" /> Overview
              </button>
              <button onClick={() => setActiveTab("collateral")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "collateral" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <Coins className="w-4 h-4" /> Collateral
              </button>
              <button onClick={() => setActiveTab("relayer")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "relayer" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <Send className="w-4 h-4" /> Private Relayer
              </button>
              <button onClick={() => setActiveTab("agents")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "agents" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <Brain className="w-4 h-4" /> My Agents
              </button>
              <button onClick={() => setActiveTab("compliance")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "compliance" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <FileCheck className="w-4 h-4" /> Compliance
              </button>
            </div>

            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Journey and next step */}
                <ProfileJourneyBanner
                  hasOnboarded={!!onboardingStatus?.has_agent}
                  hasPassport={!!passport}
                  canUseRelayer={!!(userRep && userRep.tier >= 1)}
                />
                {/* Protocol status: tier, collateral, relayer, upgrade */}
                <ProfileProtocolStatus
                  tierName={userRep?.tier_name ?? "Strict"}
                  collateralEth={userRep?.collateral_eth ?? 0}
                  canUseRelayer={!!(userRep && userRep.tier >= 1)}
                  canUpgrade={!!canUpgrade}
                  upgradeMessage={userRep?.tier === 0 ? `${5 - (userRep?.successful_txns ?? 0)} more txns for Standard` : userRep?.tier === 1 ? `${20 - (userRep?.successful_txns ?? 0)} more txns for Express` : "At max tier"}
                />
                {/* No activity yet — explain zeros */}
                {userRep && (userRep.tenure_days || 0) === 0 && (userRep.successful_txns || 0) === 0 && (userRep.collateral_eth || 0) === 0 && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-200">
                    <p className="font-medium text-cyan-100 mb-1">No activity recorded yet</p>
                    <p className="text-zinc-400">These numbers update when you use the app: stake collateral (Collateral tab), run proofs and rebalances on the Agent, and complete onboarding for credit tier. You&apos;re not missing anything — start on the Dashboard or Collateral tab to build your profile.</p>
                  </div>
                )}

                {/* Stats Grid */}
                {userRepError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                    Reputation unavailable. Tier and stats may be missing until the service is back.
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                    <div className="text-sm text-zinc-400 mb-1">Access Tier</div>
                    <div className={`text-2xl font-bold ${userRep?.tier === 0 ? "text-blue-400" : userRep?.tier === 1 ? "text-emerald-400" : "text-orange-400"}`}>{userRep?.tier_name || "Strict"}</div>
                  </div>
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                    <div className="text-sm text-zinc-400 mb-1">Account Age</div>
                    <div className="text-2xl font-bold">{userRep?.tenure_days || 0} days</div>
                  </div>
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                    <div className="text-sm text-zinc-400 mb-1">Transactions</div>
                    <div className="text-2xl font-bold">{userRep?.successful_txns || 0}</div>
                  </div>
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                    <div className="text-sm text-zinc-400 mb-1">Collateral</div>
                    <div className="text-2xl font-bold">{userRep?.collateral_eth?.toFixed(3) || 0} ETH</div>
                  </div>
                </div>

                {/* Risk Passport Card */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Shield className="w-5 h-5 text-emerald-400" /> Risk Passport
                    </h2>
                    <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">Proof-backed</span>
                  </div>
                  {passportLoading && address ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-6">
                        <div className="h-10 w-10 rounded-lg bg-zinc-700/50 animate-pulse" />
                        <div className="h-8 w-24 bg-zinc-700/50 rounded animate-pulse" />
                        <div className="h-4 w-32 bg-zinc-700/50 rounded animate-pulse" />
                      </div>
                      <div className="border-t border-zinc-800 pt-4 space-y-2">
                        <div className="h-4 w-full bg-zinc-700/50 rounded animate-pulse" />
                        <div className="h-4 w-[85%] bg-zinc-700/50 rounded animate-pulse" />
                        <div className="h-4 w-[70%] bg-zinc-700/50 rounded animate-pulse" />
                      </div>
                    </div>
                  ) : passport ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-6">
                        <div className={`text-4xl font-bold ${
                          passport.letter_rating === "A" ? "text-emerald-400" :
                          passport.letter_rating === "B" ? "text-cyan-400" :
                          passport.letter_rating === "C" ? "text-amber-400" : "text-red-400"
                        }`}>
                          {passport.letter_rating}
                        </div>
                        <div>
                          <div className="text-3xl font-bold text-white">{passport.composite_score}</div>
                          <div className="text-sm text-zinc-400">Composite score (0–100)</div>
                        </div>
                        <div className="text-sm text-zinc-400">
                          Tier: {passport.tier_name}
                          {passport.credit_tier != null && ` · Credit: ${passport.credit_tier}`}
                        </div>
                      </div>
                      {passport.proof_receipts?.[0] && (
                        <p className="text-xs text-zinc-500">
                          Last proof: {passport.proof_receipts[0].timestamp ? new Date(passport.proof_receipts[0].timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                          {passport.proof_receipts[0].snapshot_hash && ` · snap ${(passport.proof_receipts[0].snapshot_hash as string).slice(0, 10)}…${(passport.proof_receipts[0].snapshot_hash as string).slice(-6)}`}
                        </p>
                      )}
                      {passport.proof_receipts?.length > 0 && (
                        <div className="border-t border-zinc-800 pt-4">
                          <ProofTimeline
                            receipts={passport.proof_receipts.slice(0, 10)}
                            compact={false}
                            title="Proof receipts"
                          />
                        </div>
                      )}
                    </div>
                  ) : passportError ? (
                    <div className="flex items-center justify-between text-amber-400">
                      <p>Reputation unavailable. The service may be temporarily unavailable; try again later.</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-zinc-400">
                      <p>No passport data yet. Run proofs on the Agent page to build your passport.</p>
                      <Link href="/agent" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-all flex items-center gap-2 text-white text-sm">
                        <Shield className="w-4 h-4" /> Run proofs
                      </Link>
                    </div>
                  )}
                </div>

                {/* Credit Tier Card */}
                <div className="bg-gradient-to-br from-violet-900/30 to-violet-800/10 border border-violet-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Award className="w-5 h-5 text-violet-400" /> Credit Score
                    </h2>
                    <span className="text-xs text-violet-400 bg-violet-500/20 px-2 py-1 rounded">ZK-Proven</span>
                  </div>
                  {creditTier?.found ? (
                    <div className="flex items-center gap-6">
                      <div className={`text-5xl font-bold ${
                        creditTier.tier === "AAA" ? "text-emerald-400" :
                        creditTier.tier === "AA" ? "text-green-400" :
                        creditTier.tier === "A" ? "text-cyan-400" :
                        creditTier.tier === "B" ? "text-amber-400" : "text-red-400"
                      }`}>
                        {creditTier.tier}
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-white">{creditTier.score || "--"}</div>
                        <div className="text-sm text-zinc-400">Credit Score (300-850)</div>
                      </div>
                      <div className="flex-1 text-right">
                        <div className="text-sm text-zinc-400">Based on cross-chain history</div>
                        <div className="text-xs text-zinc-500">ETH, Starknet, Arbitrum, Base</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="text-zinc-400">
                        <p>Complete onboarding to generate your credit tier.</p>
                        <p className="text-sm text-zinc-500">Private proof of your cross-chain DeFi history.</p>
                      </div>
                      <Link href="/agent?tab=onboarding" className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium transition-all flex items-center gap-2">
                        <Star className="w-4 h-4" /> Get Credit Tier
                      </Link>
                    </div>
                  )}
                </div>

                {/* Linked addresses (cross-chain reputation baseline) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Link2 className="w-5 h-5 text-cyan-400" /> Linked addresses
                    </h2>
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500" title="Linking improves your reputation and credit score by aggregating activity across chains.">
                      Optional · improves credit baseline <Info className="w-3 h-3 opacity-70" />
                    </span>
                  </div>
                  {linkedLoading && address ? (
                    <div className="space-y-4">
                      <div className="h-4 w-[75%] bg-zinc-700/50 rounded animate-pulse" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="h-10 bg-zinc-700/50 rounded-lg animate-pulse" />
                        ))}
                      </div>
                      <div className="h-10 w-40 bg-zinc-700/50 rounded-lg animate-pulse" />
                    </div>
                  ) : (
                    <>
                  <p className="text-sm text-zinc-400 mb-4">
                    Link Ethereum, Arbitrum, Base, or Optimism addresses to aggregate cross-chain history for reputation and credit.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                    {(["eth", "arb", "base", "opt"] as const).map((chain) => (
                      <div key={chain}>
                        <label className="block text-xs text-zinc-500 mb-1">{chain === "eth" ? "Ethereum" : chain === "arb" ? "Arbitrum" : chain === "base" ? "Base" : "Optimism"}</label>
                        <input
                          type="text"
                          placeholder={`0x... (${chain})`}
                          value={linkedDraft[chain]}
                          onChange={(e) => setLinkedDraft((d) => ({ ...d, [chain]: e.target.value.trim() }))}
                          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono text-white placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={linkedSaving}
                    onClick={async () => {
                      if (!address) return;
                      const ok = await saveLinkedAddresses();
                      if (ok) toastSuccess("Linked addresses saved");
                      else toastError("Failed to save");
                    }}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 rounded-lg text-sm font-medium text-white transition-colors"
                  >
                    {linkedSaving ? "Saving…" : "Save linked addresses"}
                  </button>
                    </>
                  )}
                </div>

                {/* Onboarding / Proofs */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <FileCheck className="w-5 h-5 text-violet-400" /> Onboarding & proofs
                    </h2>
                    {onboardingStatus?.has_agent && (
                      <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">Agent initialized</span>
                    )}
                  </div>
                  {onboardingStatus ? (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-400">Status</span>
                        <span className={onboardingStatus.has_agent ? "text-emerald-400" : "text-amber-400"}>
                          {onboardingStatus.has_agent ? "Completed" : "In progress"}
                        </span>
                      </div>
                      {onboardingStatus.identity_commitment && (
                        <div className="flex justify-between items-center font-mono text-xs">
                          <span className="text-zinc-400">Identity commitment</span>
                          <span className="text-zinc-500 truncate max-w-[200px]">
                            {onboardingStatus.identity_commitment.length > 20
                              ? `${onboardingStatus.identity_commitment.slice(0, 10)}...${onboardingStatus.identity_commitment.slice(-8)}`
                              : onboardingStatus.identity_commitment}
                          </span>
                        </div>
                      )}
                      {onboardingStatus.fact_hash && (
                        <div className="flex justify-between items-center font-mono text-xs">
                          <span className="text-zinc-400">Fact hash</span>
                          <span className="text-zinc-500 truncate max-w-[200px]">
                            {onboardingStatus.fact_hash.length > 20
                              ? `${onboardingStatus.fact_hash.slice(0, 10)}...${onboardingStatus.fact_hash.slice(-8)}`
                              : onboardingStatus.fact_hash}
                          </span>
                        </div>
                      )}
                      {!onboardingStatus.has_agent && (
                        <Link href="/agent?tab=onboarding" className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium text-sm">
                          <Star className="w-4 h-4" /> Complete onboarding
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="text-zinc-400 text-sm">
                      <p>Onboarding status is loaded from the agent flow.</p>
                      <Link href="/agent?tab=onboarding" className="mt-2 inline-flex items-center gap-2 text-violet-400 hover:text-violet-300 text-sm">
                        Open onboarding <Star className="w-3 h-3" />
                      </Link>
                    </div>
                  )}
                </div>

                {/* Tier Benefits */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Lock className="w-5 h-5 text-zinc-400" /> Tier Benefits</h2>
                  <div className="grid md:grid-cols-3 gap-4">
                    {tiers.map((t: any) => (
                      <div key={t.tier} className={`p-4 rounded-lg border transition-all ${t.tier === userRep?.tier ? "bg-emerald-600/20 border-emerald-500 scale-105" : "border-zinc-700 hover:border-zinc-600"}`}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-semibold text-lg">{t.tier_name}</div>
                          {t.tier === userRep?.tier && <CheckCircle className="w-5 h-5 text-emerald-400" />}
                        </div>
                        <ul className="text-sm text-zinc-400 space-y-1.5">
                          <li className="flex justify-between"><span>Proof mode:</span><span className="text-white">{t.proof_requirement?.split(" ")[0] || "Full"}</span></li>
                          <li className="flex justify-between"><span>Deposits/day:</span><span className="text-white">{t.max_deposits_per_day}</span></li>
                          <li className="flex justify-between"><span>Max position:</span><span className="text-white">{t.max_position_eth || "∞"} ETH</span></li>
                          <li className="flex justify-between"><span>Relayer:</span><span className={t.relayer_access ? "text-emerald-400" : "text-zinc-500"}>{t.relayer_access ? "Yes" : "No"}</span></li>
                          <li className="flex justify-between"><span>Protocol fee:</span><span className="text-white">{t.protocol_fee_pct}%</span></li>
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Upgrade Section */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><ArrowUp className="w-5 h-5 text-zinc-400" /> Tier Upgrade</h2>
                  {canUpgrade ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-emerald-400 font-medium">You&#39;re eligible for an upgrade!</p>
                        <p className="text-sm text-zinc-400">You have {userRep?.successful_txns} successful transactions</p>
                      </div>
                      <button onClick={handleRequestUpgrade} disabled={isLoading} className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50">
                        <ArrowUp className="w-4 h-4" /> Upgrade Tier
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-zinc-400">
                      <Clock className="w-5 h-5" />
                      <div>
                        <p>Complete more transactions to unlock the next tier</p>
                        <p className="text-sm text-zinc-500">
                          {userRep?.tier === 0 ? `${5 - (userRep?.successful_txns || 0)} more txns for Standard` : 
                           userRep?.tier === 1 ? `${20 - (userRep?.successful_txns || 0)} more txns for Express` : 
                           "You&#39;re at the highest tier!"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Collateral Tab */}
            {activeTab === "collateral" && (
              <div className="space-y-6">
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Coins className="w-5 h-5 text-amber-400" /> Stake Collateral</h2>
                  <p className="text-sm text-zinc-400 mb-4">Staking collateral unlocks higher tiers and shows commitment to the protocol. Collateral can be slashed for malicious behavior.</p>
                  
                  <div className="bg-zinc-800/50 rounded-lg p-4 mb-4">
                    <div className="text-sm text-zinc-400 mb-1">Current Collateral</div>
                    <div className="text-3xl font-bold">{userRep?.collateral_eth?.toFixed(4) || 0} ETH</div>
                  </div>

                  <div className="flex gap-4">
                    <input type="number" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} placeholder="Amount in ETH" className="flex-1 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500 focus:outline-none" step="0.01" min="0" />
                    <button onClick={handleStakeCollateral} disabled={isLoading} className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium disabled:opacity-50">
                      {isLoading ? "Staking..." : "Stake"}
                    </button>
                  </div>

                  <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="text-amber-300 font-medium">Collateral Risk</p>
                        <p className="text-zinc-400">Collateral may be slashed if you submit invalid proofs or attempt malicious actions. Express tier users have higher slashing risk.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Relayer Tab */}
            {activeTab === "relayer" && (
              <div className="space-y-6">
                {!canUseRelayer ? (
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 text-center">
                    <Lock className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                    <h3 className="text-xl font-semibold mb-2">Relayer Access Locked</h3>
                    <p className="text-zinc-400 mb-4">Private relayer is available for Standard tier and above.</p>
                    <p className="text-sm text-zinc-500">Complete {5 - (userRep?.successful_txns || 0)} more transactions to unlock.</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Send className="w-5 h-5 text-violet-400" /> Private Withdrawal</h2>
                      <p className="text-sm text-zinc-400 mb-4">Withdraw to a fresh address privately. The relayer breaks the on-chain link between your source and destination.</p>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-zinc-400 mb-2">Amount (ETH)</label>
                          <input type="number" value={relayAmount} onChange={(e) => setRelayAmount(e.target.value)} className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-violet-500 focus:outline-none" step="0.01" min="0" />
                        </div>
                        <div>
                          <label className="block text-sm text-zinc-400 mb-2">Destination Address</label>
                          <input type="text" value={relayDestination} onChange={(e) => setRelayDestination(e.target.value)} placeholder="0x..." className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-violet-500 focus:outline-none font-mono" />
                        </div>
                        <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                          <span className="text-sm text-zinc-400">Relay Fee ({userRep?.tier === 1 ? "1%" : "0.5%"})</span>
                          <span className="font-medium">{(parseFloat(relayAmount || "0") * (userRep?.tier === 1 ? 0.01 : 0.005)).toFixed(4)} ETH</span>
                        </div>
                        <button onClick={handleRelayRequest} disabled={isLoading || !relayDestination} className="w-full py-3 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                          <Send className="w-4 h-4" /> {isLoading ? "Requesting..." : "Request Relay"}
                        </button>
                      </div>
                    </div>

                    {/* Pending Relays */}
                    {pendingRelays.length > 0 && (
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                        <h3 className="font-semibold mb-4">Pending Relays</h3>
                        <div className="space-y-3">
                          {pendingRelays.map((r) => (
                            <div key={r.request_id} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                              <div>
                                <div className="font-mono text-sm">{r.destination.slice(0, 10)}...{r.destination.slice(-8)}</div>
                                <div className="text-xs text-zinc-500">{(parseInt(r.amount_wei) / 1e18).toFixed(4)} ETH</div>
                              </div>
                              <span className={`px-2 py-1 text-xs rounded ${r.status === "pending" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                                {r.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Agents Tab */}
            {activeTab === "agents" && address && (
              <div className="space-y-6">
                <MyAgents userAddress={address} />
                
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-cyan-400" />
                    Compose Custom Agents
                  </h3>
                  <p className="text-sm text-zinc-400 mb-4">
                    Create custom agents by composing multiple zkML models. Each agent runs 
                    proofs in parallel and executes based on your decision logic.
                  </p>
                  <Link 
                    href="/agent?tab=models" 
                    className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-medium transition-all"
                  >
                    <Brain className="w-4 h-4" />
                    Open Model Composer
                  </Link>
                </div>
              </div>
            )}

            {/* Compliance Tab */}
            {activeTab === "compliance" && address && (
              <div className="space-y-6">
                {/* Compliance Profiles Section */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FileCheck className="w-5 h-5 text-emerald-400" /> Compliance Profiles
                  </h2>
                  <p className="text-sm text-zinc-400 mb-4">
                    Generate selective disclosure proofs to attest compliance without revealing sensitive data.
                  </p>
                  
                  {complianceProfiles.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {complianceProfiles.map((profile: any, idx: number) => (
                        <div key={idx} className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium capitalize">{profile.profile_type}</span>
                            <span className={`px-2 py-1 text-xs rounded ${profile.verified ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                              {profile.verified ? "Verified" : "Pending"}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-500">
                            Generated: {new Date(profile.created_at * 1000).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <FileCheck className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                      <p className="text-zinc-400 mb-4">No compliance profiles generated yet.</p>
                      <Link href="/agent?tab=disclosure" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-all inline-flex items-center gap-2">
                        <Shield className="w-4 h-4" /> Generate Compliance Proof
                      </Link>
                    </div>
                  )}
                </div>

                {/* Profile Types */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h3 className="font-semibold mb-4">Available Profile Types</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="w-4 h-4 text-blue-400" />
                        <span className="font-medium">KYC Eligibility</span>
                      </div>
                      <p className="text-xs text-zinc-400">Prove identity eligibility without revealing personal data.</p>
                    </div>
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span className="font-medium">Risk Compliance</span>
                      </div>
                      <p className="text-xs text-zinc-400">Attest risk score is below threshold.</p>
                    </div>
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        <span className="font-medium">Performance Proof</span>
                      </div>
                      <p className="text-xs text-zinc-400">Prove historical returns without revealing positions.</p>
                    </div>
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Coins className="w-4 h-4 text-violet-400" />
                        <span className="font-medium">Portfolio Aggregation</span>
                      </div>
                      <p className="text-xs text-zinc-400">Aggregate cross-chain positions with privacy.</p>
                    </div>
                  </div>
                </div>

                {/* Pool Safety — checked on Agent when you run rebalances */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-cyan-400" /> Pool Safety
                  </h3>
                  <p className="text-sm text-zinc-400 mb-4">
                    Pool safety is checked when you run rebalances on the Agent. zkML anomaly detection analyzes pools before execution.
                  </p>
                  <Link href="/agent" className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
                    Open Agent <ArrowUp className="w-4 h-4 rotate-90" />
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
