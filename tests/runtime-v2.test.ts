import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodeModeRuntimeV2 } from "../src/runtime-v2.js";

describe("CodeModeRuntimeV2", () => {
  it("executes TypeScript with explicit host capabilities and a bounded result", async () => {
    const calls: Array<{ capability: string; args: Record<string, unknown> }> = [];
    const runtime = new CodeModeRuntimeV2({
      read: async (args) => {
        calls.push({ capability: "read", args });
        return { path: args.path, content: "hello" };
      },
      grep: async (args) => {
        calls.push({ capability: "grep", args });
        return ["src/runtime-v2.ts"];
      },
    });
    const result = await runtime.execute({
      code: `
const paths: string[] = await host.grep({ pattern: "runtime" });
const file = await host.read({ path: paths[0] });
print("read", paths.length);
return { file, suffix: π.suffix };
`,
      strings: { suffix: "!" },
    });
    expect(result.terminationReason).toBe("completed");
    expect(result.error).toBeUndefined();
    expect(result.logs).toEqual(["read 1"]);
    expect(result.value).toEqual({
      file: { path: "src/runtime-v2.ts", content: "hello" },
      suffix: "!",
    });
    expect(calls).toEqual([
      { capability: "grep", args: { pattern: "runtime" } },
      { capability: "read", args: { path: "src/runtime-v2.ts" } },
    ]);
  });

  it("exposes only the small V2 guest surface", async () => {
    const result = await new CodeModeRuntimeV2().execute({
      code: `return {
  host: Object.keys(host).sort(),
  strings: typeof π,
  print: typeof print,
  console: typeof console,
  pi: typeof globalThis.pi,
  tools: typeof globalThis.tools,
  extensions: typeof globalThis.extensions,
  agents: typeof globalThis.agents,
  workflow: typeof globalThis.workflow,
  mcp: typeof globalThis.mcp,
  bridge: typeof globalThis.__codeModeV2HostCall,
};`,
    });
    expect(result.terminationReason).toBe("completed");
    expect(result.value).toEqual({
      host: ["bash", "grep", "mcp", "read"],
      strings: "object",
      print: "function",
      console: "object",
      pi: "undefined",
      tools: "undefined",
      extensions: "undefined",
      agents: "undefined",
      workflow: "undefined",
      mcp: "undefined",
      bridge: "undefined",
    });
  });

  it("fails closed when an explicit capability has no host handler", async () => {
    const result = await new CodeModeRuntimeV2().execute({
      code: 'return host.mcp({ server: "demo", tool: "ping", args: {} });',
    });
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("Code Mode V2 host capability unavailable: mcp");
  });

  it("propagates cancellation into an active host call", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const runtime = new CodeModeRuntimeV2({
      bash: async (_args, signal) => {
        markStarted();
        return await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const execution = runtime.execute({
      code: 'return host.bash({ command: "sleep" });',
      signal: controller.signal,
    });
    await started;
    controller.abort();
    const result = await execution;
    expect(result.terminationReason).toBe("aborted");
    expect(result.error).toBe("Execution cancelled");
  });

  it("keeps the V2 kernel independent from the orchestration stack", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/runtime-v2.ts"),
      "utf8",
    );
    for (const forbidden of [
      "execution-service",
      "action-registry",
      "AgentManager",
      "LeanAgentsProvider",
      "McpProvider",
      "approval-controller",
      "activity/store",
      "audit/trace",
    ]) {
      expect(source, `runtime-v2.ts imports or embeds ${forbidden}`).not.toContain(forbidden);
    }
  });
});
