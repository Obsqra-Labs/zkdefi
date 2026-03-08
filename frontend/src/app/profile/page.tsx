"use client";
import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { Shield, TrendingUp, Lock, Coins, ArrowUp, Send, Clock, CheckCircle, AlertTriangle, Brain } from "lucide-react";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { toastSuccess, toastError } from "@/lib/toast";
import { MyAgents } from "@/components/zkdefi/MyAgents";
import { apiUrl } from "@/lib/api/client";

interface RelayRequest {
  request_id: string;
  amount_wei: string;
  destination: string;
  status: string;
  created_at: number;
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { settled: walletSettled } = useWalletSettled();
  const [mounted, setMounted] = useState(false);
  const [userRep, setUserRep] = useState<any>(null);
  const [tiers, setTiers] = useState<any[]>([]);
  const [stakeAmount, setStakeAmount] = useState("0.1");
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "collateral" | "relayer" | "agents">("overview");
  const [relayAmount, setRelayAmount] = useState("0.01");
  const [relayDestination, setRelayDestination] = useState("");
  const [pendingRelays, setPendingRelays] = useState<RelayRequest[]>([]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch(apiUrl("/api/v1/zkdefi/reputation/tiers")).then(r => r.json()).then(setTiers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!address) return;
    fetch(apiUrl(`/api/v1/zkdefi/reputation/user/${address}`)).then(r => r.json()).then(setUserRep).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!address) return;
    fetch(apiUrl(`/api/v1/zkdefi/relayer/pending/${address}`)).then(r => r.json()).then(setPendingRelays).catch(() => {});
  }, [address]);

  const handleStakeCollateral = async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/v1/zkdefi/reputation/stake-collateral"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, amount_eth: parseFloat(stakeAmount) }),
      });
      if (res.ok) {
        toastSuccess("Collateral staked");
        // Refresh user data
        const updated = await fetch(apiUrl(`/api/v1/zkdefi/reputation/user/${address}`)).then(r => r.json());
        setUserRep(updated);
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
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/v1/zkdefi/reputation/upgrade-tier"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (data.success) {
        toastSuccess(`Upgraded to ${data.new_tier_name}`);
        setUserRep({ ...userRep, tier: data.new_tier, tier_name: data.new_tier_name });
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
      const res = await fetch(apiUrl("/api/v1/zkdefi/relayer/request"), {
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
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-lg">zkde.fi</span>
            </a>
            <nav className="hidden md:flex items-center gap-1">
              <a href="/agent" className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all">Dashboard</a>
              <a href="/profile" className="px-3 py-1.5 text-sm font-medium text-white bg-zinc-800 rounded-lg">Profile</a>
            </nav>
          </div>
          <ConnectButton />
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {!mounted || (!walletSettled && !isConnected) ? (
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
            </div>

            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                    <div className="text-sm text-zinc-400 mb-1">Current Tier</div>
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
                        <p className="text-emerald-400 font-medium">You're eligible for an upgrade!</p>
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
                           "You're at the highest tier!"}
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
                  <a 
                    href="/agent?tab=models" 
                    className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-medium transition-all"
                  >
                    <Brain className="w-4 h-4" />
                    Open Model Composer
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
