/**
 * TypedData for signed Risk Disclosure (GDPR/compliance).
 * Single source of truth for the statement users sign in onboarding.
 */

import { constants, shortString } from "starknet";

function encodeStatementForFelt(text: string): string {
  const max = 31;
  const truncated = text.length > max ? text.slice(0, max) : text;
  return shortString.encodeShortString(truncated);
}

export const RISK_DISCLOSURE_VERSION = "2026-02";
export const RISK_DISCLOSURE_STATEMENT =
  "I have read and accept the Risk Disclosure and Terms at https://zkde.fi/terms. I understand I may lose all funds. No financial advice. Only use funds I can afford to lose.";

export type RiskDisclosureTypedData = {
  domain: {
    name: string;
    version: string;
    chainId: string;
  };
  types: {
    StarkNetDomain: Array<{ name: string; type: string }>;
    RiskDisclosure: Array<{ name: string; type: string }>;
  };
  primaryType: "RiskDisclosure";
  message: {
    statement: string;
    version: string;
    timestamp: string;
  };
};

/**
 * Build TypedData for the current chain. Use when user is connected.
 */
export function buildRiskDisclosureTypedData(chainIdHex?: string): RiskDisclosureTypedData {
  const chainId = chainIdHex ?? constants.StarknetChainId.SN_SEPOLIA;
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
      RiskDisclosure: [
        { name: "statement", type: "felt" },
        { name: "version", type: "felt" },
        { name: "timestamp", type: "felt" },
      ],
    },
    primaryType: "RiskDisclosure",
    message: {
      statement: encodeStatementForFelt("zkde.fi Risk Disclosure 2026-02"),
      version: encodeStatementForFelt(RISK_DISCLOSURE_VERSION),
      timestamp: Math.floor(Date.now() / 1000).toString(),
    },
  };
}

export const RISK_SIG_STORAGE_KEY_PREFIX = "zkdefi_risk_sig_";

export function getRiskSigStorageKey(address: string): string {
  return `${RISK_SIG_STORAGE_KEY_PREFIX}${address?.toLowerCase() ?? ""}`;
}

export function saveRiskSignature(address: string, signature: { r: string; s: string }, signedAt: string): void {
  try {
    const key = getRiskSigStorageKey(address);
    const value = JSON.stringify({ signature, signedAt });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem("risk-acknowledged", "true");
    }
  } catch {
    // ignore
  }
}

export function getStoredRiskSignature(address: string): { signature: { r: string; s: string }; signedAt: string } | null {
  try {
    if (typeof window === "undefined" || !address) return null;
    const raw = window.localStorage.getItem(getRiskSigStorageKey(address));
    if (!raw) return null;
    return JSON.parse(raw) as { signature: { r: string; s: string }; signedAt: string };
  } catch {
    return null;
  }
}

export function hasStoredRiskSignature(address: string): boolean {
  return getStoredRiskSignature(address) !== null;
}
