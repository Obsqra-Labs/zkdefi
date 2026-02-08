"use client";

import { useState, useEffect, useCallback } from "react";
import { ProtocolPanel } from "@/components/zkdefi/ProtocolPanel";
import { ActivityLog } from "@/components/zkdefi/ActivityLog";
import { CompliancePanel } from "@/components/zkdefi/CompliancePanel";
import { PrivateTransferPanel } from "@/components/zkdefi/PrivateTransferPanel";
import { ShieldedPoolPanel } from "@/components/zkdefi/ShieldedPoolPanel";
import { FullPrivacyPoolPanel } from "@/components/zkdefi/FullPrivacyPoolPanel";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { PositionChart } from "@/components/zkdefi/PositionChart";
import { SessionKeyManager } from "@/components/zkdefi/SessionKeyManager";
import { AgentRebalancer } from "@/components/zkdefi/AgentRebalancer";
import { OnboardingWizard } from "@/components/zkdefi/OnboardingWizard";
import { AllocationPools } from "@/components/zkdefi/AllocationPools";
import { useAccount } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { Shield, Key, Brain, TrendingUp, User, ArrowRight, Zap, Lock, ExternalLink, Boxes } from "lucide-react";
import { ModelComposer } from "@/components/zkdefi/ModelComposer";
import { MyAgents } from "@/components/zkdefi/MyAgents";
import { BrainVisualizer } from "@/components/zkdefi/BrainVisualizer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";
const FETCH_TIMEOUT_MS = 15000;

type MainTab = "dashboard" | "pools" | "agent" | "models";
type PoolType = "conservative" | "neutral" | "aggressive";

interface UserTier {
  tier: number;
  tier_name: string;
  proof_requirement: string;
  max_deposits_per_day: number;
}

interface MarketData {
  jediswap: { tvl: number; apy_bps: number };
  ekubo: { tvl: number; apy_bps: number };
  timestamp: number;
}

export default function AgentPage() {
  const { address, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("dashboard");
  const [selectedPool, setSelectedPool] = useState<PoolType>("neutral");
  const [userTier, setUserTier] = useState<UserTier | null>(null);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [marketDataError, setMarketDataError] = useState<string | null>(null);
  const [totalPosition, setTotalPosition] = useState<string>("0");
  const [positionError, setPositionError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [positions, setPositions] = useState<{ [key: string]: number }>({});
  const [agentStatus, setAgentStatus] = useState<"idle" | "monitoring" | "executing">("idle");
  const [agentRefreshTrigger, setAgentRefreshTrigger] = useState(0);

  useEffect(() => setMounted(true), []);

  // Check if user has completed onboarding
  useEffect(() => {
    if (mounted && isConnected && address) {
      const onboarded = localStorage.getItem(`zkdefi_onboarded_${address}`);
      if (!onboarded) {
        setShowOnboarding(true);
      } else {
        setHasOnboarded(true);
      }
    }
  }, [mounted, isConnected, address]);

  // Fetch user tier
  useEffect(() => {
    if (!mounted || !isConnected || !address) return;
    fetch(`${API_BASE}/api/v1/zkdefi/reputation/user/${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.current_tier !== undefined) {
          setUserTier({
            tier: data.current_tier,
            tier_name: data.current_tier === 0 ? "Strict" : data.current_tier === 1 ? "Standard" : "Express",
            proof_requirement: data.current_tier === 0 ? "Full proof" : data.current_tier === 1 ? "Constraint proof" : "Batched",
            max_deposits_per_day: data.current_tier === 0 ? 2 : data.current_tier === 1 ? 10 : 50,
          });
        }
      })
      .catch(() => {});
  }, [mounted, isConnected, address]);

  const fetchMarketData = useCallback(() => {
    setMarketDataError(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    fetch(`${API_BASE}/api/v1/zkdefi/oracle/market-data`, { signal: ctrl.signal })
      .then((r) => {
        clearTimeout(t);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setMarketData(data);
        setMarketDataError(null);
      })
      .catch((e) => {
        clearTimeout(t);
        setMarketDataError(e.name === "AbortError" ? "Request timed out." : "Couldn't reach API.");
      });
  }, []);

  useEffect(() => {
    if (!mounted) return;
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 30000);
    return () => clearInterval(interval);
  }, [mounted, fetchMarketData]);

  // Fetch positions with timeout and error handling (includes private commitments)
  useEffect(() => {
    if (!mounted || !isConnected || !address) return;
    setPositionError(null);
    
    // Get private commitments from ALL localStorage sources
    let privateTotal = BigInt(0);
    let privateCount = 0;
    const COMMITMENT_KEYS = [
      `zkdefi_commitments_${address}`,   // Stealth Transfer
      `zkdefi_shielded_${address}`,      // Shielded Pool
      `zkdefi_fullprivacy_${address}`,   // Full Privacy Pool
    ];
    
    for (const key of COMMITMENT_KEYS) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const commitments = JSON.parse(stored);
          for (const c of commitments) {
            // Each commitment stores amount in wei (could be amount or balance field)
            const amt = BigInt(c.amount || c.balance || "0");
            privateTotal += amt;
            privateCount++;
          }
        }
      } catch (e) {
        console.warn(`Failed to read commitments from ${key}:`, e);
      }
    }
    
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    fetch(`${API_BASE}/api/v1/zkdefi/position/${address}?protocol_id=0`, { signal: ctrl.signal })
      .then((r) => {
        clearTimeout(t);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        const publicPos = BigInt(d.position ?? "0");
        const totalPos = publicPos + privateTotal;
        setTotalPosition(totalPos.toString());
        setPositions({ 
          pools: parseInt(d.position) || 0,
          private: Number(privateTotal / BigInt(10**18)), // Convert wei to human-readable
          privateCount,
        });
        setPositionError(null);
      })
      .catch((e) => {
        clearTimeout(t);
        // Even if API fails, show private positions if available
        if (privateTotal > BigInt(0)) {
          setTotalPosition(privateTotal.toString());
          setPositions({ pools: 0, private: Number(privateTotal / BigInt(10**18)), privateCount });
          setPositionError(null);
        } else {
          setPositionError(e.name === "AbortError" ? "Request timed out." : "Couldn't reach API.");
        }
      });
  }, [mounted, address, isConnected]);

  const handleOnboardingComplete = () => {
    if (address) {
      localStorage.setItem(`zkdefi_onboarded_${address}`, "true");
    }
    setShowOnboarding(false);
    setHasOnboarded(true);
  };

  // Treat "ready" only when we have address (avoids black/blank when autoConnect lags)
  const hasAccount = isConnected && !!address;
  const showConnectGate = mounted && !hasAccount && walletSettled;
  const showLoading = !mounted || (!hasAccount && !walletSettled);

  // Show onboarding wizard for first-time users (only when we have address)
  if (showOnboarding && hasAccount) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      {/* Header - always visible for better UX */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">zkde.fi</h1>
                <p className="text-xs text-zinc-400">Reputation-tiered private DeFi</p>
              </div>
            </a>
            <nav className="hidden md:flex items-center gap-1 ml-4">
              <a href="/agent" className="px-3 py-1.5 text-sm font-medium text-white bg-zinc-800 rounded-lg">Dashboard</a>
              <a href="/profile" className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all">Profile</a>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {userTier && (
              <a href="/profile" className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700 hover:border-zinc-600 transition-all">
                <User className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-medium">{userTier.tier_name}</span>
                <span className={`px-1.5 py-0.5 text-xs rounded ${userTier.tier === 0 ? "bg-blue-500/20 text-blue-400" : userTier.tier === 1 ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400"}`}>
                  Tier {userTier.tier}
                </span>
              </a>
            )}
            <ConnectButton />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {showLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-500">Connecting to Starknet...</p>
          </div>
        ) : showConnectGate ? (
          <div className="text-center py-20">
            <Shield className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
            <h2 className="text-2xl font-bold mb-2">Connect Wallet</h2>
            <p className="text-zinc-400 mb-6">Connect your wallet to access the autonomous agent</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="glass rounded-xl border border-zinc-800 p-4">
                <p className="text-xs text-zinc-400 mb-1">Total Position</p>
                <p className="text-2xl font-bold">
                  {positionError ? (
                    <span className="text-amber-500 text-base">Unavailable</span>
                  ) : totalPosition === "0" ? (
                    <span className="text-zinc-500">No deposits yet</span>
                  ) : (
                    `${(Number(BigInt(totalPosition)) / 1e18).toFixed(4)} ETH`
                  )}
                </p>
                {!positionError && positions.privateCount > 0 && (
                  <p className="text-xs text-emerald-400 mt-1">
                    {positions.privateCount} private commitment{positions.privateCount > 1 ? "s" : ""}
                  </p>
                )}
                {positionError && <p className="text-xs text-zinc-500 mt-1">{positionError}</p>}
              </div>
              <div className="glass rounded-xl border border-zinc-800 p-4">
                <p className="text-xs text-zinc-400 mb-1">Active Pool</p>
                <p className="text-2xl font-bold capitalize">{selectedPool}</p>
              </div>
              <div className="glass rounded-xl border border-zinc-800 p-4">
                <p className="text-xs text-zinc-400 mb-1">Agent Status</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${agentStatus === "idle" ? "bg-zinc-500" : agentStatus === "monitoring" ? "bg-emerald-500 animate-pulse" : "bg-orange-500 animate-pulse"}`} />
                  <p className="text-lg font-medium capitalize">{agentStatus}</p>
                </div>
              </div>
              <div className="glass rounded-xl border border-zinc-800 p-4">
                <p className="text-xs text-zinc-400 mb-1">Proof Mode</p>
                <p className="text-lg font-medium">{userTier?.proof_requirement || "Loading..."}</p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-2 mb-6 border-b border-zinc-800 pb-4">
              <button
                onClick={() => setMainTab("dashboard")}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${mainTab === "dashboard" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
              >
                <TrendingUp className="w-4 h-4" />
                Dashboard
              </button>
              <button
                onClick={() => setMainTab("pools")}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${mainTab === "pools" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
              >
                <Shield className="w-4 h-4" />
                Allocation Pools
              </button>
              <button
                onClick={() => setMainTab("agent")}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${mainTab === "agent" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
              >
                <Brain className="w-4 h-4" />
                Agent Controls
              </button>
              <button
                onClick={() => setMainTab("models")}
                className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${mainTab === "models" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
              >
                <Boxes className="w-4 h-4" />
                zkML Models
              </button>
            </div>

            {/* Dashboard Tab */}
            {mainTab === "dashboard" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  {/* Market Data */}
                  <div className="glass rounded-xl border border-zinc-800 p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-emerald-400" />
                      Live Market Data
                      <span className="ml-auto text-xs text-zinc-500">Updates every 30s</span>
                    </h3>
                    {marketData ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700/50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">JediSwap</span>
                            <span className="text-emerald-400">{(marketData.jediswap.apy_bps / 100).toFixed(1)}% APY</span>
                          </div>
                          <p className="text-sm text-zinc-400">TVL: ${(marketData.jediswap.tvl / 1e6).toFixed(1)}M</p>
                        </div>
                        <div className="bg-zinc-800/50 rounded-lg p-4 border border-zinc-700/50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">Ekubo</span>
                            <span className="text-emerald-400">{(marketData.ekubo.apy_bps / 100).toFixed(1)}% APY</span>
                          </div>
                          <p className="text-sm text-zinc-400">TVL: ${(marketData.ekubo.tvl / 1e6).toFixed(1)}M</p>
                        </div>
                      </div>
                    ) : marketDataError ? (
                      <div className="text-center py-4">
                        <p className="text-amber-500 mb-2">Couldn&apos;t load market data.</p>
                        <p className="text-sm text-zinc-500 mb-3">{marketDataError} Check backend is up and <code className="text-zinc-400">NEXT_PUBLIC_API_URL</code> points to it.</p>
                        <button
                          type="button"
                          onClick={fetchMarketData}
                          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div className="text-zinc-500 text-center py-4">Loading market data...</div>
                    )}
                  </div>

                  {/* Current Allocation */}
                  <div className="glass rounded-xl border border-zinc-800 p-6">
                    <h3 className="font-semibold mb-4">Current Allocation: <span className="text-emerald-400 capitalize">{selectedPool}</span></h3>
                    <AllocationPools currentPool={selectedPool} onSelectPool={(p) => setSelectedPool(p as PoolType)} />
                  </div>

                  {/* Private Transfer */}
                  <div className="glass rounded-xl border border-violet-800/50 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Lock className="w-5 h-5 text-violet-400" />
                      <h3 className="font-semibold">Private Transfer</h3>
                      <span className="ml-auto px-2 py-1 text-xs rounded bg-violet-600/20 text-violet-300 border border-violet-600/30">Fund Agent</span>
                    </div>
                    <PrivateTransferPanel />
                  </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                  {/* Tier Info */}
                  {userTier && (
                    <div className="glass rounded-xl border border-zinc-800 p-6">
                      <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <User className="w-5 h-5 text-zinc-400" />
                        Reputation Tier
                      </h3>
                      <div className={`rounded-lg p-4 mb-4 ${userTier.tier === 0 ? "bg-blue-500/10 border border-blue-500/30" : userTier.tier === 1 ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-orange-500/10 border border-orange-500/30"}`}>
                        <div className="text-lg font-bold">{userTier.tier_name}</div>
                        <div className="text-sm text-zinc-400">{userTier.proof_requirement}</div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-zinc-400">Max deposits/day</span><span>{userTier.max_deposits_per_day}</span></div>
                      </div>
                      <a href="/profile" className="mt-4 flex items-center justify-center gap-2 w-full py-2 border border-zinc-700 rounded-lg text-sm hover:bg-zinc-800 transition-all">
                        Manage Tier <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}

                  <PositionChart />
                  <CompliancePanel />
                </div>
              </div>
            )}

            {/* Pools Tab */}
            {mainTab === "pools" && (
              <div className="space-y-6">
                {/* Shielded Pool - unified private deposits/withdrawals with relayer option */}
                {/* Full Privacy Pool - maximum privacy with merkle tree */}
                <FullPrivacyPoolPanel />
                
                {/* Shielded Pool - standard privacy with proof-gating */}
                <ShieldedPoolPanel />
                
                {/* Info about proof-gating */}
                <div className="glass rounded-xl border border-zinc-800 p-6">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    Human vs Agent: When Proofs Are Required
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/30">
                      <p className="text-sm font-medium text-emerald-300 mb-2">You Sign (Human)</p>
                      <ul className="text-xs text-zinc-400 space-y-1">
                        <li>• Privacy proof: Yes (hides amounts)</li>
                        <li>• Execution proof: <span className="text-emerald-400">No</span> (signature = authorization)</li>
                        <li>• Result: Fast, simple, private</li>
                      </ul>
                    </div>
                    <div className="p-4 rounded-lg bg-violet-950/20 border border-violet-800/30">
                      <p className="text-sm font-medium text-violet-300 mb-2">Agent Acts (Session Key)</p>
                      <ul className="text-xs text-zinc-400 space-y-1">
                        <li>• Privacy proof: Yes (hides amounts)</li>
                        <li>• Execution proof: <span className="text-violet-400">Yes</span> (proof = authorization)</li>
                        <li>• Result: Trustless autonomous execution</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Agent Tab */}
            {mainTab === "agent" && address && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <BrainVisualizer 
                    userAddress={address} 
                    onBrainComplete={(passed) => {
                      setAgentStatus(passed ? "executing" : "idle");
                    }}
                  />
                  <SessionKeyManager userAddress={address} onSessionGranted={(sessionId) => setActiveSessionId(sessionId)} />
                  <AgentRebalancer userAddress={address} sessionId={activeSessionId ?? undefined} positions={positions} />
                </div>
                <div className="space-y-6">
                  <div className="glass rounded-xl border border-zinc-800 p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Brain className="w-5 h-5 text-cyan-400" />
                      How It Works
                    </h3>
                    <div className="space-y-3 text-sm text-zinc-400">
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-emerald-600/20 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">1</div>
                        <p>Grant session key with constraints (max position, duration)</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-emerald-600/20 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">2</div>
                        <p>Agent monitors market data and your selected pool</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-emerald-600/20 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">3</div>
                        <p>Rebalances are verified by zkML risk models</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-emerald-600/20 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0">4</div>
                        <p>Proofs submitted based on your reputation tier</p>
                      </div>
                    </div>
                  </div>
                  <ActivityLog />
                </div>
              </div>
            )}

            {/* Models Tab - zkML Marketplace */}
            {mainTab === "models" && address && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <ModelComposer
                    userAddress={address}
                    onAgentCreated={() => setAgentRefreshTrigger((t) => t + 1)}
                  />
                  
                  {/* Info Panel */}
                  <div className="glass rounded-xl border border-zinc-800 p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Boxes className="w-5 h-5 text-cyan-400" />
                      About zkML Models
                    </h3>
                    <div className="space-y-3 text-sm text-zinc-400">
                      <p>
                        Compose multiple zkML models into a custom agent. Each model generates a 
                        zero-knowledge proof that verifies a specific constraint without revealing 
                        your private data.
                      </p>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                        <p className="text-xs font-medium text-cyan-400 mb-2">Groth16 Models</p>
                        <p className="text-xs">Fast (~10s), compact proofs for portfolio constraints like risk scores, correlation, and diversification.</p>
                      </div>
                      <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
                        <p className="text-xs font-medium text-violet-400 mb-2">RISC Zero Models</p>
                        <p className="text-xs">Advanced proofs for complex computations like cross-chain credit scoring using neural networks.</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-6">
                  <MyAgents userAddress={address} refreshTrigger={agentRefreshTrigger} />
                  
                  {/* Usage Guide */}
                  <div className="glass rounded-xl border border-zinc-800 p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Brain className="w-5 h-5 text-emerald-400" />
                      How to Use
                    </h3>
                    <div className="space-y-3 text-sm text-zinc-400">
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-cyan-600/20 flex items-center justify-center text-xs font-bold text-cyan-400 flex-shrink-0">1</div>
                        <p>Select models to combine into your agent</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-cyan-600/20 flex items-center justify-center text-xs font-bold text-cyan-400 flex-shrink-0">2</div>
                        <p>Choose decision logic (AND = all must pass, OR = any can pass)</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-cyan-600/20 flex items-center justify-center text-xs font-bold text-cyan-400 flex-shrink-0">3</div>
                        <p>Execute to generate proofs in parallel</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-cyan-600/20 flex items-center justify-center text-xs font-bold text-cyan-400 flex-shrink-0">4</div>
                        <p>Results include execution proof for on-chain submission</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
