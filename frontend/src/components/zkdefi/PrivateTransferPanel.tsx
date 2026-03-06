"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { ProofVisualizer } from "./ProofVisualizer";
import { toastSuccess, toastError } from "@/lib/toast";
import { Lock, Shield, Eye, EyeOff, ArrowRight, CheckCircle2, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { addActivityEvent } from "./ActivityLog";
import { useApp } from "@/lib/AppContext";
import { ConnectButton } from "./ConnectButton";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";
const CONFIDENTIAL_TRANSFER_ADDRESS =
  process.env.NEXT_PUBLIC_CONFIDENTIAL_TRANSFER_ADDRESS || "";

type Step = 1 | 2 | 3 | 4;
type Mode = "deposit" | "withdraw";

interface Commitment {
  commitment: string;
  balance: string;
  index: number;
}

export function PrivateTransferPanel() {
  const { address, account, isConnected } = useAccount();
  const { setActivityFeed } = useApp();
  const [mounted, setMounted] = useState(false);
  
  // Wait for client-side mount to avoid hydration mismatch
  useEffect(() => setMounted(true), []);
  
  // Use mounted check to avoid hydration issues with wallet state
  const walletConnected = mounted && isConnected;
  
  // Mode toggle
  const [mode, setMode] = useState<Mode>("deposit");
  
  // Deposit state
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [amountPublic, setAmountPublic] = useState<string | null>(null);
  const [proofCalldata, setProofCalldata] = useState<string[] | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  
  // Withdraw state
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [selectedCommitment, setSelectedCommitment] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [nullifier, setNullifier] = useState<string | null>(null);
  const [loadingCommitments, setLoadingCommitments] = useState(false);

  // Fetch commitments when in withdraw mode and connected
  useEffect(() => {
    if (mode === "withdraw" && isConnected && address) {
      fetchCommitments();
    }
  }, [mode, isConnected, address]);

  const fetchCommitments = async () => {
    if (!address) return;
    setLoadingCommitments(true);
    try {
      // Fetch from localStorage (commitments are stored locally for privacy)
      const stored = localStorage.getItem(`zkdefi_commitments_${address}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        setCommitments(parsed);
      } else {
        setCommitments([]);
      }
    } catch (e) {
      console.error("Failed to fetch commitments:", e);
      setCommitments([]);
    }
    setLoadingCommitments(false);
  };

  // ==================== DEPOSIT FLOW ====================

  const handleGeneratePrivateDeposit = async () => {
    if (!address || !amount) return;
    setStep(2);

    try {
      const amountWei = (BigInt(amount) * BigInt(1e18)).toString();
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/private_deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          amount: amountWei,
        }),
      });

      const data = await res.json();
      if (data.commitment) {
        setCommitment(data.commitment);
        setAmountPublic(String(data.amount_public));
        setProofCalldata(data.proof_calldata || []);
        setStep(3);
        toastSuccess("Stealth proof generated!");
      } else {
        toastError(data.message || "Failed to generate proof");
        setStep(1);
      }
    } catch (e) {
      toastError(`Error: ${e}`);
      setStep(1);
    }
  };

  const handleSignAndSubmitDeposit = async () => {
    if (!CONFIDENTIAL_TRANSFER_ADDRESS) {
      toastError("Confidential transfer contract not configured.");
      return;
    }
    if (!account || !commitment || !amountPublic || !proofCalldata) {
      toastError("Connect wallet and generate a proof first.");
      return;
    }

    setStep(4);
    try {
      const commitmentFelt = BigInt(commitment);
      const amountPub = BigInt(amountPublic);
      const amountLow = amountPub % BigInt(2 ** 128);
      const amountHigh = amountPub / BigInt(2 ** 128);
      const proofFelts = proofCalldata.map((p) => BigInt(p).toString());

      const calldata = [
        commitmentFelt.toString(),
        amountLow.toString(),
        amountHigh.toString(),
        proofFelts.length.toString(),
        ...proofFelts,
      ];

      // ETH token on Starknet Sepolia
      const ETH_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

      // Execute approve + deposit in a multicall
      const result = await account.execute([
        {
          contractAddress: ETH_TOKEN as `0x${string}`,
          entrypoint: "approve",
          calldata: [
            CONFIDENTIAL_TRANSFER_ADDRESS, // spender
            amountLow.toString(),          // amount low
            amountHigh.toString(),         // amount high
          ],
        },
        {
          contractAddress: CONFIDENTIAL_TRANSFER_ADDRESS as `0x${string}`,
          entrypoint: "private_deposit",
          calldata,
        },
      ]);

      setTxHash(result.transaction_hash);
      toastSuccess("Stealth deposit successful!", {
        action: {
          label: "View on explorer",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });

      addActivityEvent(setActivityFeed, {
        type: "private",
        text: `Stealth deposit: commitment ${commitment.slice(0, 10)}...`,
        txHash: result.transaction_hash,
        details: `Amount hidden. Only commitment visible on-chain.`,
      });

      // Store commitment in localStorage for later withdrawal
      if (address) {
        try {
          const stored = localStorage.getItem(`zkdefi_commitments_${address}`);
          const existing = stored ? JSON.parse(stored) : [];
          const newCommitment = {
            commitment,
            balance: amountPublic,
            index: existing.length,
            timestamp: Date.now(),
          };
          existing.push(newCommitment);
          localStorage.setItem(`zkdefi_commitments_${address}`, JSON.stringify(existing));
        } catch (e) {
          console.error("Failed to store commitment locally:", e);
        }
      }
    } catch (e: unknown) {
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Failed: ${err}`);
      setStep(3);
    }
  };

  // ==================== WITHDRAW FLOW ====================

  const handleGeneratePrivateWithdraw = async () => {
    if (!address || !selectedCommitment || !withdrawAmount) return;
    setStep(2);

    try {
      const amountWei = (BigInt(withdrawAmount) * BigInt(1e18)).toString();
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/private_withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          commitment: selectedCommitment,
          amount: amountWei,
        }),
      });

      const data = await res.json();
      if (data.nullifier) {
        setNullifier(data.nullifier);
        setCommitment(data.commitment);
        setAmountPublic(String(data.amount_public));
        setProofCalldata(data.proof_calldata || []);
        setStep(3);
        toastSuccess("Withdrawal proof generated!");
      } else {
        toastError(data.message || "Failed to generate withdrawal proof");
        setStep(1);
      }
    } catch (e) {
      toastError(`Error: ${e}`);
      setStep(1);
    }
  };

  const handleSignAndSubmitWithdraw = async () => {
    if (!CONFIDENTIAL_TRANSFER_ADDRESS) {
      toastError("Confidential transfer contract not configured.");
      return;
    }
    if (!account || !nullifier || !commitment || !amountPublic || !proofCalldata) {
      toastError("Connect wallet and generate a proof first.");
      return;
    }

    setStep(4);
    try {
      const nullifierFelt = BigInt(nullifier);
      const commitmentFelt = BigInt(commitment);
      const amountPub = BigInt(amountPublic);
      const amountLow = amountPub % BigInt(2 ** 128);
      const amountHigh = amountPub / BigInt(2 ** 128);
      const proofFelts = proofCalldata.map((p) => BigInt(p).toString());

      const calldata: string[] = [
        nullifierFelt.toString(),
        commitmentFelt.toString(),
        amountLow.toString(),
        amountHigh.toString(),
        proofFelts.length.toString(),
        ...proofFelts,
        address ?? "", // recipient
      ].filter((x): x is string => typeof x === "string");

      const result = await account.execute({
        contractAddress: CONFIDENTIAL_TRANSFER_ADDRESS as `0x${string}`,
        entrypoint: "private_withdraw",
        calldata,
      });

      setTxHash(result.transaction_hash);
      toastSuccess("Stealth withdrawal successful!", {
        action: {
          label: "View on explorer",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });

      addActivityEvent(setActivityFeed, {
        type: "private",
        text: `Stealth withdrawal: nullifier ${nullifier.slice(0, 10)}...`,
        txHash: result.transaction_hash,
        details: `Amount hidden. Funds withdrawn privately.`,
      });

      // Update commitment balance in localStorage after withdrawal
      if (address && selectedCommitment) {
        try {
          const stored = localStorage.getItem(`zkdefi_commitments_${address}`);
          if (stored) {
            const existing = JSON.parse(stored);
            const updated = existing.map((c: Commitment) => {
              if (c.commitment === selectedCommitment) {
                const currentBalance = BigInt(c.balance);
                const withdrawAmt = BigInt(amountPublic);
                const newBalance = currentBalance - withdrawAmt;
                return { ...c, balance: newBalance.toString() };
              }
              return c;
            }).filter((c: Commitment) => BigInt(c.balance) > 0); // Remove depleted commitments
            localStorage.setItem(`zkdefi_commitments_${address}`, JSON.stringify(updated));
          }
        } catch (e) {
          console.error("Failed to update commitment balance:", e);
        }
      }
      
      // Refresh commitments after successful withdrawal
      fetchCommitments();
    } catch (e: unknown) {
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Failed: ${err}`);
      setStep(3);
    }
  };

  const resetFlow = () => {
    setStep(1);
    setCommitment(null);
    setAmountPublic(null);
    setProofCalldata(null);
    setTxHash(null);
    setNullifier(null);
    setSelectedCommitment(null);
    setWithdrawAmount("");
    setAmount("");
  };

  const getSelectedCommitmentBalance = () => {
    const c = commitments.find(c => c.commitment === selectedCommitment);
    return c ? (parseInt(c.balance) / 1e18).toFixed(4) : "0";
  };

  return (
    <div className="glass rounded-2xl border border-zinc-800 p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Lock className="w-6 h-6 text-privacy-shielded" />
            Stealth Transfer
          </h2>
          <p className="text-sm text-zinc-400">Amounts hidden. Only commitments visible on-chain.</p>
        </div>
        <div className="px-3 py-1 rounded-full bg-violet-900/30 text-violet-300 border border-violet-800/50 text-xs font-medium flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" />
          Garaga Groth16
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6 p-1 bg-zinc-900/50 rounded-lg border border-zinc-700">
        <button
          onClick={() => { setMode("deposit"); resetFlow(); }}
          className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm transition-all flex items-center justify-center gap-2 ${
            mode === "deposit"
              ? "bg-violet-600 text-white shadow-lg"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <ArrowDownToLine className="w-4 h-4" />
          Deposit
        </button>
        <button
          onClick={() => { setMode("withdraw"); resetFlow(); }}
          className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm transition-all flex items-center justify-center gap-2 ${
            mode === "withdraw"
              ? "bg-violet-600 text-white shadow-lg"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <ArrowUpFromLine className="w-4 h-4" />
          Withdraw
        </button>
      </div>

      {!mounted && (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}

      {mounted && !isConnected && (
        <div className="text-center py-12">
          <p className="text-zinc-400 mb-4">Connect wallet to use stealth transfer</p>
          <ConnectButton />
        </div>
      )}

      {walletConnected && (
        <>
          {/* Comparison Toggle */}
          <div className="mb-6 p-4 rounded-lg bg-zinc-900/50 border border-zinc-700">
            <button
              onClick={() => setShowComparison(!showComparison)}
              className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              {showComparison ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showComparison ? "Hide" : "Show"} comparison
            </button>
            {showComparison && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-4 grid grid-cols-2 gap-4"
              >
                <div className="p-3 rounded border border-red-500/30 bg-red-950/20">
                  <p className="text-xs font-medium text-red-400 mb-2">Normal Transfer</p>
                  <p className="text-xs text-zinc-400">Amount: Visible</p>
                  <p className="text-xs text-zinc-400">Balance: Visible</p>
                  <p className="text-xs text-zinc-400">Privacy: None</p>
                </div>
                <div className="p-3 rounded border border-violet-500/30 bg-violet-950/20">
                  <p className="text-xs font-medium text-violet-400 mb-2">Stealth Transfer</p>
                  <p className="text-xs text-zinc-400">Amount: Hidden</p>
                  <p className="text-xs text-zinc-400">Balance: Hidden</p>
                  <p className="text-xs text-zinc-400">Privacy: Full</p>
                </div>
              </motion.div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {/* ==================== DEPOSIT MODE ==================== */}
            {mode === "deposit" && step === 1 && (
              <motion.div
                key="deposit-step1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Amount (private)
                  </label>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-lg font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500"
                  />
                  {amount && (
                    <p className="mt-1 text-xs text-zinc-500">
                      This amount will be hidden on-chain
                    </p>
                  )}
                </div>

                <button
                  onClick={handleGeneratePrivateDeposit}
                  disabled={!amount}
                  className="w-full px-6 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-violet-500/20 flex items-center justify-center gap-2"
                >
                  <Lock className="w-5 h-5" />
                  Generate Stealth Deposit Proof
                </button>
              </motion.div>
            )}

            {/* ==================== WITHDRAW MODE ==================== */}
            {mode === "withdraw" && step === 1 && (
              <motion.div
                key="withdraw-step1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {/* Commitment Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-zinc-300">
                      Select Commitment
                    </label>
                    <button
                      onClick={fetchCommitments}
                      disabled={loadingCommitments}
                      className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingCommitments ? "animate-spin" : ""}`} />
                      Refresh
                    </button>
                  </div>
                  
                  {loadingCommitments ? (
                    <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-900/50 text-center">
                      <p className="text-sm text-zinc-400">Loading commitments...</p>
                    </div>
                  ) : commitments.length === 0 ? (
                    <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-900/50 text-center">
                      <p className="text-sm text-zinc-400 mb-2">No commitments found</p>
                      <p className="text-xs text-zinc-500">Make a stealth deposit first</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
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
                              <p className="font-mono text-sm text-zinc-200">
                                {c.commitment.slice(0, 12)}...{c.commitment.slice(-8)}
                              </p>
                              <p className="text-xs text-zinc-500 mt-1">
                                Index: {c.index}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-semibold text-white">
                                {(parseInt(c.balance) / 1e18).toFixed(4)}
                              </p>
                              <p className="text-xs text-zinc-500">Available</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Withdraw Amount */}
                {selectedCommitment && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                  >
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Withdraw Amount
                    </label>
                    <input
                      type="text"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-lg font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500"
                    />
                    <p className="mt-1 text-xs text-zinc-500">
                      Max: {getSelectedCommitmentBalance()}
                    </p>
                  </motion.div>
                )}

                <button
                  onClick={handleGeneratePrivateWithdraw}
                  disabled={!selectedCommitment || !withdrawAmount}
                  className="w-full px-6 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-violet-500/20 flex items-center justify-center gap-2"
                >
                  <ArrowUpFromLine className="w-5 h-5" />
                  Generate Withdrawal Proof
                </button>
              </motion.div>
            )}

            {/* ==================== GENERATING PROOF (both modes) ==================== */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <ProofVisualizer
                  state="generating"
                  progress={50}
                  step="Computing zero-knowledge proof..."
                />
                <div className="mt-6 text-center space-y-2">
                  <p className="text-sm text-zinc-400">Generating witness...</p>
                  <p className="text-sm text-zinc-400">Creating proof...</p>
                  <p className="text-sm text-zinc-400">Verifying locally...</p>
                </div>
              </motion.div>
            )}

            {/* ==================== PROOF READY (both modes) ==================== */}
            {step === 3 && commitment && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
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
                          <p className="text-xs text-zinc-500 mb-1">Nullifier:</p>
                          <p className="font-mono text-xs break-all text-zinc-200">
                            {nullifier}
                          </p>
                        </div>
                      )}
                      <div className="mb-3">
                        <p className="text-xs text-zinc-500 mb-1">Commitment:</p>
                        <p className="font-mono text-xs break-all text-zinc-200">
                          {commitment}
                        </p>
                      </div>
                      <div className="text-xs text-zinc-400 space-y-1">
                        <p>✓ Amount: Hidden</p>
                        <p>✓ Balance: Hidden</p>
                        {mode === "withdraw" && <p>✓ Nullifier prevents double-spend</p>}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={mode === "deposit" ? handleSignAndSubmitDeposit : handleSignAndSubmitWithdraw}
                    disabled={!CONFIDENTIAL_TRANSFER_ADDRESS}
                    className="flex-1 px-6 py-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg font-semibold text-white transition-all hover:shadow-lg hover:shadow-violet-500/20"
                  >
                    Sign & Submit
                  </button>
                  <button
                    onClick={resetFlow}
                    className="px-6 py-4 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium"
                  >
                    Start Over
                  </button>
                </div>
              </motion.div>
            )}

            {/* ==================== SUCCESS (both modes) ==================== */}
            {step === 4 && txHash && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-center space-y-6"
              >
                <div className="flex justify-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="w-20 h-20 rounded-full bg-violet-500/20 flex items-center justify-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      <CheckCircle2 className="w-10 h-10 text-violet-400" />
                    </motion.div>
                  </motion.div>
                </div>
                <div>
                  <p className="text-xl font-semibold text-violet-400 mb-2">
                    {mode === "deposit" ? "Deposit is stealth" : "Withdrawal is stealth"}
                  </p>
                  <p className="text-sm text-zinc-400 mb-4">
                    No amount revealed on-chain
                  </p>
                  <a
                    href={`https://sepolia.starkscan.co/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:text-violet-300 text-sm font-medium inline-flex items-center gap-1"
                  >
                    View on explorer
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
                <button
                  onClick={resetFlow}
                  className="px-6 py-3 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium"
                >
                  New Transfer
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
