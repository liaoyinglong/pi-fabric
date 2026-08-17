import { describe, expect, it } from "vitest";
import {
  mapCliTools,
  normalizeCliModel,
  resolveCliAdapter,
} from "../src/agents/cli-adapters.js";

describe("CLI adapters", () => {
  it("maps Fabric tools to Droid's native tool ids", () => {
    expect(mapCliTools("droid", ["read", "grep", "find", "ls", "bash", "edit", "write"])).toEqual([
      "Read",
      "Grep",
      "Glob",
      "LS",
      "Execute",
      "Edit",
      "ApplyPatch",
      "Create",
    ]);
    expect(() => mapCliTools("droid", ["fabric_exec"])).toThrow(/does not support/);
  });

  it("builds Droid exec arguments with a real tool restriction", () => {
    const args = resolveCliAdapter("droid").buildArguments({
      prompt: "review this change",
      model: "droid/claude-sonnet-4-6",
      thinking: "high",
      tools: ["read", "grep", "find", "ls"],
    });
    expect(args).toEqual([
      "exec",
      "--output-format",
      "json",
      "--model",
      "claude-sonnet-4-6",
      "--reasoning-effort",
      "high",
      "--restrict-tools",
      "Read,Grep,Glob,LS",
      "review this change",
    ]);
  });

  it("disables Droid's known tools for an explicit empty allowlist", () => {
    const args = resolveCliAdapter("droid").buildArguments({ prompt: "answer only", tools: [] });
    expect(args).toContain("--disabled-tools");
    expect(args[args.indexOf("--disabled-tools") + 1]).toContain("Execute");
    expect(args).not.toContain("--restrict-tools");
  });

  it("selects Droid autonomy only when the requested tools need it", () => {
    expect(resolveCliAdapter("droid").buildArguments({ prompt: "edit", tools: ["edit"] })).toContain("low");
    expect(resolveCliAdapter("droid").buildArguments({ prompt: "run", tools: ["bash"] })).toContain("medium");
    expect(resolveCliAdapter("droid").buildArguments({ prompt: "read", tools: ["read"] })).not.toContain("--auto");
  });

  it("parses Droid's JSON result envelope", () => {
    const result = resolveCliAdapter("droid").parseOutput(JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 2,
      result: "looks good",
      session_id: "session-1",
      total_cost_usd: 0.04,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 3,
      },
    }));
    expect(result).toMatchObject({
      text: "looks good",
      turns: 2,
      sessionId: "session-1",
      usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 3, cost: 0.04 },
    });
  });

  it("builds Agy headless arguments without bypassing its permission policy", () => {
    const args = resolveCliAdapter("agy").buildArguments({
      prompt: "research routers",
      model: "agy/gemini-3.7-flash",
      thinking: "low",
      tools: ["read", "grep", "find", "ls"],
    });
    expect(args.slice(0, 4)).toEqual(["--model", "gemini-3.7-flash", "--effort", "low"]);
    expect(args).toContain("-p");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args.at(-1)).toContain("Fabric requested this tool allowlist: read, grep, find, ls");
    expect(args.at(-1)).toContain("research routers");
  });

  it("keeps Agy tool policy explicit and rejects unknown Fabric tools", () => {
    expect(mapCliTools("agy", ["read", "grep", "find", "ls"])).toEqual(["read", "grep", "find", "ls"]);
    expect(() => mapCliTools("agy", ["fabric_exec"])).toThrow(/does not support/);
  });

  it("normalizes adapter-prefixed model ids", () => {
    expect(normalizeCliModel("agy", "agy/gemini-3.7-flash")).toBe("gemini-3.7-flash");
    expect(normalizeCliModel("droid", "droid/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(() => normalizeCliModel("agy", "  ")).toThrow();
  });
});
