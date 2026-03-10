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

/** Inner tabs of the Vault center stage */
export type VaultTab = "overview" | "pools" | "ekubo" | "lending" | "activity" | "trade" | "oracle" | "marketplace";

/** Overlay modes — full-screen panels that replace center stage */
export type OverlayModeV2 =
  | "deploy"
  | "circuit-board"
  | "governance"
  | "brain"
  | "execution-pipeline"
  | null;

/** Slideout drawers — right-side panels */
export type SlideoutModeV2 =
  | null
  | "deposit"
  | "withdraw"
  | "privacy"
  | "shielded"
  | "zkrag"
  | "agent-builder"
  | "lending"
  | "marketplace"
  | "oracle";

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
    lower === "capital" ||
    lower === "oracle_command"
  ) {
    return { mode: "intelligence" };
  }

  // Oracle routes to vault with oracle tab
  if (lower === "oracle") {
    return { mode: "vault", vaultTab: "oracle" };
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
    lower === "trade"
  ) {
    return { mode: "vault", vaultTab: resolveVaultTab(lower, tLower) };
  }

  // Route-specific overrides that map to vault with a specific inner tab
  if (lower === "lending" || lower === "p2p" || lower === "lend" || lower === "borrow") {
    return { mode: "vault", vaultTab: "lending" };
  }
  if (lower === "history" || lower === "memory_lane" || lower === "receipts" || lower === "activity") {
    return { mode: "vault", vaultTab: "activity" };
  }

  // Marketplace routes to vault with marketplace tab
  if (lower === "marketplace") {
    return { mode: "vault", vaultTab: "marketplace" };
  }

  // Governance/models open intelligence (overlay handled separately)
  if (
    lower === "models" ||
    lower === "zkml" ||
    lower === "governance" ||
    lower === "policy"
  ) {
    return { mode: "intelligence" };
  }

  // Default: vault (the primary view per mockups)
  if (!lower) {
    return { mode: "vault", vaultTab: resolveVaultTab("", tLower) };
  }

  return { mode: "vault" };
}

function resolveVaultTab(vLower: string, tLower: string): VaultTab {
  // Explicit ?t= param takes priority
  if (tLower === "pools" || tLower === "pool") return "pools";
  if (tLower === "ekubo" || tLower === "lp") return "ekubo";
  if (tLower === "lending" || tLower === "lend") return "lending";
  if (tLower === "activity" || tLower === "history") return "activity";
  if (tLower === "trade" || tLower === "execution") return "trade";
  if (tLower === "oracle") return "oracle";
  if (tLower === "marketplace") return "marketplace";
  if (tLower === "overview") return "overview";

  // Infer from ?v= when ?t= is absent
  if (vLower === "pools" || vLower === "pool" || vLower === "pool_intelligence") return "pools";
  if (vLower === "execution" || vLower === "execution_flow" || vLower === "trade") return "trade";
  if (vLower === "oracle") return "oracle";
  if (vLower === "marketplace") return "marketplace";

  return "overview";
}

/** Resolve ?v= param to an initial overlay or slideout for V2 layout */
export function resolveViewOverlayV2(
  v: string | null,
): { overlay?: OverlayModeV2; slideout?: SlideoutModeV2 } {
  if (!v) return {};
  const lower = String(v).toLowerCase();
  if (lower === "oracle_command") return { slideout: "oracle" };
  if (lower === "governance" || lower === "policy") return { overlay: "governance" };
  if (lower === "lending" || lower === "p2p" || lower === "lend" || lower === "borrow")
    return { slideout: "lending" };
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
 * Prevents mismatched withdraw paths (e.g. trying to withdraw a dark_ledger
 * commitment via the hashed_proof handler).
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
    dark_ledger: ["dark_ledger"],
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
