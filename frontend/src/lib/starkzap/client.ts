import { StarkzapAdapter } from "@/lib/starkzap/types";

const ENABLED = (process.env.NEXT_PUBLIC_STARKZAP_ENABLED ?? "false").toLowerCase() === "true";

let cachedAdapter: StarkzapAdapter | null = null;

function disabled(reason: string): StarkzapAdapter {
  return {
    available: false,
    walletProvider: "starknet-react",
    paymasterAvailable: false,
    controllerAvailable: false,
    reason,
  };
}

export async function getStarkzapAdapter(): Promise<StarkzapAdapter> {
  if (cachedAdapter) return cachedAdapter;
  if (!ENABLED) {
    cachedAdapter = disabled("NEXT_PUBLIC_STARKZAP_ENABLED=false");
    return cachedAdapter;
  }

  try {
    // Runtime-only import avoids hard dependency until package is pinned.
    const dynamicImport = new Function("modulePath", "return import(modulePath)") as (
      modulePath: string,
    ) => Promise<Record<string, unknown>>;
    const mod = await dynamicImport("@starkware-ecosystem/starkzap");

    const maybeClient =
      (mod?.default as Record<string, unknown> | undefined) ??
      (mod as Record<string, unknown> | undefined);

    const executeWithPaymaster =
      maybeClient && typeof maybeClient.executeWithPaymaster === "function"
        ? (maybeClient.executeWithPaymaster as StarkzapAdapter["executeWithPaymaster"])
        : undefined;

    cachedAdapter = {
      available: Boolean(executeWithPaymaster),
      walletProvider: "starkzap",
      paymasterAvailable: Boolean(executeWithPaymaster),
      controllerAvailable: true,
      executeWithPaymaster,
      reason: executeWithPaymaster ? undefined : "StarkZap loaded but no paymaster executor found",
    };
    return cachedAdapter;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "StarkZap module unavailable";
    cachedAdapter = disabled(reason);
    return cachedAdapter;
  }
}
