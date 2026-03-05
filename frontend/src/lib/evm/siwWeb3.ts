import type { EvmChain, EvmProvider } from "@/lib/evm/injectedWallets";
import { constants, shortString } from "starknet";

export type DualAuthMethod = "injected" | "web3auth_siw";

const FALLBACK_CHAIN_IDS: Record<EvmChain, number> = {
  // Testnet defaults aligned with current zkde.fi environment.
  ethereum: 11155111, // Sepolia
  arbitrum: 421614, // Arbitrum Sepolia
  base: 84532, // Base Sepolia
  optimism: 11155420, // OP Sepolia
};

type StarknetTypedData = {
  domain: {
    name: string;
    version: string;
    chainId: string;
  };
  types: {
    StarkNetDomain: Array<{ name: string; type: string }>;
    DualWalletSessionBind: Array<{ name: string; type: string }>;
  };
  primaryType: "DualWalletSessionBind";
  message: {
    statement: string;
    evmAddress: string;
    evmChain: string;
    nonceRef: string;
    timestamp: string;
  };
};

export interface StarknetSessionAuthInput {
  chainIdHex?: string;
  signature?: unknown;
  typedData?: StarknetTypedData;
  signedAt?: string;
}

function randomNonce(length = 16): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 255);
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function normalizeNonce(raw: string): string {
  const normalized = (raw || "").replace(/[^a-zA-Z0-9]/g, "");
  if (normalized.length >= 8) return normalized.slice(0, 64);
  return `${normalized}${randomNonce(16)}`.slice(0, 16);
}

function parseHexChainId(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  try {
    if (text.startsWith("0x")) return parseInt(text, 16);
    return Number.parseInt(text, 10);
  } catch {
    return null;
  }
}

function toChainIdHex(chainId: unknown): string | null {
  if (typeof chainId === "string") {
    const trimmed = chainId.trim();
    if (trimmed.startsWith("0x")) return trimmed;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) return `0x${parsed.toString(16)}`;
    return null;
  }
  if (typeof chainId === "number" && Number.isFinite(chainId)) return `0x${chainId.toString(16)}`;
  if (typeof chainId === "bigint") return `0x${chainId.toString(16)}`;
  return null;
}

function encodeShortFelt(value: string, fallback = "zkdefi"): string {
  const normalized = (value || "")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 31)
    .trim();
  const source = normalized || fallback;
  try {
    return shortString.encodeShortString(source);
  } catch {
    return shortString.encodeShortString(fallback);
  }
}

function normalizeStarknetSignature(signature: unknown): string | string[] | { r: string; s: string } {
  if (Array.isArray(signature)) {
    return signature.map((part) => String(part));
  }
  if (typeof signature === "object" && signature !== null) {
    const candidate = signature as { r?: unknown; s?: unknown };
    if (candidate.r != null && candidate.s != null) {
      return {
        r: String(candidate.r),
        s: String(candidate.s),
      };
    }
    return JSON.stringify(signature);
  }
  return String(signature ?? "");
}

export interface BuildDualSessionTypedDataInput {
  nonceId: string;
  evmAddress: string;
  evmChain: EvmChain;
  starknetChainIdHex?: string;
}

export function buildDualSessionTypedData(
  input: BuildDualSessionTypedDataInput,
): StarknetTypedData {
  const chainId = input.starknetChainIdHex ?? constants.StarknetChainId.SN_SEPOLIA;
  const nonceRef = (input.nonceId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 31);

  return {
    domain: {
      name: "zkde.fi",
      version: "1",
      chainId,
    },
    types: {
      StarkNetDomain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "felt" },
        { name: "version", type: "string" },
      ],
      DualWalletSessionBind: [
        { name: "statement", type: "felt" },
        { name: "evmAddress", type: "felt" },
        { name: "evmChain", type: "felt" },
        { name: "nonceRef", type: "felt" },
        { name: "timestamp", type: "felt" },
      ],
    },
    primaryType: "DualWalletSessionBind",
    message: {
      statement: encodeShortFelt("zkde dual bind"),
      evmAddress: input.evmAddress,
      evmChain: encodeShortFelt(input.evmChain, "ethereum"),
      nonceRef: encodeShortFelt(nonceRef, "nonce"),
      timestamp: Math.floor(Date.now() / 1000).toString(),
    },
  };
}

async function signPersonalMessage(
  provider: EvmProvider,
  address: string,
  message: string,
): Promise<string> {
  let signature: unknown;
  try {
    signature = await provider.request({
      method: "personal_sign",
      params: [message, address],
    });
  } catch {
    signature = await provider.request({
      method: "personal_sign",
      params: [address, message],
    });
  }
  if (typeof signature !== "string" || !signature) {
    throw new Error("Wallet did not return a personal_sign signature.");
  }
  return signature;
}

export interface BuildWeb3AuthCredentialInput {
  provider: EvmProvider;
  selectedChain: EvmChain;
  evmAddress: string;
  starknetAddress: string;
  nonceHint: string;
  starknetAuth?: StarknetSessionAuthInput;
}

export async function buildWeb3AuthCredential(
  input: BuildWeb3AuthCredentialInput,
): Promise<Record<string, unknown>> {
  const { SIWWeb3 } = await import("@web3auth/sign-in-with-web3");

  const walletChainRaw = await input.provider
    .request({ method: "eth_chainId" })
    .catch(() => null);
  const walletChainId = parseHexChainId(walletChainRaw);
  const selectedChainId = FALLBACK_CHAIN_IDS[input.selectedChain];
  const effectiveChainId = walletChainId ?? selectedChainId ?? 1;

  const nonce = normalizeNonce(input.nonceHint);
  const nowIso = new Date().toISOString();
  const domain = typeof window !== "undefined" ? window.location.host : "zkde.fi";
  const uri = typeof window !== "undefined" ? window.location.origin : "https://zkde.fi";

  const payload = {
    domain,
    address: input.evmAddress,
    statement: "Sign-In With Web3 for zkde.fi dual-chain session binding",
    uri,
    version: "1",
    chainId: effectiveChainId,
    nonce,
    issuedAt: nowIso,
    resources: [
      "urn:zkde:scope:dual-wallet-session",
      `urn:zkde:starknet:${input.starknetAddress.toLowerCase()}`,
    ],
  };

  const siw = new SIWWeb3({
    network: "ethereum",
    payload,
  } as ConstructorParameters<typeof SIWWeb3>[0]);
  const message = siw.prepareMessage();
  const signature = await signPersonalMessage(input.provider, input.evmAddress, message);

  let verified = false;
  try {
    const verifyRes = await siw.verify(
      payload as never,
      { t: "eip191", s: signature } as never,
    );
    verified = Boolean(verifyRes?.success);
  } catch {
    verified = false;
  }

  return {
    mode: "web3auth_siw",
    standard: "caip-74",
    generated_at: nowIso,
    ethereum: {
      network: "ethereum",
      selected_chain: input.selectedChain,
      chain_id: String(effectiveChainId),
      address: input.evmAddress,
      nonce,
      message,
      signature: {
        t: "eip191",
        s: signature,
      },
      verified,
    },
    starknet: {
      address: input.starknetAddress,
      present: Boolean(input.starknetAddress),
      chain_id:
        input.starknetAuth?.chainIdHex ??
        toChainIdHex(input.starknetAuth?.typedData?.domain?.chainId) ??
        "starknet",
      signature_type: input.starknetAuth?.signature ? "starknet_typed_data" : "wallet_connected",
      signature: input.starknetAuth?.signature
        ? normalizeStarknetSignature(input.starknetAuth.signature)
        : undefined,
      signed_at: input.starknetAuth?.signedAt ?? undefined,
      typed_data: input.starknetAuth?.typedData ?? undefined,
    },
  };
}
