"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Droplets, Repeat, Target } from "lucide-react";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import { ActivityEvent, useApp } from "@/lib/AppContext";
import { getEkuboCapabilities, getMarketSurface } from "@/lib/api/ekubo";
import { getRiskPassport, listSessionKeys, runActionGate } from "@/lib/api/gating";
import { formatAdvisoryElevatedRisk, formatGateDenied } from "@/lib/gateCopy";
import { EkuboCapabilities, MarketOpportunity, MarketSurfaceResponse } from "@/types/ekubo";
import { EkuboLpPanel } from "./EkuboLpPanel";
import { OperateHubEvent, EkuboSwapPanel } from "./EkuboSwapPanel";
import { LimitOrdersPanel } from "./LimitOrdersPanel";
import { MarketIntelligencePanel } from "./MarketIntelligencePanel";
import { API_BASE } from "@/lib/api/client";

type HubTab = "swap" | "lp" | "limit";

const DEFAULT_TOKEN_IN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"; // STRK
const DEFAULT_TOKEN_OUT = "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23"; // fUSDC

interface EkuboOperateHubProps {
  userAddress: string;
  initialTokenIn?: string;
  initialTokenOut?: string;
  initialTab?: HubTab;
  gateMode?: "balanced" | "stress";
  autopilotEnabled?: boolean;
  autopilotMinSpreadBps?: number;
  manualWalletOverrideEnabled?: boolean;
  manualOverrideMinPassportScore?: number;
}

function normalizeAddressKey(input: string): string {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return "";
  const withoutPrefix = raw.startsWith("0x") ? raw.slice(2) : raw;
  const stripped = withoutPrefix.replace(/^0+/, "");
  return `0x${stripped || "0"}`;
}

function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalizeAddressKey(a) === normalizeAddressKey(b);
}

function shortHex(value?: string | null): string {
  if (!value) return "--";
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function EkuboOperateHub({
  userAddress,
  initialTokenIn,
  initialTokenOut,
  initialTab,
  gateMode: gateModeProp = "balanced",
  autopilotEnabled: autopilotEnabledProp = false,
  autopilotMinSpreadBps: autopilotMinSpreadBpsProp = 20,
  manualWalletOverrideEnabled: manualWalletOverrideEnabledProp = true,
  manualOverrideMinPassportScore: manualOverrideMinPassportScoreProp = 20,
}: EkuboOperateHubProps) {
  const { setActivityFeed } = useApp();
  const [tab, setTab] = useState<HubTab>(initialTab ?? "swap");
  const [tokenIn, setTokenIn] = useState(initialTokenIn || DEFAULT_TOKEN_IN);
  const [tokenOut, setTokenOut] = useState(initialTokenOut || DEFAULT_TOKEN_OUT);
  const [capabilities, setCapabilities] = useState<EkuboCapabilities | null>(null);
  const [marketData, setMarketData] = useState<MarketSurfaceResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [passportScore, setPassportScore] = useState<number | null>(null);
  const [dualWalletLinked, setDualWalletLinked] = useState(false);
  const [dualWalletAddress, setDualWalletAddress] = useState<string | null>(null);
  const [dualWalletChain, setDualWalletChain] = useState<string | null>(null);
  const autoTriggerLedger = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    getEkuboCapabilities()
      .then((data) => {
        if (!cancelled) setCapabilities(data);
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialTokenIn) setTokenIn(initialTokenIn);
    if (initialTokenOut) setTokenOut(initialTokenOut);
  }, [initialTokenIn, initialTokenOut]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const fetchMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      const surface = await getMarketSurface();
      setMarketData(surface);
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : "Failed to load market intelligence");
    } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => { void fetchMarket(); }, [fetchMarket]);
  useVisibilityPolling(() => void fetchMarket(), 30_000, [fetchMarket]);

  const loadGateContext = useCallback(async () => {
    try {
      const [passport, sessions, dualSessionRes] = await Promise.all([
        getRiskPassport(userAddress),
        listSessionKeys(userAddress),
        fetch(`${API_BASE}/api/v1/zkdefi/auth/session/${userAddress}`),
      ]);

      setPassportScore(
        typeof passport?.composite_score === "number" ? passport.composite_score : null,
      );

      const active = (sessions?.sessions || []).find((row) => row.is_active && !row.is_expired);
      if (active) {
        setActiveSessionId(active.session_id);
      } else {
        setActiveSessionId(undefined);
      }

      const dualSession = dualSessionRes.ok ? await dualSessionRes.json() : null;
      const linked = Boolean(dualSession && dualSession.active);
      setDualWalletLinked(linked);
      setDualWalletAddress(
        linked && typeof dualSession?.evm_address === "string"
          ? dualSession.evm_address
          : null,
      );
      setDualWalletChain(
        linked && typeof dualSession?.chain === "string"
          ? dualSession.chain
          : null,
      );
    } catch {
      setActiveSessionId(undefined);
      setDualWalletLinked(false);
      setDualWalletAddress(null);
      setDualWalletChain(null);
    }
  }, [userAddress]);
  useEffect(() => { void loadGateContext(); }, [loadGateContext]);
  useVisibilityPolling(() => void loadGateContext(), 30_000, [loadGateContext]);

  const pushActivity = useCallback(
    (event: OperateHubEvent) => {
      const entry: ActivityEvent = {
        id: Math.random().toString(36).slice(2, 10),
        type: event.type,
        pool: "ekubo",
        text: event.text,
        details: event.details,
        txHash: event.txHash,
        status: event.status,
        time: new Date(),
      };
      setActivityFeed((prev) => [entry, ...prev].slice(0, 100));
    },
    [setActivityFeed],
  );

  const tabButtons = useMemo(
    () => [
      {
        key: "swap" as const,
        label: "Swap",
        icon: Repeat,
      },
      {
        key: "lp" as const,
        label: "LP",
        icon: Droplets,
      },
      {
        key: "limit" as const,
        label: "Limit Orders",
        icon: Target,
      },
    ],
    [],
  );

  const gateConfig = useMemo(
    () => ({
      gateMode: gateModeProp,
      sessionId: activeSessionId,
      passportScore,
      manualWalletOverrideEnabled: manualWalletOverrideEnabledProp,
      manualOverrideMinPassportScore: manualOverrideMinPassportScoreProp,
    }),
    [
      gateModeProp,
      activeSessionId,
      passportScore,
      manualWalletOverrideEnabledProp,
      manualOverrideMinPassportScoreProp,
    ],
  );

  const selectedPairOpportunity = useMemo(() => {
    const opportunities = marketData?.opportunities ?? [];
    const direct = opportunities.find((row) => sameAddress(row.token0, tokenIn) && sameAddress(row.token1, tokenOut));
    if (direct) return direct;
    const inverse = opportunities.find((row) => sameAddress(row.token0, tokenOut) && sameAddress(row.token1, tokenIn));
    return inverse ?? null;
  }, [marketData, tokenIn, tokenOut]);

  const triggerOpportunity = useCallback(
    async (row: MarketOpportunity, source: "manual" | "auto" = "manual") => {
      if (!row.token0 || !row.token1) {
        pushActivity({
          type: "trade",
          text: source === "auto" ? "Autopilot signal unavailable" : "AI signal unavailable",
          details: "Opportunity row missing token addresses",
          status: "failed",
        });
        return;
      }

      const isLpAction = row.best_venue.toLowerCase() === "ekubo" && row.spread_bps >= 0;
      const baseFeatures =
        gateModeProp === "stress"
          ? [125, 100, 85, 92, 18, 10, 92, 84]
          : [54, 38, 24, 24, 64, 36, 14, 24];

      baseFeatures[1] = Math.min(140, baseFeatures[1] + Math.floor(Math.abs(row.spread_bps) / 4));
      baseFeatures[3] = Math.min(
        140,
        baseFeatures[3] + Math.floor(Math.max(0, row.estimated_apy_pct - row.reference_apy_pct)),
      );
      if (typeof passportScore === "number") {
        baseFeatures[2] = Math.max(0, 100 - Math.floor(passportScore));
      }

      const gate = await runActionGate({
        userAddress,
        amount: Math.max(1, Math.min(1_000_000, Math.floor((row.volume_24h_usd || 1) / 1000))),
        reason: `Market signal ${row.pair} -> ${isLpAction ? "LP rebalance" : "swap rotate"} | mode=${gateModeProp}`,
        poolId: `market_${row.token0.slice(2, 8)}_${row.token1.slice(2, 8)}`,
        portfolioFeatures: baseFeatures,
        fromProtocol: isLpAction ? 0 : 1,
        toProtocol: isLpAction ? 1 : 0,
        sessionId: activeSessionId,
      });

      if (!gate.ok) {
        const canManualOverride =
          source === "manual" &&
          manualWalletOverrideEnabledProp &&
          (passportScore ?? 0) >= manualOverrideMinPassportScoreProp;
        if (canManualOverride) {
          setTokenIn(row.token0);
          setTokenOut(row.token1);
          setTab(isLpAction ? "lp" : "swap");
          pushActivity({
            type: isLpAction ? "lp" : "trade",
            text: "AI suggested (elevated risk)",
            details: formatAdvisoryElevatedRisk(gate.reason),
            status: "pending",
          });
          return;
        }
        const message = formatGateDenied(gate.reason);
        pushActivity({
          type: isLpAction ? "lp" : "trade",
          text: "Gate denied",
          details: message,
          status: "failed",
        });
        return;
      }

      setTokenIn(row.token0);
      setTokenOut(row.token1);
      setTab(isLpAction ? "lp" : "swap");
      pushActivity({
        type: isLpAction ? "lp" : "trade",
        text: "AI suggested",
        details: `Proposal ${gate.proposalId ?? "n/a"}${gate.snapshotHash ? ` • snapshot ${gate.snapshotHash.slice(0, 10)}...` : ""}${gate.executionProofHash ? ` • proof ${gate.executionProofHash.slice(0, 10)}...` : ""}`,
        status: "pending",
      });
    },
    [
      activeSessionId,
      gateModeProp,
      manualOverrideMinPassportScoreProp,
      manualWalletOverrideEnabledProp,
      passportScore,
      pushActivity,
      userAddress,
    ],
  );

  useEffect(() => {
    if (!autopilotEnabledProp) return;
    if (!marketData?.opportunities?.length) return;

    const candidate = marketData.opportunities.find((row) => {
      if (!row.token0 || !row.token1) return false;
      if (Math.abs(row.spread_bps) < autopilotMinSpreadBpsProp) return false;
      return true;
    });
    if (!candidate) return;

    const key = `${candidate.token0.toLowerCase()}_${candidate.token1.toLowerCase()}_${candidate.best_venue.toLowerCase()}`;
    const now = Date.now();
    const last = autoTriggerLedger.current[key] ?? 0;
    const cooldownMs = 45_000;
    if (now - last < cooldownMs) return;

    autoTriggerLedger.current[key] = now;
    void triggerOpportunity(candidate, "auto");
  }, [autopilotEnabledProp, autopilotMinSpreadBpsProp, marketData, triggerOpportunity]);

  return (
    <div className="space-y-4">
      <MarketIntelligencePanel
        data={marketData}
        loading={marketLoading}
        error={marketError}
        onRefresh={() => void fetchMarket()}
        onSelectPair={(next0, next1) => {
          if (!next0 || !next1) return;
          setTokenIn(next0);
          setTokenOut(next1);
        }}
        onTriggerOpportunity={(row) => void triggerOpportunity(row)}
      />

      <div className="glass rounded-xl border border-zinc-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          {tabButtons.map((button) => {
            const Icon = button.icon;
            return (
              <button
                key={button.key}
                type="button"
                onClick={() => setTab(button.key)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm border transition-colors ${
                  tab === button.key
                    ? "bg-emerald-600/20 text-emerald-300 border-emerald-600/40"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <Icon className="w-4 h-4" />
                {button.label}
              </button>
            );
          })}

          <span className="ml-auto text-xs text-zinc-500">
            Pair context shared across tabs
          </span>
        </div>
        <div className="mb-4 rounded-lg border border-zinc-700/60 bg-zinc-900/30 p-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span>Gate: {gateModeProp}</span>
            <span>Autopilot: {autopilotEnabledProp ? `on (${autopilotMinSpreadBpsProp} bps)` : "off"}</span>
            <span>
              Manual override: {manualWalletOverrideEnabledProp ? `on (min ${manualOverrideMinPassportScoreProp})` : "off"}
            </span>
            <span>Passport {passportScore ?? "—"}</span>
            <span>
              Dual wallet: {dualWalletLinked ? `${shortHex(dualWalletAddress)} (${dualWalletChain || "ethereum"})` : "not linked"}
            </span>
          </div>
        </div>

        {tab === "swap" && (
          <EkuboSwapPanel
            tokenIn={tokenIn}
            tokenOut={tokenOut}
            onTokenChange={(nextIn, nextOut) => {
              setTokenIn(nextIn);
              setTokenOut(nextOut);
            }}
            capabilities={capabilities}
            pairMarketHint={selectedPairOpportunity}
            gateConfig={gateConfig}
            onEvent={pushActivity}
          />
        )}

        {tab === "lp" && (
          <EkuboLpPanel
            token0={tokenIn}
            token1={tokenOut}
            onTokenChange={(next0, next1) => {
              setTokenIn(next0);
              setTokenOut(next1);
            }}
            capabilities={capabilities}
            gateConfig={gateConfig}
            onEvent={pushActivity}
          />
        )}

        {tab === "limit" && (
          <div className="pt-1">
            <LimitOrdersPanel />
          </div>
        )}
      </div>
    </div>
  );
}
