import { describe, expect, it } from "vitest";
import { isAgentBuilderV2EnabledForUser } from "./agentBuilderRollout";

describe("agentBuilderRollout", () => {
  it("respects global kill switch", () => {
    const enabled = isAgentBuilderV2EnabledForUser("0xabc", {
      NEXT_PUBLIC_AGENT_BUILDER_V2: "0",
      NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_PERCENT: "100",
    });
    expect(enabled).toBe(false);
  });

  it("enables allowlisted users even when rollout percent is 0", () => {
    const enabled = isAgentBuilderV2EnabledForUser("0xallow", {
      NEXT_PUBLIC_AGENT_BUILDER_V2: "1",
      NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_PERCENT: "0",
      NEXT_PUBLIC_AGENT_BUILDER_V2_INTERNAL_ALLOWLIST: "0xallow,0xfriend",
    });
    expect(enabled).toBe(true);
  });

  it("disables non-allowlisted users when rollout percent is 0", () => {
    const enabled = isAgentBuilderV2EnabledForUser("0xskip", {
      NEXT_PUBLIC_AGENT_BUILDER_V2: "1",
      NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_PERCENT: "0",
      NEXT_PUBLIC_AGENT_BUILDER_V2_INTERNAL_ALLOWLIST: "0xallow",
    });
    expect(enabled).toBe(false);
  });

  it("enables all users at 100 percent rollout", () => {
    const enabled = isAgentBuilderV2EnabledForUser("0xskip", {
      NEXT_PUBLIC_AGENT_BUILDER_V2: "1",
      NEXT_PUBLIC_AGENT_BUILDER_V2_ROLLOUT_PERCENT: "100",
    });
    expect(enabled).toBe(true);
  });
});
