"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "@starknet-react/core";
import type { ExecutionInfraStatus, ExecutionIntent, GasMode } from "@/types/ekubo";
import { getStarkzapAdapter } from "@/lib/starkzap/client";

function readGasMode(): GasMode {
  if (typeof window === "undefined") return "auto";
  const mode = window.localStorage.getItem("zkdefi_gas_mode");
  if (mode === "wallet" || mode === "paymaster" || mode === "auto") return mode;
  return "auto";
}

function writeGasMode(mode: GasMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("zkdefi_gas_mode", mode);
}

function readFallbackState(): { fallbackUsed: boolean; reason?: string } {
  if (typeof window === "undefined") return { fallbackUsed: false };
  const fallbackUsed = window.localStorage.getItem("zkdefi_fallback_used") === "1";
  const reason = window.localStorage.getItem("zkdefi_fallback_reason") ?? undefined;
  return { fallbackUsed, reason };
}

function writeFallbackState(used: boolean, reason?: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("zkdefi_fallback_used", used ? "1" : "0");
  if (reason != null) {
    window.localStorage.setItem("zkdefi_fallback_reason", reason);
  } else {
    window.localStorage.removeItem("zkdefi_fallback_reason");
  }
}

/** Derive ExecutionIntent from infra status for gate/signer consistency. */
export function executionIntentFromStatus(status: ExecutionInfraStatus): ExecutionIntent {
  const mode = status.gasMode;
  if (mode === "paymaster") return "paymaster";
  if (mode === "wallet") return "manual_wallet";
  if (mode === "auto" && status.controllerSession === "controller-ready") return "orchestrated";
  return "manual_wallet";
}

export interface ExecutionContextValue {
  /** Wallet connected from StarknetProvider. */
  walletConnected: boolean;
  /** Infra status: gas mode, paymaster, controller session, fallback. */
  status: ExecutionInfraStatus;
  /** Resolved intent for gating (manual_wallet | paymaster | orchestrated). */
  executionIntent: ExecutionIntent;
  loading: boolean;
  setGasMode: (mode: GasMode) => void;
  refresh: () => Promise<void>;
  markFallback: (reason?: string) => void;
}

const ExecutionContext = createContext<ExecutionContextValue | undefined>(undefined);

export function ExecutionContextProvider({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const [status, setStatus] = useState<ExecutionInfraStatus>({
    walletProvider: "starknet-react",
    paymasterAvailable: false,
    gasMode: "auto",
    controllerSession: "wallet",
    fallbackUsed: false,
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const mode = readGasMode();
      const adapter = await getStarkzapAdapter();
      const fallback = readFallbackState();
      setStatus({
        walletProvider: adapter.available ? adapter.walletProvider : "starknet-react",
        paymasterAvailable: adapter.paymasterAvailable,
        controllerSession: adapter.controllerAvailable ? "controller-ready" : isConnected ? "wallet" : "none",
        gasMode: mode,
        fallbackUsed: fallback.fallbackUsed,
        lastFallbackReason: fallback.reason || adapter.reason,
      });
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key !== null &&
        e.key !== "zkdefi_fallback_used" &&
        e.key !== "zkdefi_fallback_reason"
      ) return;
      const fallback = readFallbackState();
      setStatus((prev) => ({
        ...prev,
        fallbackUsed: fallback.fallbackUsed,
        lastFallbackReason: fallback.reason,
      }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setGasMode = useCallback((nextMode: GasMode) => {
    writeGasMode(nextMode);
    setStatus((prev) => ({ ...prev, gasMode: nextMode }));
  }, []);

  const markFallback = useCallback((reason?: string) => {
    const msg = reason ?? "Fallback to wallet gas";
    writeFallbackState(true, msg);
    setStatus((prev) => ({
      ...prev,
      fallbackUsed: true,
      lastFallbackReason: msg,
    }));
  }, []);

  const executionIntent = useMemo(() => executionIntentFromStatus(status), [status]);

  const value = useMemo<ExecutionContextValue>(
    () => ({
      walletConnected: Boolean(isConnected),
      status,
      executionIntent,
      loading,
      setGasMode,
      refresh,
      markFallback,
    }),
    [isConnected, status, executionIntent, loading, setGasMode, refresh, markFallback],
  );

  return (
    <ExecutionContext.Provider value={value}>
      {children}
    </ExecutionContext.Provider>
  );
}

export function useExecutionContextProvider(): ExecutionContextValue {
  const ctx = useContext(ExecutionContext);
  if (ctx === undefined) {
    throw new Error("useExecutionContextProvider must be used within ExecutionContextProvider");
  }
  return ctx;
}

export function useExecutionContextProviderOptional(): ExecutionContextValue | undefined {
  return useContext(ExecutionContext);
}
