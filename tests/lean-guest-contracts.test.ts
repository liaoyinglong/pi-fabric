import { describe, expect, it } from "vitest";
import { GUEST_TYPE_DECLARATIONS } from "../src/runtime/guest-types.js";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const runtimeOptions = {
  timeoutMs: 5_000,
  memoryLimitBytes: 32 * 1024 * 1024,
};

describe("Lean guest contract alignment", () => {
  it.each(["agents", "workflow", "agent", "parallel", "pipeline", "phase", "budget", "all"])(
    "does not type %s as a Fabric guest global",
    (name) => {
      const result = typeCheckFabricCode(`return ${name};`, GUEST_TYPE_DECLARATIONS);
      expect(result.javascript).toBeUndefined();
      expect(result.errors.some((error) => error.message.includes(`Cannot find name '${name}'`))).toBe(true);
    },
  );

  it("removes historical orchestration globals before author code executes", async () => {
    const result = await new QuickJsRuntime().execute(
      `return {
  agents: typeof globalThis.agents,
  workflow: typeof globalThis.workflow,
  agent: typeof globalThis.agent,
  parallel: typeof globalThis.parallel,
  pipeline: typeof globalThis.pipeline,
  phase: typeof globalThis.phase,
  budget: typeof globalThis.budget,
  all: typeof globalThis.all,
};`,
      async () => undefined,
      runtimeOptions,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      agents: "undefined",
      workflow: "undefined",
      agent: "undefined",
      parallel: "undefined",
      pipeline: "undefined",
      phase: "undefined",
      budget: "undefined",
      all: "undefined",
    });
  });

  it("keeps only execution globals", async () => {
    const result = await new QuickJsRuntime().execute(
      `return {
  tools: typeof tools,
  pi: typeof pi,
  extensions: typeof extensions,
  mcp: typeof mcp,
  print: typeof print,
  console: typeof console,
};`,
      async () => undefined,
      runtimeOptions,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      tools: "object",
      pi: "object",
      extensions: "object",
      mcp: "object",
      print: "function",
      console: "object",
    });
  });

  it("does not declare the host model registry on the tools API", () => {
    expect(GUEST_TYPE_DECLARATIONS).not.toContain("models():");
    expect(GUEST_TYPE_DECLARATIONS).not.toContain("FabricModelInfo");
  });

  it("rejects object-style properties on stable Pi string results before runtime", () => {
    const result = typeCheckFabricCode(
      `
const content = await pi.read({ path: "README.md" });
const files = await pi.find({ pattern: "*", path: "." });
return { content: content.content, matches: files.matches };
`,
      GUEST_TYPE_DECLARATIONS,
    );

    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) =>
      error.message.includes("Property 'content'") && error.message.includes("type 'string'"),
    )).toBe(true);
    expect(result.errors.some((error) =>
      error.message.includes("Property 'matches'") && error.message.includes("type 'string'"),
    )).toBe(true);
  });
});
