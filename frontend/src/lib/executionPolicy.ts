import { ExecutionIntent, ExecutionPolicyDecision } from "@/types/ekubo";

interface ResolvePolicyInput {
  intent: ExecutionIntent;
  walletConnected: boolean;
}

const EXEC_POLICY_V2 = (process.env.NEXT_PUBLIC_EXEC_POLICY_V2 ?? "true").toLowerCase() !== "false";

/**
 * Execution policy matrix:
 * - Manual + wallet: no pre-gate; advisory post-submit.
 * - Manual without wallet (orchestrated): pre-gate required.
 * - Autonomous/session paths: pre-gate required.
 */
export function resolveExecutionPolicy(input: ResolvePolicyInput): ExecutionPolicyDecision {
  if (!EXEC_POLICY_V2) {
    return {
      enforceGate: true,
      advisoryAfterSubmit: false,
    };
  }

  if (input.intent === "manual_wallet" && input.walletConnected) {
    return {
      enforceGate: false,
      advisoryAfterSubmit: true,
    };
  }

  if (input.intent === "autonomous") {
    return {
      enforceGate: true,
      advisoryAfterSubmit: false,
    };
  }

  return {
    enforceGate: true,
    advisoryAfterSubmit: false,
  };
}
