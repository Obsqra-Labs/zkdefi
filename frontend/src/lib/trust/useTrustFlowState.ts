import { useMemo } from "react";

import type { RiskProfileV2 } from "@/hooks/useProfile";
import {
  deriveTrustFlowState,
  getTrustFlowProgress,
  isTrustFlowComplete,
  isTrustFlowReadyForAgent,
  type TrustFlowProgress,
  type TrustFlowState,
} from "@/lib/trust/trustFlow";

export interface UseTrustFlowStateResult {
  state: TrustFlowState;
  progress: TrustFlowProgress;
  complete: boolean;
  readyForAgent: boolean;
}

export function useTrustFlowState(
  profile: RiskProfileV2 | null | undefined,
  address?: string | null
): UseTrustFlowStateResult {
  return useMemo(() => {
    const state = deriveTrustFlowState(profile, address);
    const progress = getTrustFlowProgress(state);

    return {
      state,
      progress,
      complete: isTrustFlowComplete(state),
      readyForAgent: isTrustFlowReadyForAgent(state),
    };
  }, [profile, address]);
}
