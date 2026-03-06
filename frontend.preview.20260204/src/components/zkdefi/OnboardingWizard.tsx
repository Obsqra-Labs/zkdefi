"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useSignTypedData, useNetwork } from "@starknet-react/core";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ChevronRight, ChevronLeft, Check, Loader2, Wallet, Settings, FileCheck, Zap, Lock, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { toastSuccess, toastError } from "@/lib/toast";
import { ProofVisualizer } from "./ProofVisualizer";
import {
  buildRiskDisclosureTypedData,
  saveRiskSignature,
  hasStoredRiskSignature,
  RISK_DISCLOSURE_STATEMENT,
} from "@/lib/riskDisclosureTypedData";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8003";

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEPS = [
  { id: 1, title: "Connect", icon: Wallet },
  { id: 2, title: "Risk Disclosure", icon: AlertTriangle },
  { id: 3, title: "Configure", icon: Settings },
  { id: 4, title: "Claims", icon: FileCheck },
  { id: 5, title: "Authorize", icon: Shield },
  { id: 6, title: "Fund", icon: Zap },
  { id: 7, title: "Complete", icon: Check },
];

const RISK_LEVELS = [
  { value: 30, label: "Conservative", description: "Lower risk" },
  { value: 50, label: "Neutral", description: "Balanced" },
  { value: 70, label: "Aggressive", description: "Higher risk" },
];

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { chain } = useNetwork();
  const { signTypedDataAsync } = useSignTypedData({});
  const [step, setStep] = useState<Step>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [proofState, setProofState] = useState<"idle" | "generating" | "valid">("idle");
  const [constraints, setConstraints] = useState({ maxPosition: "5", riskTolerance: 50, sessionDuration: 24 });
  const [claims, setClaims] = useState([
    { id: "compliance", label: "Compliance", description: "Not in sanctioned set", enabled: true, required: true },
    { id: "tenure", label: "Tenure > 30 days", description: "Account age proof", enabled: true },
  ]);
  const [proofHashes, setProofHashes] = useState<string[]>([]);
  const [depositAmount, setDepositAmount] = useState("0.1");

  useEffect(() => {
    if (isConnected && step === 1) setStep(2);
  }, [isConnected, step]);

  useEffect(() => {
    if (isConnected && address && step === 2 && hasStoredRiskSignature(address)) {
      setStep(3);
    }
  }, [isConnected, address, step]);

  const handleConnect = async (connectorId: string) => {
    const connector = connectors.find((c) => c.id === connectorId);
    if (connector) {
      try {
        await connect({ connector });
        toastSuccess("Wallet connected");
      } catch (e) {
        toastError("Connection failed");
      }
    }
  };

  const handleSignRiskDisclosure = async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const chainIdHex = chain?.id ? String(chain.id) : undefined;
      const typedData = buildRiskDisclosureTypedData(chainIdHex);
      const sig = await signTypedDataAsync(typedData as Parameters<typeof signTypedDataAsync>[0]);
      let r: string | undefined;
      let s: string | undefined;
      if (Array.isArray(sig) && sig.length >= 2) {
        r = sig[0] != null ? String(sig[0]) : undefined;
        s = sig[1] != null ? String(sig[1]) : undefined;
      } else if (sig && typeof sig === "object" && "r" in sig && "s" in sig) {
        const o = sig as { r: bigint | string; s: bigint | string };
        r = typeof o.r === "bigint" ? o.r.toString() : String(o.r);
        s = typeof o.s === "bigint" ? o.s.toString() : String(o.s);
      }
      if (r != null && s != null) {
        saveRiskSignature(address, { r, s }, new Date().toISOString());
        toastSuccess("Risk disclosure signed");
        setStep(3);
      } else {
        throw new Error("Invalid signature");
      }
    } catch (e) {
      toastError("Signing failed or was rejected");
    } finally {
      setIsLoading(false);
    }
  };

  const generateMasterProof = async () => {
    if (!address) return;
    setIsLoading(true);
    setProofState("generating");
    try {
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          protocol_id: 1,
          amount: "0",
          constraints: { max_position: (parseFloat(constraints.maxPosition) * 1e18).toString(), risk_tolerance: constraints.riskTolerance },
        }),
      });
      const data = await res.json();
      if (data.proof_hash || data.fact_hash) {
        setProofHashes([data.proof_hash || data.fact_hash]);
        setProofState("valid");
        toastSuccess("Proofs generated");
        setStep(5);
      } else {
        throw new Error(data.detail || "Failed");
      }
    } catch (e) {
      toastError("Error generating proofs");
      setProofState("idle");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeposit = async () => {
    setIsLoading(true);
    try {
      // TODO: Wire up actual deposit flow
      // For now, skip to completion (onboarding wizard is for demo)
      toastSuccess("Agent funded (demo mode)");
      setStep(7);
    } catch (e) {
      toastError("Deposit failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex justify-between mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${step > s.id ? "bg-emerald-600" : step === s.id ? "bg-emerald-600/20 border-2 border-emerald-500" : "bg-zinc-800"}`}>
                {step > s.id ? <Check className="w-5 h-5" /> : <s.icon className={`w-5 h-5 ${step === s.id ? "text-emerald-400" : "text-zinc-500"}`} />}
              </div>
              {i < STEPS.length - 1 && <div className={`w-6 h-0.5 mx-1 ${step > s.id ? "bg-emerald-600" : "bg-zinc-700"}`} />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-xl p-6">
            {step === 1 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Connect Wallet</h2>
                {connectors.map((c) => (
                  <button key={c.id} onClick={() => handleConnect(c.id)} className="w-full p-4 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg flex justify-between">
                    <span>{c.name}</span><ChevronRight className="w-5 h-5" />
                  </button>
                ))}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 justify-center">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-center">Risk Disclosure</h2>
                </div>
                <p className="text-sm text-zinc-300">
                  To comply with our terms and risk disclosure, please sign the following statement with your wallet. This creates a verifiable record that you have read and accepted the risks.
                </p>
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-sm text-zinc-300 max-h-32 overflow-y-auto">
                  {RISK_DISCLOSURE_STATEMENT}
                </div>
                <p className="text-xs text-zinc-500">
                  Full text: <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">Terms of Service</Link> and <Link href="/terms#risk" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">Risk Disclosure</Link>.
                </p>
                <button onClick={handleSignRiskDisclosure} disabled={isLoading} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  {isLoading ? "Signing..." : "Sign with wallet"}
                </button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Configure Constraints</h2>
                <div>
                  <label className="block text-sm mb-2">Max Position (ETH)</label>
                  <input type="number" value={constraints.maxPosition} onChange={(e) => setConstraints({ ...constraints, maxPosition: e.target.value })} className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm mb-2">Risk Tolerance</label>
                  <div className="grid grid-cols-3 gap-3">
                    {RISK_LEVELS.map((l) => (
                      <button key={l.value} onClick={() => setConstraints({ ...constraints, riskTolerance: l.value })} className={`p-3 rounded-lg border ${constraints.riskTolerance === l.value ? "bg-emerald-600/20 border-emerald-500" : "bg-zinc-800/50 border-zinc-700"}`}>
                        <div className="text-sm font-medium">{l.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(2)} className="px-6 py-3 border border-zinc-700 rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => setStep(4)} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg">Continue</button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Reputation Claims</h2>
                {claims.map((c) => (
                  <div key={c.id} className={`p-4 rounded-lg border ${c.enabled ? "bg-emerald-600/20 border-emerald-500" : "bg-zinc-800/50 border-zinc-700"}`}>
                    <div className="font-medium">{c.label}</div>
                    <div className="text-sm text-zinc-400">{c.description}</div>
                  </div>
                ))}
                <div className="flex gap-3">
                  <button onClick={() => setStep(3)} className="px-6 py-3 border border-zinc-700 rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => setStep(5)} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg">Continue</button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Generate Authorization</h2>
                <ProofVisualizer state={proofState} />
                {proofState === "generating" && <p className="text-center text-sm text-zinc-400">Generating STARK proofs (~2 min)</p>}
                <div className="flex gap-3">
                  <button onClick={() => setStep(4)} disabled={isLoading} className="px-6 py-3 border border-zinc-700 rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={generateMasterProof} disabled={isLoading} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center justify-center gap-2">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    {isLoading ? "Generating..." : "Generate Proofs"}
                  </button>
                </div>
              </div>
            )}

            {step === 6 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Fund Your Agent</h2>
                <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-4 flex items-center gap-3">
                  <Check className="w-5 h-5 text-emerald-400" />
                  <span className="text-emerald-300">Authorization Complete</span>
                </div>
                <div>
                  <label className="block text-sm mb-2">Deposit Amount (ETH)</label>
                  <input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg" />
                </div>
                <button onClick={handleDeposit} disabled={isLoading} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center justify-center gap-2">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  Private Deposit
                </button>
              </div>
            )}

            {step === 7 && (
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-600/20 flex items-center justify-center mx-auto">
                  <Check className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold">Setup Complete</h2>
                <p className="text-zinc-400">Your autonomous agent is now active</p>
                <button onClick={onComplete} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg">Go to Dashboard</button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
