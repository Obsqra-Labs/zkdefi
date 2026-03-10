"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "@starknet-react/core";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Download,
  Eye,
  Fingerprint,
  KeyRound,
  Link2,
  Loader2,
  Shield,
  ShieldCheck,
  TrendingUp,
  Vote,
} from "lucide-react";

import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { AppNavbar } from "@/components/zkdefi/AppNavbar";
import { TrustFlowChecklist } from "@/components/zkdefi/TrustFlowChecklist";
import { TrustFlowProgressSummary } from "@/components/zkdefi/trust-flow/TrustFlowProgressSummary";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { apiFetch, apiUrl } from "@/lib/api/client";
import { toFixed, formatUsdSafe } from "@/lib/format";
import {
  confirmSessionGrant,
  confirmSessionRevoke,
  formatTimeRemaining,
  generateSessionRequest,
  getUserSessions,
  revokeSession,
  type Session,
} from "@/lib/sessionKeys";
import {
  getDisclosureClaims,
  getExecutionGate,
  getGovernancePower,
  getIdentityBindingStatus,
  getLendingGate,
  type DisclosureClaimKey,
} from "@/lib/trust/adapters";
import {
  deriveClaims,
  fetchIdentityGraph,
  issueCredential,
  normalizeSubject,
  revokeCredential,
  syncAttributions,
  verifyCredential,
  type AttributionQueryResponse,
  type ClaimsDeriveResponse,
  type CredentialIssueResponse,
  type CredentialRevokeResponse,
  type CredentialVerifyResponse,
  type IdentityGraphResponse,
} from "@/lib/trust/lifecycle";
import {
  isPortableIdentityV3Enabled,
  isProfileV3Enabled,
  isTrustSurfaceWiringEnabled,
  isZkficoFinisherEnabled,
} from "@/lib/trust/flags";
import { useTrustFlowState } from "@/lib/trust/useTrustFlowState";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  useLinkedAddresses,
  useRiskProfile,
  useRiskProfileV2,
} from "@/hooks/useProfile";

type LensKey = "identity" | "reputation" | "credit" | "governance";
type ChainKey = "eth" | "arb" | "base" | "opt";

const CHAIN_INFO: Array<{ short: ChainKey; full: string; label: string }> = [
  { short: "eth", full: "ethereum", label: "Ethereum" },
  { short: "arb", full: "arbitrum", label: "Arbitrum" },
  { short: "base", full: "base", label: "Base" },
  { short: "opt", full: "optimism", label: "Optimism" },
];

const DISCLOSURE_OPTIONS: Array<{ key: DisclosureClaimKey; label: string }> = [
  { key: "identity_binding", label: "Identity Binding" },
  { key: "reputation_tier", label: "Reputation Tier" },
  { key: "credit_line", label: "Credit Terms" },
  { key: "governance_power", label: "Governance Power" },
  { key: "execution_gate", label: "Execution Gate" },
];

interface ZkficoAggregate {
  pack_id?: string;
  pack_version?: string;
  readiness?: {
    complete?: number;
    total?: number;
    ratio?: number;
    ready_for_policy?: boolean;
    ready_for_credit?: boolean;
  };
  scores?: {
    trust_score_0_100?: number;
    fico_display_300_850?: number;
  };
}

interface ZkficoManifest {
  pack_id?: string;
  pack_version?: string;
  proof_policy?: {
    mode?: string;
    ux_verifier?: string;
    canonical_settlement_envelope?: string;
  };
  circuits?: Array<{
    proof_type?: string;
    circuit_id?: string;
    artifact_hashes?: {
      wasm_sha256?: string | null;
      zkey_sha256?: string | null;
      vkey_sha256?: string | null;
    };
  }>;
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

function asWeiFromEth(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 1e18);
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { settled } = useWalletSettled();
  const [mounted, setMounted] = useState(false);
  const [activeLens, setActiveLens] = useState<LensKey>("identity");
  const profileV3Enabled = isProfileV3Enabled();
  const portableV3Enabled = isPortableIdentityV3Enabled();
  const zkficoEnabled = isZkficoFinisherEnabled();
  const trustSurfaceWiringEnabled = isTrustSurfaceWiringEnabled();

  const { profile: bundle, loading: bundleLoading, refetch: refetchBundle } = useRiskProfile(address);
  const {
    profile: profileV2,
    loading: v2Loading,
    error: v2Error,
    refetch: refetchV2,
  } = useRiskProfileV2(address);
  const { linked, draft, setDraft, save, saving } = useLinkedAddresses(address);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionTxById, setSessionTxById] = useState<Record<string, string>>({});
  const [createSessionConfig, setCreateSessionConfig] = useState({
    sessionKeyAddress: "",
    maxPositionEth: "0.2",
    durationHours: "24",
    protocolPools: true,
    protocolEkubo: true,
    protocolJediswap: false,
  });
  const [pendingGrant, setPendingGrant] = useState<{ sessionId: string } | null>(null);

  const [stakeCollateralEth, setStakeCollateralEth] = useState("0.10");
  const [proofs, setProofs] = useState<Array<Record<string, unknown>>>([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [zkficoAggregate, setZkficoAggregate] = useState<ZkficoAggregate | null>(null);
  const [zkficoManifest, setZkficoManifest] = useState<ZkficoManifest | null>(null);

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

  const [selectedClaims, setSelectedClaims] = useState<DisclosureClaimKey[]>(
    DISCLOSURE_OPTIONS.map((item) => item.key)
  );
  const [trustOpsLoading, setTrustOpsLoading] = useState({
    graph: false,
    sync: false,
    derive: false,
    issue: false,
    verify: false,
    revoke: false,
  });
  const [identityGraphSnapshot, setIdentityGraphSnapshot] = useState<IdentityGraphResponse | null>(null);
  const [attributionSnapshot, setAttributionSnapshot] = useState<AttributionQueryResponse | null>(null);
  const [derivedClaimsSnapshot, setDerivedClaimsSnapshot] = useState<ClaimsDeriveResponse | null>(null);
  const [issuedCredential, setIssuedCredential] = useState<CredentialIssueResponse["credential"] | null>(null);
  const [credentialVerification, setCredentialVerification] = useState<CredentialVerifyResponse | null>(null);
  const [credentialRevocation, setCredentialRevocation] = useState<CredentialRevokeResponse | null>(null);
  const [credentialVerifyInput, setCredentialVerifyInput] = useState("");
  const [credentialRevokeInput, setCredentialRevokeInput] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!address) {
      setSessions([]);
      return;
    }
    void refreshSessions(address, setSessions, setSessionLoading);
  }, [address]);

  useEffect(() => {
    if (!address) {
      setProofs([]);
      return;
    }
    void refreshProofs(address, setProofs, setProofsLoading);
  }, [address]);

  useEffect(() => {
    if (!address || !zkficoEnabled) {
      setZkficoAggregate(null);
      setZkficoManifest(null);
      return;
    }

    let cancelled = false;
    const loadZkfico = async () => {
      try {
        const [aggregate, manifest] = await Promise.all([
          apiFetch<ZkficoAggregate>(`/api/v1/zkdefi/reputation/zkfico/${address}`),
          apiFetch<ZkficoManifest>("/api/v1/zkdefi/reputation/pack/manifest"),
        ]);
        if (cancelled) return;
        setZkficoAggregate(aggregate ?? null);
        setZkficoManifest(manifest ?? null);
      } catch {
        if (cancelled) return;
        setZkficoAggregate(null);
        setZkficoManifest(null);
      }
    };

    void loadZkfico();
    return () => {
      cancelled = true;
    };
  }, [address, zkficoEnabled]);

  const executionGate = useMemo(() => getExecutionGate(profileV2), [profileV2]);
  const lendingGate = useMemo(() => getLendingGate(profileV2), [profileV2]);
  const governancePower = useMemo(() => getGovernancePower(profileV2), [profileV2]);
  const identityBinding = useMemo(() => getIdentityBindingStatus(profileV2), [profileV2]);
  const trustFlow = useTrustFlowState(profileV2, address);

  const disclosureClaims = useMemo(
    () => getDisclosureClaims(profileV2, selectedClaims),
    [profileV2, selectedClaims]
  );

  const linkedVerification = ((linked as Record<string, unknown>)?.verification ?? {}) as Record<
    ChainKey,
    { verified?: boolean; verified_at?: string; address?: string }
  >;
  const trustSubject = useMemo(
    () => normalizeSubject(profileV2?.identity?.subject_id ?? address ?? ""),
    [profileV2?.identity?.subject_id, address]
  );

  const setTrustLoading = (
    key: keyof typeof trustOpsLoading,
    value: boolean
  ) => {
    setTrustOpsLoading((prev) => ({ ...prev, [key]: value }));
  };

  const refreshing = async () => {
    await Promise.all([refetchBundle(), refetchV2()]);
    if (address) {
      const tasks: Array<Promise<unknown>> = [
        refreshSessions(address, setSessions, setSessionLoading),
        refreshProofs(address, setProofs, setProofsLoading),
      ];
      if (zkficoEnabled) {
        tasks.push(
          apiFetch<ZkficoAggregate>(`/api/v1/zkdefi/reputation/zkfico/${address}`)
            .then((payload) => setZkficoAggregate(payload ?? null))
            .catch(() => setZkficoAggregate(null))
        );
      }
      await Promise.all(tasks);
    }
  };

  const handleFetchIdentityGraph = async () => {
    if (!trustSubject) return;
    setTrustLoading("graph", true);
    try {
      const graph = await fetchIdentityGraph(trustSubject);
      setIdentityGraphSnapshot(graph ?? null);
      toastSuccess("Identity graph loaded");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to load identity graph");
    } finally {
      setTrustLoading("graph", false);
    }
  };

  const handleSyncAttributions = async () => {
    if (!trustSubject) return;
    setTrustLoading("sync", true);
    try {
      const payload = await syncAttributions(trustSubject, 90, false);
      setAttributionSnapshot(payload ?? null);
      await refreshing();
      toastSuccess("Attributions synced");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to sync attributions");
    } finally {
      setTrustLoading("sync", false);
    }
  };

  const handleDeriveClaims = async () => {
    if (!trustSubject) return;
    setTrustLoading("derive", true);
    try {
      const payload = await deriveClaims(trustSubject, 90, 0.0);
      setDerivedClaimsSnapshot(payload ?? null);
      await refreshing();
      toastSuccess("Claims derived");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to derive claims");
    } finally {
      setTrustLoading("derive", false);
    }
  };

  const handleIssueCredential = async () => {
    if (!trustSubject) return;
    setTrustLoading("issue", true);
    try {
      const payload = await issueCredential(trustSubject, {
        template: "portable_identity_v3",
        audience: "self",
        ttlHours: 24,
      });
      setIssuedCredential(payload?.credential ?? null);
      if (payload?.credential?.credential_id) {
        setCredentialVerifyInput(payload.credential.credential_id);
        setCredentialRevokeInput(payload.credential.credential_id);
      }
      await refreshing();
      toastSuccess("Credential issued");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to issue credential");
    } finally {
      setTrustLoading("issue", false);
    }
  };

  const handleVerifyCredential = async () => {
    const credentialId = credentialVerifyInput.trim();
    if (!credentialId) {
      toastError("Enter a credential id");
      return;
    }
    setTrustLoading("verify", true);
    try {
      const payload = await verifyCredential(credentialId);
      setCredentialVerification(payload ?? null);
      toastSuccess(payload?.valid ? "Credential verified" : "Credential not valid");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to verify credential");
    } finally {
      setTrustLoading("verify", false);
    }
  };

  const handleRevokeCredential = async () => {
    const credentialId = credentialRevokeInput.trim();
    if (!credentialId) {
      toastError("Enter a credential id");
      return;
    }
    setTrustLoading("revoke", true);
    try {
      const payload = await revokeCredential(credentialId, "profile_user_request");
      setCredentialRevocation(payload ?? null);
      await refreshing();
      toastSuccess(payload?.revoked ? "Credential revoked" : "Credential revoke not applied");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to revoke credential");
    } finally {
      setTrustLoading("revoke", false);
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
      await save();
      await refreshing();
      toastSuccess(`${full} address verified`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to verify address");
    } finally {
      setVerifyBusy((prev) => ({ ...prev, [short]: false }));
    }
  };

  const handleSaveLinkedAddresses = async () => {
    const ok = await save();
    if (ok) {
      toastSuccess("Linked wallets saved");
      await refreshing();
    } else {
      toastError("Failed to save linked wallets");
    }
  };

  const handleCreateSession = async () => {
    if (!address) return;

    const maxPositionWei = asWeiFromEth(createSessionConfig.maxPositionEth);
    if (!createSessionConfig.sessionKeyAddress.trim() || maxPositionWei <= 0) {
      toastError("Session key address and max position are required");
      return;
    }

    const protocols: string[] = [];
    if (createSessionConfig.protocolPools) protocols.push("pools");
    if (createSessionConfig.protocolEkubo) protocols.push("ekubo");
    if (createSessionConfig.protocolJediswap) protocols.push("jediswap");
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
      toastSuccess("Session request created. Confirm it with on-chain tx hash.");
      await refreshSessions(address, setSessions, setSessionLoading);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create session request");
    }
  };

  const handleConfirmGrant = async () => {
    if (!pendingGrant) return;
    const txHash = sessionTxById[pendingGrant.sessionId]?.trim();
    if (!txHash) {
      toastError("Enter tx hash to confirm grant");
      return;
    }

    try {
      await confirmSessionGrant(pendingGrant.sessionId, txHash);
      setPendingGrant(null);
      setSessionTxById((prev) => ({ ...prev, [pendingGrant.sessionId]: "" }));
      if (address) await refreshSessions(address, setSessions, setSessionLoading);
      await refreshing();
      toastSuccess("Session grant confirmed");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to confirm grant");
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!address) return;
    try {
      await revokeSession(sessionId, address);
      toastSuccess("Session revoke request created. Confirm with tx hash.");
      if (address) await refreshSessions(address, setSessions, setSessionLoading);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to request revoke");
    }
  };

  const handleConfirmRevoke = async (sessionId: string) => {
    const txHash = sessionTxById[sessionId]?.trim();
    if (!txHash) {
      toastError("Enter tx hash to confirm revoke");
      return;
    }

    try {
      await confirmSessionRevoke(sessionId, txHash);
      setSessionTxById((prev) => ({ ...prev, [sessionId]: "" }));
      if (address) await refreshSessions(address, setSessions, setSessionLoading);
      await refreshing();
      toastSuccess("Session revoke confirmed");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to confirm revoke");
    }
  };

  const handleStakeCollateral = async () => {
    if (!address) return;
    const amountWei = asWeiFromEth(stakeCollateralEth);
    if (amountWei <= 0) {
      toastError("Enter a positive collateral amount");
      return;
    }

    try {
      await apiFetch(`/api/v1/zkdefi/reputation/stake-collateral?address=${address}&amount_wei=${amountWei}`, {
        method: "POST",
      });
      toastSuccess("Collateral staked");
      await refreshing();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to stake collateral");
    }
  };

  const handleExportErc8004 = async () => {
    if (!address) return;
    try {
      const payload = await apiFetch(`/api/v1/zkdefi/risk_profile/${address}?format=erc8004`);
      downloadJson(`profile-erc8004-${address}.json`, payload);
      toastSuccess("Portable profile exported");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to export profile");
    }
  };

  const handleExportSnapshot = async () => {
    if (!address) return;
    try {
      const payload = await apiFetch(`/api/v1/zkdefi/profile/snapshot/${address}`);
      downloadJson(`profile-snapshot-${address}.json`, payload);
      toastSuccess("Profile snapshot exported");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to export snapshot");
    }
  };

  const handleExportSelectedClaims = () => {
    if (!profileV2) {
      toastError("No profile to export");
      return;
    }
    downloadJson(`profile-claims-${profileV2.address}.json`, {
      address: profileV2.address,
      generated_at: profileV2.generated_at,
      claims: disclosureClaims,
    });
    toastSuccess("Selected claims exported");
  };

  if (!mounted || (!settled && !isConnected)) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-zinc-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Restoring wallet session...</span>
        </div>
      </main>
    );
  }

  if (!isConnected || !address) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <header className="border-b border-zinc-800 px-6 py-4">
          <div className="mx-auto max-w-6xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-emerald-400" />
              <span className="font-semibold">zkde.fi Profile</span>
            </div>
            <ConnectButton />
          </div>
        </header>
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <ShieldCheck className="mx-auto mb-4 h-14 w-14 text-zinc-500" />
          <h1 className="text-2xl font-semibold">Connect wallet to open Profile V2</h1>
          <p className="mt-2 text-zinc-400">
            Identity, reputation, credit, and governance are separated into explicit trust domains.
          </p>
        </div>
      </main>
    );
  }

  const rep = profileV2?.reputation ?? bundle?.reputation;
  const passport = profileV2?.passport ?? bundle?.risk_passport;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <AppNavbar />
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-emerald-400" />
            <div>
              <div className="font-semibold">Capital OS Profile V2</div>
              <div className="text-xs text-zinc-400">{address}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refreshing()}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500"
            >
              Refresh
            </button>
            <ConnectButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6">
        {v2Error ? (
          <div className="mb-4 rounded-xl border border-amber-600/30 bg-amber-900/20 p-3 text-sm text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>V2 profile unavailable; showing fallback data where possible.</span>
            </div>
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Reputation Tier" value={String(rep?.tier_name ?? "Unknown")} />
          <StatCard label="Passport Score" value={String(passport?.composite_score ?? 0)} />
          <StatCard label="Execution Gate" value={executionGate.mode.toUpperCase()} />
          <StatCard label="Voting Power" value={toFixed(governancePower?.votingPower, 2)} />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <LensButton icon={<Fingerprint className="h-4 w-4" />} active={activeLens === "identity"} onClick={() => setActiveLens("identity")}>
            Identity
          </LensButton>
          <LensButton icon={<ShieldCheck className="h-4 w-4" />} active={activeLens === "reputation"} onClick={() => setActiveLens("reputation")}>
            Reputation
          </LensButton>
          <LensButton icon={<TrendingUp className="h-4 w-4" />} active={activeLens === "credit"} onClick={() => setActiveLens("credit")}>
            Credit
          </LensButton>
          <LensButton icon={<Vote className="h-4 w-4" />} active={activeLens === "governance"} onClick={() => setActiveLens("governance")}>
            Governance
          </LensButton>
        </div>

        {activeLens === "identity" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <Panel title="Identity Binding" icon={<Link2 className="h-4 w-4" />}>
              <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-300">
                <div className="flex items-center justify-between">
                  <span>Has agent identity</span>
                  <Badge ok={identityBinding.hasAgent} text={identityBinding.hasAgent ? "Yes" : "No"} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Verified linked wallets</span>
                  <span>{identityBinding.linkedVerifiedCount}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Dual wallet session</span>
                  <Badge ok={identityBinding.dualWalletActive} text={identityBinding.dualWalletStatus} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Active session keys</span>
                  <span>{identityBinding.activeSessionCount}</span>
                </div>
              </div>

              {profileV3Enabled ? (
                <div className="mb-3">
                  <TrustFlowProgressSummary
                    complete={trustFlow.progress.complete}
                    total={trustFlow.progress.total}
                    ready={trustFlow.readyForAgent}
                    progressLabel="progress"
                    readinessLabel="ready for agent"
                  />
                  <div className="mb-2 text-xs text-zinc-500">complete flow: {trustFlow.complete ? "yes" : "no"}</div>
                  <TrustFlowChecklist state={trustFlow.state} />
                </div>
              ) : null}

              {portableV3Enabled ? (
                <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-xs text-zinc-300">
                  <div className="mb-2 flex items-center justify-between text-zinc-200">
                    <span className="font-medium">Portable Reputation V3</span>
                    <span className="text-zinc-500">subject: {profileV2?.identity?.subject_id ?? "n/a"}</span>
                  </div>
                  <MetricRow
                    label="Attribution events"
                    value={String(profileV2?.attribution_summary?.event_count ?? 0)}
                    compact
                  />
                  <MetricRow
                    label="Active credentials"
                    value={String(profileV2?.credential_summary?.active_count ?? 0)}
                    compact
                  />
                  <MetricRow
                    label="Credential revocations"
                    value={String(profileV2?.credential_summary?.revoked_count ?? 0)}
                    compact
                  />
                </div>
              ) : null}

              <div className="space-y-3">
                {CHAIN_INFO.map(({ short, full, label }) => (
                  <div key={short} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium text-zinc-200">{label}</span>
                      <Badge
                        ok={Boolean(linkedVerification?.[short]?.verified)}
                        text={linkedVerification?.[short]?.verified ? "Verified" : "Unverified"}
                      />
                    </div>
                    <input
                      value={(draft as Record<ChainKey, string>)[short] ?? ""}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [short]: e.target.value }))}
                      placeholder={`0x... ${label} address`}
                      className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />

                    {verificationChallenges[short] ? (
                      <div className="mb-2 rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-300">
                        <div className="mb-1">Challenge:</div>
                        <div className="break-all text-zinc-400">{verificationChallenges[short]?.challenge}</div>
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
                      placeholder="Paste EVM signature to complete verification"
                      className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleStartVerify(short, full)}
                        disabled={verifyBusy[short]}
                        className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:border-zinc-500 disabled:opacity-60"
                      >
                        {verifyBusy[short] ? "Working..." : "Start Verify"}
                      </button>
                      <button
                        onClick={() => void handleCompleteVerify(short, full)}
                        disabled={verifyBusy[short]}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium hover:bg-emerald-500 disabled:opacity-60"
                      >
                        Complete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => void handleSaveLinkedAddresses()}
                disabled={saving}
                className="mt-3 w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-zinc-500 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Linked Wallets"}
              </button>
            </Panel>

            <Panel title="Smart Wallet Sessions" icon={<KeyRound className="h-4 w-4" />}>
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <div className="mb-2 text-sm font-medium">Create Session Capability</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      value={createSessionConfig.sessionKeyAddress}
                      onChange={(e) =>
                        setCreateSessionConfig((prev) => ({ ...prev, sessionKeyAddress: e.target.value }))
                      }
                      placeholder="Session key address"
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    <input
                      value={createSessionConfig.maxPositionEth}
                      onChange={(e) =>
                        setCreateSessionConfig((prev) => ({ ...prev, maxPositionEth: e.target.value }))
                      }
                      placeholder="Max position (ETH)"
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    <input
                      value={createSessionConfig.durationHours}
                      onChange={(e) =>
                        setCreateSessionConfig((prev) => ({ ...prev, durationHours: e.target.value }))
                      }
                      placeholder="Duration hours"
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    <div className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs">
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
                          checked={createSessionConfig.protocolJediswap}
                          onChange={(e) =>
                            setCreateSessionConfig((prev) => ({ ...prev, protocolJediswap: e.target.checked }))
                          }
                        />
                        jediswap
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleCreateSession()}
                    className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500"
                  >
                    Create Session Request
                  </button>
                </div>

                {pendingGrant ? (
                  <div className="rounded-lg border border-emerald-600/30 bg-emerald-900/10 p-3 text-sm">
                    <div className="mb-2">Pending grant confirmation for {pendingGrant.sessionId}</div>
                    <input
                      value={sessionTxById[pendingGrant.sessionId] ?? ""}
                      onChange={(e) =>
                        setSessionTxById((prev) => ({ ...prev, [pendingGrant.sessionId]: e.target.value }))
                      }
                      placeholder="Grant tx hash"
                      className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={() => void handleConfirmGrant()}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium hover:bg-emerald-500"
                    >
                      Confirm Grant
                    </button>
                  </div>
                ) : null}

                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">Active Sessions</span>
                    <span className="text-zinc-400">{sessionLoading ? "loading..." : sessions.length}</span>
                  </div>
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <div key={session.sessionId} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-zinc-200">{session.sessionId.slice(0, 18)}...</span>
                          <Badge ok={session.isActive && !session.isExpired} text={session.isExpired ? "Expired" : session.isActive ? "Active" : "Inactive"} />
                        </div>
                        <div className="mt-1 text-zinc-400">key: {session.sessionKey}</div>
                        <div className="mt-1 text-zinc-400">time left: {formatTimeRemaining(session.expiresAt)}</div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <button
                            onClick={() => void handleRevokeSession(session.sessionId)}
                            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs hover:border-zinc-500"
                          >
                            Request Revoke
                          </button>
                          <input
                            value={sessionTxById[session.sessionId] ?? ""}
                            onChange={(e) =>
                              setSessionTxById((prev) => ({ ...prev, [session.sessionId]: e.target.value }))
                            }
                            placeholder="Revoke tx hash"
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                          />
                          <button
                            onClick={() => void handleConfirmRevoke(session.sessionId)}
                            className="rounded-lg bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700 md:col-span-2"
                          >
                            Confirm Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                    {!sessionLoading && sessions.length === 0 ? (
                      <div className="text-xs text-zinc-500">No sessions yet.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Portable Identity + Selective Disclosure" icon={<Download className="h-4 w-4" />} className="lg:col-span-2">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm font-medium">Export</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => void handleExportErc8004()} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:border-zinc-500">
                      Export ERC-8004
                    </button>
                    <button onClick={() => void handleExportSnapshot()} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:border-zinc-500">
                      Export Snapshot
                    </button>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Disclosure Claims</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DISCLOSURE_OPTIONS.map((item) => (
                      <label key={item.key} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={selectedClaims.includes(item.key)}
                          onChange={(e) => {
                            setSelectedClaims((prev) =>
                              e.target.checked ? [...prev, item.key] : prev.filter((k) => k !== item.key)
                            );
                          }}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={handleExportSelectedClaims}
                    className="mt-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium hover:bg-emerald-500"
                  >
                    Export Selected Claims
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Eye className="h-4 w-4" /> Claim Preview
                </div>
                <pre className="max-h-56 overflow-auto text-xs text-zinc-300">
                  {JSON.stringify(disclosureClaims, null, 2)}
                </pre>
              </div>
            </Panel>

            {portableV3Enabled ? (
              <Panel title="Trust Lifecycle Actions" icon={<Shield className="h-4 w-4" />} className="lg:col-span-2">
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="mb-2 text-sm font-medium text-zinc-100">Identity Graph</div>
                    <button
                      onClick={() => void handleFetchIdentityGraph()}
                      disabled={trustOpsLoading.graph}
                      className="mb-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:border-zinc-500 disabled:opacity-60"
                    >
                      {trustOpsLoading.graph ? "Loading..." : "Load graph"}
                    </button>
                    <MetricRow
                      label="links"
                      value={String(identityGraphSnapshot?.links?.length ?? 0)}
                      compact
                    />
                    <MetricRow
                      label="sessions"
                      value={String(identityGraphSnapshot?.sessions?.length ?? 0)}
                      compact
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="mb-2 text-sm font-medium text-zinc-100">Attributions + Claims</div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleSyncAttributions()}
                        disabled={trustOpsLoading.sync}
                        className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:border-zinc-500 disabled:opacity-60"
                      >
                        {trustOpsLoading.sync ? "Syncing..." : "Sync attributions"}
                      </button>
                      <button
                        onClick={() => void handleDeriveClaims()}
                        disabled={trustOpsLoading.derive}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {trustOpsLoading.derive ? "Deriving..." : "Derive claims"}
                      </button>
                    </div>
                    <MetricRow
                      label="events"
                      value={String(attributionSnapshot?.summary?.total_events ?? 0)}
                      compact
                    />
                    <MetricRow
                      label="coverage"
                      value={String(attributionSnapshot?.summary?.coverage_score ?? 0)}
                      compact
                    />
                    <MetricRow
                      label="reputation score"
                      value={String(
                        Number(derivedClaimsSnapshot?.claims?.reputation_score_0_100 ?? 0).toFixed(2)
                      )}
                      compact
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="mb-2 text-sm font-medium text-zinc-100">Credential Lifecycle</div>
                    <button
                      onClick={() => void handleIssueCredential()}
                      disabled={trustOpsLoading.issue}
                      className="mb-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {trustOpsLoading.issue ? "Issuing..." : "Issue disclosure pack"}
                    </button>

                    <input
                      value={credentialVerifyInput}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCredentialVerifyInput(next);
                        setCredentialRevokeInput(next);
                      }}
                      placeholder="Credential id"
                      className="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs outline-none focus:border-emerald-500"
                    />
                    <div className="mb-2 flex gap-2">
                      <button
                        onClick={() => void handleVerifyCredential()}
                        disabled={trustOpsLoading.verify}
                        className="rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:border-zinc-500 disabled:opacity-60"
                      >
                        {trustOpsLoading.verify ? "Verifying..." : "Verify"}
                      </button>
                      <button
                        onClick={() => void handleRevokeCredential()}
                        disabled={trustOpsLoading.revoke}
                        className="rounded-lg border border-amber-700/50 bg-amber-900/10 px-3 py-2 text-xs hover:border-amber-600 disabled:opacity-60"
                      >
                        {trustOpsLoading.revoke ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                    <MetricRow
                      label="issued"
                      value={issuedCredential?.credential_id ? "yes" : "no"}
                      compact
                    />
                    <MetricRow
                      label="verified"
                      value={
                        credentialVerification?.valid == null
                          ? "n/a"
                          : credentialVerification.valid
                          ? "yes"
                          : "no"
                      }
                      compact
                    />
                    <MetricRow
                      label="revoked"
                      value={
                        credentialRevocation?.revoked == null
                          ? "n/a"
                          : credentialRevocation.revoked
                          ? "yes"
                          : "no"
                      }
                      compact
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                  <div className="mb-1 text-zinc-200">subject</div>
                  <div className="font-mono break-all text-zinc-400">{trustSubject || "n/a"}</div>
                  {issuedCredential?.credential_id ? (
                    <div className="mt-2">
                      <div className="text-zinc-200">last credential</div>
                      <div className="font-mono break-all text-zinc-400">
                        {issuedCredential.credential_id}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Panel>
            ) : null}
          </section>
        )}

        {activeLens === "reputation" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <Panel title="Behavioral Reputation" icon={<ShieldCheck className="h-4 w-4" />}>
              <MetricRow label="Tier" value={String(rep?.tier_name ?? "Unknown")} />
              <MetricRow label="Tier Index" value={String(rep?.tier ?? 0)} />
              <MetricRow label="Tenure" value={`${rep?.tenure_days ?? 0} days`} />
              <MetricRow label="Successful tx" value={String(rep?.successful_txns ?? 0)} />
              <MetricRow label="Transaction count" value={String(rep?.transaction_count ?? 0)} />
              <MetricRow label="Total volume" value={`${Number(rep?.total_volume_eth ?? 0).toFixed(4)} ETH`} />
            </Panel>

            <Panel title="Proof Lifecycle" icon={<CircleDot className="h-4 w-4" />}>
              {proofsLoading ? (
                <div className="text-sm text-zinc-400">Loading proofs...</div>
              ) : (
                <div className="space-y-2">
                  {proofs.map((proof, idx) => {
                    const status = String(proof.status ?? "unknown");
                    const ok = status === "complete";
                    return (
                      <div key={`${proof.proof_type ?? "proof"}-${idx}`} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-200">{String(proof.proof_type ?? "unknown")}</span>
                          <Badge ok={ok} text={status} />
                        </div>
                        {proof.generated_at ? (
                          <div className="mt-1 text-zinc-500">generated: {String(proof.generated_at)}</div>
                        ) : null}
                      </div>
                    );
                  })}
                  {proofs.length === 0 ? <div className="text-xs text-zinc-500">No proof records yet.</div> : null}
                </div>
              )}
            </Panel>

            {zkficoEnabled ? (
              <Panel title="zkFICO Finisher" icon={<Shield className="h-4 w-4" />} className="lg:col-span-2">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
                    <MetricRow
                      label="Trust score (0-100)"
                      value={String(
                        Number(zkficoAggregate?.scores?.trust_score_0_100 ?? 0).toFixed(2)
                      )}
                    />
                    <MetricRow
                      label="FICO display (300-850)"
                      value={String(Math.round(Number(zkficoAggregate?.scores?.fico_display_300_850 ?? 300)))}
                    />
                    <MetricRow
                      label="Proof readiness"
                      value={`${zkficoAggregate?.readiness?.complete ?? 0}/${zkficoAggregate?.readiness?.total ?? 0}`}
                    />
                    <MetricRow
                      label="Policy ready"
                      value={zkficoAggregate?.readiness?.ready_for_policy ? "yes" : "no"}
                    />
                    <MetricRow
                      label="Credit ready"
                      value={zkficoAggregate?.readiness?.ready_for_credit ? "yes" : "no"}
                    />
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
                    <div className="mb-2 text-zinc-200 font-medium">Proof envelope</div>
                    <MetricRow
                      label="Pack"
                      value={`${zkficoManifest?.pack_id ?? "zkfico_pack_v1"}@${zkficoManifest?.pack_version ?? "1.0"}`}
                      compact
                    />
                    <MetricRow
                      label="Policy mode"
                      value={zkficoManifest?.proof_policy?.mode ?? "hybrid"}
                      compact
                    />
                    <MetricRow
                      label="UX verifier"
                      value={zkficoManifest?.proof_policy?.ux_verifier ?? "groth16"}
                      compact
                    />
                    <MetricRow
                      label="Settlement envelope"
                      value={zkficoManifest?.proof_policy?.canonical_settlement_envelope ?? "stark_wrapped_async_v1"}
                      compact
                    />
                    <div className="mt-2 text-zinc-500">
                      circuits: {Array.isArray(zkficoManifest?.circuits) ? zkficoManifest?.circuits?.length : 0}
                    </div>
                  </div>
                </div>
              </Panel>
            ) : null}
          </section>
        )}

        {activeLens === "credit" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <Panel title="Credit Domain" icon={<TrendingUp className="h-4 w-4" />}>
              <MetricRow label="Lending Gate" value={lendingGate.mode.toUpperCase()} />
              <MetricRow label="Predictive Grade" value={String(profileV2?.predictive_credit?.grade ?? "N/A")} />
              <MetricRow label="Credit line" value={`${Number(profileV2?.predictive_credit?.credit_line_eth ?? 0).toFixed(4)} ETH`} />
              <MetricRow label="Rate" value={`${Number(profileV2?.predictive_credit?.rate_bps ?? 0)} bps`} />
              <MetricRow label="Collateral" value={`${Number(rep?.collateral_eth ?? 0).toFixed(4)} ETH`} />

              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-2 text-sm font-medium">Stake Additional Collateral</div>
                <div className="flex gap-2">
                  <input
                    value={stakeCollateralEth}
                    onChange={(e) => setStakeCollateralEth(e.target.value)}
                    placeholder="ETH amount"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() => void handleStakeCollateral()}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500"
                  >
                    Stake
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="Execution and Lending Reasons" icon={<AlertTriangle className="h-4 w-4" />}>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-1 text-sm font-medium">Execution gate reasons</div>
                <ul className="space-y-1 text-xs text-zinc-300">
                  {executionGate.reasons.length ? (
                    executionGate.reasons.map((reason) => <li key={reason}>- {reason}</li>)
                  ) : (
                    <li>- none</li>
                  )}
                </ul>
              </div>
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-1 text-sm font-medium">Lending gate reasons</div>
                <ul className="space-y-1 text-xs text-zinc-300">
                  {lendingGate.reasons.length ? (
                    lendingGate.reasons.map((reason) => <li key={reason}>- {reason}</li>)
                  ) : (
                    <li>- none</li>
                  )}
                </ul>
              </div>
            </Panel>
          </section>
        )}

        {activeLens === "governance" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <Panel title="Governance Domain" icon={<Vote className="h-4 w-4" />}>
              <MetricRow label="Voting power" value={toFixed(governancePower?.votingPower, 4)} />
              <MetricRow label="LP capital" value={formatUsdSafe(governancePower?.lpUsd)} />
              <MetricRow label="Lending capital" value={formatUsdSafe(governancePower?.lendingUsd)} />
              <MetricRow label="Staking capital" value={formatUsdSafe(governancePower?.stakingUsd)} />
              <MetricRow label="Tier multiplier" value={toFixed(governancePower?.tierMultiplier, 2)} />
              <MetricRow label="Formula" value={governancePower.formulaVersion} />
            </Panel>

            <Panel title="Trust Domain Separation" icon={<Shield className="h-4 w-4" />}>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
                <div className="mb-2 font-medium text-zinc-200">Reputation != Credit != Governance</div>
                <div className="grid gap-2">
                  <MetricRow label="Reputation tier" value={String(rep?.tier_name ?? "Unknown")} compact />
                  <MetricRow
                    label="Credit grade"
                    value={String(profileV2?.predictive_credit?.grade ?? "N/A")}
                    compact
                  />
                  <MetricRow label="Governance voting power" value={toFixed(governancePower?.votingPower, 3)} compact />
                </div>
              </div>
            </Panel>
          </section>
        )}

        <div className="mt-6 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            loading: {bundleLoading || v2Loading ? "yes" : "no"}
          </span>
          <span className="mx-2">|</span>
          <span>identity commitment: {identityBinding.identityCommitment ? "present" : "missing"}</span>
          <span className="mx-2">|</span>
          <span>
            trust matrix: {profileV2?.version_matrix?.builder_v2 ?? "2.x"}/
            {profileV2?.version_matrix?.profile_v2 ?? "2.x"}/
            {profileV2?.version_matrix?.portable_v3 ?? "3.x"}/
            {profileV2?.version_matrix?.zkfico_pack_v1 ?? "1.x"}
          </span>
          <span className="mx-2">|</span>
          <span>wiring: {trustSurfaceWiringEnabled ? "on" : "off"}</span>
          <span className="mx-2">|</span>
          <span>
            API base: <code>{apiUrl("/api/v1/zkdefi")}</code>
          </span>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function LensButton({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
        active
          ? "bg-emerald-600 text-white"
          : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Panel({
  title,
  icon,
  children,
  className = "",
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-100">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Badge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
        ok
          ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/30"
          : "bg-zinc-800 text-zinc-300 border border-zinc-700"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} {text}
    </span>
  );
}

function MetricRow({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${compact ? "text-xs" : "text-sm"}`}>
      <span className="text-zinc-400">{label}</span>
      <span className="text-zinc-100">{value}</span>
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

async function refreshProofs(
  address: string,
  setProofs: (proofs: Array<Record<string, unknown>>) => void,
  setLoading: (loading: boolean) => void
): Promise<void> {
  setLoading(true);
  try {
    const response = await apiFetch<{
      proofs?: Array<Record<string, unknown>>;
    }>(`/api/v1/zkdefi/reputation/proofs/${address}`);
    setProofs(Array.isArray(response.proofs) ? response.proofs : []);
  } catch {
    setProofs([]);
  } finally {
    setLoading(false);
  }
}
