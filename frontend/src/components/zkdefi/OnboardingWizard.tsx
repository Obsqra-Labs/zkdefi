"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount, useConnect, useSignTypedData } from "@starknet-react/core";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ChevronRight, ChevronLeft, Check, Loader2, Wallet, Settings, FileCheck, Zap, Lock, AlertTriangle, Scale } from "lucide-react";
import Link from "next/link";
import { toastSuccess, toastError } from "@/lib/toast";
import { ProofVisualizer } from "./ProofVisualizer";
import {
  buildRiskDisclosureTypedData,
  RISK_DISCLOSURE_STATEMENT,
} from "@/lib/riskDisclosureTypedData";
import { getIdentityService } from "@/services/identity";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { VaultConstitution } from "@/components/zkdefi/vault/VaultConstitution";

import { API_BASE } from "@/lib/api/client";

// Initialize identity service
const identityService = getIdentityService(API_BASE);

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const STEPS = [
  { id: 1, title: "Connect", icon: Wallet },
  { id: 2, title: "Constraints", icon: Settings },
  { id: 3, title: "Claims", icon: FileCheck },
  { id: 4, title: "Prove", icon: Shield },
  { id: 5, title: "Review", icon: AlertTriangle },
  { id: 6, title: "Vault Rules", icon: Scale },
  { id: 7, title: "Submit", icon: Zap },
  { id: 8, title: "Profile Ready", icon: Check },
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
  const safeConnectors = useMemo(
    () => (Array.isArray(connectors) ? connectors.filter((connector) => connector && typeof connector.id === "string") : []),
    [connectors],
  );
  
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
  const [creditTier, setCreditTier] = useState<string | null>(null);
  const [creditScore, setCreditScore] = useState<number | null>(null);

  // Auto-advance when wallet connects
  useEffect(() => {
    if (isConnected && step === 1) {
      toastSuccess("Wallet connected");
      setStep(2);
    }
  }, [isConnected, step]);

  const handleConnect = async (connectorId: string) => {
    const connector = safeConnectors.find((c) => c.id === connectorId);
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
      const enabledClaims = claims.filter(c => c.enabled).map(c => c.id);
      const maxPositionWei = (parseFloat(constraints.maxPosition) * 1e18).toString();
      
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/onboarding/generate_authorization`, {
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
      
      const responseText = await response.text();
      const contentType = response.headers.get("content-type") || "";
      let data: any = null;

      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          if (response.ok) {
            throw new Error("Authorization endpoint returned non-JSON response");
          }
          const sanitized = responseText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          throw new Error(sanitized || `Authorization failed (${response.status})`);
        }
      }

      if (!response.ok) {
        const detail =
          (typeof data?.detail === "string" && data.detail) ||
          (typeof data?.message === "string" && data.message) ||
          `Authorization failed (${response.status})`;
        throw new Error(detail);
      }

      if (!data || typeof data !== "object") {
        throw new Error(
          contentType
            ? `Authorization endpoint returned invalid payload (${contentType})`
            : "Authorization endpoint returned invalid payload"
        );
      }

      
      setFactHash(data.fact_hash);
      setIdentityCommitment(data.identity_commitment);
      
      // Also fetch credit tier from identity service
      try {
        const creditResponse = await fetch(`${API_BASE}/api/v1/identity/credit-proof`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commitment: data.identity_commitment,
            addresses: { starknet: address },
            signatures: []
          }),
        });
        if (creditResponse.ok) {
          const creditData = await creditResponse.json();
          setCreditTier(creditData.tier);
          setCreditScore(creditData.score);
        }
      } catch {
        /* credit tier fetch is optional */
      }
      
      setProofState("valid");
      toastSuccess("Authorization proof generated");
      setStep(5); // Move to Review & Sign Risk Disclosure
      
    } catch (e: any) {
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
      // Build typed data for wallet signing
      const typedData = buildRiskDisclosureTypedData(
        chainId ? `0x${chainId.toString(16)}` : undefined
      );
      
      const signature = await signTypedDataAsync(typedData);
      
      // Parse signature - it could be an array or object
      let r: string, s: string;
      if (Array.isArray(signature)) {
        // Signature is [r, s] array
        r = signature[0]?.toString() ?? "0x0";
        s = signature[1]?.toString() ?? "0x0";
      } else if (typeof signature === "object" && signature !== null) {
        // Signature is { r, s } object
        r = (signature as { r?: string; s?: string }).r ?? "0x0";
        s = (signature as { r?: string; s?: string }).s ?? "0x0";
      } else {
        // Fallback - treat as single value
        r = String(signature);
        s = "0x0";
      }
      
      setRiskSignature({ r, s });
      
      toastSuccess("Risk disclosure signed");
      setStep(6);
      
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isRejected =
        /reject|denied|cancel|declined/i.test(msg) ||
        (typeof e === "object" && e !== null && "code" in e && (e as { code?: number }).code === 5001);
      if (isRejected) {
        toastError("Signature declined. You can try again when ready.");
      } else {
        toastError(`Signing failed: ${msg}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAgent = async () => {
    if (!address || !factHash || !identityCommitment || !riskSignature) return;
    setIsLoading(true);
    
    try {
      const response = await fetch(`${API_BASE}/api/v1/zkdefi/onboarding/submit_agent`, {
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
      setAgentTxHash(data.tx_hash);
      
      toastSuccess("Agent initialized successfully!");
      setStep(8);
      
    } catch (e: any) {
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
                {safeConnectors.map((c) => (
                  <button 
                    key={c.id} 
                    onClick={() => handleConnect(c.id)} 
                    className="w-full p-4 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg flex justify-between items-center transition-colors"
                  >
                    <span>{typeof c.name === "string" && c.name.trim().length > 0 ? c.name : "Starknet wallet"}</span>
                    <ChevronRight className="w-5 h-5" />
                  </button>
                ))}
                {safeConnectors.length === 0 && (
                  <p className="text-sm text-zinc-500 text-center">
                    No Starknet wallet connector detected. Install Argent X or Braavos, then refresh.
                  </p>
                )}
              </div>
            )}

            {/* Step 2: Configure Constraints */}
            {step === 2 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Configure Constraints</h2>
                <p className="text-sm text-zinc-400 text-center">
                  Set guardrails for your autonomous agent. These constraints will appear on your Risk Profile.
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
                  Creating the proof that backs your Risk Profile identity (STARK).
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
                  {creditTier && (
                    <div>
                      <div className="text-xs text-zinc-500 uppercase">Credit Tier</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`text-sm font-bold ${
                          creditTier === 'AAA' ? 'text-emerald-400' :
                          creditTier === 'AA' ? 'text-green-400' :
                          creditTier === 'A' ? 'text-yellow-400' :
                          creditTier === 'B' ? 'text-orange-400' : 'text-red-400'
                        }`}>{creditTier}</span>
                        {creditScore && <span className="text-xs text-zinc-500">({creditScore}/1000)</span>}
                      </div>
                    </div>
                  )}
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

            {/* Step 6: Vault Constitution */}
            {step === 6 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-center">Set Your Vault Rules</h2>
                <p className="text-sm text-zinc-400 text-center">
                  The AI will operate within these boundaries. You can change them anytime from your Profile.
                </p>

                <VaultConstitution mode="edit" />

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(5)}
                    className="px-6 py-3 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setStep(7)}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 7: Submit Agent On-Chain */}
            {step === 7 && (
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

            {/* Step 8: Complete */}
            {step === 8 && (
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-600/20 flex items-center justify-center mx-auto">
                  <Check className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold">Your Risk Profile is ready</h2>
                <p className="text-zinc-400">
                  Your identity and constraints are set. View your profile or go to the Dashboard to run proofs and build reputation.
                </p>
                
                {agentTxHash && (
                  <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                    <p className="text-xs text-zinc-500 uppercase mb-1">Transaction</p>
                    <a 
                      href={sepoliaVoyagerTxUrl(agentTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-emerald-400 hover:text-emerald-300 font-mono break-all"
                    >
                      {agentTxHash.slice(0, 20)}...{agentTxHash.slice(-10)}
                    </a>
                  </div>
                )}
                
                {creditTier && (
                  <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Credit Rating</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xl font-bold ${
                          creditTier === 'AAA' ? 'text-emerald-400' :
                          creditTier === 'AA' ? 'text-green-400' :
                          creditTier === 'A' ? 'text-yellow-400' :
                          creditTier === 'B' ? 'text-orange-400' : 'text-red-400'
                        }`}>{creditTier}</span>
                        {creditScore && <span className="text-sm text-zinc-500">({creditScore}/1000)</span>}
                      </div>
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                      ERC-8004 aligned reputation proof
                    </p>
                  </div>
                )}
                
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-left space-y-2 text-sm">
                  <p className="text-emerald-300 font-medium">✅ Privacy Preserved:</p>
                  <ul className="text-zinc-400 space-y-1 ml-4">
                    <li>• Constraints hidden (only hash on-chain)</li>
                    <li>• Claims private (provable when needed)</li>
                    <li>• Identity commitment stored</li>
                    <li>• Credit tier proven via ZK (Sybil-resistant)</li>
                  </ul>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    href="/profile"
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors text-center"
                  >
                    View your Risk Profile
                  </Link>
                  <button 
                    onClick={onComplete} 
                    className="flex-1 py-3 border border-zinc-600 hover:border-zinc-500 rounded-lg font-medium transition-colors"
                  >
                    Go to Dashboard
                  </button>
                </div>
              </div>
            )}
            
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
