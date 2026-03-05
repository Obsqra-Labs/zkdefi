/**
 * Track A / Track B vault model (see docs/plans/VAULT_AND_PRIVACY_ARCHITECTURE.md).
 * Track A = user vault (personal); Track B = shared pool managed by the AI.
 */
export const TRACK_A = "track_a" as const;
export const TRACK_B = "track_b" as const;
export type VaultTrack = typeof TRACK_A | typeof TRACK_B;

export const TRACK_A_LABEL = "Your Vault";
export const TRACK_B_LABEL = "Shared Pool";
