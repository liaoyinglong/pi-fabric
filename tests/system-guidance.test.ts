import { describe, expect, it } from "vitest";
import { defaultFabricExecutionGuidance } from "../src/core/system-guidance.js";

describe("defaultFabricExecutionGuidance", () => {
  it("advertises only the retained execution surfaces", () => {
    const guidance = defaultFabricExecutionGuidance(true);
    expect(guidance).toContain("pi.*");
    expect(guidance).toContain("extensions.*");
    expect(guidance).toContain("mcp.<server>.<tool>");
    expect(guidance).toContain("Promise.all");
    expect(guidance).toContain("all({...})");
    for (const removed of ["agents.", "workflow", "todo(", "pipeline(", "phase("] as const) {
      expect(guidance).not.toContain(removed);
    }
  });

  it("omits MCP guidance when MCP is disabled", () => {
    const guidance = defaultFabricExecutionGuidance(true, { mcpEnabled: false });
    expect(guidance).not.toContain("mcp.<server>.<tool>");
    expect(guidance).toContain("tools.search");
  });
});
