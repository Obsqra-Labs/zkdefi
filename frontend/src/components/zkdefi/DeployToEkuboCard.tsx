"use client";

import { useState } from "react";
import { useAccount, useProvider } from "@starknet-react/core";
import { Zap, Loader2, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { useApp } from "@/lib/AppContext";
import { sepoliaVoyagerTxUrl } from "@/lib/explorer";
import { toastSuccess, toastError } from "@/lib/toast";
import { advisoryActionCheck, runActionGate } from "@/lib/api/gating";
import { formatAdvisoryElevatedRisk, formatAdvisoryPass, formatGateDenied } from "@/lib/gateCopy";
import { resolveExecutionPolicy } from "@/lib/executionPolicy";
import { executeCalls } from "@/lib/tx/executeCalls";
import { annotateAddressesInMessage, buildTxDebugInfo } from "@/lib/txDebug";

import { API_BASE } from "@/lib/api/client";

const SEPOLIA_USDC = "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080";
const SEPOLIA_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

type RiskProfile = "conservative" | "balanced" | "aggressive";

interface PositionResult {
  strategy: string;
  amount: number;
  status: string;
  tx_hash?: string | null;
  tx_calldata?: { contract_address: string; entrypoint: string; calldata: string[] };
  tx_calldata_error?: string;
  cap_applied?: {
    token: string;
    max_amount: number;
    reason: string;
  };
}

interface DeployResult {
  deployment_id: string;
  positions: PositionResult[];
  receipt_id: string;
  target: string;
  recommendation_id?: string;
}

type TokenMeta = { symbol: string; decimals: number };

const TOKEN_META: Record<string, TokenMeta> = {
  [SEPOLIA_USDC]: { symbol: "USDC", decimals: 6 },
  [SEPOLIA_STRK]: { symbol: "STRK", decimals: 18 },
};

function shortAddress(address: string): string {
  if (!address || !address.startsWith("0x") || address.length < 14) return address;
  return `${address.slice(0, 8)}...${address.slice(-4)}`;
}

function decorateErrorMessage(message: string): string {
  if (!message) return message;
  return annotateAddressesInMessage(message).replace(/0x[0-9a-fA-F]{40,66}/g, shortAddress);
}

function tokenMeta(address: string): TokenMeta {
  const key = address.toLowerCase();
  return TOKEN_META[key] ?? { symbol: `${address.slice(0, 8)}...`, decimals: 18 };
}

function parseU256FromResult(result: Array<string | bigint>): bigint {
  if (!Array.isArray(result) || result.length === 0) return BigInt(0);
  if (result.length === 1) return BigInt(result[0]);
  const low = BigInt(result[0]);
  const high = BigInt(result[1]);
  return low + (high << BigInt(128));
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = amount / scale;
  const frac = amount % scale;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

function deployFeatures(profile: RiskProfile): number[] {
  const byProfile: Record<RiskProfile, number[]> = {
    conservative: [40, 20, 20, 15, 70, 40, 8, 15],
    balanced: [55, 35, 25, 25, 60, 30, 12, 22],
    aggressive: [75, 55, 40, 45, 45, 20, 25, 35],
  };
  return [...byProfile[profile]];
}

interface DeployToEkuboCardProps {
  userAddress: string;
  onEvent?: (event: {
    type: "trade" | "lp";
    text: string;
    details?: string;
    txHash?: string;
    status?: "pending" | "confirmed" | "failed";
  }) => void;
  onBeforeDeploy?: (input: {
    amount: number;
    riskProfile: RiskProfile;
  }) => Promise<{ ok: boolean; reason?: string }>;
}

export function DeployToEkuboCard({ userAddress, onEvent, onBeforeDeploy }: DeployToEkuboCardProps) {
  const { account, isConnected } = useAccount();
  const { provider } = useProvider();
  const { hasOnboarded, invalidateTabs, demoMode } = useApp();
  const [amount, setAmount] = useState("");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("balanced");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIndex, setSigningIndex] = useState<number | null>(null);

  const handleDeploy = async () => {
    const num = parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a positive amount");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      // Deploy input is USDC-denominated. Block early when wallet has insufficient USDC.
      try {
        const requiredUsdcRaw = BigInt(Math.floor(num * 1_000_000));
        const balanceRes = await provider.callContract({
          contractAddress: SEPOLIA_USDC as `0x${string}`,
          entrypoint: "balanceOf",
          calldata: [userAddress],
        });
        const currentUsdc = parseU256FromResult(balanceRes as Array<string | bigint>);
        if (currentUsdc < requiredUsdcRaw) {
          const need = formatTokenAmount(requiredUsdcRaw, 6);
          const have = formatTokenAmount(currentUsdc, 6);
          const msg = `Insufficient USDC to deploy: need ${need}, wallet has ${have}. Swap STRK → USDC first.`;
          setError(msg);
          onEvent?.({
            type: "trade",
            text: "Deploy blocked",
            details: msg,
            status: "failed",
          });
          return;
        }
      } catch {
        // If balance read fails, continue and let backend/wallet provide canonical errors.
      }

      const executionPolicy = resolveExecutionPolicy({
        intent: "manual_wallet",
        walletConnected: Boolean(isConnected && account),
      });
      if (executionPolicy.enforceGate) {
        if (onBeforeDeploy) {
          const precheck = await onBeforeDeploy({ amount: num, riskProfile });
          if (!precheck.ok) {
            const reason = precheck.reason || "Deploy blocked by policy gate";
            const message = formatGateDenied(reason);
            setError(message);
            onEvent?.({
              type: "trade",
              text: "Gate denied",
              details: message,
              status: "failed",
            });
            return;
          }
        } else {
          const features = deployFeatures(riskProfile);
          const gate = await runActionGate({
            userAddress: userAddress,
            amount: Math.max(1, Math.floor(num * 1000)),
            reason: `Ekubo deploy ${riskProfile}`,
            poolId: `ekubo_deploy_${riskProfile}`,
            portfolioFeatures: features,
            fromProtocol: 0,
            toProtocol: 1,
          });
          if (!gate.ok) {
            const message = formatGateDenied(gate.reason);
            setError(message);
            onEvent?.({
              type: "trade",
              text: "Gate denied",
              details: message,
              status: "failed",
            });
            return;
          }
        }
      }
      const res = await fetch(`${API_BASE}/api/v1/zkdefi/orchestration/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(demoMode ? { "X-Demo-Mode": "true" } : {}),
        },
        body: JSON.stringify({
          user_address: userAddress,
          deployable_amount: num,
          risk_profile: riskProfile,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = decorateErrorMessage(typeof data.detail === "string" ? data.detail : "Deploy failed");
        setError(msg);
        onEvent?.({
          type: "trade",
          text: "Deploy failed",
          details: msg,
          status: "failed",
        });
        return;
      }
      setResult(data as DeployResult);
      onEvent?.({
        type: "trade",
        text: "Deploy plan created",
        details: `Receipt ${String((data as DeployResult).receipt_id ?? "")}`,
        status: "pending",
      });
    } catch (e) {
      const msg = decorateErrorMessage(e instanceof Error ? e.message : "Request failed");
      setError(msg);
      onEvent?.({
        type: "trade",
        text: "Deploy failed",
        details: msg,
        status: "failed",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignAndExecute = async (positionIndex: number, receiptId: string) => {
    if (!result?.positions?.[positionIndex]?.tx_calldata || !account) {
      toastError(isConnected ? "Missing calldata." : "Connect wallet to sign.");
      return;
    }
    if (userAddress && hasOnboarded === false) {
      toastError("Complete one-time agent setup to continue. Open Setup from the banner or go to /agent?tab=onboarding");
      return;
    }
    const cd = result.positions[positionIndex].tx_calldata!;
    const calldata = cd.calldata;
    if (!calldata || calldata.length < 10) {
      toastError("Invalid calldata for this position.");
      return;
    }
    setSigningIndex(positionIndex);
    try {
      const position = result.positions[positionIndex];
      const routerAddress = (cd.contract_address.startsWith("0x") ? cd.contract_address : `0x${cd.contract_address}`) as `0x${string}`;
      const tokenIn = (calldata[8].startsWith("0x") ? calldata[8] : `0x${calldata[8]}`) as `0x${string}`;
      const amountIn = BigInt(calldata[9]);
      const meta = tokenMeta(tokenIn.toLowerCase());

      // Preflight: avoid sending tx when input-token balance is insufficient.
      try {
        const balanceRes = await provider.callContract({
          contractAddress: tokenIn,
          entrypoint: "balanceOf",
          calldata: [userAddress],
        });
        const currentBalance = parseU256FromResult(balanceRes as Array<string | bigint>);
        if (currentBalance < amountIn) {
          const need = formatTokenAmount(amountIn, meta.decimals);
          const have = formatTokenAmount(currentBalance, meta.decimals);
          const details = `Insufficient ${meta.symbol}: need ${need}, wallet has ${have}.`;
          toastError(details);
          onEvent?.({
            type: "trade",
            text: "Deploy execution blocked",
            details,
            status: "failed",
          });
          return;
        }
      } catch {
        // Continue if read call fails; wallet execute will still provide canonical chain error.
      }

      const u256Mask = (BigInt(1) << BigInt(128)) - BigInt(1);
      const amountLow = (amountIn & u256Mask).toString();
      const amountHigh = (amountIn >> BigInt(128)).toString();
      const token0 = (calldata[0].startsWith("0x") ? calldata[0] : `0x${calldata[0]}`) as `0x${string}`;
      const token1 = (calldata[1].startsWith("0x") ? calldata[1] : `0x${calldata[1]}`) as `0x${string}`;
      const tokenOut = tokenIn.toLowerCase() === token0.toLowerCase() ? token1 : token0;

      // Ekubo Router pays from its own balance during lock-callback swap.
      // Required execution order: transfer input to router -> swap -> clear output (+dust) to wallet.
      const txResult = await executeCalls({
        account,
        gasMode: "wallet",
        calls: [
          { contractAddress: tokenIn, entrypoint: "transfer", calldata: [routerAddress, amountLow, amountHigh] },
          { contractAddress: routerAddress, entrypoint: cd.entrypoint, calldata },
          { contractAddress: routerAddress, entrypoint: "clear", calldata: [tokenOut] },
          { contractAddress: routerAddress, entrypoint: "clear", calldata: [tokenIn] },
        ] as Parameters<typeof account.execute>[0],
      });

      setResult((prev) => {
        if (!prev) return prev;
        const next = { ...prev, positions: [...prev.positions] };
        next.positions[positionIndex] = { ...next.positions[positionIndex], tx_hash: txResult.transaction_hash, status: "submitted" };
        return next;
      });
      onEvent?.({
        type: "trade",
        text: `Deploy execution submitted (${position.strategy})`,
        details: `Receipt ${receiptId}${txResult.executionPath === "paymaster" ? " • paymaster" : ""}${txResult.fallbackUsed ? " • fallback wallet gas" : ""}`,
        txHash: txResult.transaction_hash,
        status: "confirmed",
      });
      await fetch(`${API_BASE}/api/v1/zkdefi/orchestration/receipt/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt_id: receiptId, tx_hash: txResult.transaction_hash }),
      }).catch(() => {});
      toastSuccess("Swap submitted!", {
        action: { label: "View on Explorer", onClick: () => window.open(sepoliaVoyagerTxUrl(txResult.transaction_hash), "_blank") },
      });
      invalidateTabs();

      void advisoryActionCheck({
        user_address: userAddress,
        action_type: "deploy",
        pool_id: `ekubo_deploy_${(position.strategy || "unknown").slice(0, 12)}`,
        portfolio_features: deployFeatures(riskProfile),
        context: {
          amount: String(position.amount),
          venue: "ekubo",
          from_protocol: 0,
          to_protocol: 1,
        },
      })
        .then((advisory) => {
          const advisoryDetails = advisory.can_proceed
            ? formatAdvisoryPass(advisory.reason)
            : formatAdvisoryElevatedRisk(advisory.reason);
          onEvent?.({
            type: "trade",
            text: advisory.can_proceed ? "AI suggested" : "AI suggested (elevated risk)",
            details: advisoryDetails,
            status: "pending",
          });
        })
        .catch(() => {
          // advisory is non-blocking
        });
    } catch (e) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      const debug = buildTxDebugInfo(rawMessage);
      const isOverflow = debug.decode.code === "u256_sub_overflow" || /u256_sub|Overflow/i.test(rawMessage);
      const strategy = result?.positions?.[positionIndex]?.strategy?.toLowerCase() ?? "";
      const prettyMessage = decorateErrorMessage(rawMessage);
      const details =
        isOverflow && strategy === "ekubo_strk_usdc"
          ? "Pool STRK liquidity is too low for this size on Sepolia. Retry with a smaller deploy amount or execute ETH/USDC only."
          : isOverflow
            ? `${debug.decode.summary}. ${debug.decode.suggestedAction}`
            : prettyMessage || "Sign & execute failed";
      toastError(details);
      onEvent?.({
        type: "trade",
        text: "Deploy execution failed",
        details,
        status: "failed",
      });
    } finally {
      setSigningIndex(null);
    }
  };

  return (
    <div id="deploy-to-ekubo" className="glass rounded-xl border border-emerald-800/50 p-6 scroll-mt-4">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5 text-emerald-400" />
        <h3 className="font-semibold">Deploy to Ekubo</h3>
        <span className="ml-auto px-2 py-1 text-xs rounded bg-emerald-600/20 text-emerald-300 border border-emerald-600/30">
          Ekubo Sepolia
        </span>
      </div>
      <p className="text-sm text-zinc-400 mb-4">
        Recommend → execute → receipt. Ekubo Sepolia only. Enter the amount you want to deploy; we allocate by risk profile and record a compliance receipt.
      </p>
      {!result ? (
        <>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Deployable amount</label>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                disabled={loading}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Risk profile</label>
              <select
                value={riskProfile}
                onChange={(e) => setRiskProfile(e.target.value as RiskProfile)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700 text-white focus:border-emerald-500 focus:outline-none"
                disabled={loading}
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-amber-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={handleDeploy}
            disabled={loading}
            className="mt-4 w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deploying…
              </>
            ) : (
              "Deploy"
            )}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          {(() => {
            const hasAnyTxHash = result.positions?.some((p) => p.tx_hash) ?? false;
            return (
              <>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">
                    {hasAnyTxHash ? "Deployed" : "Receipt recorded"}
                  </span>
                </div>
                {!hasAnyTxHash && (
                  <p className="text-xs text-zinc-500">
                    No on-chain execution yet. Allocation and receipt are recorded; use Sign & execute when calldata is available.
                  </p>
                )}
              </>
            );
          })()}
          <div className="text-sm space-y-1">
            <p className="text-zinc-400">
              <span className="text-zinc-500">Deployment ID:</span>{" "}
              <span className="font-mono text-zinc-300">{result.deployment_id}</span>
            </p>
            <p className="text-zinc-400">
              <span className="text-zinc-500">Receipt:</span>{" "}
              <span className="font-mono text-zinc-300 truncate block max-w-full" title={result.receipt_id}>
                {result.receipt_id}
              </span>
            </p>
          </div>
          {result.positions?.length > 0 && (
            <div className="pt-2 border-t border-zinc-700/50">
              <p className="text-xs text-zinc-500 mb-2">Positions</p>
              <ul className="space-y-2 text-sm">
                {result.positions.map((p, i) => (
                  <li key={i} className="flex flex-col gap-1 text-zinc-300">
                    <div className="flex justify-between items-center">
                      <span>{p.strategy}</span>
                      <span>{p.amount} — {p.status}</span>
                    </div>
                    {p.cap_applied && (
                      <p className="text-xs text-zinc-500">
                        Capped at {p.cap_applied.max_amount} {p.cap_applied.token} for Sepolia liquidity safety.
                      </p>
                    )}
                    {p.tx_hash ? (
                      <a
                        href={sepoliaVoyagerTxUrl(p.tx_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-xs"
                      >
                        View on Explorer <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : p.tx_calldata ? (
                      <button
                        type="button"
                        onClick={() => handleSignAndExecute(i, result.receipt_id)}
                        disabled={!account || signingIndex !== null}
                        className="mt-1 inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-600/40 hover:bg-emerald-600/30 disabled:opacity-50"
                      >
                        {signingIndex === i ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Signing…
                          </>
                        ) : (
                          "Sign & execute"
                        )}
                      </button>
                    ) : p.tx_calldata_error ? (
                      <span className="text-xs text-amber-400">{p.tx_calldata_error}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {result.positions.every((p) => p.tx_calldata_error && !p.tx_calldata && !p.tx_hash) && (
                <p className="text-xs text-zinc-500 mt-2">
                  Ekubo API returned an error for this pair on Sepolia (often temporary). Receipt is stored; try again later to get swap calldata and Sign & execute.
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setAmount("");
              setError(null);
            }}
            className="mt-3 text-sm text-emerald-400 hover:text-emerald-300"
          >
            Deploy again
          </button>
        </div>
      )}
    </div>
  );
}
