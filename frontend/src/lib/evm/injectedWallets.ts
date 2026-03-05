export type EvmChain = "ethereum" | "arbitrum" | "base" | "optimism";

export const EVM_CHAIN_OPTIONS: Array<{ value: EvmChain; label: string }> = [
  { value: "ethereum", label: "Ethereum" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "base", label: "Base" },
  { value: "optimism", label: "Optimism" },
];

export interface EvmProvider {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: EvmProvider[];
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963AnnounceDetail {
  info: Eip6963ProviderInfo;
  provider: EvmProvider;
}

export interface DetectedEvmWallet {
  id: string;
  label: string;
  rdns?: string;
  provider: EvmProvider;
  source: "eip6963" | "window_ethereum";
}

function isEvmProvider(value: unknown): value is EvmProvider {
  return !!value && typeof value === "object" && typeof (value as EvmProvider).request === "function";
}

function deriveProviderLabel(provider: EvmProvider, fallback = "Injected Wallet"): string {
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isRabby) return "Rabby";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  return fallback;
}

function stableWalletId(source: string, hint: string, fallbackIndex: number): string {
  const safeHint = hint.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `${source}:${safeHint || fallbackIndex}`;
}

export async function discoverEvmWallets(timeoutMs = 300): Promise<DetectedEvmWallet[]> {
  if (typeof window === "undefined") return [];

  const found = new Map<string, DetectedEvmWallet>();
  let fallbackIndex = 0;

  const addWallet = (
    source: "eip6963" | "window_ethereum",
    provider: unknown,
    labelHint?: string,
    rdns?: string,
    idHint?: string,
  ) => {
    if (!isEvmProvider(provider)) return;
    const label = deriveProviderLabel(provider, labelHint || "Injected Wallet");
    const id = stableWalletId(source, idHint || rdns || label, fallbackIndex++);
    if (!found.has(id)) {
      found.set(id, { id, label, rdns, provider, source });
    }
  };

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963AnnounceDetail>).detail;
    if (!detail || !detail.provider || !detail.info) return;
    addWallet(
      "eip6963",
      detail.provider,
      detail.info.name || "EVM Wallet",
      detail.info.rdns,
      detail.info.uuid || detail.info.rdns || detail.info.name,
    );
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const ethereum = (window as Window & { ethereum?: unknown }).ethereum;
  if (isEvmProvider(ethereum)) {
    addWallet("window_ethereum", ethereum, deriveProviderLabel(ethereum), undefined, "default");
    if (Array.isArray(ethereum.providers)) {
      ethereum.providers.forEach((provider, idx) => {
        addWallet(
          "window_ethereum",
          provider,
          `Injected Wallet ${idx + 1}`,
          undefined,
          `provider-${idx}`,
        );
      });
    }
  }

  await new Promise((resolve) => setTimeout(resolve, Math.max(100, timeoutMs)));
  window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);

  const wallets = Array.from(found.values());
  wallets.sort((a, b) => {
    if (a.label === b.label) return a.id.localeCompare(b.id);
    if (a.label === "MetaMask") return -1;
    if (b.label === "MetaMask") return 1;
    return a.label.localeCompare(b.label);
  });
  return wallets;
}

export function firstEvmAccount(accounts: unknown): string | null {
  if (!Array.isArray(accounts)) return null;
  for (const value of accounts) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}
