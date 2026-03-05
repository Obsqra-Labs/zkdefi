import { normalizeStarknetHex } from "@/lib/explorer";

type AddressKind = "token" | "protocol" | "contract";

export interface LabeledAddress {
  address: string;
  short: string;
  label: string;
  kind: AddressKind;
}

export interface TxFailureDecode {
  code: string;
  summary: string;
  likelyCause: string;
  suggestedAction: string;
}

export interface TxDebugInfo {
  raw: string;
  labeledMessage: string;
  addresses: LabeledAddress[];
  decode: TxFailureDecode;
}

const LABELS: Record<string, { label: string; kind: AddressKind }> = {
  // Core Sepolia token set
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": { label: "STRK", kind: "token" },
  "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080": { label: "USDC", kind: "token" },
  "0x07ab0b8855a61f480b4423c46c32fa7c553f0aac3531bbddaa282d86244f7a23": { label: "fUSDC", kind: "token" },
  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": { label: "ETH", kind: "token" },
  // Ekubo Sepolia
  "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763": { label: "Ekubo Router", kind: "protocol" },
  "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384": { label: "Ekubo Core", kind: "protocol" },
  // AVNU swap path (seen in Sepolia execution traces)
  "0x02c56e8b00dbe2a71e57472685378fc8988bba947e9a99b26a00fade2b4fe7c2": { label: "AVNU Route Contract", kind: "protocol" },
};

function shortAddress(value: string): string {
  if (!value || !value.startsWith("0x") || value.length < 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function uniqueAddressesInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeStarknetHex(value);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function labelAddress(address: string): LabeledAddress {
  const normalized = normalizeStarknetHex(address) ?? address.toLowerCase();
  const known = LABELS[normalized];
  const label = known?.label ?? "Contract";
  const kind = known?.kind ?? "contract";
  return {
    address: normalized,
    short: shortAddress(normalized),
    label,
    kind,
  };
}

export function annotateAddressesInMessage(message: string): string {
  if (!message) return message;
  return message.replace(/0x[0-9a-fA-F]{40,66}/g, (match) => {
    const labeled = labelAddress(match);
    if (labeled.kind === "contract") return labeled.short;
    return `${labeled.label} (${labeled.short})`;
  });
}

function decodeFromMessage(message: string): TxFailureDecode {
  const normalized = (message || "").toLowerCase();
  if (
    normalized.includes("u256_sub overflow") ||
    normalized.includes("u256_sub") ||
    normalized.includes("0x753235365f737562204f766572666c6f77")
  ) {
    // Full Privacy Pool withdraw: pool calls token.transfer; overflow = pool balance < withdrawal amount
    if (normalized.includes("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d")) {
      return {
        code: "u256_sub_overflow",
        summary: "Pool has insufficient token balance",
        likelyCause:
          "The Full Privacy Pool does not hold enough STRK to cover this withdrawal. Deposits may not have been finalized or the pool needs to be funded.",
        suggestedAction:
          "Try a smaller withdrawal amount, or ensure the pool is funded with STRK (deposits must complete and tokens sit in the pool).",
      };
    }
    return {
      code: "u256_sub_overflow",
      summary: "Token subtraction underflow",
      likelyCause:
        "Input balance/allowance is too low, or the selected route/pool cannot pay the output amount at this size.",
      suggestedAction:
        "Use a smaller amount, refresh quote/route, and verify token balance + router approval for the input token.",
    };
  }
  if (
    normalized.includes("insufficient tokens received") ||
    normalized.includes("0x496e73756666696369656e7420746f6b656e73207265636569766564")
  ) {
    return {
      code: "insufficient_tokens_received",
      summary: "Received amount below minimum",
      likelyCause:
        "Route output dropped below min receive at execution time (stale quote, thin liquidity, or rapid price movement).",
      suggestedAction:
        "Refresh quote and retry with smaller size or different venue/pair (for Sepolia, STRK↔fUSDC is usually deeper).",
    };
  }
  if (normalized.includes("insufficient allowance")) {
    return {
      code: "insufficient_allowance",
      summary: "Insufficient token allowance",
      likelyCause: "Router approval is below the required input amount.",
      suggestedAction: "Approve the router for at least the input amount, then retry.",
    };
  }
  if (normalized.includes("insufficient balance")) {
    return {
      code: "insufficient_balance",
      summary: "Insufficient token balance",
      likelyCause: "Wallet balance is below the transaction input amount.",
      suggestedAction: "Reduce size or fund the wallet with the input token.",
    };
  }
  if (normalized.includes("slippage") || normalized.includes("min_out")) {
    return {
      code: "slippage",
      summary: "Slippage protection triggered",
      likelyCause: "Market moved beyond your slippage tolerance before execution.",
      suggestedAction: "Refresh quote and retry with smaller size or wider slippage tolerance.",
    };
  }
  if (normalized.includes("entrypoint_not_found")) {
    return {
      code: "entrypoint_not_found",
      summary: "Contract call shape mismatch",
      likelyCause: "The targeted contract or calldata entrypoint does not match on-chain ABI.",
      suggestedAction: "Rebuild calldata from fresh quote/build endpoint and retry.",
    };
  }
  return {
    code: "unknown",
    summary: "Execution reverted",
    likelyCause: "A downstream contract condition failed during call execution.",
    suggestedAction: "Inspect implicated contracts and retry with smaller size or refreshed route.",
  };
}

function extractLikelyContracts(message: string): string[] {
  if (!message) return [];
  const fromContractFrames = Array.from(
    message.matchAll(/contract address:\s*(0x[0-9a-fA-F]{40,66})/g),
  ).map((match) => match[1]);
  if (fromContractFrames.length > 0) {
    return uniqueAddressesInOrder(fromContractFrames);
  }
  const genericAddresses = Array.from(message.matchAll(/0x[0-9a-fA-F]{40,66}/g)).map(
    (match) => match[0],
  );
  return uniqueAddressesInOrder(genericAddresses);
}

export function buildTxDebugInfo(rawMessage?: string): TxDebugInfo {
  const raw = (rawMessage || "").trim();
  const contracts = extractLikelyContracts(raw);
  return {
    raw,
    labeledMessage: annotateAddressesInMessage(raw),
    addresses: contracts.map(labelAddress),
    decode: decodeFromMessage(raw),
  };
}
