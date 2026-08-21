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
    expect(guidance).toContain("Promise.all");
    expect(guidance).toContain("tools.call({ref,args})");
    expect(guidance).toContain("one object");
    expect(guidance).toContain("not cwd");
    expect(guidance).toContain("settle: true");
    expect(guidance).toContain("no patch or two-argument form");
    expect(guidance).toContain("π.key");
  });

  it("routes unpredictable or data-heavy output through code mode", () => {
    const tool = createLeanFabricExecTool({} as LeanFabricRuntime);
    const guidance = (tool.promptGuidelines ?? []).join("\n");

    expect(tool.description).toContain("large or unpredictable");
    expect(guidance).toContain("output size/shape is unknown or potentially large");
    expect(guidance).toContain("filter, count, aggregate, parse, compare, or transform");
    expect(guidance).toContain("smallest bounded evidence");
    expect(guidance).toContain("do not forward raw logs");
  });

  it("tells the model to reduce shell and discovery output before returning", () => {
    const tool = createLeanFabricExecTool({} as LeanFabricRuntime);
    const guidance = (tool.promptGuidelines ?? []).join("\n");

    expect(guidance).toContain("Treat shell stdout as data to reduce before returning");
    expect(guidance).toContain("selected lines, counts, fields, or summaries");
    expect(guidance).toContain("tools.search({query, limit:5})");
    expect(guidance).toContain("schema-light summaries");
  });
});
