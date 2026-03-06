"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount, useSignTypedData } from "@starknet-react/core";
import { useWalletSettled } from "@/lib/useWalletSettled";
import { useRiskProfile, useRiskProfileV2 } from "@/hooks/useProfile";
import { Shield, TrendingUp, Lock, Coins, ArrowUp, Send, Clock, CheckCircle, AlertTriangle, FileCheck, Star, Award, Link2, Info, ChevronRight, Fingerprint, Download, ExternalLink, Loader2 } from "lucide-react";
import { ConnectButton } from "@/components/zkdefi/ConnectButton";
import { ProofTimeline } from "@/components/zkdefi/ProofTimeline";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";
import { ProfileJourneyBanner } from "@/components/zkdefi/ProfileJourneyBanner";
import { ProfileProtocolStatus } from "@/components/zkdefi/ProfileProtocolStatus";
import { RiskProfileSummaryCard } from "@/components/zkdefi/RiskProfileSummaryCard";
import { derivePortableIdentityFromBundle } from "@/lib/identity/erc8004";
import { CompliancePanel } from "@/components/zkdefi/CompliancePanel";
import { AIInsightsCard } from "@/components/zkdefi/AIInsightsCard";
import { ExecutionAuthorityCard } from "@/components/zkdefi/vault/ExecutionAuthorityCard";
import {
  completeDualWalletSession,
  getDualWalletSession,
  revokeDualWalletSession,
  startDualWalletSession,
  type DualWalletSessionStatus,
} from "@/lib/api/authSession";
import {
  EVM_CHAIN_OPTIONS,
  discoverEvmWallets,
  firstEvmAccount,
  type DetectedEvmWallet,
  type EvmChain,
} from "@/lib/evm/injectedWallets";
import {
  buildWeb3AuthCredential,
  buildDualSessionTypedData,
  type DualAuthMethod,
} from "@/lib/evm/siwWeb3";
import * as reputationApi from "@/lib/api/reputation";
import * as relayerApi from "@/lib/api/relayer";
import { getOnChainReputation, type OnChainReputation } from "@/lib/api/onchainReputation";
import { API_BASE } from "@/lib/api/client";
import type { RelayRequest } from "@/lib/api/relayer";
import { CreditReputationHub } from "@/components/zkdefi/CreditReputationHub";

type ProfileTab = "trust" | "reputation" | "compliance" | "connections";

const DEMO_FALLBACK_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000000";
const VALID_TABS: ProfileTab[] = ["trust", "reputation", "compliance", "connections"];

function shortHex(value: string | undefined): string {
  if (!value) return "--";
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatFixed(value: unknown, digits: number, fallback = "0"): string {
  const parsed = toFiniteNumber(value);
  return parsed == null ? fallback : parsed.toFixed(digits);
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, isConnected, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData({});
  const { settled: walletSettled } = useWalletSettled();

  // Paper/demo mode: ?mode=demo bypasses wallet requirement
  const demoMode = searchParams?.get("mode") === "demo";
  const effectiveAddress = address || (demoMode ? DEMO_FALLBACK_ADDRESS : undefined);
  const effectiveConnected = isConnected || demoMode;

  const {
    profile,
    reputation: userRep,
    riskPassport: passport,
    onboarding: onboardingStatus,
    linkedAddresses: profileLinked,
    complianceSummary,
    loading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useRiskProfile(effectiveAddress);
  const {
    profile: profileV2,
    refetch: refetchProfileV2,
  } = useRiskProfileV2(effectiveAddress);
  const [linkedDraft, setLinkedDraft] = useState({ eth: "", arb: "", base: "", opt: "" });
  const [linkedVerification, setLinkedVerification] = useState<Record<string, { verified: boolean; verified_at?: string | null }>>({});
  const [verifyingChain, setVerifyingChain] = useState<string | null>(null);
  const [linkedSaving, setLinkedSaving] = useState(false);
  const [dualSessionLoading, setDualSessionLoading] = useState(false);
  const [dualSessionBusy, setDualSessionBusy] = useState(false);
  const [dualSession, setDualSession] = useState<DualWalletSessionStatus | null>(null);
  const [evmWallets, setEvmWallets] = useState<DetectedEvmWallet[]>([]);
  const [evmWalletsLoading, setEvmWalletsLoading] = useState(false);
  const [selectedDualWalletId, setSelectedDualWalletId] = useState<string>("");
  const [selectedDualChain, setSelectedDualChain] = useState<EvmChain>("ethereum");
  const [dualAuthMethod, setDualAuthMethod] = useState<DualAuthMethod>("injected");
  useEffect(() => {
    const p = profileLinked as (Record<string, string> & { verification?: Record<string, { verified?: boolean; verified_at?: string }> }) | undefined;
    if (p && typeof p === "object") {
      setLinkedDraft({ eth: p.eth ?? "", arb: p.arb ?? "", base: p.base ?? "", opt: p.opt ?? "" });
      const ver = p.verification;
      if (ver && typeof ver === "object") {
        setLinkedVerification({
          eth: { verified: Boolean(ver.eth?.verified), verified_at: ver.eth?.verified_at ?? null },
          arb: { verified: Boolean(ver.arb?.verified), verified_at: ver.arb?.verified_at ?? null },
          base: { verified: Boolean(ver.base?.verified), verified_at: ver.base?.verified_at ?? null },
          opt: { verified: Boolean(ver.opt?.verified), verified_at: ver.opt?.verified_at ?? null },
        });
      } else {
        setLinkedVerification({});
      }
    }
  }, [profileLinked]);
  const saveLinkedAddresses = useCallback(async () => {
    if (!effectiveAddress) return false;
    setLinkedSaving(true);
    try {
      const payload: {
        starknet_address: string;
        eth?: string;
        arb?: string;
        base?: string;
        opt?: string;
      } = { starknet_address: effectiveAddress };

      const skipped: string[] = [];
      (["eth", "arb", "base", "opt"] as const).forEach((chain) => {
        const value = linkedDraft[chain]?.trim() ?? "";
        if (!value) {
          // Explicit empty string clears existing linked value.
          payload[chain] = "";
          return;
        }
        if (linkedVerification?.[chain]?.verified) {
          payload[chain] = value;
          return;
        }
        // Avoid hard 403 by not submitting unverified edits.
        skipped.push(chain);
      });

      const res = await fetch(`${API_BASE}/api/v1/zkdefi/linked_addresses`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await refetchProfile();
        await refetchProfileV2();
        if (skipped.length > 0) {
          const labels = skipped.map((c) => (c === "eth" ? "Ethereum" : c === "arb" ? "Arbitrum" : c === "opt" ? "Optimism" : "Base"));
          toastInfo(`Skipped unverified edits for: ${labels.join(", ")}.`);
        }
        return true;
      }
      const errorPayload = await res.json().catch(() => ({}));
      const detail = typeof errorPayload?.detail === "string" ? errorPayload.detail : "Failed to save linked addresses";
      toastError(detail);
      return false;
    } finally {
      setLinkedSaving(false);
    }
  }, [effectiveAddress, linkedDraft, linkedVerification, refetchProfile, refetchProfileV2]);

  const verifyLinkedAddress = useCallback(async (chainKey: "eth" | "arb" | "base" | "opt") => {
    if (!effectiveAddress) return;
    const chainName = chainKey === "eth" ? "ethereum" : chainKey === "arb" ? "arbitrum" : chainKey === "base" ? "base" : "optimism";
    const candidate = linkedDraft[chainKey]?.trim();
    if (!candidate) {
      toastError("Enter an address first.");
      return;
    }

    const wallets = await discoverEvmWallets();
    const selectedWallet =
      wallets.find((wallet) => wallet.id === selectedDualWalletId) ?? wallets[0] ?? null;
    if (!selectedWallet) {
      toastError("EVM wallet not found. Install MetaMask, Rabby, or another injected wallet.");
      return;
    }

    setVerifyingChain(chainKey);
    try {
      const startRes = await fetch(`${API_BASE}/api/v1/zkdefi/linked_addresses/verify/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starknet_address: effectiveAddress,
          chain: chainName,
          address: candidate,
        }),
      });
      const startPayload = await startRes.json();
      if (!startRes.ok) {
        throw new Error(typeof startPayload?.detail === "string" ? startPayload.detail : "Failed to start verification.");
      }

      const accounts = await selectedWallet.provider.request({ method: "eth_requestAccounts" });
      const selectedAccount = (firstEvmAccount(accounts) ?? "").toLowerCase();
      if (selectedAccount && selectedAccount !== candidate.toLowerCase()) {
        setLinkedDraft((d) => ({ ...d, [chainKey]: selectedAccount }));
        setLinkedVerification((prev) => ({
          ...prev,
          [chainKey]: { verified: false, verified_at: null },
        }));
        throw new Error("Connected EVM account does not match entered address. Field updated to connected account; verify again.");
      }
      let signature: unknown;
      try {
        signature = await selectedWallet.provider.request({
          method: "personal_sign",
          params: [startPayload.challenge, candidate],
        });
      } catch {
        signature = await selectedWallet.provider.request({
          method: "personal_sign",
          params: [candidate, startPayload.challenge],
        });
      }
      if (typeof signature !== "string" || !signature) {
        throw new Error("Signature was not returned by wallet.");
      }

      const completeRes = await fetch(`${API_BASE}/api/v1/zkdefi/linked_addresses/verify/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starknet_address: effectiveAddress,
          chain: chainName,
          address: candidate,
          nonce_id: startPayload.nonce_id,
          signature,
        }),
      });
      const completePayload = await completeRes.json();
      if (!completeRes.ok) {
        throw new Error(typeof completePayload?.detail === "string" ? completePayload.detail : "Verification failed.");
      }

      const verification = completePayload?.verification?.[chainKey];
      setLinkedVerification((prev) => ({
        ...prev,
        [chainKey]: {
          verified: Boolean(verification?.verified ?? true),
          verified_at: verification?.verified_at ?? new Date().toISOString(),
        },
      }));
      toastSuccess(`${chainName} address verified.`);
      await refetchProfile();
      await refetchProfileV2();
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Linked-address verification failed.");
    } finally {
      setVerifyingChain(null);
    }
  }, [effectiveAddress, linkedDraft, selectedDualWalletId, refetchProfile, refetchProfileV2]);

  const refreshDualSession = useCallback(async () => {
    if (!effectiveAddress) {
      setDualSession(null);
      return;
    }
    setDualSessionLoading(true);
    try {
      const payload = await getDualWalletSession(effectiveAddress);
      setDualSession(payload);
    } catch {
      setDualSession(null);
    } finally {
      setDualSessionLoading(false);
    }
  }, [effectiveAddress]);

  useEffect(() => {
    refreshDualSession();
  }, [refreshDualSession]);

  const refreshEvmWallets = useCallback(async () => {
    if (!effectiveAddress) {
      setEvmWallets([]);
      setSelectedDualWalletId("");
      setEvmWalletsLoading(false);
      return;
    }
    setEvmWalletsLoading(true);
    try {
      const wallets = await discoverEvmWallets();
      setEvmWallets(wallets);
      setSelectedDualWalletId((prev) => {
        if (prev && wallets.some((wallet) => wallet.id === prev)) return prev;
        return wallets[0]?.id ?? "";
      });
    } finally {
      setEvmWalletsLoading(false);
    }
  }, [effectiveAddress]);

  useEffect(() => {
    if (!effectiveAddress) return;
    void refreshEvmWallets();
  }, [effectiveAddress, refreshEvmWallets]);

  const bindDualSession = useCallback(async () => {
    if (!effectiveAddress) return;
    const selectedWallet =
      evmWallets.find((wallet) => wallet.id === selectedDualWalletId) ?? evmWallets[0] ?? null;
    if (!selectedWallet) {
      toastError("No EVM wallet detected. Install MetaMask, Rabby, or another injected wallet.");
      return;
    }

    setDualSessionBusy(true);
    try {
      const accounts = await selectedWallet.provider.request({ method: "eth_requestAccounts" });
      const evmAddress = firstEvmAccount(accounts);
      if (!evmAddress) throw new Error("No EVM account selected.");

      const start = await startDualWalletSession(effectiveAddress, evmAddress, selectedDualChain);
      let credentials: Record<string, unknown> | undefined;
      if (dualAuthMethod === "web3auth_siw") {
        const chainIdHex = chainId != null ? `0x${chainId.toString(16)}` : undefined;
        const typedData = buildDualSessionTypedData({
          nonceId: start.nonce_id,
          evmAddress,
          evmChain: selectedDualChain,
          starknetChainIdHex: chainIdHex,
        });
        const starknetSignature = await signTypedDataAsync(typedData);
        credentials = await buildWeb3AuthCredential({
          provider: selectedWallet.provider,
          selectedChain: selectedDualChain,
          evmAddress,
          starknetAddress: effectiveAddress,
          nonceHint: start.nonce_id,
          starknetAuth: {
            chainIdHex: typedData.domain.chainId,
            typedData,
            signature: starknetSignature,
            signedAt: new Date().toISOString(),
          },
        });
      }
      let signature: unknown;
      try {
        signature = await selectedWallet.provider.request({
          method: "personal_sign",
          params: [start.challenge, evmAddress],
        });
      } catch {
        signature = await selectedWallet.provider.request({
          method: "personal_sign",
          params: [evmAddress, start.challenge],
        });
      }
      if (typeof signature !== "string" || !signature) {
        throw new Error("Wallet signature was not returned.");
      }

      const session = await completeDualWalletSession(
        effectiveAddress,
        evmAddress,
        start.nonce_id,
        signature,
        selectedDualChain,
        {
          authProvider: dualAuthMethod,
          credentials,
        },
      );
      setDualSession(session);
      toastSuccess(
        `Dual-wallet session linked (Starknet + ${selectedWallet.label} via ${
          dualAuthMethod === "web3auth_siw" ? "Web3Auth SIW" : "injected challenge"
        }).`,
      );
      await refetchProfile();
      await refetchProfileV2();
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to bind dual-wallet session.");
    } finally {
      setDualSessionBusy(false);
    }
  }, [effectiveAddress, evmWallets, selectedDualWalletId, selectedDualChain, dualAuthMethod, chainId, signTypedDataAsync, refetchProfile, refetchProfileV2]);

  const revokeDualSession = useCallback(async () => {
    if (!effectiveAddress) return;
    setDualSessionBusy(true);
    try {
      const payload = await revokeDualWalletSession(effectiveAddress);
      setDualSession(payload);
      toastSuccess("Dual-wallet session revoked.");
    } catch (error) {
      toastError(error instanceof Error ? error.message : "Failed to revoke dual-wallet session.");
    } finally {
      setDualSessionBusy(false);
    }
  }, [effectiveAddress]);

  const linkedAddresses = profileLinked as Record<string, string>;
  const linkedLoading = profileLoading;
  const userRepError = profileError;
  const passportLoading = profileLoading;
  const passportError = profileError;
  const complianceProfiles = complianceSummary?.profiles ?? [];
  const creditTier = passport ? (passport.credit_tier || passport.credit_score != null ? { found: true, tier: passport.credit_tier ?? undefined, score: passport.credit_score ?? undefined } : null) : null;

  // Portable Identity: derive from Risk Profile bundle (no separate fetch per vision step 4)
  const portableIdentity = profile ? derivePortableIdentityFromBundle(profile) : null;
  const identityLoading = profileLoading;
  const [tiers, setTiers] = useState<any[]>([]);
  const [stakeAmount, setStakeAmount] = useState("0.1");
  const [isLoading, setIsLoading] = useState(false);
  const [onChainRep, setOnChainRep] = useState<OnChainReputation | null>(null);
  const [onChainRepLoading, setOnChainRepLoading] = useState(false);
  const tabFromUrl = (searchParams?.get("tab") as ProfileTab | null) ?? null;
  const [activeTabState, setActiveTabState] = useState<ProfileTab>("trust");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Use URL tab only after mount to avoid React hydration #418 (server/client searchParams mismatch).
  const activeTab: ProfileTab = !mounted
    ? "trust"
    : (tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : activeTabState);
  const setActiveTab = (t: ProfileTab) => {
    setActiveTabState(t);
    router.replace(`/profile?tab=${t}`, { scroll: false });
  };
  const [relayAmount, setRelayAmount] = useState("0.01");
  const [relayDestination, setRelayDestination] = useState("");
  const [pendingRelays, setPendingRelays] = useState<RelayRequest[]>([]);
  const [loadingBailout, setLoadingBailout] = useState(false);

  useEffect(() => {
    const tab = searchParams?.get("tab");
    // Backwards compat: map old tab names
    const TAB_COMPAT: Record<string, ProfileTab> = { overview: "trust", collateral: "reputation", relayer: "connections", agents: "trust", compliance: "compliance" };
    const resolved = TAB_COMPAT[tab ?? ""] ?? tab;
    if (resolved && VALID_TABS.includes(resolved as ProfileTab)) {
      setActiveTabState(resolved as ProfileTab);
    }
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => setLoadingBailout(true), 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    reputationApi.getTiers().then(setTiers).catch(() => {});
  }, []);

  // Fetch on-chain reputation when address available
  useEffect(() => {
    if (!effectiveAddress) return;
    setOnChainRepLoading(true);
    getOnChainReputation(effectiveAddress)
      .then(setOnChainRep)
      .catch(() => setOnChainRep(null))
      .finally(() => setOnChainRepLoading(false));
  }, [effectiveAddress]);

  useEffect(() => {
    if (!effectiveAddress) return;
    relayerApi.getPending(effectiveAddress).then(setPendingRelays).catch(() => {});
  }, [effectiveAddress]);

  const handleStakeCollateral = async () => {
    if (!effectiveAddress) return;
    setIsLoading(true);
    try {
      const amountWei = Math.floor(parseFloat(stakeAmount) * 1e18);
      await reputationApi.stakeCollateral(effectiveAddress, amountWei);
      toastSuccess("Collateral staked");
      refetchProfile();
    } catch {
      toastError("Failed to stake collateral");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestUpgrade = async () => {
    if (!effectiveAddress) return;
    const currentTier = userRep?.tier ?? 0;
    const targetTier = Math.min(currentTier + 1, 2);
    if (targetTier <= currentTier) {
      toastError("Already at max tier");
      return;
    }
    setIsLoading(true);
    try {
      const data = await reputationApi.upgradeTier(effectiveAddress, targetTier);
      if (data.success) {
        toastSuccess(`Upgraded to ${data.new_tier_name}`);
        refetchProfile();
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
    if (!effectiveAddress || !relayDestination) return;
    setIsLoading(true);
    try {
      const data = await relayerApi.requestRelay(
        effectiveAddress,
        (parseFloat(relayAmount) * 1e18).toString(),
        relayDestination,
      );
      if (data.request_id) {
        toastSuccess("Relay requested");
        setPendingRelays([...pendingRelays, data as unknown as RelayRequest]);
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
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-lg">zkde.fi</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              <Link href="/agent" prefetch={false} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded-lg transition-all">Dashboard</Link>
              <Link href="/profile" className="px-3 py-1.5 text-sm font-medium text-white bg-zinc-800 rounded-lg">Profile</Link>
            </nav>
          </div>
          <ConnectButton />
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {!mounted || ((!walletSettled && !effectiveConnected) && !loadingBailout) ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-400">{mounted ? "Restoring session…" : "Loading…"}</p>
          </div>
        ) : !effectiveConnected ? (
          <div className="text-center py-20">
            <Shield className="w-16 h-16 mx-auto mb-4 text-zinc-600" />
            <h2 className="text-2xl font-bold mb-2">Connect Wallet</h2>
            <p className="text-zinc-400 mb-6">Connect your wallet to view your reputation profile</p>
            <ConnectButton />
            <Link href="/profile?mode=demo" className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-300 underline underline-offset-2">
              Try paper mode (no wallet)
            </Link>
          </div>
        ) : (
          <>
            {/* Risk Profile summary — single composable artifact */}
            <RiskProfileSummaryCard profile={profile} loading={profileLoading} address={effectiveAddress} />
            {/* Paper mode banner */}
            {demoMode && !isConnected && (
              <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-2.5 flex items-center gap-2 mt-4">
                <Info className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300">Paper mode — viewing with demo data. Connect a wallet for your real profile.</p>
              </div>
            )}
            {/* Tabs — trust/compliance-first per WP-5 Identity Reframe */}
            <div className="flex gap-2 mb-6 mt-6 border-b border-zinc-800 pb-4 flex-wrap">
              <button onClick={() => setActiveTab("trust")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "trust" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <Fingerprint className="w-4 h-4" /> Trust & Identity
              </button>
              <button onClick={() => setActiveTab("reputation")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "reputation" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <TrendingUp className="w-4 h-4" /> Reputation
              </button>
              <button onClick={() => setActiveTab("compliance")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "compliance" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <FileCheck className="w-4 h-4" /> Compliance
              </button>
              <button onClick={() => setActiveTab("connections")} className={`px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === "connections" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}>
                <Link2 className="w-4 h-4" /> Connections
              </button>
            </div>

            {/* ============================================================ */}
            {/* TRUST & IDENTITY TAB                                         */}
            {/* ============================================================ */}
            {activeTab === "trust" && (
              <div className="space-y-6">
                {/* AI Predictive Credit Insights (zkML v6) */}
                <AIInsightsCard profileV2={profileV2} loading={profileLoading} />

                {/* ERC-8004 Portable Identity Card */}
                <div className="bg-gradient-to-br from-emerald-950/40 to-zinc-900/60 border border-emerald-700/30 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Fingerprint className="w-5 h-5 text-emerald-400" /> Portable Identity (ERC-8004)
                    </h2>
                    <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">Composable</span>
                  </div>
                  {identityLoading ? (
                    <div className="space-y-3">
                      <div className="h-6 w-48 bg-zinc-700/50 rounded animate-pulse" />
                      <div className="h-4 w-full bg-zinc-700/50 rounded animate-pulse" />
                      <div className="h-4 w-[80%] bg-zinc-700/50 rounded animate-pulse" />
                    </div>
                  ) : portableIdentity ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                          <p className="text-xs text-zinc-500">Agent</p>
                          <p className="text-sm font-mono text-zinc-200 truncate">{portableIdentity.identity_card?.name ?? "Unnamed agent"}</p>
                        </div>
                        <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                          <p className="text-xs text-zinc-500">Reputation Score</p>
                          <p className="text-xl font-bold text-emerald-400">{portableIdentity.reputation?.overall_score ?? 0}</p>
                        </div>
                        <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                          <p className="text-xs text-zinc-500">Privacy Tier</p>
                          <p className="text-sm font-medium text-zinc-200">{portableIdentity.reputation?.privacy_tier ?? "Unknown"}</p>
                        </div>
                        <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3">
                          <p className="text-xs text-zinc-500">Active Sessions</p>
                          <p className="text-xl font-bold text-cyan-400">{portableIdentity.session_summary?.active_count ?? 0}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(portableIdentity.identity_card?.capabilities ?? []).map((cap) => (
                          <span key={cap} className="px-2 py-0.5 text-[10px] font-medium rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                            {cap}
                          </span>
                        ))}
                      </div>
                      {(portableIdentity.reputation?.attestations?.length ?? 0) > 0 && (
                        <div className="text-xs text-zinc-500">
                          {portableIdentity.reputation?.verified_receipt_count ?? 0} verified proofs · {portableIdentity.reputation?.attestations?.length ?? 0} attestations
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-400">
                      <p>Your portable identity will be generated after you run proofs and build reputation.</p>
                      <Link href="/agent?v=brain" prefetch={false} className="mt-2 inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 text-sm">
                        Open Brain <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                  )}
                </div>

                {/* Journey and next step */}
                <ProfileJourneyBanner
                  hasOnboarded={!!onboardingStatus?.has_agent}
                  hasPassport={!!passport}
                  canUseRelayer={!!(userRep && userRep.tier >= 1)}
                />
                {/* Protocol status: tier, collateral, relayer, upgrade */}
                <ProfileProtocolStatus
                  tierName={userRep?.tier_name ?? "Strict"}
                  collateralEth={userRep?.collateral_eth ?? 0}
                  canUseRelayer={!!(userRep && userRep.tier >= 1)}
                  canUpgrade={!!canUpgrade}
                  upgradeMessage={userRep?.tier === 0 ? `${5 - (userRep?.successful_txns ?? 0)} more txns for Standard` : userRep?.tier === 1 ? `${20 - (userRep?.successful_txns ?? 0)} more txns for Express` : "At max tier"}
                />
                {/* Execution Authority Card -- who can move funds */}
                <ExecutionAuthorityCard address={effectiveAddress} />
                {profileV2?.decisions && (
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Shield className="w-5 h-5 text-cyan-400" /> Decision Trace (v2)
                      </h2>
                      <span className="text-xs text-zinc-500">Canonical trust control plane</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-zinc-200">Identity Linkage</p>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded border ${
                              profileV2?.identity?.dual_wallet_session?.active
                                ? "text-emerald-300 bg-emerald-500/10 border-emerald-600/40"
                                : "text-zinc-400 bg-zinc-800 border-zinc-700"
                            }`}
                          >
                            {profileV2?.identity?.dual_wallet_session?.active ? "linked" : "not linked"}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400">
                          {profileV2?.identity?.dual_wallet_session?.active
                            ? `${shortHex(profileV2.identity.dual_wallet_session?.evm_address ?? undefined)} • ${profileV2.identity.dual_wallet_session?.chain || "ethereum"}`
                            : "Starknet wallet only. Optional EVM wallet bind adds cross-chain trust context."}
                        </p>
                      </div>
                      {(["relayer", "execution", "lending"] as const).map((gate) => {
                        const row = profileV2.decisions[gate];
                        const mode = row?.mode ?? "unknown";
                        const pillClass =
                          mode === "allow"
                            ? "text-emerald-300 bg-emerald-500/10 border-emerald-600/40"
                            : mode === "advisory"
                              ? "text-amber-300 bg-amber-500/10 border-amber-600/40"
                              : mode === "block"
                                ? "text-rose-300 bg-rose-500/10 border-rose-600/40"
                                : "text-zinc-400 bg-zinc-800 border-zinc-700";
                        return (
                          <div key={gate} className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-sm font-medium text-zinc-200 capitalize">{gate}</p>
                              <span className={`text-[11px] px-2 py-0.5 rounded border ${pillClass}`}>{mode}</span>
                            </div>
                            <p className="text-xs text-zinc-500 break-words">
                              {(row?.reason_codes?.length ?? 0) > 0
                                ? row.reason_codes.join(", ")
                                : "No blocking reasons."}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-zinc-500 mt-3">
                      {profileV2?.disclosures?.disclaimer ?? "Eligibility signal only; not legal, tax, or financial advice."}
                    </p>
                  </div>
                )}
                {/* No activity yet — explain zeros */}
                {userRep && (userRep.tenure_days || 0) === 0 && (userRep.successful_txns || 0) === 0 && (userRep.collateral_eth || 0) === 0 && (
                  <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-200">
                    <p className="font-medium text-cyan-100 mb-1">No activity recorded yet</p>
                    <p className="text-zinc-400">These numbers update when you use the app: stake collateral (Reputation tab), run proofs and rebalances on the Agent, and complete onboarding for credit tier. You&apos;re not missing anything — start on the Dashboard or Reputation tab to build your profile.</p>
                  </div>
                )}

                {userRepError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                    Reputation unavailable. Tier and stats may be missing until the service is back.
                  </div>
                )}

                {/* Risk Passport Card */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Shield className="w-5 h-5 text-emerald-400" /> Risk Passport
                    </h2>
                    <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">Proof-backed</span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-4">
                    Your risk passport is a cryptographic attestation — protocols can verify your creditworthiness and history without seeing your positions, balances, or linked addresses.
                  </p>
                  {passportLoading && effectiveAddress ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-6">
                        <div className="h-10 w-10 rounded-lg bg-zinc-700/50 animate-pulse" />
                        <div className="h-8 w-24 bg-zinc-700/50 rounded animate-pulse" />
                        <div className="h-4 w-32 bg-zinc-700/50 rounded animate-pulse" />
                      </div>
                      <div className="border-t border-zinc-800 pt-4 space-y-2">
                        <div className="h-4 w-full bg-zinc-700/50 rounded animate-pulse" />
                        <div className="h-4 w-[85%] bg-zinc-700/50 rounded animate-pulse" />
                        <div className="h-4 w-[70%] bg-zinc-700/50 rounded animate-pulse" />
                      </div>
                    </div>
                  ) : passport ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-6">
                        <div className={`text-4xl font-bold ${
                          passport.letter_rating === "A" ? "text-emerald-400" :
                          passport.letter_rating === "B" ? "text-cyan-400" :
                          passport.letter_rating === "C" ? "text-amber-400" : "text-red-400"
                        }`}>
                          {passport.letter_rating}
                        </div>
                        <div>
                          <div className="text-3xl font-bold text-white">{passport.composite_score}</div>
                          <div className="text-sm text-zinc-400">Composite score (0–100)</div>
                        </div>
                        <div className="text-sm text-zinc-400">
                          Tier: {passport.tier_name}
                          {passport.credit_tier != null && ` · Credit: ${passport.credit_tier}`}
                        </div>
                      </div>
                      {passport.proof_receipts?.[0] && (
                        <p className="text-xs text-zinc-500">
                          Last proof: {passport.proof_receipts[0].timestamp ? new Date(String(passport.proof_receipts[0].timestamp)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}
                          {passport.proof_receipts[0].snapshot_hash ? ` · snap ${String(passport.proof_receipts[0].snapshot_hash).slice(0, 10)}…${String(passport.proof_receipts[0].snapshot_hash).slice(-6)}` : ""}
                        </p>
                      )}
                      {(passport.proof_receipts?.length ?? 0) > 0 && (
                        <div className="border-t border-zinc-800 pt-4">
                          <ProofTimeline
                            receipts={(passport.proof_receipts ?? []).slice(0, 10) as any}
                            compact={false}
                            title="Proof receipts"
                            chainId={passport.chain_id ?? undefined}
                            factRegistryBaseUrl={typeof process !== "undefined" ? process.env.NEXT_PUBLIC_FACT_REGISTRY_BASE_URL : undefined}
                          />
                        </div>
                      )}
                      {passport.aggregation_sources && passport.aggregation_sources.length > 0 && (
                        <div className="border-t border-zinc-800 pt-4">
                          <p className="text-xs font-medium text-zinc-400 mb-2">Data sources</p>
                          <ul className="space-y-1 text-xs text-zinc-500">
                            {passport.aggregation_sources.map((src: { id?: string; description?: string; chain?: string }) => (
                              <li key={src.id ?? src.description ?? ""}>
                                {src.description ?? src.id}
                                {src.chain && <span className="ml-1 text-zinc-600">({src.chain})</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="border-t border-zinc-800 pt-4 flex flex-wrap gap-3">
                        <button
                          onClick={async () => {
                            if (!effectiveAddress) return;
                            try {
                              const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_passport/user/${effectiveAddress}/attestation`, { method: "POST" });
                              if (!res.ok) throw new Error("Failed");
                              const att = await res.json();
                              const blob = new Blob([JSON.stringify(att, null, 2)], { type: "application/json" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `attestation-${effectiveAddress.slice(0, 10)}.json`;
                              a.click();
                              URL.revokeObjectURL(url);
                              toastSuccess("Attestation exported");
                            } catch { toastError("Failed to export attestation"); }
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 rounded-lg text-sm text-emerald-300 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> Export Attestation
                        </button>
                        <button
                          onClick={async () => {
                            if (!effectiveAddress) return;
                            try {
                              const res = await fetch(`${API_BASE}/api/v1/zkdefi/risk_passport/user/${effectiveAddress}/attestation?format=vc`, { method: "POST" });
                              if (!res.ok) throw new Error("Failed");
                              const vc = await res.json();
                              await navigator.clipboard.writeText(JSON.stringify(vc, null, 2));
                              toastSuccess("W3C Verifiable Credential copied");
                            } catch { toastError("Failed to copy credential"); }
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Copy as W3C VC
                        </button>
                      </div>
                    </div>
                  ) : passportError ? (
                    <div className="flex items-center justify-between text-amber-400">
                      <p>Reputation unavailable. The service may be temporarily unavailable; try again later.</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-zinc-400">
                      <p>No passport data yet. Run proofs on the Agent page to build your passport.</p>
                      <Link href="/agent" prefetch={false} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-all flex items-center gap-2 text-white text-sm">
                        <Shield className="w-4 h-4" /> Run proofs
                      </Link>
                    </div>
                  )}
                </div>

                {/* Credit Tier Card */}
                <div className="bg-gradient-to-br from-violet-900/30 to-violet-800/10 border border-violet-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Award className="w-5 h-5 text-violet-400" /> Credit Score
                    </h2>
                    <span className="text-xs text-violet-400 bg-violet-500/20 px-2 py-1 rounded">ZK-Proven</span>
                  </div>
                  {creditTier?.found ? (
                    <div className="flex items-center gap-6">
                      <div className={`text-5xl font-bold ${
                        creditTier.tier === "AAA" ? "text-emerald-400" :
                        creditTier.tier === "AA" ? "text-green-400" :
                        creditTier.tier === "A" ? "text-cyan-400" :
                        creditTier.tier === "B" ? "text-amber-400" : "text-red-400"
                      }`}>
                        {creditTier.tier}
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-white">{creditTier.score || "--"}</div>
                        <div className="text-sm text-zinc-400">Credit Score (300-850)</div>
                      </div>
                      <div className="flex-1 text-right">
                        <div className="text-sm text-zinc-400">Based on cross-chain history</div>
                        <div className="text-xs text-zinc-500">ETH, Starknet, Arbitrum, Base</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="text-zinc-400">
                        <p>Complete onboarding to generate your credit tier.</p>
                        <p className="text-sm text-zinc-500">Private proof of your cross-chain DeFi history.</p>
                      </div>
                      <Link href="/agent?tab=onboarding" prefetch={false} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium transition-all flex items-center gap-2">
                        <Star className="w-4 h-4" /> Get Credit Tier
                      </Link>
                    </div>
                  )}
                </div>

                {/* Identity & Constraints (from onboarding) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Fingerprint className="w-5 h-5 text-violet-400" /> Identity & Constraints
                    </h2>
                    {onboardingStatus?.has_agent ? (
                      <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded">Verified</span>
                    ) : (
                      <span className="text-xs text-amber-400 bg-amber-500/20 px-2 py-1 rounded">Not set up</span>
                    )}
                  </div>
                  {onboardingStatus?.has_agent ? (
                    <div className="space-y-3 text-sm">
                      <p className="text-zinc-400">Your identity and execution constraints were created during onboarding. These back your Risk Profile and gate proof-verified execution.</p>
                      {onboardingStatus.identity_commitment && (
                        <div className="flex justify-between items-center font-mono text-xs bg-zinc-800/50 rounded-lg p-3">
                          <span className="text-zinc-400">Identity commitment</span>
                          <span className="text-zinc-300 truncate max-w-[200px]">
                            {onboardingStatus.identity_commitment.length > 20
                              ? `${onboardingStatus.identity_commitment.slice(0, 10)}...${onboardingStatus.identity_commitment.slice(-8)}`
                              : onboardingStatus.identity_commitment}
                          </span>
                        </div>
                      )}
                      {onboardingStatus.fact_hash && (
                        <div className="flex justify-between items-center font-mono text-xs bg-zinc-800/50 rounded-lg p-3">
                          <span className="text-zinc-400">Fact hash</span>
                          <span className="text-zinc-300 truncate max-w-[200px]">
                            {onboardingStatus.fact_hash.length > 20
                              ? `${onboardingStatus.fact_hash.slice(0, 10)}...${onboardingStatus.fact_hash.slice(-8)}`
                              : onboardingStatus.fact_hash}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-zinc-400">
                        Set up your identity to build your Risk Profile. Onboarding creates a ZK-backed identity commitment and execution constraints that other protocols can verify.
                      </p>
                      <Link href="/agent?tab=onboarding" prefetch={false} className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-medium text-sm transition-colors">
                        <Star className="w-4 h-4" /> Build your Risk Profile
                      </Link>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* Reputation Tab — Credit & Reputation Hub */}
            {activeTab === "reputation" && effectiveAddress && (
              <CreditReputationHub address={effectiveAddress} />
            )}

            {/* Connections Tab (was Relayer + Linked Addresses) */}
            {activeTab === "connections" && (
              <div className="space-y-6">
                {/* How Cross-Chain Reputation Works explainer */}
                <div className="glass rounded-xl border border-zinc-800 p-5 space-y-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-cyan-400" />
                    How Cross-Chain Reputation Works
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3 text-center">
                      <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center mx-auto mb-2">
                        <span className="text-sm font-bold text-violet-400">1</span>
                      </div>
                      <p className="text-xs font-medium text-zinc-200 mb-1">Link Wallets</p>
                      <p className="text-[11px] text-zinc-500">Connect your Ethereum, Arbitrum, Base, or Optimism addresses below.</p>
                    </div>
                    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3 text-center">
                      <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center mx-auto mb-2">
                        <span className="text-sm font-bold text-violet-400">2</span>
                      </div>
                      <p className="text-xs font-medium text-zinc-200 mb-1">Verify Ownership</p>
                      <p className="text-[11px] text-zinc-500">Sign a challenge with each EVM wallet to prove you control the address.</p>
                    </div>
                    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3 text-center">
                      <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center mx-auto mb-2">
                        <span className="text-sm font-bold text-violet-400">3</span>
                      </div>
                      <p className="text-xs font-medium text-zinc-200 mb-1">Aggregate History</p>
                      <p className="text-[11px] text-zinc-500">Your cross-chain DeFi activity is privately aggregated into your risk passport score.</p>
                    </div>
                    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700 p-3 text-center">
                      <div className="w-8 h-8 rounded-full bg-emerald-600/20 flex items-center justify-center mx-auto mb-2">
                        <span className="text-sm font-bold text-emerald-400">4</span>
                      </div>
                      <p className="text-xs font-medium text-zinc-200 mb-1">Unlock Benefits</p>
                      <p className="text-[11px] text-zinc-500">Higher passport score → better credit tier → lower rates, higher LTV, and priority access.</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-700/20 bg-emerald-950/10 px-3 py-2 text-xs text-emerald-400/80 flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      Linked addresses are verified off-chain. Your cross-chain history is used as private input to zkML risk models — no raw transaction data is stored or shared.
                    </span>
                  </div>
                </div>

                {/* Dual-wallet session (Starknet + EVM wallet) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Fingerprint className="w-5 h-5 text-violet-400" /> Dual-Wallet Session
                    </h2>
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      Starknet + EVM
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 mb-4">
                    Bind your connected Starknet identity to any injected EVM wallet with a signed challenge.
                    This is an off-chain trust/session bind used by profile, reputation, and risk-context UX.
                  </p>
                  {dualSessionLoading ? (
                    <div className="space-y-2">
                      <div className="h-4 w-[40%] bg-zinc-700/50 rounded animate-pulse" />
                      <div className="h-4 w-[60%] bg-zinc-700/50 rounded animate-pulse" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
                        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3">
                          <p className="text-xs text-zinc-500 mb-1">Status</p>
                          <p className={dualSession?.active ? "text-emerald-300" : "text-zinc-300"}>
                            {dualSession?.active ? "Active" : "Not bound"}
                          </p>
                        </div>
                        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3">
                          <p className="text-xs text-zinc-500 mb-1">EVM Address</p>
                          <p className="font-mono text-zinc-200">{shortHex(dualSession?.evm_address)}</p>
                        </div>
                        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3">
                          <p className="text-xs text-zinc-500 mb-1">Chain</p>
                          <p className="text-zinc-200">{dualSession?.chain || "ethereum"}</p>
                        </div>
                        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3">
                          <p className="text-xs text-zinc-500 mb-1">Auth Provider</p>
                          <p className="text-zinc-200">{dualSession?.auth_provider || "injected"}</p>
                        </div>
                        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3">
                          <p className="text-xs text-zinc-500 mb-1">Identity Binding</p>
                          <p className={dualSession?.identity_binding?.bound ? "text-emerald-300" : "text-zinc-300"}>
                            {dualSession?.identity_binding?.bound ? "Bound" : "Pending"}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-500">
                        Starknet proof: {dualSession?.credential_summary?.starknet?.signature_type ?? "wallet_connected"}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <select
                          value={dualAuthMethod}
                          onChange={(event) => setDualAuthMethod(event.target.value as DualAuthMethod)}
                          disabled={dualSessionBusy}
                          className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 disabled:opacity-60"
                        >
                          <option value="injected">Injected challenge (default)</option>
                          <option value="web3auth_siw">Web3Auth SIW (CAIP-74 style)</option>
                        </select>
                        <select
                          value={selectedDualWalletId}
                          onChange={(event) => setSelectedDualWalletId(event.target.value)}
                          disabled={dualSessionBusy || evmWallets.length === 0}
                          className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 disabled:opacity-60"
                        >
                          {evmWallets.length === 0 ? (
                            <option value="">No injected EVM wallet detected</option>
                          ) : (
                            evmWallets.map((wallet) => (
                              <option key={wallet.id} value={wallet.id}>
                                {wallet.label}
                              </option>
                            ))
                          )}
                        </select>
                        <select
                          value={selectedDualChain}
                          onChange={(event) => setSelectedDualChain(event.target.value as EvmChain)}
                          disabled={dualSessionBusy}
                          className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 disabled:opacity-60"
                        >
                          {EVM_CHAIN_OPTIONS.map((chain) => (
                            <option key={chain.value} value={chain.value}>
                              {chain.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={bindDualSession}
                          disabled={dualSessionBusy || !effectiveAddress || evmWallets.length === 0}
                          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 rounded-lg text-sm font-medium text-white transition-colors"
                        >
                          {dualSessionBusy ? "Binding..." : dualSession?.active ? "Re-bind EVM Wallet" : "Bind EVM Session"}
                        </button>
                        <button
                          type="button"
                          onClick={revokeDualSession}
                          disabled={dualSessionBusy || !dualSession?.active || !effectiveAddress}
                          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-sm font-medium text-zinc-200 transition-colors border border-zinc-700"
                        >
                          Revoke Session
                        </button>
                        <button
                          type="button"
                          onClick={() => void refreshEvmWallets()}
                          disabled={dualSessionBusy || evmWalletsLoading}
                          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-sm font-medium text-zinc-200 transition-colors border border-zinc-700"
                        >
                          {evmWalletsLoading ? "Refreshing wallets..." : "Refresh wallet list"}
                        </button>
                        <span className="text-xs text-zinc-500">
                          Off-chain binding only. Vault and agent execution still require explicit session-key authorization.
                        </span>
                        {dualAuthMethod === "web3auth_siw" && (
                          <span className="text-xs text-zinc-500">
                            SIW mode asks for one EVM SIW signature plus one Starknet typed-data signature.
                          </span>
                        )}
                        <Link
                          href="/agent?v=brain"
                          prefetch={false}
                          className="text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          Open agent controls to grant session key
                        </Link>
                      </div>
                      {Array.isArray(dualSession?.history) && dualSession.history.length > 0 && (
                        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-3">
                          <p className="text-xs text-zinc-400 mb-2">Identity Bind History</p>
                          <div className="space-y-2">
                            {dualSession.history.slice(-5).reverse().map((event, idx) => (
                              <div key={`${event.at || "event"}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 text-[11px] border-b border-zinc-800 pb-2 last:border-b-0 last:pb-0">
                                <div className="text-zinc-300">
                                  <span className="font-medium capitalize">{event.action || "event"}</span>
                                  <span className="text-zinc-500"> · {event.auth_provider || dualSession?.auth_provider || "injected"}</span>
                                  {event.chain && <span className="text-zinc-500"> · {event.chain}</span>}
                                  {event.evm_address && (
                                    <span className="text-zinc-500"> · {shortHex(event.evm_address)}</span>
                                  )}
                                </div>
                                <div className="text-zinc-500">
                                  {event.at ? new Date(event.at).toLocaleString() : "unknown time"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Linked Addresses (cross-chain reputation) */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Link2 className="w-5 h-5 text-cyan-400" /> Linked Addresses
                    </h2>
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500" title="Linking improves your reputation and credit score by aggregating activity across chains.">
                      Optional · improves credit baseline <Info className="w-3 h-3 opacity-70" />
                    </span>
                  </div>
                  {linkedLoading && effectiveAddress ? (
                    <div className="space-y-4">
                      <div className="h-4 w-[75%] bg-zinc-700/50 rounded animate-pulse" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="h-10 bg-zinc-700/50 rounded-lg animate-pulse" />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-zinc-400 mb-4">
                        Link Ethereum, Arbitrum, Base, or Optimism addresses to aggregate cross-chain history for reputation and credit.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        {(["eth", "arb", "base", "opt"] as const).map((chain) => (
                          <div key={chain}>
                            <label className="block text-xs text-zinc-500 mb-1 flex items-center justify-between">
                              <span>{chain === "eth" ? "Ethereum" : chain === "arb" ? "Arbitrum" : chain === "base" ? "Base" : "Optimism"}</span>
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[10px] ${
                                  linkedVerification?.[chain]?.verified
                                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-600/40"
                                    : "text-zinc-400 bg-zinc-800 border-zinc-700"
                                }`}
                              >
                                {linkedVerification?.[chain]?.verified ? "Verified" : "Unverified"}
                              </span>
                            </label>
                            <input
                              type="text"
                              placeholder={`0x... (${chain})`}
                              value={linkedDraft[chain]}
                              onChange={(e) => {
                                const next = e.target.value.trim();
                                setLinkedDraft((d) => {
                                  const prevValue = String(d[chain] ?? "").trim().toLowerCase();
                                  if (prevValue !== next.toLowerCase()) {
                                    setLinkedVerification((prev) => ({
                                      ...prev,
                                      [chain]: { verified: false, verified_at: null },
                                    }));
                                  }
                                  return { ...d, [chain]: next };
                                });
                              }}
                              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono text-white placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={verifyingChain === chain || !linkedDraft[chain]}
                              onClick={() => verifyLinkedAddress(chain)}
                              className="mt-1 text-xs px-2 py-1 rounded border border-cyan-700/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
                            >
                              {verifyingChain === chain ? "Verifying..." : "Verify with wallet"}
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={linkedSaving}
                        onClick={async () => {
                          if (!effectiveAddress) return;
                          const ok = await saveLinkedAddresses();
                          if (ok) toastSuccess("Linked addresses saved");
                        }}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 rounded-lg text-sm font-medium text-white transition-colors"
                      >
                        {linkedSaving ? "Saving…" : "Save linked addresses"}
                      </button>
                    </>
                  )}
                </div>

                {/* Private Relayer */}
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
                          <span className="font-medium">{formatFixed(parseFloat(relayAmount || "0") * (userRep?.tier === 1 ? 0.01 : 0.005), 4)} ETH</span>
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
                                <div className="text-xs text-zinc-500">{formatFixed((parseInt(String(r.amount_wei ?? "0"), 10) || 0) / 1e18, 4)} ETH</div>
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

            {/* Compliance Tab — now includes selective disclosure (migrated from Brain WP-5) */}
            {activeTab === "compliance" && effectiveAddress && (
              <div className="space-y-6">
                {/* Selective Disclosure Panel (migrated from Brain > Disclosure) */}
                <CompliancePanel initialProfiles={complianceProfiles} />

                {/* Compliance Profiles Section */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FileCheck className="w-5 h-5 text-emerald-400" /> Compliance Profiles
                  </h2>
                  <p className="text-sm text-zinc-400 mb-4">
                    Generate selective disclosure proofs to attest compliance without revealing sensitive data.
                  </p>
                  
                  {complianceProfiles.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {complianceProfiles.map((profile: any, idx: number) => (
                        <div key={idx} className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium capitalize">{profile.profile_type}</span>
                            <span className={`px-2 py-1 text-xs rounded ${profile.verified ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                              {profile.verified ? "Verified" : "Pending"}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-500">
                            Generated: {new Date(profile.created_at * 1000).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <FileCheck className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
                      <p className="text-zinc-400 mb-4">No compliance profiles generated yet.</p>
                      <Link href="/agent?v=brain&sub=pipeline" prefetch={false} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium transition-all inline-flex items-center gap-2">
                        <Shield className="w-4 h-4" /> Generate Compliance Proof
                      </Link>
                    </div>
                  )}
                </div>

                {/* Profile Types */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h3 className="font-semibold mb-4">Available Profile Types</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="w-4 h-4 text-blue-400" />
                        <span className="font-medium">KYC Eligibility</span>
                      </div>
                      <p className="text-xs text-zinc-400">Prove identity eligibility without revealing personal data.</p>
                    </div>
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span className="font-medium">Risk Compliance</span>
                      </div>
                      <p className="text-xs text-zinc-400">Attest risk score is below threshold.</p>
                    </div>
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        <span className="font-medium">Performance Proof</span>
                      </div>
                      <p className="text-xs text-zinc-400">Prove historical returns without revealing positions.</p>
                    </div>
                    <div className="p-4 bg-zinc-800/30 rounded-lg border border-zinc-700/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Coins className="w-4 h-4 text-violet-400" />
                        <span className="font-medium">Portfolio Aggregation</span>
                      </div>
                      <p className="text-xs text-zinc-400">Aggregate cross-chain positions with privacy.</p>
                    </div>
                  </div>
                </div>

                {/* Pool Safety — checked on Agent when you run rebalances */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-cyan-400" /> Pool Safety
                  </h3>
                  <p className="text-sm text-zinc-400 mb-4">
                    Pool safety is checked when you run rebalances on the Agent. zkML anomaly detection analyzes pools before execution.
                  </p>
                  <Link href="/agent" prefetch={false} className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
                    Open Agent <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// Wrap in Suspense for useSearchParams
export default function ProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    }>
      <ProfilePageContent />
    </Suspense>
  );
}
