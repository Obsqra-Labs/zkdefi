"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useSignTypedData } from "@starknet-react/core";
import { constants } from "starknet";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ChevronRight, ChevronLeft, Check, Loader2, Wallet, Settings, FileCheck, Zap, Lock, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { toastSuccess, toastError } from "@/lib/toast";
import { apiUrl } from "@/lib/api/client";
import { ProofVisualizer } from "./ProofVisualizer";
import {
  buildRiskDisclosureTypedData,
  RISK_DISCLOSURE_STATEMENT,
} from "@/lib/riskDisclosureTypedData";



interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEPS = [
  { id: 1, title: "Connect", icon: Wallet },
  { id: 2, title: "Configure", icon: Settings },
  { id: 3, title: "Claims", icon: FileCheck },
  { id: 4, title: "Authorize", icon: Shield },
  { id: 5, title: "Review", icon: AlertTriangle },
  { id: 6, title: "Submit", icon: Zap },
  { id: 7, title: "Complete", icon: Check },
];

const RISK_LEVELS = [
  { value: 30, label: "Conservative", description: "Lower risk" },
  { value: 50, label: "Neutral", description: "Balanced" },
  { value: 70, label: "Aggressive", description: "Higher risk" },
];

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { signTypedDataAsync } = useSignTypedData({});
  
  const [step, setStep] = useState<Step>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [proofState, setProofState] = useState<"idle" | "generating" | "valid">("idle");
  
  // User configuration
  const [constraints, setConstraints] = useState({ 
    maxPosition: "5", 
    riskTolerance: 50, 
    sessionDuration: 24 
  });
  const [claims, setClaims] = useState([
    { id: "compliance", label: "Compliance", description: "Not in sanctioned set", enabled: true, required: true },
    { id: "tenure", label: "Tenure > 30 days", description: "Account age proof", enabled: false },
  ]);
  
  // Generated data
  const [factHash, setFactHash] = useState<string | null>(null);
  const [identityCommitment, setIdentityCommitment] = useState<string | null>(null);
  const [riskSignature, setRiskSignature] = useState<{ r: string; s: string } | null>(null);
  const [agentTxHash, setAgentTxHash] = useState<string | null>(null);

  // Auto-advance when wallet connects
  useEffect(() => {
    if (isConnected && step === 1) {
      toastSuccess("Wallet connected");
      setStep(2);
    }
  }, [isConnected, step]);

  const handleConnect = async (connectorId: string) => {
    const connector = connectors.find((c) => c.id === connectorId);
    if (connector) {
      try {
        await connect({ connector });
      } catch (e) {
        toastError("Connection failed");
      }
    }
  };

  const handleGenerateAuthorization = async () => {
    if (!address) return;
    setIsLoading(true);
    setProofState("generating");
    
    try {
      console.log("🔐 Generating REAL authorization proof...");
      console.log("User:", address);
      console.log("Constraints:", constraints);
      console.log("Claims:", claims.filter(c => c.enabled).map(c => c.id));
      
      const enabledClaims = claims.filter(c => c.enabled).map(c => c.id);
      const maxPositionWei = (parseFloat(constraints.maxPosition) * 1e18).toString();
      
      const response = await fetch(apiUrl("/api/v1/zkdefi/onboarding/generate_authorization"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          constraints: {
            max_position: maxPositionWei,
            risk_tolerance: constraints.riskTolerance,
            session_duration: constraints.sessionDuration
          },
          claims: enabledClaims
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Authorization failed");
      }
      
      const data = await response.json();
      console.log("✅ Authorization proof generated:", data);
      
      setFactHash(data.fact_hash);
      setIdentityCommitment(data.identity_commitment);
      setProofState("valid");
      toastSuccess("Authorization proof generated");
      setStep(5); // Move to Review & Sign Risk Disclosure
      
    } catch (e: any) {
      console.error("❌ Authorization generation failed:", e);
      toastError(`Failed: ${e.message}`);
      setProofState("idle");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignRiskDisclosure = async () => {
    if (!address || !factHash || !identityCommitment) return;
    setIsLoading(true);
    
    try {
      // Use wallet's chain so domain.chainId matches (avoids wallet rejection)
      const chainIdHex =
        chainId != null
          ? typeof chainId === "bigint"
            ? "0x" + chainId.toString(16)
            : String(chainId)
          : constants.StarknetChainId.SN_SEPOLIA;
      const typedData = buildRiskDisclosureTypedData(chainIdHex);
      
      const sig = await signTypedDataAsync(typedData as Parameters<typeof signTypedDataAsync>[0]);
      
      let r: string | undefined;
      let s: string | undefined;
      
      if (Array.isArray(sig) && sig.length >= 2) {
        r = sig[0] != null ? String(sig[0]) : undefined;
        s = sig[1] != null ? String(sig[1]) : undefined;
      } else if (sig && typeof sig === "object") {
        const o = sig as unknown as Record<string, unknown>;
        const rVal = o.r ?? o.r_low ?? o[0];
        const sVal = o.s ?? o.s_low ?? o[1];
        if (rVal != null && sVal != null) {
          r = typeof rVal === "bigint" ? rVal.toString() : String(rVal);
          s = typeof sVal === "bigint" ? sVal.toString() : String(sVal);
        }
      }
      
      if (!r || !s) {
        console.error("Unsupported signature shape:", sig);
        throw new Error("Invalid signature");
      }
      
      setRiskSignature({ r, s });
      localStorage.setItem("risk-acknowledged", "true");
      localStorage.setItem(
        `zkdefi_risk_sig_${address.toLowerCase()}`,
        JSON.stringify({ signature: { r, s }, signedAt: new Date().toISOString() })
      );
      
      toastSuccess("Risk disclosure signed");
      setStep(6);
      
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      const isReject =
        lower.includes("reject") ||
        lower.includes("denied") ||
        lower.includes("cancel") ||
        lower.includes("user");
      console.error("Signature failed:", e);
      toastError(isReject ? "Signing was rejected" : "Signing failed. Try again or use another wallet.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAgent = async () => {
    if (!address || !factHash || !identityCommitment || !riskSignature) return;
    setIsLoading(true);
    
    try {
      console.log("🚀 Submitting agent on-chain...");
      console.log("Fact Hash:", factHash);
      console.log("Identity Commitment:", identityCommitment);
      
      const response = await fetch(apiUrl("/api/v1/zkdefi/onboarding/submit_agent"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          fact_hash: factHash,
          identity_commitment: identityCommitment,
          risk_signature: riskSignature
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Submission failed");
      }
      
      const data = await response.json();
      console.log("✅ Agent initialized:", data);
      
      setAgentTxHash(data.tx_hash);
      
      // Mark onboarding complete
      localStorage.setItem("onboarding-complete", "true");
      localStorage.setItem(
        `zkdefi_agent_${address.toLowerCase()}`,
        JSON.stringify({
          fact_hash: factHash,
          identity_commitment: identityCommitment,
          initialized_at: new Date().toISOString()
        })
      );
      
      toastSuccess("Agent initialized successfully!");
      setStep(7);
      
    } catch (e: any) {
      console.error("❌ Agent submission failed:", e);
      toastError(`Failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
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
            
            {/* Step 1: Connect Wallet */}
            {step === 1 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Connect Wallet</h2>
                <p className="text-sm text-zinc-400 text-center">
                  Connect your Starknet wallet to initialize your autonomous agent
                </p>
                {connectors.map((c) => (
                  <button 
                    key={c.id} 
                    onClick={() => handleConnect(c.id)} 
                    className="w-full p-4 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg flex justify-between items-center transition-colors"
                  >
                    <span>{c.name}</span>
                    <ChevronRight className="w-5 h-5" />
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: Configure Constraints */}
            {step === 2 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Configure Constraints</h2>
                <p className="text-sm text-zinc-400 text-center">
                  Set guardrails for your autonomous agent
                </p>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Max Position (ETH)</label>
                  <input 
                    type="number" 
                    value={constraints.maxPosition} 
                    onChange={(e) => setConstraints({ ...constraints, maxPosition: e.target.value })} 
                    className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500 outline-none"
                    placeholder="5.0"
                  />
                  <p className="text-xs text-zinc-500 mt-1">Maximum ETH per position</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Risk Tolerance</label>
                  <div className="grid grid-cols-3 gap-3">
                    {RISK_LEVELS.map((l) => (
                      <button 
                        key={l.value} 
                        onClick={() => setConstraints({ ...constraints, riskTolerance: l.value })} 
                        className={`p-3 rounded-lg border transition-all ${
                          constraints.riskTolerance === l.value 
                            ? "bg-emerald-600/20 border-emerald-500 text-emerald-400" 
                            : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
                        }`}
                      >
                        <div className="text-sm font-medium">{l.label}</div>
                        <div className="text-xs text-zinc-500">{l.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Session Duration (hours)</label>
                  <input 
                    type="number" 
                    value={constraints.sessionDuration} 
                    onChange={(e) => setConstraints({ ...constraints, sessionDuration: parseInt(e.target.value) })} 
                    className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500 outline-none"
                    placeholder="24"
                  />
                  <p className="text-xs text-zinc-500 mt-1">How long agent can execute without re-authorization</p>
                </div>
                
                <button 
                  onClick={() => setStep(3)} 
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
                >
                  Continue
                </button>
              </div>
            )}

            {/* Step 3: Select Claims */}
            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Reputation Claims</h2>
                <p className="text-sm text-zinc-400 text-center">
                  Select optional privacy-preserving claims about your account
                </p>
                
                {claims.map((c) => (
                  <div 
                    key={c.id} 
                    onClick={() => !c.required && setClaims(claims.map(cl => cl.id === c.id ? { ...cl, enabled: !cl.enabled } : cl))}
                    className={`p-4 rounded-lg border cursor-pointer transition-all ${
                      c.enabled 
                        ? "bg-emerald-600/20 border-emerald-500" 
                        : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
                    } ${c.required ? "opacity-80 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {c.label}
                          {c.required && <span className="text-xs px-2 py-0.5 bg-zinc-700 rounded">Required</span>}
                        </div>
                        <div className="text-sm text-zinc-400 mt-1">{c.description}</div>
                      </div>
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        c.enabled ? "border-emerald-500 bg-emerald-500" : "border-zinc-600"
                      }`}>
                        {c.enabled && <Check className="w-3 h-3" />}
                      </div>
                    </div>
                  </div>
                ))}
                
                <div className="flex gap-3">
                  <button 
                    onClick={() => setStep(2)} 
                    className="px-6 py-3 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setStep(4)} 
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Generate Authorization (REAL STARK PROOF) */}
            {step === 4 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Generate Authorization</h2>
                <p className="text-sm text-zinc-400 text-center">
                  Creating privacy-preserving identity proof (STARK)
                </p>
                
                <ProofVisualizer state={proofState} />
                
                {proofState === "generating" && (
                  <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-4">
                    <p className="text-sm text-violet-300 font-medium text-center">
                      Generating STARK proof (~2-3 minutes)
                    </p>
                    <p className="text-xs text-zinc-500 text-center mt-2">
                      This creates your privacy-preserving on-chain identity
                    </p>
                  </div>
                )}
                
                {proofState === "valid" && factHash && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 space-y-2">
                    <p className="text-sm text-emerald-300 font-medium">✅ Proof Generated</p>
                    <p className="text-xs text-zinc-400 font-mono break-all">Fact: {factHash.slice(0, 20)}...{factHash.slice(-10)}</p>
                  </div>
                )}
                
                <div className="flex gap-3">
                  <button 
                    onClick={() => setStep(3)} 
                    disabled={isLoading}
                    className="px-6 py-3 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={handleGenerateAuthorization} 
                    disabled={isLoading || proofState === "valid"}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating STARK Proof...
                      </>
                    ) : proofState === "valid" ? (
                      <>
                        <Check className="w-4 h-4" />
                        Proof Generated
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Generate Authorization Proof
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: Review & Sign Risk Disclosure (FINAL) */}
            {step === 5 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 justify-center">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  </div>
                  <h2 className="text-2xl font-bold">Final Authorization</h2>
                </div>
                
                <p className="text-sm text-zinc-300 text-center">
                  Review your settings and sign to authorize on-chain submission
                </p>
                
                {/* Review configured settings */}
                <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-3">
                  <div>
                    <div className="text-xs text-zinc-500 uppercase">Constraints</div>
                    <div className="text-sm text-zinc-300 mt-1">
                      Max Position: {constraints.maxPosition} ETH<br />
                      Risk: {RISK_LEVELS.find(r => r.value === constraints.riskTolerance)?.label}<br />
                      Duration: {constraints.sessionDuration}h
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 uppercase">Claims</div>
                    <div className="text-sm text-zinc-300 mt-1">
                      {claims.filter(c => c.enabled).map(c => c.label).join(", ")}
                    </div>
                  </div>
                  {factHash && (
                    <div>
                      <div className="text-xs text-zinc-500 uppercase">Fact Hash</div>
                      <div className="text-xs text-emerald-400 font-mono mt-1 break-all">
                        {factHash.slice(0, 30)}...
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Risk Disclosure */}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                  <p className="text-sm text-amber-200 leading-relaxed">
                    {RISK_DISCLOSURE_STATEMENT}
                  </p>
                  <p className="text-xs text-zinc-500 mt-3">
                    Full text: <Link href="/terms" target="_blank" className="text-emerald-400 hover:text-emerald-300">Terms</Link>
                  </p>
                </div>
                
                <div className="flex gap-3">
                  <button 
                    onClick={() => setStep(4)} 
                    disabled={isLoading}
                    className="px-6 py-3 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={handleSignRiskDisclosure} 
                    disabled={isLoading}
                    className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors font-medium"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Signing...
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Sign & Authorize
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Step 6: Submit Agent On-Chain */}
            {step === 6 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Initialize Agent</h2>
                <p className="text-sm text-zinc-400 text-center">
                  Submitting your privacy-preserving identity on-chain
                </p>
                
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-emerald-300 font-medium mb-2">
                    <Check className="w-4 h-4" />
                    Authorization Signed
                  </div>
                  {identityCommitment && (
                    <p className="text-xs text-zinc-400 font-mono break-all">
                      Identity: {identityCommitment.slice(0, 30)}...
                    </p>
                  )}
                </div>
                
                <button 
                  onClick={handleSubmitAgent} 
                  disabled={isLoading}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 transition-colors font-medium"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting Transaction...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Initialize Agent On-Chain
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Step 7: Complete */}
            {step === 7 && (
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-600/20 flex items-center justify-center mx-auto">
                  <Check className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold">Agent Initialized</h2>
                <p className="text-zinc-400">
                  Your autonomous agent is now live with privacy-preserving identity
                </p>
                
                {agentTxHash && (
                  <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                    <p className="text-xs text-zinc-500 uppercase mb-1">Transaction</p>
                    <a 
                      href={`https://sepolia.starkscan.co/tx/${agentTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-emerald-400 hover:text-emerald-300 font-mono break-all"
                    >
                      {agentTxHash.slice(0, 20)}...{agentTxHash.slice(-10)}
                    </a>
                  </div>
                )}
                
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-left space-y-2 text-sm">
                  <p className="text-emerald-300 font-medium">✅ Privacy Preserved:</p>
                  <ul className="text-zinc-400 space-y-1 ml-4">
                    <li>• Constraints hidden (only hash on-chain)</li>
                    <li>• Claims private (provable when needed)</li>
                    <li>• Identity commitment stored</li>
                  </ul>
                </div>
                
                <button 
                  onClick={onComplete} 
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
                >
                  Go to Dashboard
                </button>
              </div>
            )}
            
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
