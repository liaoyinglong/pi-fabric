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
  it("executes canonical agents.profiles through the legacy runtime alias", async () => {
    const hostCall = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      expect(ref).toBe("agents.roles");
      expect(args).toEqual({});
      return {
        profiles: [{ name: "research", runner: "veda" }],
        sources: ["global"],
      };
    });

    const result = await new QuickJsRuntime().execute(
      "return agents.profiles({});",
      hostCall,
      runtimeOptions,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      profiles: [{ name: "research", runner: "veda" }],
      sources: ["global"],
    });
    expect(hostCall).toHaveBeenCalledTimes(1);
  });

  it("lowers only real agents.profiles calls and preserves source offsets", () => {
    const source = [
      'const literal = "agents.profiles({})";',
      "const profiles = await agents.profiles({});",
      "return { literal, profiles };",
    ].join("\n");
    const transpiled = transpileFabricCodeWithSourceMap(source).code;

    expect(transpiled).toContain('"agents.profiles({})"');
    expect(transpiled).toContain("agents.roles");
    expect(transpiled).not.toContain("await agents.profiles");
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
