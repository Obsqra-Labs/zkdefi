/**
 * Standard gate outcome labels and advisory copy (Phase 6 control surface).
 * Use across action cards for consistent "AI suggested" / "Gate denied" messaging.
 */

export const GATE_DENIED_LABEL = "Gate denied";
export const AI_SUGGESTED_LABEL = "AI suggested";

const WHAT_TO_DO_NEXT =
  "Complete one-time setup from the banner, check Trust tab, or retry with a smaller amount.";

/**
 * Format blocking message when gate denies an action.
 * @param reason - Backend or gate reason (optional)
 * @returns User-facing "Gate denied" message with optional what-to-do-next
 */
export function formatGateDenied(reason?: string): string {
  const trimmed = (reason || "").trim();
  if (!trimmed) return `${GATE_DENIED_LABEL}. ${WHAT_TO_DO_NEXT}`;
  return `${GATE_DENIED_LABEL}: ${trimmed}. ${WHAT_TO_DO_NEXT}`;
}

/**
 * Short reason only (for inline display where what-to-do is shown elsewhere).
 */
export function gateDeniedReasonOnly(reason?: string): string {
  const trimmed = (reason || "").trim();
  return trimmed || "Policy or zkML gate rejected this action.";
}

/**
 * Format advisory (non-blocking) message when gate allows and we show "AI suggested".
 */
export function formatAdvisoryPass(reason?: string): string {
  const trimmed = (reason || "").trim();
  if (!trimmed) return `${AI_SUGGESTED_LABEL}. Policy check passed.`;
  return `${AI_SUGGESTED_LABEL}. ${trimmed}`;
}

/**
 * Format advisory when policy reports elevated risk but action is allowed (manual override).
 */
export function formatAdvisoryElevatedRisk(reason?: string): string {
  const trimmed = (reason || "").trim();
  if (!trimmed) return "Elevated risk noted; manual execution allowed by policy.";
  return `${trimmed}`;
}
