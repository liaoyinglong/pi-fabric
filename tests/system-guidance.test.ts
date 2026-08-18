import { describe, expect, it } from "vitest";
import { defaultFabricExecutionGuidance } from "../src/core/system-guidance.js";

describe("defaultFabricExecutionGuidance", () => {
  it("steers staged subagent review toward existing evidence", () => {
    const guidance = defaultFabricExecutionGuidance(true, { agentsEnabled: true });

    expect(guidance).toContain(
      "Reuse prior child findings and referenced evidence before rereading repository context.",
    );
    expect(guidance).toContain(
      "Do not ask a strong reviewer to independently retrace the full original research scope by default",
    );
    expect(guidance).toContain("inspect additional repository context only to close concrete evidence gaps");
    expect(guidance).toContain("evidence-preserving synthesis");
  });

  it("does not inject subagent review guidance when agents are disabled", () => {
    const guidance = defaultFabricExecutionGuidance(true, { agentsEnabled: false });

    expect(guidance).not.toContain("Reuse prior child findings");
    expect(guidance).toContain("One-shot agents and agent-backed workflow delegation are disabled");
  });
});
