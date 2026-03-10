"use client";

import Link from "next/link";
import { Loader2, Check, ChevronLeft, ChevronRight, type LucideIcon, Wallet, Settings, FileCheck, Shield, AlertTriangle, Zap } from "lucide-react";
import { type ReactNode } from "react";

import { ProofVisualizer } from "@/components/zkdefi/ProofVisualizer";
import { TrustFlowProgressSummary } from "@/components/zkdefi/trust-flow/TrustFlowProgressSummary";

export interface OnboardingConstraintConfig {
  maxPosition: string;
  riskTolerance: number;
  sessionDuration: number;
}

export interface OnboardingClaimConfig {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  required?: boolean;
}

export interface OnboardingPortableLifecycleStatus {
  walletsLinked: boolean;
  walletsVerified: boolean;
  scopedSessionBound: boolean;
  attributionsSynced: boolean;
  claimsDerived: boolean;
  disclosurePackIssued: boolean;
  verifiedWalletCount: number;
  activeSessionCount: number;
  attributionEvents: number;
  reputationScore: number;
  credentialId: string | null;
}

export const ONBOARDING_STEPS: Array<{ id: number; title: string; icon: LucideIcon }> = [
  { id: 1, title: "Connect", icon: Wallet },
  { id: 2, title: "Configure", icon: Settings },
  { id: 3, title: "Claims", icon: FileCheck },
  { id: 4, title: "Authorize", icon: Shield },
  { id: 5, title: "Review", icon: AlertTriangle },
  { id: 6, title: "Submit", icon: Zap },
  { id: 7, title: "Complete", icon: Check },
];

export function OnboardingStepProgress({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex justify-between mb-8">
      {ONBOARDING_STEPS.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              currentStep > step.id
                ? "bg-emerald-600"
                : currentStep === step.id
                  ? "bg-emerald-600/20 border-2 border-emerald-500"
                  : "bg-zinc-800"
            }`}
          >
            {currentStep > step.id ? (
              <Check className="w-5 h-5" />
            ) : (
              <step.icon className={`w-5 h-5 ${currentStep === step.id ? "text-emerald-400" : "text-zinc-500"}`} />
            )}
          </div>
          {index < ONBOARDING_STEPS.length - 1 ? (
            <div className={`w-6 h-0.5 mx-1 ${currentStep > step.id ? "bg-emerald-600" : "bg-zinc-700"}`} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function OnboardingTrustProgress({
  complete,
  total,
  ready,
}: {
  complete: number;
  total: number;
  ready: boolean;
}) {
  return (
    <div className="mb-6">
      <TrustFlowProgressSummary complete={complete} total={total} ready={ready} />
    </div>
  );
}

export function OnboardingConnectStep({
  connectors,
  onConnect,
}: {
  connectors: Array<{ id: string; name: string }>;
  onConnect: (connectorId: string) => Promise<void> | void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center">Connect Wallet</h2>
      <p className="text-sm text-zinc-400 text-center">
        Connect your Starknet wallet to initialize your autonomous agent
      </p>
      {connectors.map((connector) => (
        <button
          key={connector.id}
          onClick={() => void onConnect(connector.id)}
          className="w-full p-4 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg flex justify-between items-center transition-colors"
        >
          <span>{connector.name}</span>
          <ChevronRight className="w-5 h-5" />
        </button>
      ))}
    </div>
  );
}

export function OnboardingConfigureStep({
  constraints,
  onConstraintsChange,
  riskLevels,
  onContinue,
}: {
  constraints: OnboardingConstraintConfig;
  onConstraintsChange: (next: OnboardingConstraintConfig) => void;
  riskLevels: Array<{ value: number; label: string; description: string }>;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center">Configure Constraints</h2>
      <p className="text-sm text-zinc-400 text-center">Set guardrails for your autonomous agent</p>

      <div>
        <label className="block text-sm font-medium mb-2">Max Position (ETH)</label>
        <input
          type="number"
          value={constraints.maxPosition}
          onChange={(e) => onConstraintsChange({ ...constraints, maxPosition: e.target.value })}
          className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500 outline-none"
          placeholder="5.0"
        />
        <p className="text-xs text-zinc-500 mt-1">Maximum ETH per position</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Risk Tolerance</label>
        <div className="grid grid-cols-3 gap-3">
          {riskLevels.map((level) => (
            <button
              key={level.value}
              onClick={() => onConstraintsChange({ ...constraints, riskTolerance: level.value })}
              className={`p-3 rounded-lg border transition-all ${
                constraints.riskTolerance === level.value
                  ? "bg-emerald-600/20 border-emerald-500 text-emerald-400"
                  : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
              }`}
            >
              <div className="text-sm font-medium">{level.label}</div>
              <div className="text-xs text-zinc-500">{level.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Session Duration (hours)</label>
        <input
          type="number"
          value={constraints.sessionDuration}
          onChange={(e) =>
            onConstraintsChange({ ...constraints, sessionDuration: Number.parseInt(e.target.value || "0", 10) })
          }
          className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg focus:border-emerald-500 outline-none"
          placeholder="24"
        />
        <p className="text-xs text-zinc-500 mt-1">How long agent can execute without re-authorization</p>
      </div>

      <button
        onClick={onContinue}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
      >
        Continue
      </button>
    </div>
  );
}

export function OnboardingClaimsStep({
  claims,
  extraContent,
  continueDisabled = false,
  continueLabel = "Continue",
  onClaimsChange,
  onBack,
  onContinue,
}: {
  claims: OnboardingClaimConfig[];
  extraContent?: ReactNode;
  continueDisabled?: boolean;
  continueLabel?: string;
  onClaimsChange: (next: OnboardingClaimConfig[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center">Reputation Claims</h2>
      <p className="text-sm text-zinc-400 text-center">
        Select optional privacy-preserving claims about your account
      </p>

      {claims.map((claim) => (
        <div
          key={claim.id}
          onClick={() =>
            !claim.required &&
            onClaimsChange(claims.map((item) => (item.id === claim.id ? { ...item, enabled: !item.enabled } : item)))
          }
          className={`p-4 rounded-lg border cursor-pointer transition-all ${
            claim.enabled
              ? "bg-emerald-600/20 border-emerald-500"
              : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
          } ${claim.required ? "opacity-80 cursor-not-allowed" : ""}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium flex items-center gap-2">
                {claim.label}
                {claim.required ? (
                  <span className="text-xs px-2 py-0.5 bg-zinc-700 rounded">Required</span>
                ) : null}
              </div>
              <div className="text-sm text-zinc-400 mt-1">{claim.description}</div>
            </div>
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                claim.enabled ? "border-emerald-500 bg-emerald-500" : "border-zinc-600"
              }`}
            >
              {claim.enabled ? <Check className="w-3 h-3" /> : null}
            </div>
          </div>
        </div>
      ))}

      {extraContent ?? null}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-3 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onContinue}
          disabled={continueDisabled}
          className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors disabled:opacity-60"
        >
          {continueLabel}
        </button>
      </div>
    </div>
  );
}

export function OnboardingAuthorizeStep({
  proofState,
  isLoading,
  factHash,
  onBack,
  onGenerate,
}: {
  proofState: "idle" | "generating" | "valid";
  isLoading: boolean;
  factHash: string | null;
  onBack: () => void;
  onGenerate: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center">Generate Authorization</h2>
      <p className="text-sm text-zinc-400 text-center">Creating privacy-preserving identity proof (STARK)</p>

      <ProofVisualizer state={proofState} />

      {proofState === "generating" ? (
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-4">
          <p className="text-sm text-violet-300 font-medium text-center">Generating STARK proof (~2-3 minutes)</p>
          <p className="text-xs text-zinc-500 text-center mt-2">
            This creates your privacy-preserving on-chain identity
          </p>
        </div>
      ) : null}

      {proofState === "valid" && factHash ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 space-y-2">
          <p className="text-sm text-emerald-300 font-medium">Proof Generated</p>
          <p className="text-xs text-zinc-400 font-mono break-all">
            Fact: {factHash.slice(0, 20)}...{factHash.slice(-10)}
          </p>
        </div>
      ) : null}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="px-6 py-3 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors disabled:opacity-50"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => void onGenerate()}
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
  );
}

export function OnboardingReviewStep({
  constraints,
  claims,
  factHash,
  portableLifecycle,
  isLoading,
  riskDisclosureStatement,
  riskLevels,
  onBack,
  onSign,
}: {
  constraints: OnboardingConstraintConfig;
  claims: OnboardingClaimConfig[];
  factHash: string | null;
  portableLifecycle?: OnboardingPortableLifecycleStatus;
  isLoading: boolean;
  riskDisclosureStatement: string;
  riskLevels: Array<{ value: number; label: string }>;
  onBack: () => void;
  onSign: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 justify-center">
        <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        </div>
        <h2 className="text-2xl font-bold">Final Authorization</h2>
      </div>

      <p className="text-sm text-zinc-300 text-center">Review your settings and sign to authorize on-chain submission</p>

      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-3">
        <div>
          <div className="text-xs text-zinc-500 uppercase">Constraints</div>
          <div className="text-sm text-zinc-300 mt-1">
            Max Position: {constraints.maxPosition} ETH
            <br />
            Risk: {riskLevels.find((item) => item.value === constraints.riskTolerance)?.label}
            <br />
            Duration: {constraints.sessionDuration}h
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500 uppercase">Claims</div>
          <div className="text-sm text-zinc-300 mt-1">{claims.filter((item) => item.enabled).map((item) => item.label).join(", ")}</div>
        </div>
        {factHash ? (
          <div>
            <div className="text-xs text-zinc-500 uppercase">Fact Hash</div>
            <div className="text-xs text-emerald-400 font-mono mt-1 break-all">{factHash.slice(0, 30)}...</div>
          </div>
        ) : null}
        {portableLifecycle ? (
          <div>
            <div className="text-xs text-zinc-500 uppercase">Portable Trust Prep</div>
            <div className="mt-1 space-y-1 text-xs text-zinc-300">
              <div className="flex items-center justify-between">
                <span>Wallets linked</span>
                <span>{portableLifecycle.walletsLinked ? "yes" : "no"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Wallets verified</span>
                <span>{portableLifecycle.walletsVerified ? "yes" : "no"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Scoped session bound</span>
                <span>{portableLifecycle.scopedSessionBound ? "yes" : "no"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Verified wallets</span>
                <span>{portableLifecycle.verifiedWalletCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Active sessions</span>
                <span>{portableLifecycle.activeSessionCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Attributions synced</span>
                <span>{portableLifecycle.attributionsSynced ? "yes" : "no"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Claims derived</span>
                <span>{portableLifecycle.claimsDerived ? "yes" : "no"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Attributed events</span>
                <span>{portableLifecycle.attributionEvents}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Reputation score (0-100)</span>
                <span>{portableLifecycle.reputationScore.toFixed(2)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <p className="text-sm text-amber-200 leading-relaxed">{riskDisclosureStatement}</p>
        <p className="text-xs text-zinc-500 mt-3">
          Full text: <Link href="/terms" target="_blank" className="text-emerald-400 hover:text-emerald-300">Terms</Link>
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={isLoading}
          className="px-6 py-3 border border-zinc-700 hover:border-zinc-600 rounded-lg transition-colors disabled:opacity-50"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => void onSign()}
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
  );
}

export function OnboardingSubmitStep({
  identityCommitment,
  isLoading,
  onSubmit,
}: {
  identityCommitment: string | null;
  isLoading: boolean;
  onSubmit: () => Promise<void> | void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center">Initialize Agent</h2>
      <p className="text-sm text-zinc-400 text-center">Submitting your privacy-preserving identity on-chain</p>

      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
        <div className="flex items-center gap-2 text-emerald-300 font-medium mb-2">
          <Check className="w-4 h-4" />
          Authorization Signed
        </div>
        {identityCommitment ? (
          <p className="text-xs text-zinc-400 font-mono break-all">Identity: {identityCommitment.slice(0, 30)}...</p>
        ) : null}
      </div>

      <button
        onClick={() => void onSubmit()}
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
  );
}

export function OnboardingCompleteStep({
  agentTxHash,
  portableLifecycle,
  onComplete,
}: {
  agentTxHash: string | null;
  portableLifecycle?: OnboardingPortableLifecycleStatus;
  onComplete: () => void;
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="w-16 h-16 rounded-full bg-emerald-600/20 flex items-center justify-center mx-auto">
        <Check className="w-8 h-8 text-emerald-400" />
      </div>
      <h2 className="text-2xl font-bold">Agent Initialized</h2>
      <p className="text-zinc-400">Your autonomous agent is now live with privacy-preserving identity</p>

      {agentTxHash ? (
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
      ) : null}

      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-left space-y-2 text-sm">
        <p className="text-emerald-300 font-medium">Privacy Preserved:</p>
        <ul className="text-zinc-400 space-y-1 ml-4">
          <li>- Constraints hidden (only hash on-chain)</li>
          <li>- Claims private (provable when needed)</li>
          <li>- Identity commitment stored</li>
        </ul>
      </div>

      {portableLifecycle ? (
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 text-left space-y-2 text-sm">
          <p className="text-zinc-200 font-medium">Portable Trust Lifecycle</p>
          <ul className="text-zinc-400 space-y-1 ml-4">
            <li>- Wallets linked: {portableLifecycle.walletsLinked ? "complete" : "pending"}</li>
            <li>- Wallets verified: {portableLifecycle.walletsVerified ? "complete" : "pending"}</li>
            <li>- Scoped session: {portableLifecycle.scopedSessionBound ? "active" : "pending"}</li>
            <li>- Attribution sync: {portableLifecycle.attributionsSynced ? "complete" : "pending"}</li>
            <li>- Claim derivation: {portableLifecycle.claimsDerived ? "complete" : "pending"}</li>
            <li>- Disclosure pack: {portableLifecycle.disclosurePackIssued ? "issued" : "not issued"}</li>
            <li>- Reputation score: {portableLifecycle.reputationScore.toFixed(2)}</li>
          </ul>
          {portableLifecycle.credentialId ? (
            <p className="text-xs text-zinc-500 font-mono break-all">
              Credential: {portableLifecycle.credentialId}
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        onClick={onComplete}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-colors"
      >
        Go to Dashboard
      </button>
    </div>
  );
}
