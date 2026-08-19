import { describe, expect, it } from "vitest";
import { createLeanFabricExecTool } from "../src/lean-exec-tool.js";
import type { LeanFabricRuntime } from "../src/lean-runtime.js";

describe("fabric_exec prompt contract", () => {
  it("keeps the minimum first-call ABI on the active tool", () => {
    const tool = createLeanFabricExecTool({} as LeanFabricRuntime);
    const guidance = (tool.promptGuidelines ?? []).join("\n");

    expect(guidance).toContain("pi.read");
    expect(guidance).toContain("pi.bash");
    expect(guidance).toContain("return strings");
    expect(guidance).toContain("process and require are unavailable");
    expect(guidance).toContain("tools.search");
    expect(guidance).toContain("Promise.all");
  });
});
