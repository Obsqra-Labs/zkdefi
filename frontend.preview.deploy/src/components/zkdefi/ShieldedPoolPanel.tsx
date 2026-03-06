"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { ProofVisualizer } from "./ProofVisualizer";
import { ConnectButton } from "./ConnectButton";
import { toastSuccess, toastError } from "@/lib/toast";
import { 
  Lock, Shield, Eye, EyeOff, ArrowRight, CheckCircle2, 
  ArrowDownToLine, ArrowUpFromLine, Send, Info, AlertTriangle 
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";
const SHIELDED_POOL_ADDRESS = process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS || 
                              process.env.NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS || "";

type PoolType = "conservative" | "neutral" | "aggressive";
type Mode = "deposit" | "withdraw";
type Step = 1 | 2 | 3 | 4;

const POOL_INFO: Record<PoolType, { name: string; allocation: string; risk: number; color: string }> = {
  conservative: { name: "Conservative", allocation: "80% JediSwap / 20% Ekubo", risk: 32, color: "blue" },
  neutral: { name: "Neutral", allocation: "50% JediSwap / 50% Ekubo", risk: 48, color: "emerald" },
  aggressive: { name: "Aggressive", allocation: "20% JediSwap / 80% Ekubo", risk: 67, color: "orange" },
};

interface Commitment {
  commitment: string;
  balance: string;
  pool_type: PoolType;
  index: number;
}

interface UserTier {
  tier: number;
  tier_name: string;
  can_use_relayer: boolean;
  relayer_fee_pct: number;
  relayer_delay_seconds: number;
}

export function ShieldedPoolPanel() {
  const { address, account, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  
  // Mode and pool selection
  const [mode, setMode] = useState<Mode>("deposit");
  const [selectedPool, setSelectedPool] = useState<PoolType>("neutral");
  
  // Form state
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>(1);
  
  // Privacy proof state
  const [commitment, setCommitment] = useState<string | null>(null);
  const [nullifier, setNullifier] = useState<string | null>(null);
  const [proofCalldata, setProofCalldata] = useState<string[] | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  
  // Commitment selection for withdrawals
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [selectedCommitment, setSelectedCommitment] = useState<string | null>(null);
  const [loadingCommitments, setLoadingCommitments] = useState(false);
  
  // Relayer option
  const [useRelayer, setUseRelayer] = useState(false);
  const [relayerDestination, setRelayerDestination] = useState("");
  const [userTier, setUserTier] = useState<UserTier | null>(null);
  
  // Privacy comparison toggle
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => setMounted(true), []);
  
  // Fetch user tier for relayer eligibility
  useEffect(() => {
    if (mounted && address) {
      fetchUserTier();
      if (mode === "withdraw") {
        fetchCommitments();
      }
    }
  }, [mounted, address, mode]);

  const fetchUserTier = async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/reputation/${address}`);
      const data = await res.json();
      setUserTier({
        tier: data.tier || 0,
        tier_name: data.tier_name || "Strict",
        can_use_relayer: data.tier >= 1,
        relayer_fee_pct: data.tier === 2 ? 0.5 : 1,
        relayer_delay_seconds: data.tier === 2 ? 0 : 3600,
      });
    } catch {
      setUserTier({ tier: 0, tier_name: "Strict", can_use_relayer: false, relayer_fee_pct: 1, relayer_delay_seconds: 3600 });
    }
  };

  const fetchCommitments = async () => {
    if (!address) return;
    setLoadingCommitments(true);
    try {
      const stored = localStorage.getItem(`zkdefi_shielded_${address}`);
      if (stored) {
        setCommitments(JSON.parse(stored));
      } else {
        setCommitments([]);
      }
    } catch {
      setCommitments([]);
    }
    setLoadingCommitments(false);
  };

  const walletConnected = mounted && isConnected;

  const resetFlow = () => {
    setStep(1);
    setCommitment(null);
    setNullifier(null);
    setProofCalldata(null);
    setTxHash(null);
    setAmount("");
    setSelectedCommitment(null);
    setUseRelayer(false);
    setRelayerDestination("");
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    resetFlow();
    if (newMode === "withdraw") {
      fetchCommitments();
    }
  };

  // ==================== DEPOSIT FLOW ====================

  const handleGenerateDepositProof = async () => {
    if (!address || !amount) return;
    setStep(2);

    try {
      const amountWei = (BigInt(amount) * BigInt(1e18)).toString();
      
      // Generate privacy proof (commitment + Groth16 proof)
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/shielded_deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          pool_type: selectedPool,
          amount: amountWei,
        }),
      });

      const data = await res.json();
      if (data.commitment) {
        setCommitment(data.commitment);
        setProofCalldata(data.proof_calldata || []);
        setStep(3);
        toastSuccess("Privacy proof generated!");
      } else {
        toastError(data.message || "Failed to generate proof");
        setStep(1);
      }
    } catch (e) {
      toastError(`Error: ${e}`);
      setStep(1);
    }
  };

  const handleSignDeposit = async () => {
    if (!account || !commitment || !proofCalldata || !SHIELDED_POOL_ADDRESS) {
      toastError("Missing data for deposit");
      return;
    }

    setStep(4);
    try {
      const amountWei = BigInt(amount) * BigInt(1e18);
      const amountLow = amountWei % BigInt(2 ** 128);
      const amountHigh = amountWei / BigInt(2 ** 128);
      const commitmentFelt = BigInt(commitment);
      const poolTypeNum = selectedPool === "conservative" ? 0 : selectedPool === "neutral" ? 1 : 2;
      const proofFelts = proofCalldata.map((p) => BigInt(p).toString());

      const ETH_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

      // Human-signed: Only privacy proof needed, no execution proof
      const result = await account.execute([
        {
          contractAddress: ETH_TOKEN as `0x${string}`,
          entrypoint: "approve",
          calldata: [SHIELDED_POOL_ADDRESS, amountLow.toString(), amountHigh.toString()],
        },
        {
          contractAddress: SHIELDED_POOL_ADDRESS as `0x${string}`,
          entrypoint: "private_deposit",
          calldata: [
            commitmentFelt.toString(),
            poolTypeNum.toString(),
            amountLow.toString(),
            amountHigh.toString(),
            proofFelts.length.toString(),
            ...proofFelts,
          ],
        },
      ]);

      setTxHash(result.transaction_hash);
      toastSuccess("Private deposit successful!", {
        action: {
          label: "View on explorer",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });

      // Store commitment locally
      if (address) {
        const stored = localStorage.getItem(`zkdefi_shielded_${address}`);
        const existing = stored ? JSON.parse(stored) : [];
        existing.push({
          commitment,
          balance: (BigInt(amount) * BigInt(1e18)).toString(),
          pool_type: selectedPool,
          index: existing.length,
          timestamp: Date.now(),
        });
        localStorage.setItem(`zkdefi_shielded_${address}`, JSON.stringify(existing));
      }
    } catch (e: unknown) {
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Failed: ${err}`);
      setStep(3);
    }
  };

  // ==================== WITHDRAW FLOW ====================

  const handleGenerateWithdrawProof = async () => {
    if (!address || !selectedCommitment || !amount) return;
    setStep(2);

    try {
      const amountWei = (BigInt(amount) * BigInt(1e18)).toString();
      
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/shielded_withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          commitment: selectedCommitment,
          amount: amountWei,
          use_relayer: useRelayer,
          recipient: useRelayer ? relayerDestination : address,
        }),
      });

      const data = await res.json();
      if (data.nullifier) {
        setNullifier(data.nullifier);
        setCommitment(data.commitment);
        setProofCalldata(data.proof_calldata || []);
        setStep(3);
        toastSuccess("Withdrawal proof generated!");
      } else {
        toastError(data.message || "Failed to generate proof");
        setStep(1);
      }
    } catch (e) {
      toastError(`Error: ${e}`);
      setStep(1);
    }
  };

  const handleSignWithdraw = async () => {
    if (!account || !nullifier || !commitment || !proofCalldata || !SHIELDED_POOL_ADDRESS) {
      toastError("Missing data for withdrawal");
      return;
    }

    setStep(4);
    try {
      const amountWei = BigInt(amount) * BigInt(1e18);
      const amountLow = amountWei % BigInt(2 ** 128);
      const amountHigh = amountWei / BigInt(2 ** 128);
      const nullifierFelt = BigInt(nullifier);
      const commitmentFelt = BigInt(commitment);
      const proofFelts = proofCalldata.map((p) => BigInt(p).toString());
      const recipient = useRelayer ? relayerDestination : address;

      let result: { transaction_hash: string };
      if (useRelayer) {
        // Request relayed withdrawal (executed later by relayer)
        result = await account.execute({
          contractAddress: SHIELDED_POOL_ADDRESS as `0x${string}`,
          entrypoint: "request_relayed_withdraw",
          calldata: [
            nullifierFelt.toString(),
            commitmentFelt.toString(),
            amountLow.toString(),
            amountHigh.toString(),
            proofFelts.length.toString(),
            ...proofFelts,
            recipient ?? "",
          ],
        });
        toastSuccess("Relayed withdrawal requested!", {
          action: {
            label: "View on explorer",
            onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
          },
        });
      } else {
        // Direct withdrawal
        result = await account.execute({
          contractAddress: SHIELDED_POOL_ADDRESS as `0x${string}`,
          entrypoint: "private_withdraw",
          calldata: [
            nullifierFelt.toString(),
            commitmentFelt.toString(),
            amountLow.toString(),
            amountHigh.toString(),
            proofFelts.length.toString(),
            ...proofFelts,
            recipient ?? "",
          ],
        });
        toastSuccess("Private withdrawal successful!", {
          action: {
            label: "View on explorer",
            onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
          },
        });
      }

      setTxHash(result.transaction_hash);

      // Update local commitment balance
      if (address && selectedCommitment) {
        const stored = localStorage.getItem(`zkdefi_shielded_${address}`);
        if (stored) {
          const existing = JSON.parse(stored);
          const updated = existing.map((c: Commitment) => {
            if (c.commitment === selectedCommitment) {
              const newBalance = BigInt(c.balance) - amountWei;
              return { ...c, balance: newBalance.toString() };
            }
            return c;
          }).filter((c: Commitment) => BigInt(c.balance) > 0);
          localStorage.setItem(`zkdefi_shielded_${address}`, JSON.stringify(updated));
        }
      }
    } catch (e: unknown) {
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Failed: ${err}`);
      setStep(3);
    }
  };

  const getSelectedCommitmentBalance = () => {
    const c = commitments.find(c => c.commitment === selectedCommitment);
    return c ? (parseInt(c.balance) / 1e18).toFixed(4) : "0";
  };

  return (
    <div className="glass rounded-2xl border border-zinc-800 p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Lock className="w-6 h-6 text-privacy-shielded" />
            Shielded Pool
          </h2>
          <p className="text-sm text-zinc-400">Private {mode} with hidden amounts</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-violet-900/30 text-violet-300 border border-violet-800/50 text-xs font-medium flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Amount Hidden
          </span>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6 p-1 bg-zinc-900/50 rounded-lg border border-zinc-700">
        <button
          onClick={() => switchMode("deposit")}
          className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm transition-all flex items-center justify-center gap-2 ${
            mode === "deposit" ? "bg-violet-600 text-white shadow-lg" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <ArrowDownToLine className="w-4 h-4" />
          Deposit
        </button>
        <button
          onClick={() => switchMode("withdraw")}
          className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm transition-all flex items-center justify-center gap-2 ${
            mode === "withdraw" ? "bg-violet-600 text-white shadow-lg" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <ArrowUpFromLine className="w-4 h-4" />
          Withdraw
        </button>
      </div>

      {/* Loading state */}
      {!mounted && (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}

      {/* Connect wallet prompt */}
      {mounted && !isConnected && (
        <div className="text-center py-12">
          <p className="text-zinc-400 mb-4">Connect wallet to use shielded pools</p>
          <ConnectButton />
        </div>
      )}

      {walletConnected && (
        <>
          {/* Privacy comparison */}
          <div className="mb-6 p-4 rounded-lg bg-zinc-900/50 border border-zinc-700">
            <button
              onClick={() => setShowComparison(!showComparison)}
              className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              {showComparison ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showComparison ? "Hide" : "Show"} privacy comparison
            </button>
            {showComparison && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 grid grid-cols-2 gap-4">
                <div className="p-3 rounded border border-red-500/30 bg-red-950/20">
                  <p className="text-xs font-medium text-red-400 mb-2">Normal Pool (Not Private)</p>
                  <p className="text-xs text-zinc-400">Amount: Visible on-chain</p>
                  <p className="text-xs text-zinc-400">Pool choice: Visible</p>
                  <p className="text-xs text-zinc-400">Address: Linked</p>
                </div>
                <div className="p-3 rounded border border-violet-500/30 bg-violet-950/20">
                  <p className="text-xs font-medium text-violet-400 mb-2">Shielded Pool (Private)</p>
                  <p className="text-xs text-zinc-400">Amount: Hidden (commitment)</p>
                  <p className="text-xs text-zinc-400">Pool choice: Hidden</p>
                  <p className="text-xs text-zinc-400">Address: Unlinkable (w/ relayer)</p>
                </div>
              </motion.div>
            )}
          </div>

          {/* Info banner */}
          <div className="mb-6 p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/30">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-emerald-300 font-medium mb-1">Human-signed = No execution proof needed</p>
                <p className="text-zinc-400">Your wallet signature authorizes the transaction. Privacy proof hides amounts. Execution proofs only required for autonomous agent actions.</p>
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {/* ==================== DEPOSIT STEP 1 ==================== */}
            {mode === "deposit" && step === 1 && (
              <motion.div key="deposit-step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
                {/* Pool Selection */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-3">Select Pool</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(Object.keys(POOL_INFO) as PoolType[]).map((pool) => (
                      <button
                        key={pool}
                        onClick={() => setSelectedPool(pool)}
                        className={`p-4 rounded-lg border text-left transition-all ${
                          selectedPool === pool
                            ? `border-${POOL_INFO[pool].color}-500 bg-${POOL_INFO[pool].color}-950/30`
                            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"
                        }`}
                      >
                        <p className="font-medium text-sm mb-1">{POOL_INFO[pool].name}</p>
                        <p className="text-xs text-zinc-500">{POOL_INFO[pool].allocation}</p>
                        <p className="text-xs text-zinc-500 mt-1">Risk: {POOL_INFO[pool].risk}/100</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">Amount (private)</label>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-lg font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  />
                  <p className="mt-1 text-xs text-zinc-500">This amount will be hidden on-chain</p>
                </div>

                <button
                  onClick={handleGenerateDepositProof}
                  disabled={!amount}
                  className="w-full px-6 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-violet-500/20 flex items-center justify-center gap-2"
                >
                  <Lock className="w-5 h-5" />
                  Generate Privacy Proof
                </button>
              </motion.div>
            )}

            {/* ==================== WITHDRAW STEP 1 ==================== */}
            {mode === "withdraw" && step === 1 && (
              <motion.div key="withdraw-step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
                {/* Commitment Selection */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">Select Commitment</label>
                  {loadingCommitments ? (
                    <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-900/50 text-center">
                      <p className="text-sm text-zinc-400">Loading...</p>
                    </div>
                  ) : commitments.length === 0 ? (
                    <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-900/50 text-center">
                      <p className="text-sm text-zinc-400 mb-2">No shielded positions found</p>
                      <p className="text-xs text-zinc-500">Make a shielded deposit first</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {commitments.map((c) => (
                        <button
                          key={c.commitment}
                          onClick={() => setSelectedCommitment(c.commitment)}
                          className={`w-full p-4 rounded-lg border text-left transition-all ${
                            selectedCommitment === c.commitment
                              ? "border-violet-500 bg-violet-950/30"
                              : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-mono text-sm text-zinc-200">{c.commitment.slice(0, 10)}...{c.commitment.slice(-6)}</p>
                              <p className="text-xs text-zinc-500 mt-1 capitalize">{c.pool_type} pool</p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-semibold">{(parseInt(c.balance) / 1e18).toFixed(4)}</p>
                              <p className="text-xs text-zinc-500">ETH</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Amount */}
                {selectedCommitment && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">Withdraw Amount</label>
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-lg font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    />
                    <p className="mt-1 text-xs text-zinc-500">Max: {getSelectedCommitmentBalance()} ETH</p>
                  </motion.div>
                )}

                {/* Relayer Option */}
                {selectedCommitment && amount && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-700">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useRelayer}
                        onChange={(e) => setUseRelayer(e.target.checked)}
                        disabled={!userTier?.can_use_relayer}
                        className="mt-1 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500 disabled:opacity-50"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Send className="w-4 h-4 text-violet-400" />
                          <span className="font-medium text-sm">Use Private Relayer</span>
                          {!userTier?.can_use_relayer && (
                            <span className="px-2 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded">Tier 1+ required</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-1">
                          Withdraw to a fresh address. Breaks the on-chain link between source and destination.
                        </p>
                        {userTier?.can_use_relayer && (
                          <p className="text-xs text-zinc-400 mt-1">
                            Fee: {userTier.relayer_fee_pct}% • Delay: {userTier.relayer_delay_seconds === 0 ? "Instant" : `${userTier.relayer_delay_seconds / 60} min`}
                          </p>
                        )}
                      </div>
                    </label>

                    {useRelayer && (
                      <div className="mt-4">
                        <label className="block text-sm text-zinc-400 mb-2">Destination Address (fresh wallet)</label>
                        <input
                          type="text"
                          value={relayerDestination}
                          onChange={(e) => setRelayerDestination(e.target.value)}
                          placeholder="0x..."
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-mono text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                        />
                        <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-300">Use a fresh address with no prior transaction history for maximum privacy.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                <button
                  onClick={handleGenerateWithdrawProof}
                  disabled={!selectedCommitment || !amount || (useRelayer && !relayerDestination)}
                  className="w-full px-6 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-violet-500/20 flex items-center justify-center gap-2"
                >
                  <Lock className="w-5 h-5" />
                  Generate Withdrawal Proof
                </button>
              </motion.div>
            )}

            {/* ==================== GENERATING PROOF (STEP 2) ==================== */}
            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ProofVisualizer state="generating" progress={50} step="Computing privacy proof..." />
                <div className="mt-6 text-center space-y-2 text-sm text-zinc-400">
                  <p>Generating commitment...</p>
                  <p>Creating Groth16 proof...</p>
                  <p>Verifying locally...</p>
                </div>
              </motion.div>
            )}

            {/* ==================== PROOF READY (STEP 3) ==================== */}
            {step === 3 && (commitment || nullifier) && (
              <motion.div key="step3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
                <ProofVisualizer state="valid" />

                <div className="glass rounded-lg border border-violet-500/30 bg-violet-950/20 p-4">
                  <div className="flex items-start gap-3">
                    <Lock className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-violet-300 mb-2">
                        {mode === "deposit" ? "Commitment Generated" : "Withdrawal Proof Ready"}
                      </p>
                      {mode === "withdraw" && nullifier && (
                        <div className="mb-3">
                          <p className="text-xs text-zinc-500">Nullifier (prevents double-spend):</p>
                          <p className="font-mono text-xs break-all text-zinc-200">{nullifier.slice(0, 20)}...{nullifier.slice(-10)}</p>
                        </div>
                      )}
                      {commitment && (
                        <div className="mb-3">
                          <p className="text-xs text-zinc-500">Commitment:</p>
                          <p className="font-mono text-xs break-all text-zinc-200">{commitment.slice(0, 20)}...{commitment.slice(-10)}</p>
                        </div>
                      )}
                      <div className="text-xs text-zinc-400 space-y-1">
                        <p>✓ Amount: Hidden</p>
                        <p>✓ Pool choice: Hidden</p>
                        {useRelayer && <p>✓ Destination: Unlinkable via relayer</p>}
                        <p className="text-emerald-400">✓ No execution proof needed (you're signing)</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={mode === "deposit" ? handleSignDeposit : handleSignWithdraw}
                    className="flex-1 px-6 py-4 bg-violet-600 hover:bg-violet-500 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-violet-500/20"
                  >
                    Sign & {mode === "deposit" ? "Deposit" : (useRelayer ? "Request Relay" : "Withdraw")}
                  </button>
                  <button onClick={resetFlow} className="px-6 py-4 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium">
                    Start Over
                  </button>
                </div>
              </motion.div>
            )}

            {/* ==================== SUCCESS (STEP 4) ==================== */}
            {step === 4 && txHash && (
              <motion.div key="step4" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-center space-y-6">
                <div className="flex justify-center">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 15 }} className="w-20 h-20 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10 text-violet-400" />
                  </motion.div>
                </div>
                <div>
                  <p className="text-xl font-semibold text-violet-400 mb-2">
                    {mode === "deposit" ? "Private deposit complete" : (useRelayer ? "Relay request submitted" : "Private withdrawal complete")}
                  </p>
                  <p className="text-sm text-zinc-400 mb-4">
                    {useRelayer ? "Funds will be sent to fresh address after delay" : "Amount hidden on-chain"}
                  </p>
                  <a href={`https://sepolia.starkscan.co/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 text-sm font-medium inline-flex items-center gap-1">
                    View on explorer <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
                <button onClick={resetFlow} className="px-6 py-3 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium">
                  New Transaction
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
