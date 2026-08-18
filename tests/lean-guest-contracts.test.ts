import { describe, expect, it, vi } from "vitest";
import { GUEST_TYPE_DECLARATIONS } from "../src/runtime/guest-types.js";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";
import {
  transpileFabricCodeWithSourceMap,
  typeCheckFabricCode,
} from "../src/runtime/type-checker.js";

const runtimeOptions = {
  timeoutMs: 5_000,
  memoryLimitBytes: 32 * 1024 * 1024,
};

describe("Lean guest contract alignment", () => {
  it("executes canonical agents.routing through the checked production path", async () => {
    const source = "return agents.routing({});";
    const checked = typeCheckFabricCode(source, GUEST_TYPE_DECLARATIONS);
    expect(checked.errors).toEqual([]);
    expect(checked.javascript).toContain("agents.routing");
    expect(checked.javascript).toBeDefined();

    const hostCall = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      expect(ref).toBe("fabric.$call");
      expect(args).toEqual({ ref: "agents.routing", args: {} });
      return {
        tiers: [
          { name: "fast", description: "cheap evidence" },
          { name: "balance", description: "routine work" },
          { name: "strong", description: "difficult reasoning" },
        ],
        policies: [
          { name: "inspect", description: "read only", tools: ["read"], worktree: false },
        ],
        sources: ["built-in"],
      };
    });

    const result = await new QuickJsRuntime().execute(
      source,
      hostCall,
      {
        ...runtimeOptions,
        transpiledCode: checked.javascript!,
        ...(checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {}),
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      tiers: [
        { name: "fast", description: "cheap evidence" },
        { name: "balance", description: "routine work" },
        { name: "strong", description: "difficult reasoning" },
      ],
      policies: [
        { name: "inspect", description: "read only", tools: ["read"], worktree: false },
      ],
      sources: ["built-in"],
    });
    expect(hostCall).toHaveBeenCalledTimes(1);
  });

  it("keeps agents.routing canonical and preserves string literals", () => {
    const source = [
      'const literal = "agents.routing({})";',
      "const catalog = await agents.routing({});",
      "return { literal, tiers: catalog.tiers };",
    ].join("\n");
    const transpiled = transpileFabricCodeWithSourceMap(source).code;

    expect(transpiled).toContain('"agents.routing({})"');
    expect(transpiled).toContain("agents.routing({})");
  });

  it("executes agents.recurse through the tier/policy bridge", async () => {
    const source = 'return agents.recurse({ tier: "strong", policy: "inspect", role: "decomposer", task: "inspect" });';
    const checked = typeCheckFabricCode(source, GUEST_TYPE_DECLARATIONS);
    expect(checked.errors).toEqual([]);
    expect(checked.javascript).toBeDefined();

    const hostCall = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      expect(ref).toBe("fabric.$call");
      expect(args).toEqual({
        ref: "agents.recurse",
        args: { tier: "strong", policy: "inspect", role: "decomposer", task: "inspect" },
      });
      return {
        id: "child-1",
        name: "decomposer",
        status: "completed",
        text: "done",
        turns: 1,
        toolCalls: 1,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 },
      };
    });

    const result = await new QuickJsRuntime().execute(source, hostCall, {
      ...runtimeOptions,
      transpiledCode: checked.javascript!,
      ...(checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {}),
    });

    expect(result.error).toBeUndefined();
    expect((result.value as { status?: string }).status).toBe("completed");
  });

  it("rejects removed agents.profiles calls in the model-facing contract", () => {
    const result = typeCheckFabricCode(
      "return agents.profiles({});",
      GUEST_TYPE_DECLARATIONS,
    );

    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) =>
      error.message.includes("Property 'profiles'") && error.message.includes("FabricAgentsApi"),
    )).toBe(true);
  });

  it("types routing catalog tier and policy semantics", () => {
    const result = typeCheckFabricCode(
      `
const catalog = await agents.routing({});
const fast = catalog.tiers.find((tier) => tier.name === "fast");
const inspect = catalog.policies.find((policy) => policy.name === "inspect");
return { fast: fast?.description, tools: inspect?.tools, worktree: inspect?.worktree };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects object-style properties on stable Pi string results before runtime", () => {
    const result = typeCheckFabricCode(
      `
const skill = await pi.read({ path: "SKILL.md" });
const files = await pi.find({ pattern: "*", path: "." });
const pkg = await pi.read({ path: "package.json" });
return {
  skill: skill.content,
  matches: files.matches,
  pkg: pkg?.content,
};
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

  it("keeps intentionally-wide agent union property access compatible", () => {
    const result = typeCheckFabricCode(
      `
const status = await agents.status({ id: "worker-1" });
return { error: status.error, text: status.text, value: status.value, logFile: status.logFile };
`,
      GUEST_TYPE_DECLARATIONS,
    );

    expect(result.errors).toEqual([]);
  });
});
