"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { ProofVisualizer } from "./ProofVisualizer";
import { toastSuccess, toastError } from "@/lib/toast";
import { Shield, ArrowRight, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ConnectButton } from "./ConnectButton";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";
const AGENT_ADDRESS = process.env.NEXT_PUBLIC_PROOF_GATED_AGENT_ADDRESS || "";

// DEBUG: Log the address being used
if (typeof window !== 'undefined') {
  console.log("[zkde.fi DEBUG] ProofGatedAgent address:", AGENT_ADDRESS);
  console.log("[zkde.fi DEBUG] Expected: 0x04b1265fa18e6873899a4f3ff15cfa0348b7bdf3ccb66bc658d0045ac61dfc0c");
}

type ProtocolId = "pools" | "ekubo" | "jediswap";

const PROTOCOL_IDS: Record<ProtocolId, number> = {
  pools: 0,
  ekubo: 1,
  jediswap: 2,
};

const PROTOCOL_NAMES: Record<ProtocolId, string> = {
  pools: "Pools",
  ekubo: "Ekubo",
  jediswap: "JediSwap",
};

type Step = 1 | 2 | 3 | 4 | 5;
type Mode = "deposit" | "withdraw";

type ProofResult = {
  proof_hash: string;
  calldata: { protocol_id: number; amount: string; proof_hash: string };
} | null;

export function ProtocolPanel({ protocolId }: { protocolId: ProtocolId }) {
  const { address, account, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [maxPosition, setMaxPosition] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [proofResult, setProofResult] = useState<ProofResult>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [showPrivacyPreview, setShowPrivacyPreview] = useState(false);

  // Wait for client-side mount to avoid hydration mismatch
  useEffect(() => setMounted(true), []);
  
  // Fetch position on mount and when mode changes
  useEffect(() => {
    if (mounted && address) {
      handleFetchPosition();
    }
  }, [mounted, address, mode]);

  const pid = PROTOCOL_IDS[protocolId];
  
  // Use mounted check to avoid hydration issues with wallet state
  const walletConnected = mounted && isConnected;

  const resetFlow = () => {
    setStep(1);
    setProofResult(null);
    setTxHash(null);
    setShowPrivacyPreview(false);
    setAmount("");
  };

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    resetFlow();
  };

  const handleGenerateProof = async () => {
    if (!address || !amount) return;
    setStep(2);
    setProofResult(null);

    try {
      // Convert BigInt to string for JSON serialization
      const amountWei = (BigInt(amount) * BigInt(1e18)).toString();
      const maxPosWei = maxPosition ? (BigInt(maxPosition) * BigInt(1e18)).toString() : "0";
      
      // Use different endpoints for deposit vs withdraw
      const endpoint = mode === "deposit" 
        ? `${API_BASE}/api/v1/zkdefi/deposit`
        : `${API_BASE}/api/v1/zkdefi/withdraw`;
      
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          protocol_id: pid,
          amount: amountWei,
          max_position: maxPosWei,
          max_daily_yield_bps: 0,
          min_withdraw_delay_seconds: 0,
        }),
      });

      const data = await res.json();
      if (data.proof_hash && data.calldata) {
        setProofResult({ proof_hash: data.proof_hash, calldata: data.calldata });
        setStep(3);
        toastSuccess(`${mode === "deposit" ? "Deposit" : "Withdraw"} proof generated!`);
      } else {
        toastError(data.detail || data.message || "Failed to generate proof");
        setStep(1);
      }
    } catch (e) {
      toastError(`Error: ${e}`);
      setStep(1);
    }
  };

  const handleSignAndExecute = async () => {
    if (!account || !proofResult || !AGENT_ADDRESS) {
      toastError(AGENT_ADDRESS ? "Connect wallet to sign." : "Proof-gated agent address not configured.");
      return;
    }

    setStep(4);
    try {
      const amt = BigInt(proofResult.calldata.amount);
      const amountLow = amt % BigInt(2 ** 128);
      const amountHigh = amt / BigInt(2 ** 128);
      const proofHashFelt = BigInt(proofResult.calldata.proof_hash);

      const entrypoint = mode === "deposit" ? "deposit_with_proof" : "withdraw_with_proof";

      // DEBUG: Log transaction details before execution
      console.log("[zkde.fi DEBUG] Executing transaction:");
      console.log("  - contractAddress:", AGENT_ADDRESS);
      console.log("  - entrypoint:", entrypoint);
      console.log("  - calldata:", [pid, amountLow.toString(), amountHigh.toString(), proofHashFelt.toString()]);

      // ETH token on Starknet Sepolia
      const ETH_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
      
      let result;
      if (mode === "deposit") {
        // Execute approve + deposit in a multicall
        result = await account.execute([
          {
            contractAddress: ETH_TOKEN as `0x${string}`,
            entrypoint: "approve",
            calldata: [
              AGENT_ADDRESS,               // spender (ProofGatedYieldAgent)
              amountLow.toString(),        // amount low
              amountHigh.toString(),       // amount high
            ],
          },
          {
            contractAddress: AGENT_ADDRESS as `0x${string}`,
            entrypoint: "deposit_with_proof",
            calldata: [pid, amountLow.toString(), amountHigh.toString(), proofHashFelt.toString()],
          },
        ]);
      } else {
        // Withdraw doesn't need approve, just call withdraw_with_proof
        result = await account.execute({
          contractAddress: AGENT_ADDRESS as `0x${string}`,
          entrypoint: "withdraw_with_proof",
          calldata: [pid, amountLow.toString(), amountHigh.toString(), proofHashFelt.toString()],
        });
      }

      setTxHash(result.transaction_hash);
      setStep(5);
      toastSuccess(`${mode === "deposit" ? "Deposit" : "Withdrawal"} successful!`, {
        action: {
          label: "View on explorer",
          onClick: () => window.open(`https://sepolia.starkscan.co/tx/${result.transaction_hash}`, "_blank"),
        },
      });
      
      // Refresh position after success
      setTimeout(() => handleFetchPosition(), 2000);
    } catch (e: unknown) {
      const err = e && typeof e === "object" && "message" in e ? (e as { message: string }).message : String(e);
      toastError(`Failed: ${err}`);
      setStep(3);
    }
  };

  const handleFetchPosition = async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/position/${address}?protocol_id=${pid}`);
      const data = await res.json();
      setPosition(data.position ?? data.error ?? "—");
    } catch (e) {
      setPosition(`Error: ${e}`);
    }
  };

  const getProofState = (): "idle" | "generating" | "valid" | "error" => {
    if (step === 1) return "idle";
    if (step === 2) return "generating";
    if (step >= 3 && proofResult) return "valid";
    return "idle";
  };

  const getProgress = (): number => {
    if (step === 2) return 50;
    if (step >= 3) return 100;
    return 0;
  };

  return (
    <div className="glass rounded-2xl border border-zinc-800 p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">{PROTOCOL_NAMES[protocolId]}</h2>
          <p className="text-sm text-zinc-400">Proof-gated {mode}</p>
        </div>
        <span className="px-3 py-1 rounded-full bg-emerald-900/30 text-emerald-300 border border-emerald-800/50 text-xs font-medium flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" />
          Proof-gated
        </span>
      </div>

      {/* Mode Toggle */}
      {walletConnected && step === 1 && (
        <div className="flex gap-2 mb-6 p-1 bg-zinc-900/50 rounded-lg border border-zinc-700">
          <button
            onClick={() => switchMode("deposit")}
            className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm transition-all ${
              mode === "deposit"
                ? "bg-emerald-600 text-white shadow-lg"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Deposit
          </button>
          <button
            onClick={() => switchMode("withdraw")}
            className={`flex-1 px-4 py-2.5 rounded-md font-medium text-sm transition-all ${
              mode === "withdraw"
                ? "bg-orange-600 text-white shadow-lg"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Withdraw
          </button>
        </div>
      )}

      {/* Current Position Display */}
      {walletConnected && position && (
        <div className="mb-6 p-4 rounded-lg bg-zinc-900/50 border border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Your Position</span>
            <span className="text-lg font-semibold text-white">
              {position !== "—" && position !== "0" 
                ? `${(parseFloat(position) / 1e18).toFixed(4)} ETH`
                : "No position"}
            </span>
          </div>
        </div>
      )}

      {!mounted && (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}

      {mounted && !isConnected && (
        <div className="text-center py-12">
          <p className="text-zinc-400 mb-4">Connect wallet to deposit</p>
          <ConnectButton />
        </div>
      )}

      {walletConnected && (
        <>
          {/* Visual State Machine */}
          <div className="flex items-center gap-1 sm:gap-2 mb-6 lg:mb-8 overflow-x-auto pb-2">
            {[
              { step: 1, label: "Input", icon: "1" },
              { step: 2, label: "Proof", icon: "2" },
              { step: 3, label: "Review", icon: "3" },
              { step: 4, label: "Sign", icon: "4" },
              { step: 5, label: "Done", icon: "✓" },
            ].map(({ step: s, label, icon }, i) => (
              <div key={s} className="flex items-center flex-1">
                <div
                  className={`flex-1 flex flex-col items-center gap-2 ${
                    step >= s ? "opacity-100" : "opacity-40"
                  }`}
                >
                  <div
                    className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-semibold text-xs sm:text-sm transition-all ${
                      step === s
                        ? "bg-proof-generating text-white scale-110"
                        : step > s
                        ? "bg-proof-valid text-white"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {icon}
                  </div>
                  <span className="text-xs text-zinc-400">{label}</span>
                </div>
                {i < 4 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 transition-all ${
                      step > s ? "bg-proof-valid" : "bg-zinc-800"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Amount
                  </label>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-lg font-medium text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                  />
                  {amount && (
                    <p className="mt-1 text-xs text-zinc-500">
                      ≈ ${parseFloat(amount || "0").toLocaleString()} USD
                    </p>
                  )}
                </div>

                {protocolId === "pools" && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Max position (optional)
                    </label>
                    <input
                      type="text"
                      value={maxPosition}
                      onChange={(e) => setMaxPosition(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                    />
                  </div>
                )}

                <button
                  onClick={handleGenerateProof}
                  disabled={!amount || (mode === "withdraw" && (!position || position === "0" || position === "—"))}
                  className={`w-full px-6 py-4 ${mode === "deposit" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-orange-600 hover:bg-orange-500"} disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all hover:shadow-lg ${mode === "deposit" ? "hover:shadow-emerald-500/20" : "hover:shadow-orange-500/20"} flex items-center justify-center gap-2`}
                >
                  Generate {mode === "deposit" ? "Deposit" : "Withdraw"} Proof
                  <ArrowRight className="w-5 h-5" />
                </button>
                
                {mode === "withdraw" && (!position || position === "0" || position === "—") && (
                  <p className="text-center text-sm text-zinc-500 mt-2">
                    No position to withdraw from
                  </p>
                )}
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <ProofVisualizer
                  state="generating"
                  progress={getProgress()}
                  step="Generating zero-knowledge proof..."
                />
              </motion.div>
            )}

            {step === 3 && proofResult && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <ProofVisualizer state="valid" />

                <div className="glass rounded-lg border border-zinc-700 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Proof hash</span>
                    <button
                      onClick={() => setShowPrivacyPreview(!showPrivacyPreview)}
                      className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      {showPrivacyPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {showPrivacyPreview ? "Hide" : "Show"} details
                    </button>
                  </div>
                  {showPrivacyPreview && (
                    <p className="font-mono text-xs break-all text-zinc-200">
                      {proofResult.proof_hash}
                    </p>
                  )}
                </div>

                <div className="glass rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-emerald-300 mb-1">
                        Privacy Preview
                      </p>
                      <div className="text-xs text-zinc-400 space-y-1">
                        <p>✓ Amount: Hidden</p>
                        <p>✓ Intent: Hidden</p>
                        <p>✓ Strategy: Hidden</p>
                        <p>✓ Only proof hash revealed</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSignAndExecute}
                    className={`flex-1 px-6 py-4 ${mode === "deposit" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-orange-600 hover:bg-orange-500"} rounded-lg font-semibold text-white transition-all hover:shadow-lg ${mode === "deposit" ? "hover:shadow-emerald-500/20" : "hover:shadow-orange-500/20"}`}
                  >
                    Sign & {mode === "deposit" ? "Deposit" : "Withdraw"}
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

            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-8"
              >
                <p className="text-lg font-medium mb-2">Confirm in your wallet...</p>
                <p className="text-sm text-zinc-400">Please approve the transaction</p>
              </motion.div>
            )}

            {step === 5 && txHash && (
              <motion.div
                key="step5"
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
                    className="w-20 h-20 rounded-full bg-proof-valid/20 flex items-center justify-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      <Shield className="w-10 h-10 text-proof-valid" />
                    </motion.div>
                  </motion.div>
                </div>
                <div>
                  <p className="text-xl font-semibold text-proof-valid mb-2">
                    {mode === "deposit" ? "Deposit" : "Withdrawal"} successful!
                  </p>
                  <p className="text-sm text-zinc-400 mb-4">
                    Your {mode} is verified on-chain
                  </p>
                  <a
                    href={`https://sepolia.starkscan.co/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 text-sm font-medium inline-flex items-center gap-1"
                  >
                    View on explorer
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
                <button
                  onClick={resetFlow}
                  className="px-6 py-3 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium"
                >
                  New Deposit
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-8 pt-6 border-t border-zinc-800 flex gap-3">
            <button
              onClick={handleFetchPosition}
              className="px-4 py-2 border border-zinc-600 hover:bg-zinc-800 rounded-lg font-medium text-sm"
            >
              Get Position
            </button>
            {position !== null && (
              <div className="flex-1 px-4 py-2 bg-zinc-900/50 rounded-lg text-sm text-zinc-300">
                Position: {position}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
