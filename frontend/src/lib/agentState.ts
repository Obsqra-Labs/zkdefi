/**
 * Canonical UI state model for the Capital OS agent page.
 *
 * Every piece of navigation state (center mode, vault tab, overlay, slideout,
 * deposit mode) is defined here so back/forward, deep links and internal
 * navigation all resolve through the same code path.
 */

import type { PrivacyMethod, VaultCommitment } from "@/hooks/usePrivacyVault";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** V2 2-pill center stage modes */
export type CenterModeV2 = "intelligence" | "vault";

/** Inner tabs of the Vault center stage — five-lane layout */
export type VaultTab = "overview" | "capital" | "lend" | "govern" | "activity";

/** Overlay modes — full-screen panels that replace center stage */
export type OverlayModeV2 =
  | "circuit-board"
  | "brain"
  | null;

/** Slideout drawers — right-side panels */
export type SlideoutModeV2 =
  | null
  | "fund"
  | "deposit"
  | "withdraw"
  | "privacy"
  | "shielded"
  | "zkrag"
  | "agent-builder"
  | "execute";

/** Deposit flow sub-mode */
export type DepositMode = "fund-vault" | "direct-to-pool";

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

export function isCapitalOSV2Enabled(): boolean {
  if (typeof window === "undefined") return false;
  return process.env.NEXT_PUBLIC_ENABLE_CAPITAL_OS_V2 !== "0";
}

// ---------------------------------------------------------------------------
// URL resolution — ?v=<mode>&t=<vaultTab>
// ---------------------------------------------------------------------------

export interface ResolvedView {
  mode: CenterModeV2;
  vaultTab?: VaultTab;
}

/** Map ?v= URL param to CenterModeV2 + optional VaultTab */
export function resolveViewParamV2(
  v: string | null,
  t: string | null,
): ResolvedView {
  const lower = String(v ?? "").toLowerCase();
  const tLower = String(t ?? "").toLowerCase();

  // Intelligence mode mappings
  if (
    lower === "intelligence" ||
    lower === "signals" ||
    lower === "oracle_command"
  ) {
    return { mode: "intelligence" };
  }

  // Vault mode mappings
  if (
    lower === "vault" ||
    lower === "portfolio" ||
    lower === "pools" ||
    lower === "pool" ||
    lower === "pool_intelligence" ||
    lower === "execution" ||
    lower === "execution_flow" ||
    lower === "opportunities" ||
    lower === "trade" ||
    lower === "ekubo" ||
    lower === "capital"
  ) {
    return { mode: "vault", vaultTab: resolveVaultTab(lower, tLower) };
  }

  // Lending / borrow → lend tab
  if (lower === "lending" || lower === "p2p" || lower === "lend" || lower === "borrow") {
    return { mode: "vault", vaultTab: "lend" };
  }

  // Activity / history
  if (lower === "history" || lower === "memory_lane" || lower === "receipts" || lower === "activity") {
    return { mode: "vault", vaultTab: "activity" };
  }

  // Oracle / marketplace → overview (no longer standalone tabs)
  if (lower === "oracle" || lower === "marketplace") {
    return { mode: "vault", vaultTab: "overview" };
  }

  // Governance / policy → govern tab
  if (
    lower === "models" ||
    lower === "zkml" ||
    lower === "governance" ||
    lower === "policy"
  ) {
    return { mode: "vault", vaultTab: "govern" };
  }

  // Default: vault overview
  if (!lower) {
    return { mode: "vault", vaultTab: resolveVaultTab("", tLower) };
  }

  return { mode: "vault" };
}

function resolveVaultTab(vLower: string, tLower: string): VaultTab {
  // Explicit ?t= param takes priority — map old names to new five-lane tabs
  if (tLower === "pools" || tLower === "pool" || tLower === "ekubo" || tLower === "lp" || tLower === "trade" || tLower === "execution" || tLower === "capital") return "capital";
  if (tLower === "lending" || tLower === "lend") return "lend";
  if (tLower === "governance" || tLower === "govern") return "govern";
  if (tLower === "activity" || tLower === "history") return "activity";
  if (tLower === "oracle" || tLower === "marketplace") return "overview";
  if (tLower === "overview") return "overview";

  // Infer from ?v= when ?t= is absent
  if (vLower === "pools" || vLower === "pool" || vLower === "pool_intelligence" || vLower === "ekubo" || vLower === "capital") return "capital";
  if (vLower === "execution" || vLower === "execution_flow" || vLower === "trade") return "capital";
  if (vLower === "oracle" || vLower === "marketplace") return "overview";

  return "overview";
}

/** Resolve ?v= param to an initial overlay or slideout for V2 layout */
export function resolveViewOverlayV2(
  v: string | null,
): { overlay?: OverlayModeV2; slideout?: SlideoutModeV2 } {
  if (!v) return {};
  const lower = String(v).toLowerCase();
  if (lower === "models" || lower === "zkml")
    return { overlay: "brain" };
  return {};
}

/** Build a URL for navigating within Capital OS */
export function buildAgentUrl(mode: CenterModeV2, vaultTab?: VaultTab): string {
  const params = new URLSearchParams();
  params.set("v", mode);
  if (mode === "vault" && vaultTab && vaultTab !== "overview") {
    params.set("t", vaultTab);
  }
  return `/agent?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Method ↔ commitment compatibility guard
// ---------------------------------------------------------------------------

/**
 * Check that the selected privacy method matches the commitment being acted on.
 * Prevents mismatched withdraw paths (e.g. trying to withdraw a nullifier_set
 * commitment via the commitment_shield handler).
 */
export function assertMethodMatchesCommitment(
  method: PrivacyMethod,
  commitment: VaultCommitment,
): { ok: boolean; error?: string } {
  // hashed_proof and nullifier_set share the same handler, so they're compatible
  const compatible: Record<PrivacyMethod, PrivacyMethod[]> = {
    commitment_shield: ["commitment_shield"],
    nullifier_set: ["nullifier_set", "hashed_proof"],
    hashed_proof: ["hashed_proof", "nullifier_set"],
  };

  const allowed = compatible[method] ?? [method];
  if (allowed.includes(commitment.method)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `Cannot use "${method}" method to withdraw a "${commitment.method}" commitment. ` +
      `Please select a commitment that matches the "${method}" method, or switch to "${commitment.method}".`,
  };
}
