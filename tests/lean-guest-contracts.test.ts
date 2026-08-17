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
  it("executes canonical agents.profiles through the checked production path", async () => {
    const source = "return agents.profiles({});";
    const checked = typeCheckFabricCode(source, GUEST_TYPE_DECLARATIONS);
    expect(checked.errors).toEqual([]);
    expect(checked.javascript).toContain("agents.profiles");
    expect(checked.javascript).toBeDefined();

    const hostCall = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      expect(ref).toBe("fabric.$call");
      expect(args).toEqual({ ref: "agents.profiles", args: {} });
      return {
        profiles: [{ name: "research", runner: "veda" }],
        sources: ["global"],
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
      profiles: [{ name: "research", runner: "veda" }],
      sources: ["global"],
    });
    expect(hostCall).toHaveBeenCalledTimes(1);
  });

  it("keeps agents.profiles canonical and preserves string literals", () => {
    const source = [
      'const literal = "agents.profiles({})";',
      "const catalog = await agents.profiles({});",
      "return { literal, profiles: catalog.profiles };",
    ].join("\n");
    const transpiled = transpileFabricCodeWithSourceMap(source).code;

    expect(transpiled).toContain('"agents.profiles({})"');
    expect(transpiled).toContain("agents.profiles({})");
  });

  it("executes agents.recurse through the canonical bridge", async () => {
    const source = 'return agents.recurse({ profile: "deep", task: "inspect" });';
    const checked = typeCheckFabricCode(source, GUEST_TYPE_DECLARATIONS);
    expect(checked.errors).toEqual([]);
    expect(checked.javascript).toBeDefined();

    const hostCall = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      expect(ref).toBe("fabric.$call");
      expect(args).toEqual({
        ref: "agents.recurse",
        args: { profile: "deep", task: "inspect" },
      });
      return {
        id: "child-1",
        name: "deep",
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

  it("rejects the recurring wrong agents.profiles return shape", () => {
    const result = typeCheckFabricCode(
      `
const profiles = await agents.profiles({});
const research = profiles.find((p: any) => p.name === "research");
return research.id;
`,
      GUEST_TYPE_DECLARATIONS,
    );

    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) =>
      error.message.includes("Property 'find'") &&
      error.message.includes("FabricSubagentProfileCatalog"),
    )).toBe(true);
  });

  it("rejects profile.id and keeps profile.name as the selector", () => {
    const result = typeCheckFabricCode(
      `
const catalog = await agents.profiles({});
const research = catalog.profiles[0];
return research.id;
`,
      GUEST_TYPE_DECLARATIONS,
    );

    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) =>
      error.message.includes("Property 'id'") &&
      error.message.includes("FabricSubagentRoleInfo"),
    )).toBe(true);
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
