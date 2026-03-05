"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useProvider } from "@starknet-react/core";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import {
  buildLpAddTx,
  buildLpRemoveTx,
  confirmPositionStatus,
  getDexTokens,
  getEkuboPositions,
  importOnchainPositions,
  previewLp,
  purgeStalePositions,
  syncOnchainBalance,
  verifyLpTx,
} from "@/lib/api/ekubo";
import { advisoryActionCheck, runActionGate } from "@/lib/api/gating";
import { formatAdvisoryElevatedRisk, formatAdvisoryPass, formatGateDenied } from "@/lib/gateCopy";
import { EkuboCapabilities, EkuboPosition, LpBuildResponse, LpPreviewResponse, RiskProfile, TokenInfo } from "@/types/ekubo";
import { toastError, toastSuccess } from "@/lib/toast";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { EkuboSwapPanel } from "./EkuboSwapPanel";
import type { OperateHubEvent } from "./EkuboSwapPanel";
import { resolveExecutionPolicy } from "@/lib/executionPolicy";
import { executeCalls } from "@/lib/tx/executeCalls";
import { annotateAddressesInMessage, buildTxDebugInfo } from "@/lib/txDebug";
import { AlertTriangle, ArrowLeftRight, X } from "lucide-react";
import {
  ensureHex,
  toU256,
  normalizeAddressKey,
  parseU256FromCallResult,
  formatBalance,
  formatBalanceFull,
  parseHumanToRaw,
  sanitizeDecimalInput,
  shortAddress,
} from "@/lib/starknet-utils";
import { resolveTokenDecimals as sharedResolveDecimals, feeTierLabel } from "@/lib/tokens";

interface EkuboLpPanelProps {
  token0: string;
  token1: string;
  onTokenChange: (token0: string, token1: string) => void;
  capabilities: EkuboCapabilities | null;
  gateConfig: {
    gateMode: "balanced" | "stress";
    sessionId?: string;
    passportScore?: number | null;
    manualWalletOverrideEnabled?: boolean;
    manualOverrideMinPassportScore?: number;
  };
  onEvent: (event: OperateHubEvent) => void;
  /** When true, renders a compact guided-first experience (hides token selectors, positions, shows step-based UI) */
  inline?: boolean;
  /** Human-readable pair label, e.g. "USDC/USDT" */
  pairLabel?: string;
  /** Symbol for token0, e.g. "USDC" */
  token0Symbol?: string;
  /** Symbol for token1, e.g. "USDT" */
  token1Symbol?: string;
}

type LpMode = "guided" | "advanced";
type LpSeedPrefillPayload = {
  source?: string;
  pair?: string;
  token0?: string;
  token1?: string;
  amount0?: string;
  amount1?: string;
  feeTier?: number;
  riskProfile?: RiskProfile;
  timestamp?: string;
  note?: string;
};

function getTokenDecimals(addr: string, tokens: TokenInfo[]): number {
  // Try shared canonical map first (handles all known tokens + leading-zero variants)
  const fromShared = sharedResolveDecimals(addr);
  // If the shared map returned a non-default value, trust it
  const key = normalizeAddressKey(addr);
  const match = tokens.find((t) => normalizeAddressKey(t.address) === key);
  const raw = (match as TokenInfo & { decimals?: number | string })?.decimals;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === "string") { const n = Number(raw); if (Number.isFinite(n) && n >= 0) return Math.floor(n); }
  // If symbol contains USD/USDC/USDT/DAI assume 6 decimals
  const sym = (match?.symbol ?? "").toUpperCase();
  if (sym.includes("USD") || sym.includes("DAI")) return 6;
  return fromShared;
}

export function EkuboLpPanel({ token0, token1, onTokenChange, capabilities, gateConfig, onEvent, inline, pairLabel, token0Symbol, token1Symbol }: EkuboLpPanelProps) {
  const { account, address, isConnected } = useAccount();
  const { provider } = useProvider();
  const [mode, setMode] = useState<LpMode>("guided");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("neutral");
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const [feeTier, setFeeTier] = useState<number>(3000);
  const [lowerTick, setLowerTick] = useState<string>("");
  const [upperTick, setUpperTick] = useState<string>("");
  const [preview, setPreview] = useState<LpPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [txWarnings, setTxWarnings] = useState<string[]>([]);
  const [buildLoading, setBuildLoading] = useState(false);
  const [positions, setPositions] = useState<EkuboPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [removeBpsByPosition, setRemoveBpsByPosition] = useState<Record<string, number>>({});
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  /* ── Balance fetching ── */
  const [balance0, setBalance0] = useState<bigint | null>(null);
  const [balance1, setBalance1] = useState<bigint | null>(null);
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);

  const fetchBalance = useCallback(
    async (tokenAddr: string): Promise<bigint> => {
      if (!address || !tokenAddr) return BigInt(0);
      const contractAddress = ensureHex(tokenAddr);
      const owner = ensureHex(address);
      for (const entrypoint of ["balanceOf", "balance_of"]) {
        try {
          const raw = await provider.callContract({ contractAddress, entrypoint, calldata: [owner] });
          return parseU256FromCallResult(raw);
        } catch { /* try next selector */ }
      }
      return BigInt(0);
    },
    [address, provider],
  );

  useEffect(() => {
    let c = false;
    setBalancesLoaded(false);
    const load = async () => {
      try {
        const [b0, b1] = await Promise.all([fetchBalance(token0), fetchBalance(token1)]);
        if (!c) { setBalance0(b0); setBalance1(b1); setBalancesLoaded(true); }
      } catch {
        if (!c) { setBalance0(BigInt(0)); setBalance1(BigInt(0)); setBalancesLoaded(true); }
      }
    };
    void load();
    return () => { c = true; };
  }, [fetchBalance, token0, token1]);
  useVisibilityPolling(async () => {
    try {
      const [b0, b1] = await Promise.all([fetchBalance(token0), fetchBalance(token1)]);
      setBalance0(b0); setBalance1(b1); setBalancesLoaded(true);
    } catch { /* silent */ }
  }, 30_000, [fetchBalance, token0, token1]);

  const decimals0 = useMemo(() => getTokenDecimals(token0, tokens), [token0, tokens]);
  const decimals1 = useMemo(() => getTokenDecimals(token1, tokens), [token1, tokens]);

  useEffect(() => {
    const raw = window.localStorage.getItem("zkdefi_lp_seed_prefill");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as LpSeedPrefillPayload;
      let applied = false;
      if (payload.token0 && payload.token1) {
        onTokenChange(payload.token0, payload.token1);
        applied = true;
      }
      if (typeof payload.amount0 === "string") {
        setAmount0(sanitizeDecimalInput(payload.amount0));
        applied = true;
      }
      if (typeof payload.amount1 === "string") {
        setAmount1(sanitizeDecimalInput(payload.amount1));
        applied = true;
      }
      if (typeof payload.feeTier === "number" && [500, 3000, 10000].includes(payload.feeTier)) {
        setFeeTier(payload.feeTier);
        applied = true;
      }
      if (
        payload.riskProfile &&
        (payload.riskProfile === "conservative" || payload.riskProfile === "neutral" || payload.riskProfile === "aggressive")
      ) {
        setMode("guided");
        setRiskProfile(payload.riskProfile);
        applied = true;
      }
      if (applied) {
        toastSuccess("LP prefill loaded from DEX seeding assistant.");
      }
    } catch {
      // Ignore malformed cached prefill payloads.
    } finally {
      window.localStorage.removeItem("zkdefi_lp_seed_prefill");
    }
  }, [onTokenChange]);

  useEffect(() => {
    getDexTokens(500)
      .then((payload) => setTokens(payload.tokens ?? []))
      .catch(() => setTokens([]));
  }, []);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      return;
    }

    let cancelled = false;

    const loadPositions = async () => {
      setPositionsLoading(true);
      try {
        const payload = await getEkuboPositions(address);
        if (!cancelled) {
          setPositions(payload.positions ?? []);
        }
      } catch {
        if (!cancelled) setPositions([]);
      } finally {
        if (!cancelled) setPositionsLoading(false);
      }
    };

    void loadPositions();
    return () => {
      cancelled = true;
    };
  }, [address]);
  useVisibilityPolling(async () => {
    if (!address) return;
    try {
      const payload = await getEkuboPositions(address);
      setPositions(payload.positions ?? []);
    } catch { setPositions([]); }
  }, 30_000, [address]);

  const symbolMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const token of tokens) {
      if (!token.address) continue;
      out[token.address.toLowerCase()] = token.symbol ?? token.name ?? shortAddress(token.address);
    }
    return out;
  }, [tokens]);

  const sym0 = token0Symbol || symbolMap[token0.toLowerCase()] || "Token A";
  const sym1 = token1Symbol || symbolMap[token1.toLowerCase()] || "Token B";
  const warningRows = useMemo(() => {
    const rows: string[] = [];
    if (preview?.single_sided_expected) {
      rows.push(`Tick is outside range. Position is currently single-sided in ${preview.single_sided_side === "token0" ? sym0 : sym1}.`);
    }
    if (preview?.warnings?.length) {
      rows.push(...preview.warnings);
    }
    if (previewError) {
      rows.push(previewError);
    }
    if (txWarnings.length) {
      rows.push(...txWarnings);
    }
    return Array.from(new Set(rows.filter(Boolean)));
  }, [preview, previewError, sym0, sym1, txWarnings]);

  const fetchPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setTxWarnings([]);
    try {
      const next = await previewLp({
        token0,
        token1,
        amount0: parseHumanToRaw(amount0 || "0", decimals0),
        amount1: parseHumanToRaw(amount1 || "0", decimals1),
        fee_tier: feeTier,
        risk_profile: mode === "guided" ? riskProfile : undefined,
        lower_tick: mode === "advanced" && lowerTick !== "" ? Number(lowerTick) : undefined,
        upper_tick: mode === "advanced" && upperTick !== "" ? Number(upperTick) : undefined,
      });
      setPreview(next);
      if (mode === "guided") {
        setLowerTick(String(next.lower_tick));
        setUpperTick(String(next.upper_tick));
      }
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : "Preview unavailable");
    } finally {
      setPreviewLoading(false);
    }
  };

  const executeBuildResponse = async (
    build: LpBuildResponse,
    actionLabel: string,
  ): Promise<{ mode: "wallet" | "orchestrated"; txHash?: string; fallbackReason?: string }> => {
    if (build.execution_mode === "wallet") {
      if (!account) {
        toastError("Wallet mode selected but no wallet is connected.");
        throw new Error("Wallet mode selected but no wallet is connected.");
      }

      const walletCalls = [
        ...build.approvals.map((approval) => {
          const [low, high] = toU256(BigInt(approval.amount));
          return {
            contractAddress: ensureHex(approval.token),
            entrypoint: "approve",
            calldata: [ensureHex(approval.spender), low, high],
          };
        }),
        ...build.calls.map((call) => ({
          contractAddress: ensureHex(call.contract_address),
          entrypoint: call.entrypoint,
          calldata: call.calldata,
        })),
      ];

      const tx = await executeCalls({
        account,
        gasMode: "wallet",
        calls: walletCalls as Parameters<typeof account.execute>[0],
      });
      onEvent({
        type: "lp",
        text: `${actionLabel} confirmed`,
        details: `${build.position_id ? `Position: ${build.position_id}` : ""}${tx.executionPath === "paymaster" ? " • paymaster" : ""}${tx.fallbackUsed ? " • fallback wallet gas" : ""}`.trim(),
        txHash: tx.transaction_hash,
        status: "confirmed",
      });
      toastSuccess(`${actionLabel} submitted`, {
        action: {
          label: "View",
          onClick: () => window.open(sepoliaVoyagerTxUrl(tx.transaction_hash), "_blank"),
        },
      });
      return {
        mode: "wallet",
        txHash: tx.transaction_hash,
        fallbackReason: tx.fallbackReason,
      };
    } else {
      onEvent({
        type: "lp",
        text: `${actionLabel} queued`,
        details: build.receipt_id ? `Receipt ${build.receipt_id}` : "Receipt pending",
        status: "pending",
      });
      toastSuccess(build.receipt_id ? `${actionLabel} receipt ${build.receipt_id}` : `${actionLabel} queued`);
      return { mode: "orchestrated" };
    }
  };

  const reconcileAfterWalletTx = useCallback(async (
    txHash: string,
    action: "add" | "remove",
    positionId?: string,
  ) => {
    if (!address) return;

    let verified = false;
    let mintedNftId: number | null = null;
    try {
      const verification = await verifyLpTx(txHash, address, action === "add" ? positionId : undefined);
      verified = Boolean(verification?.verified);
      mintedNftId = verification?.ekubo_nft_id ?? null;
    } catch {
      verified = false;
    }

    if (positionId) {
      try {
        if (action === "add") {
          if (mintedNftId != null) {
            await confirmPositionStatus(positionId, "active", txHash, mintedNftId);
          } else if (verified) {
            await confirmPositionStatus(positionId, "active", txHash);
          } else {
            await confirmPositionStatus(positionId, "failed", txHash);
          }
        } else {
          await confirmPositionStatus(positionId, verified ? "closed" : "failed", txHash);
        }
      } catch {
        // status update best effort
      }
    }

    try {
      const sync = await syncOnchainBalance(address);
      if (sync?.synced === false) {
        await importOnchainPositions(address);
      }
    } catch {
      // sync/import best effort
    }

    try {
      const payload = await getEkuboPositions(address);
      setPositions(payload.positions ?? []);
    } catch {
      // refresh best effort
    }

    onEvent({
      type: "lp",
      text: action === "add" ? "LP add reconciled" : "LP remove reconciled",
      details: `${verified ? "on-chain verified" : "verification pending"}${mintedNftId != null ? ` • NFT ${mintedNftId}` : ""}`,
      txHash,
      status: verified ? "confirmed" : "pending",
    });
  }, [address, onEvent]);

  const handleAddLp = async () => {
    if (!token0 || !token1) {
      toastError("Select a token pair first.");
      return;
    }
    if (!amount0 || !amount1) {
      toastError("Enter both token amounts.");
      return;
    }

    const lower = lowerTick !== "" ? Number(lowerTick) : undefined;
    const upper = upperTick !== "" ? Number(upperTick) : undefined;

    setBuildLoading(true);
    setTxWarnings([]);
    try {
      const amountGate = Math.max(1, Number((amount0 || amount1 || "1").slice(0, 9) || "1"));
      const addFeatures =
        gateConfig.gateMode === "stress"
          ? [120, 92, 85, 88, 20, 12, 85, 78]
          : [48, 35, 24, 25, 62, 35, 12, 25];
      if (preview) {
        addFeatures[3] = Math.min(120, Math.max(addFeatures[3], Math.floor(preview.estimated_fees_apr / 2)));
      }
      if (typeof gateConfig.passportScore === "number") {
        addFeatures[2] = Math.max(0, 100 - Math.floor(gateConfig.passportScore));
      }
      const executionPolicy = resolveExecutionPolicy({
        intent: "manual_wallet",
        walletConnected: Boolean(isConnected && account),
      });
      if (executionPolicy.enforceGate) {
        const gate = await runActionGate({
          userAddress: address || "unknown",
          amount: amountGate,
          reason: `Ekubo LP add ${token0.slice(0, 8)}/${token1.slice(0, 8)} | mode=${gateConfig.gateMode}`,
          poolId: `ekubo_lp_${token0.slice(2, 8)}_${token1.slice(2, 8)}`,
          portfolioFeatures: addFeatures,
          fromProtocol: 0,
          toProtocol: 1,
          sessionId: gateConfig.sessionId,
        });
        if (!gate.ok) {
          const message = formatGateDenied(gate.reason);
          onEvent({
            type: "lp",
            text: "Gate denied",
            details: message,
            status: "failed",
          });
          toastError(message);
          return;
        }
        onEvent({
          type: "lp",
          text: "AI suggested",
          details: `Proposal ${gate.proposalId ?? "n/a"}${gate.snapshotHash ? ` • snapshot ${gate.snapshotHash.slice(0, 10)}...` : ""}`,
          status: "pending",
        });
      }

      const build = await buildLpAddTx({
        token0,
        token1,
        amount0: parseHumanToRaw(amount0 || "0", decimals0),
        amount1: parseHumanToRaw(amount1 || "0", decimals1),
        fee_tier: feeTier,
        risk_profile: mode === "guided" ? riskProfile : undefined,
        lower_tick: mode === "advanced" ? lower : undefined,
        upper_tick: mode === "advanced" ? upper : undefined,
        owner: address,
        execution_mode: "auto",
        wallet_connected: Boolean(isConnected && account),
      });

      if ((build.warnings?.length ?? 0) > 0) {
        setTxWarnings(build.warnings ?? []);
        onEvent({
          type: "lp",
          text: "LP add warning",
          details: build.warnings?.join(" • "),
          status: "pending",
        });
      }

      if (!build.calls?.length) {
        setTxWarnings((prev) => {
          const first = build.warnings?.[0] || "No LP add transaction calls generated.";
          return Array.from(new Set([...prev, first]));
        });
        toastError(build.warnings?.[0] || "No LP add transaction calls generated.");
        return;
      }

      onEvent({
        type: "lp",
        text: `LP add built ${shortAddress(token0)} / ${shortAddress(token1)}`,
        details: build.position_id ? `Position ${build.position_id}` : undefined,
        status: "pending",
      });

      const executionResult = await executeBuildResponse(build, "LP add");
      if (executionResult.mode === "wallet" && executionResult.txHash) {
        await reconcileAfterWalletTx(executionResult.txHash, "add", build.position_id);
      }

      if (executionPolicy.advisoryAfterSubmit && executionResult.mode === "wallet" && address) {
        void advisoryActionCheck({
          user_address: address,
          action_type: "lp_add",
          pool_id: `ekubo_lp_${token0.slice(2, 8)}_${token1.slice(2, 8)}`,
          portfolio_features: addFeatures,
          context: {
            token_in: token0,
            token_out: token1,
            amount: amount0,
            venue: "ekubo",
            from_protocol: 0,
            to_protocol: 1,
          },
        }).then((advisory) => {
          const advisoryDetails = advisory.can_proceed
            ? formatAdvisoryPass(advisory.reason)
            : formatAdvisoryElevatedRisk(advisory.reason);
          onEvent({
            type: "lp",
            text: advisory.can_proceed ? "AI suggested" : "AI suggested (elevated risk)",
            details: advisoryDetails,
            status: "pending",
          });
        }).catch(() => {});
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "LP add failed";
      const debug = buildTxDebugInfo(rawMessage);
      const message = annotateAddressesInMessage(rawMessage);
      const details =
        debug.decode.code === "u256_sub_overflow"
          ? `${debug.decode.summary}: ${debug.decode.suggestedAction}`
          : message;
      onEvent({ type: "lp", text: "LP add failed", details: message, status: "failed" });
      toastError(details);
    } finally {
      setBuildLoading(false);
    }
  };

  const handleRemoveLp = async (positionId: string) => {
    if (!address) {
      toastError("Connect wallet first.");
      return;
    }

    const liquidity = removeBpsByPosition[positionId] ?? 10_000;
    setBuildLoading(true);
    setTxWarnings([]);
    try {
      const removeFeatures =
        gateConfig.gateMode === "stress"
          ? [115, 90, 80, 80, 20, 10, 90, 70]
          : [45, 28, 20, 18, 65, 35, 10, 18];
      if (typeof gateConfig.passportScore === "number") {
        removeFeatures[2] = Math.max(0, 100 - Math.floor(gateConfig.passportScore));
      }
      const executionPolicy = resolveExecutionPolicy({
        intent: "manual_wallet",
        walletConnected: Boolean(isConnected && account),
      });
      if (executionPolicy.enforceGate) {
        const gate = await runActionGate({
          userAddress: address,
          amount: Math.max(1, liquidity),
          reason: `Ekubo LP remove ${positionId.slice(0, 10)} | mode=${gateConfig.gateMode}`,
          poolId: `ekubo_lp_remove_${positionId.slice(2, 8)}`,
          portfolioFeatures: removeFeatures,
          fromProtocol: 1,
          toProtocol: 0,
          sessionId: gateConfig.sessionId,
        });
        if (!gate.ok) {
          const message = formatGateDenied(gate.reason);
          onEvent({
            type: "lp",
            text: "Gate denied",
            details: message,
            status: "failed",
          });
          toastError(message);
          return;
        }
        onEvent({
          type: "lp",
          text: "AI suggested",
          details: `Proposal ${gate.proposalId ?? "n/a"}${gate.snapshotHash ? ` • snapshot ${gate.snapshotHash.slice(0, 10)}...` : ""}`,
          status: "pending",
        });
      }

      const build = await buildLpRemoveTx({
        owner: address,
        position_id: positionId,
        liquidity_bps: liquidity,
        execution_mode: "auto",
        wallet_connected: Boolean(isConnected && account),
      });

      if ((build.warnings?.length ?? 0) > 0) {
        setTxWarnings(build.warnings ?? []);
        onEvent({
          type: "lp",
          text: "LP remove warning",
          details: build.warnings?.join(" • "),
          status: "pending",
        });
      }

      if (!build.calls?.length) {
        setTxWarnings((prev) => {
          const first = build.warnings?.[0] || "No LP remove transaction calls generated.";
          return Array.from(new Set([...prev, first]));
        });
        toastError(build.warnings?.[0] || "No LP remove transaction calls generated.");
        return;
      }

      onEvent({
        type: "lp",
        text: `LP remove built ${positionId.slice(0, 10)}...`,
        details: `Liquidity ${liquidity} bps`,
        status: "pending",
      });

      const executionResult = await executeBuildResponse(build, "LP remove");
      if (executionResult.mode === "wallet" && executionResult.txHash) {
        await reconcileAfterWalletTx(executionResult.txHash, "remove", build.position_id || positionId);
      }

      if (executionPolicy.advisoryAfterSubmit && executionResult.mode === "wallet" && address) {
        void advisoryActionCheck({
          user_address: address,
          action_type: "lp_remove",
          pool_id: `ekubo_lp_remove_${positionId.slice(2, 8)}`,
          portfolio_features: removeFeatures,
          context: {
            amount: String(liquidity),
            venue: "ekubo",
            from_protocol: 1,
            to_protocol: 0,
          },
        }).then((advisory) => {
          const advisoryDetails = advisory.can_proceed
            ? formatAdvisoryPass(advisory.reason)
            : formatAdvisoryElevatedRisk(advisory.reason);
          onEvent({
            type: "lp",
            text: advisory.can_proceed ? "AI suggested" : "AI suggested (elevated risk)",
            details: advisoryDetails,
            status: "pending",
          });
        }).catch(() => {});
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "LP remove failed";
      const debug = buildTxDebugInfo(rawMessage);
      const message = annotateAddressesInMessage(rawMessage);
      const details =
        debug.decode.code === "u256_sub_overflow"
          ? `${debug.decode.summary}: ${debug.decode.suggestedAction}`
          : message;
      onEvent({ type: "lp", text: "LP remove failed", details: message, status: "failed" });
      toastError(details);
    } finally {
      setBuildLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <datalist id="ekubo-lp-token-options">
        {tokens.map((token) => (
          <option key={token.address} value={token.address}>
            {token.symbol ?? token.name ?? token.address}
          </option>
        ))}
      </datalist>

      {/* ── Mode toggle ── */}
      {inline && mode === "guided" ? null : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("guided")}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              mode === "guided"
                ? "bg-emerald-600/20 text-emerald-300 border-emerald-600/40"
                : "bg-zinc-800 text-zinc-400 border-zinc-700"
            }`}
          >
            Guided
          </button>
          <button
            type="button"
            onClick={() => setMode("advanced")}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              mode === "advanced"
                ? "bg-emerald-600/20 text-emerald-300 border-emerald-600/40"
                : "bg-zinc-800 text-zinc-400 border-zinc-700"
            }`}
          >
            Advanced
          </button>
          {!capabilities?.lp_enabled && (
            <span className="ml-auto text-xs text-amber-300">LP API disabled</span>
          )}
          {capabilities?.lp_enabled && (
            <span className="ml-auto text-xs text-zinc-500">Gate {gateConfig.gateMode}</span>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          INLINE GUIDED FLOW — step-by-step, no raw hex, explanations
         ═══════════════════════════════════════════════════════════════ */}
      {inline && mode === "guided" ? (
        <div className="space-y-5">
          {/* Step 1 — How much to deposit */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-[10px] font-bold">1</span>
              <span className="text-xs font-medium text-zinc-300">How much do you want to deposit?</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Token 0 input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-400">{sym0} amount</label>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    {!address ? (
                      <span className="text-zinc-600">Connect wallet</span>
                    ) : !balancesLoaded ? (
                      <span className="text-zinc-600">Loading...</span>
                    ) : (
                      <>
                        <span className="text-zinc-500">Balance: <span className="text-zinc-300 font-mono">{formatBalance(balance0 ?? BigInt(0), decimals0)}</span></span>
                        {balance0 !== null && balance0 > BigInt(0) && (
                          <button
                            type="button"
                            onClick={() => setAmount0(formatBalanceFull(balance0, decimals0))}
                            className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                          >
                            MAX
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <input
                    value={amount0}
                    onChange={(event) => setAmount0(sanitizeDecimalInput(event.target.value))}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                {balancesLoaded && (balance0 === null || balance0 === BigInt(0)) && (
                  <button
                    type="button"
                    onClick={() => setShowSwapModal(true)}
                    className="mt-1 inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    No {sym0}? Swap to get some
                  </button>
                )}
              </div>

              {/* Token 1 input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-400">{sym1} amount</label>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    {!address ? (
                      <span className="text-zinc-600">Connect wallet</span>
                    ) : !balancesLoaded ? (
                      <span className="text-zinc-600">Loading...</span>
                    ) : (
                      <>
                        <span className="text-zinc-500">Balance: <span className="text-zinc-300 font-mono">{formatBalance(balance1 ?? BigInt(0), decimals1)}</span></span>
                        {balance1 !== null && balance1 > BigInt(0) && (
                          <button
                            type="button"
                            onClick={() => setAmount1(formatBalanceFull(balance1, decimals1))}
                            className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                          >
                            MAX
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <input
                    value={amount1}
                    onChange={(event) => setAmount1(sanitizeDecimalInput(event.target.value))}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                {balancesLoaded && (balance1 === null || balance1 === BigInt(0)) && (
                  <button
                    type="button"
                    onClick={() => setShowSwapModal(true)}
                    className="mt-1 inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    No {sym1}? Swap to get some
                  </button>
                )}
              </div>
            </div>
            {balancesLoaded && balance0 !== null && balance1 !== null && balance0 > BigInt(0) && balance1 > BigInt(0) && (
              <div className="flex items-center gap-2 mt-2 ml-0.5">
                <button
                  type="button"
                  onClick={() => { setAmount0(formatBalanceFull(balance0, decimals0)); setAmount1(formatBalanceFull(balance1, decimals1)); }}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                >
                  Use max of both tokens
                </button>
              </div>
            )}
          </div>

          {/* Step 2 — Fee tier */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-[10px] font-bold">2</span>
              <span className="text-xs font-medium text-zinc-300">Select fee tier</span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2 ml-7">Higher fees earn more per trade but attract less volume. Most pairs work best with 0.30%.</p>
            <div className="grid grid-cols-3 gap-2 ml-7">
              {[
                { value: 500, label: "0.05%", desc: "Stable pairs", sub: "Best for pegged assets" },
                { value: 3000, label: "0.30%", desc: "Standard", sub: "Most common, recommended" },
                { value: 10000, label: "1.00%", desc: "Volatile pairs", sub: "Exotic or low-volume" },
              ].map((tier) => (
                <button
                  key={tier.value}
                  type="button"
                  onClick={() => setFeeTier(tier.value)}
                  className={`text-left p-2.5 rounded-lg border transition-colors ${
                    feeTier === tier.value
                      ? "border-emerald-500/60 bg-emerald-600/10"
                      : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                  }`}
                >
                  <div className={`text-sm font-mono font-bold ${feeTier === tier.value ? "text-emerald-400" : "text-zinc-300"}`}>
                    {tier.label}
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{tier.desc}</div>
                  <div className="text-[9px] text-zinc-600 mt-0.5">{tier.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Step 3 — Risk strategy */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 text-[10px] font-bold">3</span>
              <span className="text-xs font-medium text-zinc-300">Choose your strategy</span>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2 ml-7">This determines how wide your price range is. Wider = safer but lower fees. Tighter = more fees but higher risk.</p>
            <div className="grid grid-cols-3 gap-2 ml-7">
              {[
                { value: "conservative" as RiskProfile, label: "Safe", icon: "🛡️", desc: "Wide price range", sub: "Lower fees, less rebalancing needed" },
                { value: "neutral" as RiskProfile, label: "Balanced", icon: "⚖️", desc: "Moderate range", sub: "Good balance of fees and safety" },
                { value: "aggressive" as RiskProfile, label: "Max Yield", icon: "🔥", desc: "Tight price range", sub: "Higher fees, frequent rebalancing" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRiskProfile(opt.value)}
                  className={`text-left p-2.5 rounded-lg border transition-colors ${
                    riskProfile === opt.value
                      ? "border-emerald-500/60 bg-emerald-600/10"
                      : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{opt.icon}</span>
                    <span className={`text-sm font-medium ${riskProfile === opt.value ? "text-emerald-400" : "text-zinc-300"}`}>
                      {opt.label}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1">{opt.desc}</div>
                  <div className="text-[9px] text-zinc-600 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview + Submit */}
          <div className="ml-7 space-y-3">
            {warningRows.length > 0 && (
              <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
                <div className="flex items-center gap-2 text-amber-300 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <p className="text-xs font-medium">Warnings</p>
                </div>
                <ul className="space-y-1">
                  {warningRows.map((warning) => (
                    <li key={warning} className="text-[10px] text-amber-300">• {warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview && (
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/30 p-3 space-y-1 text-xs">
                <p className="text-zinc-300 font-medium mb-1.5">Position Preview</p>
                <p className="text-zinc-400">
                  Price range: <span className="text-zinc-200 font-mono">{preview.lower_tick}</span>
                  <span className="text-zinc-600 mx-1">→</span>
                  <span className="text-zinc-200 font-mono">{preview.upper_tick}</span>
                </p>
                {preview.current_tick != null && (
                  <p className="text-zinc-400">
                    Current tick: <span className="text-zinc-200 font-mono">{preview.current_tick}</span>
                  </p>
                )}
                <p className="text-zinc-400">
                  Your pool share: <span className="text-zinc-200">{preview.estimated_share}</span>
                </p>
                <p className="text-zinc-400">
                  Estimated yield: <span className="text-emerald-400 font-medium">{preview.estimated_fees_apr.toFixed(2)}% APR</span>
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchPreview()}
                disabled={previewLoading || !capabilities?.lp_enabled || (!amount0 && !amount1)}
                className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 disabled:opacity-40 transition-colors"
              >
                {previewLoading ? "Previewing..." : "Preview Position"}
              </button>
              <button
                type="button"
                onClick={() => void handleAddLp()}
                disabled={buildLoading || !capabilities?.lp_enabled || (!amount0 && !amount1)}
                className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
              >
                {buildLoading ? "Submitting..." : "Add Liquidity"}
              </button>
              <button
                type="button"
                onClick={() => setMode("advanced")}
                className="ml-auto text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Switch to Advanced →
              </button>
            </div>
          </div>
        </div>

      ) : (
      /* ═══════════════════════════════════════════════════════════════
          STANDARD / ADVANCED FLOW — full controls
         ═══════════════════════════════════════════════════════════════ */
      <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Token 0</label>
          <input
            list="ekubo-lp-token-options"
            value={token0}
            onChange={(event) => onTokenChange(event.target.value.trim(), token1)}
            placeholder="0x..."
            className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <p className="text-[11px] text-zinc-500 mt-1">{symbolMap[token0.toLowerCase()] ?? shortAddress(token0)}</p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Token 1</label>
          <input
            list="ekubo-lp-token-options"
            value={token1}
            onChange={(event) => onTokenChange(token0, event.target.value.trim())}
            placeholder="0x..."
            className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
          <p className="text-[11px] text-zinc-500 mt-1">{symbolMap[token1.toLowerCase()] ?? shortAddress(token1)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Amount 0 ({sym0})</label>
          <input
            value={amount0}
            onChange={(event) => setAmount0(sanitizeDecimalInput(event.target.value))}
            placeholder="0.00"
            inputMode="decimal"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Amount 1 ({sym1})</label>
          <input
            value={amount1}
            onChange={(event) => setAmount1(sanitizeDecimalInput(event.target.value))}
            placeholder="0.00"
            inputMode="decimal"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Fee Tier</label>
          <select
            value={feeTier}
            onChange={(event) => setFeeTier(Number(event.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value={500}>500 ({feeTierLabel(500)})</option>
            <option value={3000}>3000 ({feeTierLabel(3000)})</option>
            <option value={10000}>10000 ({feeTierLabel(10000)})</option>
          </select>
        </div>
      </div>

      {mode === "guided" ? (
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Risk Profile</label>
          <select
            value={riskProfile}
            onChange={(event) => setRiskProfile(event.target.value as RiskProfile)}
            className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="conservative">Conservative</option>
            <option value="neutral">Neutral</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Lower Tick</label>
            <input
              value={lowerTick}
              onChange={(event) => setLowerTick(event.target.value.replace(/[^0-9-]/g, ""))}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Upper Tick</label>
            <input
              value={upperTick}
              onChange={(event) => setUpperTick(event.target.value.replace(/[^0-9-]/g, ""))}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void fetchPreview()}
          disabled={previewLoading || !capabilities?.lp_enabled}
          className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50"
        >
          {previewLoading ? "Previewing..." : "Preview Range"}
        </button>
        <button
          type="button"
          onClick={() => void handleAddLp()}
          disabled={buildLoading || !capabilities?.lp_enabled}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium"
        >
          {buildLoading ? "Building..." : "Add LP"}
        </button>
      </div>

      <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/30 p-3 space-y-2">
        {warningRows.length > 0 && (
          <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-2.5">
            <div className="flex items-center gap-1.5 text-amber-300 mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              <p className="text-[11px] font-medium">Warnings</p>
            </div>
            <ul className="space-y-1 text-amber-300 text-[10px]">
              {warningRows.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        )}
        {preview ? (
          <div className="text-xs text-zinc-400 space-y-1">
            <p>
              Range: <span className="text-zinc-200">{preview.lower_tick} to {preview.upper_tick}</span>
            </p>
            {preview.current_tick != null && (
              <p>
                Current tick: <span className="text-zinc-200">{preview.current_tick}</span>
              </p>
            )}
            <p>
              Est. share: <span className="text-zinc-200">{preview.estimated_share}</span>
            </p>
            <p>
              Est. fees APR: <span className="text-zinc-200">{preview.estimated_fees_apr.toFixed(2)}%</span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Use preview to validate LP range before building tx.</p>
        )}
      </div>

      {!inline && (
      <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/20 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Existing Positions</p>
          {positionsLoading && <span className="text-xs text-zinc-500">Refreshing...</span>}
        </div>

        {positions.length === 0 ? (
          <p className="text-xs text-zinc-500">No tracked Ekubo positions for this wallet yet.</p>
        ) : (
          <div className="space-y-2">
            {positions.map((position) => {
              const removeValue = removeBpsByPosition[position.position_id] ?? 10_000;
              const canRemove = Boolean(position.ekubo_nft_id) && position.status !== "closed";
              return (
                <div key={position.position_id} className="rounded-md border border-zinc-700/50 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <p className="text-zinc-200 font-medium">
                        {symbolMap[position.token0.toLowerCase()] ?? shortAddress(position.token0)} / {symbolMap[position.token1.toLowerCase()] ?? shortAddress(position.token1)}
                      </p>
                      <p className="text-zinc-500">
                        {position.position_id.slice(0, 12)}... • {position.status}{position.ekubo_nft_id ? ` • NFT ${position.ekubo_nft_id}` : " • NFT unknown"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={10_000}
                        value={removeValue}
                        onChange={(event) =>
                          setRemoveBpsByPosition((prev) => ({
                            ...prev,
                            [position.position_id]: Math.max(1, Math.min(10_000, Number(event.target.value) || 1)),
                          }))
                        }
                        className="w-24 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200"
                      />
                      <button
                        type="button"
                        onClick={() => void handleRemoveLp(position.position_id)}
                        disabled={buildLoading || !canRemove}
                        className="px-2.5 py-1 rounded bg-zinc-800 border border-zinc-700 hover:border-amber-600/50 text-zinc-200 disabled:opacity-50"
                      >
                        {canRemove ? "Remove" : "Unavailable"}
                      </button>
                    </div>
                  </div>
                  {!canRemove && (
                    <p className="mt-1 text-[10px] text-amber-300">
                      Position can’t be removed from UI yet because its on-chain NFT id is missing or it is already closed. Run position sync/import first.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
      </>
      )}

      {/* ═══ Quick Swap Modal ═══ */}
      {showSwapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-cyan-400" />
                Quick Swap
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowSwapModal(false);
                  // Refresh balances after swap
                  void (async () => {
                    const [b0, b1] = await Promise.all([fetchBalance(token0), fetchBalance(token1)]);
                    setBalance0(b0);
                    setBalance1(b1);
                  })();
                }}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-xs text-zinc-500 mb-3">
                Swap tokens so you have both {sym0} and {sym1} to add liquidity.
              </p>
              <EkuboSwapPanel
                tokenIn={token0}
                tokenOut={token1}
                onTokenChange={() => {}}
                capabilities={capabilities}
                pairMarketHint={null}
                gateConfig={gateConfig}
                onEvent={onEvent}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
