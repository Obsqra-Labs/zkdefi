import { GasMode } from "@/types/ekubo";
import { getStarkzapAdapter } from "@/lib/starkzap/client";

export interface ExecuteCallsResult {
  transaction_hash: string;
  executionPath: "wallet" | "paymaster";
  fallbackUsed: boolean;
  fallbackReason?: string;
}

interface ExecuteCallsInput {
  account: {
    execute: (...args: any[]) => Promise<{ transaction_hash: string }>;
  };
  calls: unknown;
  gasMode?: GasMode;
}

function writeFallbackState(fallbackUsed: boolean, reason?: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("zkdefi_fallback_used", fallbackUsed ? "1" : "0");
  if (reason) {
    window.localStorage.setItem("zkdefi_fallback_reason", reason);
  } else {
    window.localStorage.removeItem("zkdefi_fallback_reason");
  }
}

function getStoredGasMode(): GasMode {
  if (typeof window === "undefined") return "auto";
  const raw = window.localStorage.getItem("zkdefi_gas_mode");
  if (raw === "wallet" || raw === "paymaster" || raw === "auto") return raw;
  return "auto";
}

export async function executeCalls(input: ExecuteCallsInput): Promise<ExecuteCallsResult> {
  const gasMode = input.gasMode ?? getStoredGasMode();
  if (gasMode !== "wallet") {
    const adapter = await getStarkzapAdapter();
    if (adapter.available && adapter.executeWithPaymaster) {
      try {
        const res = await adapter.executeWithPaymaster({
          calls: input.calls,
          gasMode,
        });
        writeFallbackState(false);
        return {
          transaction_hash: res.transaction_hash,
          executionPath: "paymaster",
          fallbackUsed: false,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Paymaster fallback";
        const fallback = await input.account.execute(input.calls as any);
        writeFallbackState(true, reason);
        return {
          transaction_hash: fallback.transaction_hash,
          executionPath: "wallet",
          fallbackUsed: true,
          fallbackReason: reason,
        };
      }
    }
  }

  const direct = await input.account.execute(input.calls as any);
  writeFallbackState(false);
  return {
    transaction_hash: direct.transaction_hash,
    executionPath: "wallet",
    fallbackUsed: false,
  };
}
