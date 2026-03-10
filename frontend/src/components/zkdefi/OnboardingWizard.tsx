"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useSignTypedData } from "@starknet-react/core";
import { constants } from "starknet";
import { motion, AnimatePresence } from "framer-motion";

import { apiFetch } from "@/lib/api/client";
import {
  confirmSessionGrant,
  formatTimeRemaining,
  generateSessionRequest,
  getUserSessions,
  type Session,
} from "@/lib/sessionKeys";
import { toastSuccess, toastError } from "@/lib/toast";
import {
  buildRiskDisclosureTypedData,
  RISK_DISCLOSURE_STATEMENT,
} from "@/lib/riskDisclosureTypedData";
import { markOnboardingComplete } from "@/lib/trust/onboardingState";
import {
  deriveClaims,
  issueCredential,
  normalizeSubject,
  syncAttributions,
} from "@/lib/trust/lifecycle";
import { useLinkedAddresses } from "@/hooks/useProfile";
import {
  OnboardingAuthorizeStep,
  OnboardingClaimsStep,
  OnboardingCompleteStep,
  OnboardingConfigureStep,
  OnboardingConnectStep,
  OnboardingReviewStep,
  OnboardingStepProgress,
  OnboardingSubmitStep,
  OnboardingTrustProgress,
  type OnboardingClaimConfig,
  type OnboardingConstraintConfig,
  type OnboardingPortableLifecycleStatus,
} from "@/components/zkdefi/trust-flow/OnboardingSteps";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type ChainKey = "eth" | "arb" | "base" | "opt";

const CHAIN_INFO: Array<{ short: ChainKey; full: string; label: string }> = [
  { short: "eth", full: "ethereum", label: "Ethereum" },
  { short: "arb", full: "arbitrum", label: "Arbitrum" },
  { short: "base", full: "base", label: "Base" },
  { short: "opt", full: "optimism", label: "Optimism" },
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
  const { linked, draft, setDraft, save: saveLinkedAddresses, saving: savingLinkedAddresses } =
    useLinkedAddresses(address);

  const [step, setStep] = useState<Step>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [proofState, setProofState] = useState<"idle" | "generating" | "valid">("idle");

  const [constraints, setConstraints] = useState<OnboardingConstraintConfig>({
    maxPosition: "5",
    riskTolerance: 50,
    sessionDuration: 24,
  });
  const [claims, setClaims] = useState<OnboardingClaimConfig[]>([
    {
      id: "compliance",
      label: "Compliance",
      description: "Not in sanctioned set",
      enabled: true,
      required: true,
    },
    {
      id: "tenure",
      label: "Tenure > 30 days",
      description: "Account age proof",
      enabled: false,
    },
  ]);

  const [factHash, setFactHash] = useState<string | null>(null);
  const [identityCommitment, setIdentityCommitment] = useState<string | null>(null);
  const [riskSignature, setRiskSignature] = useState<{ r: string; s: string } | null>(null);
  const [agentTxHash, setAgentTxHash] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionTxById, setSessionTxById] = useState<Record<string, string>>({});
  const [pendingGrant, setPendingGrant] = useState<{ sessionId: string } | null>(null);
  const [createSessionConfig, setCreateSessionConfig] = useState({
    sessionKeyAddress: "",
    maxPositionEth: "0.2",
    durationHours: "24",
    protocolPools: true,
    protocolEkubo: true,
    protocolLending: false,
  });
  const [verificationDrafts, setVerificationDrafts] = useState<Record<ChainKey, { signature: string }>>({
    eth: { signature: "" },
    arb: { signature: "" },
    base: { signature: "" },
    opt: { signature: "" },
  });
  const [verificationChallenges, setVerificationChallenges] = useState<
    Record<ChainKey, { nonceId: string; challenge: string } | null>
  >({ eth: null, arb: null, base: null, opt: null });
  const [verifyBusy, setVerifyBusy] = useState<Record<ChainKey, boolean>>({
    eth: false,
    arb: false,
    base: false,
    opt: false,
  });
  const [portableLifecycle, setPortableLifecycle] = useState<OnboardingPortableLifecycleStatus>({
    walletsLinked: false,
    walletsVerified: false,
    scopedSessionBound: false,
    attributionsSynced: false,
    claimsDerived: false,
    disclosurePackIssued: false,
    verifiedWalletCount: 0,
    activeSessionCount: 0,
    attributionEvents: 0,
    reputationScore: 0,
    credentialId: null,
  });

  useEffect(() => {
    if (isConnected && step === 1) {
      toastSuccess("Wallet connected");
      setStep(2);
    }
  }, [isConnected, step]);

  useEffect(() => {
    if (!address) {
      setSessions([]);
      return;
    }
    void refreshSessions(address, setSessions, setSessionLoading);
  }, [address]);

  const linkedVerification = ((linked as Record<string, unknown>)?.verification ?? {}) as Record<
    ChainKey,
    { verified?: boolean }
  >;

  useEffect(() => {
    const linkedCount = CHAIN_INFO.reduce((count, { short }) => {
      const value = (linked as Record<string, unknown>)?.[short];
      if (typeof value === "string" && value.trim()) return count + 1;
      return count;
    }, 0);
    const verifiedWalletCount = CHAIN_INFO.reduce((count, { short }) => {
      return count + (linkedVerification?.[short]?.verified ? 1 : 0);
    }, 0);
    const activeSessionCount = sessions.filter((session) => session.isActive && !session.isExpired).length;

    setPortableLifecycle((prev) => ({
      ...prev,
      walletsLinked: linkedCount > 0,
      walletsVerified: verifiedWalletCount > 0,
      scopedSessionBound: activeSessionCount > 0,
      verifiedWalletCount,
      activeSessionCount,
    }));
  }, [linked, linkedVerification, sessions]);

  const handleConnect = async (connectorId: string) => {
    const connector = connectors.find((item) => item.id === connectorId);
    if (!connector) {
      return;
    }
    try {
      await connect({ connector });
    } catch {
      toastError("Connection failed");
    }
  };

  const handleStartVerify = async (short: ChainKey, full: string) => {
    if (!address) return;
    const chainAddress = (draft as Record<ChainKey, string>)[short]?.trim();
    if (!chainAddress) {
      toastError(`Enter a ${full} address first`);
      return;
    }

    setVerifyBusy((prev) => ({ ...prev, [short]: true }));
    try {
      const response = await apiFetch<{ nonce_id: string; challenge: string }>(
        "/api/v1/zkdefi/linked_addresses/verify/start",
        {
          method: "POST",
          body: JSON.stringify({
            starknet_address: address,
            chain: full,
            address: chainAddress,
          }),
        }
      );

      setVerificationChallenges((prev) => ({
        ...prev,
        [short]: { nonceId: response.nonce_id, challenge: response.challenge },
      }));
      toastSuccess(`${full} verification challenge created`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to start verification");
    } finally {
      setVerifyBusy((prev) => ({ ...prev, [short]: false }));
    }
  };

  const handleCompleteVerify = async (short: ChainKey, full: string) => {
    if (!address) return;
    const challenge = verificationChallenges[short];
    const chainAddress = (draft as Record<ChainKey, string>)[short]?.trim();
    const signature = verificationDrafts[short]?.signature?.trim();
    if (!challenge || !chainAddress || !signature) {
      toastError("Challenge, address, and signature are required");
      return;
    }

    setVerifyBusy((prev) => ({ ...prev, [short]: true }));
    try {
      await apiFetch("/api/v1/zkdefi/linked_addresses/verify/complete", {
        method: "POST",
        body: JSON.stringify({
          starknet_address: address,
          chain: full,
          address: chainAddress,
          nonce_id: challenge.nonceId,
          signature,
        }),
      });

      setVerificationChallenges((prev) => ({ ...prev, [short]: null }));
      setVerificationDrafts((prev) => ({ ...prev, [short]: { signature: "" } }));
      const ok = await saveLinkedAddresses();
      if (!ok) {
        toastError("Address verified, but save failed");
      }
      toastSuccess(`${full} address verified`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to verify address");
    } finally {
      setVerifyBusy((prev) => ({ ...prev, [short]: false }));
    }
  };

  const handleSaveLinkedAddresses = async () => {
    const ok = await saveLinkedAddresses();
    if (ok) {
      toastSuccess("Linked wallets saved");
    } else {
      toastError("Failed to save linked wallets");
    }
  };

  const handleCreateSession = async () => {
    if (!address) return;
    const maxPositionEth = Number(createSessionConfig.maxPositionEth);
    const maxPositionWei = Number.isFinite(maxPositionEth) ? Math.floor(maxPositionEth * 1e18) : 0;
    if (!createSessionConfig.sessionKeyAddress.trim() || maxPositionWei <= 0) {
      toastError("Session key address and max position are required");
      return;
    }

    const protocols: string[] = [];
    if (createSessionConfig.protocolPools) protocols.push("pools");
    if (createSessionConfig.protocolEkubo) protocols.push("ekubo");
    if (createSessionConfig.protocolLending) protocols.push("lending");
    if (!protocols.length) {
      toastError("Select at least one protocol scope");
      return;
    }

    try {
      const result = await generateSessionRequest(address, {
        sessionKeyAddress: createSessionConfig.sessionKeyAddress.trim(),
        maxPosition: maxPositionWei,
        allowedProtocols: protocols,
        durationHours: Number(createSessionConfig.durationHours) || 24,
      });
      setPendingGrant({ sessionId: result.sessionId });
      toastSuccess("Session request created. Confirm with on-chain tx hash.");
      await refreshSessions(address, setSessions, setSessionLoading);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create session request");
    }
  };

  const handleConfirmGrant = async () => {
    if (!pendingGrant || !address) return;
    const txHash = sessionTxById[pendingGrant.sessionId]?.trim();
    if (!txHash) {
      toastError("Enter tx hash to confirm grant");
      return;
    }

    try {
      await confirmSessionGrant(pendingGrant.sessionId, txHash);
      setPendingGrant(null);
      setSessionTxById((prev) => ({ ...prev, [pendingGrant.sessionId]: "" }));
      await refreshSessions(address, setSessions, setSessionLoading);
      toastSuccess("Session grant confirmed");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to confirm grant");
    }
  };

  const handleGenerateAuthorization = async () => {
    if (!address) return;
    setIsLoading(true);
    setProofState("generating");

    try {
      const enabledClaims = claims.filter((item) => item.enabled).map((item) => item.id);
      const maxPositionWei = (Number.parseFloat(constraints.maxPosition) * 1e18).toString();

      const response = await fetch(`${API_BASE}/v1/zkdefi/onboarding/generate_authorization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          constraints: {
            max_position: maxPositionWei,
            risk_tolerance: constraints.riskTolerance,
            session_duration: constraints.sessionDuration,
          },
          claims: enabledClaims,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Authorization failed");
      }

      const data = await response.json();
      setFactHash(data.fact_hash);
      setIdentityCommitment(data.identity_commitment);
      setProofState("valid");
      const subject = normalizeSubject(address);

      try {
        const attribution = await syncAttributions(subject, 90, false);
        setPortableLifecycle((prev) => ({
          ...prev,
          attributionsSynced: true,
          attributionEvents: Number(attribution?.summary?.total_events ?? 0),
        }));
        toastSuccess("Attributions synced");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Attribution sync unavailable";
        toastError(`Non-blocking: ${message}`);
      }

      try {
        const derived = await deriveClaims(subject, 90, 0);
        setPortableLifecycle((prev) => ({
          ...prev,
          claimsDerived: true,
          reputationScore: Number(derived?.claims?.reputation_score_0_100 ?? 0),
        }));
        toastSuccess("Portable claims derived");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Claim derivation unavailable";
        toastError(`Non-blocking: ${message}`);
      }

      toastSuccess("Authorization proof generated");
      setStep(5);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Authorization failed";
      toastError(`Failed: ${message}`);
      setProofState("idle");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignRiskDisclosure = async () => {
    if (!address || !factHash || !identityCommitment) return;
    setIsLoading(true);

    try {
      const chainIdHex =
        chainId != null
          ? typeof chainId === "bigint"
            ? `0x${chainId.toString(16)}`
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
        const obj = sig as unknown as Record<string, unknown>;
        const rValue = obj.r ?? obj.r_low ?? obj[0];
        const sValue = obj.s ?? obj.s_low ?? obj[1];
        if (rValue != null && sValue != null) {
          r = typeof rValue === "bigint" ? rValue.toString() : String(rValue);
          s = typeof sValue === "bigint" ? sValue.toString() : String(sValue);
        }
      }

      if (!r || !s) {
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      const isReject =
        lower.includes("reject") ||
        lower.includes("denied") ||
        lower.includes("cancel") ||
        lower.includes("user");
      toastError(isReject ? "Signing was rejected" : "Signing failed. Try again or use another wallet.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAgent = async () => {
    if (!address || !factHash || !identityCommitment || !riskSignature) return;
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/v1/zkdefi/onboarding/submit_agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: address,
          fact_hash: factHash,
          identity_commitment: identityCommitment,
          risk_signature: riskSignature,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Submission failed");
      }

      const data = await response.json();
      setAgentTxHash(data.tx_hash);

      try {
        const subject = normalizeSubject(address);
        const issued = await issueCredential(subject, {
          template: "portable_identity_v3",
          audience: "self",
          ttlHours: 24,
        });
        setPortableLifecycle((prev) => ({
          ...prev,
          disclosurePackIssued: true,
          credentialId: issued?.credential?.credential_id ?? null,
        }));
        toastSuccess("Disclosure credential issued");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Credential issue unavailable";
        toastError(`Agent initialized, but credential issue failed: ${message}`);
      }

      markOnboardingComplete(address, "onboarding_wizard_submit_agent");
      toastSuccess("Agent initialized successfully!");
      setStep(7);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Submission failed";
      toastError(`Failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const trustProgressComplete = Math.max(0, Math.min(7, step - 1));

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <OnboardingStepProgress currentStep={step} />
        <OnboardingTrustProgress
          complete={trustProgressComplete}
          total={7}
          ready={step === 7}
        />

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-xl p-6"
          >
            {step === 1 ? (
              <OnboardingConnectStep
                connectors={connectors.map((item) => ({ id: item.id, name: item.name }))}
                onConnect={handleConnect}
              />
            ) : null}

            {step === 2 ? (
              <OnboardingConfigureStep
                constraints={constraints}
                onConstraintsChange={setConstraints}
                riskLevels={RISK_LEVELS}
                onContinue={() => setStep(3)}
              />
            ) : null}

            {step === 3 ? (
              <OnboardingClaimsStep
                claims={claims}
                extraContent={
                  <div className="space-y-3">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div className="mb-2 text-sm font-medium">Link + Verify Wallets</div>
                      <div className="mb-2 text-xs text-zinc-400">
                        Verify at least one linked wallet for cross-chain trust attribution.
                      </div>
                      <div className="space-y-2">
                        {CHAIN_INFO.map(({ short, full, label }) => (
                          <div key={short} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="text-zinc-300">{label}</span>
                              <span className={linkedVerification?.[short]?.verified ? "text-emerald-300" : "text-zinc-500"}>
                                {linkedVerification?.[short]?.verified ? "verified" : "unverified"}
                              </span>
                            </div>
                            <input
                              value={(draft as Record<ChainKey, string>)[short] ?? ""}
                              onChange={(e) => setDraft((prev) => ({ ...prev, [short]: e.target.value }))}
                              placeholder={`0x... ${label} address`}
                              className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                            />
                            {verificationChallenges[short] ? (
                              <div className="mb-2 rounded border border-zinc-700 bg-zinc-900 p-2 text-[11px] text-zinc-400">
                                {verificationChallenges[short]?.challenge}
                              </div>
                            ) : null}
                            <input
                              value={verificationDrafts[short].signature}
                              onChange={(e) =>
                                setVerificationDrafts((prev) => ({
                                  ...prev,
                                  [short]: { signature: e.target.value },
                                }))
                              }
                              placeholder="Paste EVM signature"
                              className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => void handleStartVerify(short, full)}
                                disabled={verifyBusy[short]}
                                className="rounded border border-zinc-700 px-2 py-1 text-[11px] hover:border-zinc-500 disabled:opacity-60"
                              >
                                {verifyBusy[short] ? "..." : "start"}
                              </button>
                              <button
                                onClick={() => void handleCompleteVerify(short, full)}
                                disabled={verifyBusy[short]}
                                className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-medium hover:bg-emerald-600 disabled:opacity-60"
                              >
                                complete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => void handleSaveLinkedAddresses()}
                        disabled={savingLinkedAddresses}
                        className="mt-2 rounded border border-zinc-700 px-2 py-1 text-xs hover:border-zinc-500 disabled:opacity-60"
                      >
                        {savingLinkedAddresses ? "saving..." : "save linked wallets"}
                      </button>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div className="mb-2 text-sm font-medium">Bind Scoped Session</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          value={createSessionConfig.sessionKeyAddress}
                          onChange={(e) =>
                            setCreateSessionConfig((prev) => ({ ...prev, sessionKeyAddress: e.target.value }))
                          }
                          placeholder="Session key address"
                          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                        />
                        <input
                          value={createSessionConfig.maxPositionEth}
                          onChange={(e) =>
                            setCreateSessionConfig((prev) => ({ ...prev, maxPositionEth: e.target.value }))
                          }
                          placeholder="Max position (ETH)"
                          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                        />
                        <input
                          value={createSessionConfig.durationHours}
                          onChange={(e) =>
                            setCreateSessionConfig((prev) => ({ ...prev, durationHours: e.target.value }))
                          }
                          placeholder="Duration hours"
                          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                        />
                        <div className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px]">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={createSessionConfig.protocolPools}
                              onChange={(e) =>
                                setCreateSessionConfig((prev) => ({ ...prev, protocolPools: e.target.checked }))
                              }
                            />
                            pools
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={createSessionConfig.protocolEkubo}
                              onChange={(e) =>
                                setCreateSessionConfig((prev) => ({ ...prev, protocolEkubo: e.target.checked }))
                              }
                            />
                            ekubo
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={createSessionConfig.protocolLending}
                              onChange={(e) =>
                                setCreateSessionConfig((prev) => ({ ...prev, protocolLending: e.target.checked }))
                              }
                            />
                            lending
                          </label>
                        </div>
                      </div>
                      <button
                        onClick={() => void handleCreateSession()}
                        className="mt-2 rounded bg-emerald-700 px-2 py-1 text-xs font-medium hover:bg-emerald-600"
                      >
                        create session request
                      </button>

                      {pendingGrant ? (
                        <div className="mt-2 rounded-lg border border-emerald-600/30 bg-emerald-900/10 p-2 text-xs">
                          <div className="mb-1 text-zinc-300">
                            pending: {pendingGrant.sessionId.slice(0, 18)}...
                          </div>
                          <input
                            value={sessionTxById[pendingGrant.sessionId] ?? ""}
                            onChange={(e) =>
                              setSessionTxById((prev) => ({ ...prev, [pendingGrant.sessionId]: e.target.value }))
                            }
                            placeholder="Grant tx hash"
                            className="mb-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-emerald-500"
                          />
                          <button
                            onClick={() => void handleConfirmGrant()}
                            className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-medium hover:bg-emerald-600"
                          >
                            confirm grant
                          </button>
                        </div>
                      ) : null}

                      <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-[11px] text-zinc-400">
                        <div className="mb-1 text-zinc-300">
                          active sessions: {sessionLoading ? "loading..." : sessions.length}
                        </div>
                        {sessions.slice(0, 2).map((session) => (
                          <div key={session.sessionId} className="mb-1">
                            {session.sessionId.slice(0, 10)}... {session.isActive && !session.isExpired ? "active" : "inactive"} ({formatTimeRemaining(session.expiresAt)})
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
                      <div className="mb-1 text-zinc-300">Trust readiness</div>
                      <div className="grid grid-cols-2 gap-1 text-zinc-400">
                        <span>wallets linked</span>
                        <span>{portableLifecycle.walletsLinked ? "yes" : "no"}</span>
                        <span>wallets verified</span>
                        <span>{portableLifecycle.walletsVerified ? "yes" : "no"}</span>
                        <span>active session</span>
                        <span>{portableLifecycle.scopedSessionBound ? "yes" : "no"}</span>
                      </div>
                    </div>
                  </div>
                }
                continueLabel={
                  portableLifecycle.walletsVerified && portableLifecycle.scopedSessionBound
                    ? "Continue"
                    : "Continue (recommended: verify + bind session)"
                }
                onClaimsChange={setClaims}
                onBack={() => setStep(2)}
                onContinue={() => setStep(4)}
              />
            ) : null}

            {step === 4 ? (
              <OnboardingAuthorizeStep
                proofState={proofState}
                isLoading={isLoading}
                factHash={factHash}
                onBack={() => setStep(3)}
                onGenerate={handleGenerateAuthorization}
              />
            ) : null}

            {step === 5 ? (
              <OnboardingReviewStep
                constraints={constraints}
                claims={claims}
                factHash={factHash}
                portableLifecycle={portableLifecycle}
                isLoading={isLoading}
                riskDisclosureStatement={RISK_DISCLOSURE_STATEMENT}
                riskLevels={RISK_LEVELS}
                onBack={() => setStep(4)}
                onSign={handleSignRiskDisclosure}
              />
            ) : null}

            {step === 6 ? (
              <OnboardingSubmitStep
                identityCommitment={identityCommitment}
                isLoading={isLoading}
                onSubmit={handleSubmitAgent}
              />
            ) : null}

            {step === 7 ? (
              <OnboardingCompleteStep
                agentTxHash={agentTxHash}
                portableLifecycle={portableLifecycle}
                onComplete={onComplete}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

async function refreshSessions(
  address: string,
  setSessions: (sessions: Session[]) => void,
  setLoading: (loading: boolean) => void
): Promise<void> {
  setLoading(true);
  try {
    const data = await getUserSessions(address);
    setSessions(data);
  } catch {
    setSessions([]);
  } finally {
    setLoading(false);
  }
}
