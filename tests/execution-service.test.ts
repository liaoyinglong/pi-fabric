import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { FabricAutoApprovalClassifier } from "../src/core/auto-approval-classifier.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { PiToolsProvider } from "../src/providers/pi-tools-provider.js";
import type { FabricActionDescriptor, FabricProvider } from "../src/protocol.js";

const context = (cwd = process.cwd()): ExtensionContext => ({ cwd, hasUI: false } as ExtensionContext);

describe("FabricExecutionService", () => {
  it("runs Pi core tools from sandboxed TypeScript", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-execution-"));
    try {
      fs.writeFileSync(path.join(cwd, "sample.txt"), "fabric works\n", "utf8");
      const registry = new ActionRegistry();
      registry.register(new PiToolsProvider(cwd, undefined, undefined));
      const config = structuredClone(DEFAULT_FABRIC_CONFIG);
      config.approvals.read = "allow";
      const result = await new FabricExecutionService(registry, config).execute({
        code: 'const content = await pi.read({ path: "sample.txt" }); return content.trim();',
        signal: undefined,
        parentToolCallId: "read-test",
        context: context(cwd),
        onPartial() {},
      });
      expect(result.success).toBe(true);
      expect(result.value).toBe("fabric works");
      expect(result.audits[0]).toMatchObject({ ref: "pi.read", success: true });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each(["quickjs", "node-process"] as const)(
    "waits for every nested write in the %s executor",
    async (runtime) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-nested-"));
      try {
        const registry = new ActionRegistry();
        registry.register(new PiToolsProvider(cwd, undefined, undefined));
        const config = structuredClone(DEFAULT_FABRIC_CONFIG);
        config.executor.runtime = runtime;
        if (runtime === "node-process") config.executor.memoryLimitBytes = 128 * 1024 * 1024;
        config.approvals.write = "allow";
        const result = await new FabricExecutionService(registry, config).execute({
          code: `await Promise.all([
  pi.write({ path: "one.txt", content: "one" }),
  pi.write({ path: "two.txt", content: "two" }),
]); return "done";`,
          signal: undefined,
          parentToolCallId: `nested-${runtime}`,
          context: context(cwd),
          onPartial() {},
        });
        expect(result.success).toBe(true);
        expect(result.value).toBe("done");
        expect(result.audits).toHaveLength(2);
        expect(fs.readdirSync(cwd).sort()).toEqual(["one.txt", "two.txt"]);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it("extends the outer deadline from an explicit pi.bash timeout", async () => {
    const registry = new ActionRegistry();
    const descriptor: FabricActionDescriptor = {
      name: "bash",
      description: "fake slow bash",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" }, timeout: { type: "number" } },
        required: ["command"],
        additionalProperties: true,
      },
      risk: "read",
    };
    registry.register({
      name: "pi",
      description: "fake pi",
      async list() { return [descriptor]; },
      async describe(name) { return name === "bash" ? descriptor : undefined; },
      async invoke() { return new Promise((resolve) => setTimeout(() => resolve({ ok: true, output: "ok", details: {} }), 150)); },
    });
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.executor.timeoutMs = 50;
    config.approvals.read = "allow";
    const result = await new FabricExecutionService(registry, config).execute({
      code: 'await pi.bash({ command: "slow", timeout: 1 }); return "ok";',
      signal: undefined,
      parentToolCallId: "bash-timeout",
      context: context(),
      onPartial() {},
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe("ok");
  });

  it("keeps the configured executor deadline for ordinary provider calls", async () => {
    const registry = new ActionRegistry();
    const descriptor: FabricActionDescriptor = {
      name: "slow",
      description: "slow call",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      risk: "read",
    };
    registry.register({
      name: "demo",
      description: "demo provider",
      async list() { return [descriptor]; },
      async describe(name) { return name === "slow" ? descriptor : undefined; },
      async invoke(_name, _args, invocation) {
        return new Promise((_resolve, reject) => {
          invocation.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    });
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.fullCodeMode = false;
    config.executor.timeoutMs = 50;
    config.approvals.read = "allow";
    const result = await new FabricExecutionService(registry, config).execute({
      code: 'return tools.call({ ref: "demo.slow" });',
      signal: undefined,
      parentToolCallId: "ordinary-timeout",
      context: context(),
      onPartial() {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("audits auto approvals and accounts for classifier usage", async () => {
    const registry = new ActionRegistry();
    const descriptor: FabricActionDescriptor = {
      name: "mutate",
      description: "mutate one value",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      risk: "write",
    };
    const invoke = vi.fn(async (_name: string, args: Record<string, unknown>) => args);
    registry.register({
      name: "demo",
      description: "demo provider",
      async list() { return [descriptor]; },
      async describe(name) { return name === "mutate" ? descriptor : undefined; },
      invoke,
    });
    const usage = {
      input: 20,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 25,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    };
    const classifier = {
      classify: vi.fn(async () => ({
        decision: "allow" as const,
        reason: "Bounded task-aligned mutation",
        model: "anthropic/classifier",
        usage,
      })),
    } as unknown as FabricAutoApprovalClassifier;
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.fullCodeMode = false;
    config.approvals.write = "auto";
    const result = await new FabricExecutionService(
      registry,
      config,
      undefined,
      undefined,
      classifier,
    ).execute({
      code: 'return tools.call({ ref: "demo.mutate", args: { value: "next" } });',
      signal: undefined,
      parentToolCallId: "auto-approval",
      context: context(),
      onPartial() {},
    });
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(result.usage).toEqual(usage);
    expect(result.trace.operations).toContainEqual(expect.objectContaining({ ref: "fabric.approval.auto" }));
  });
});

describe("FabricExecutionService dynamic guest typing", () => {
  const descriptor: FabricActionDescriptor = {
    name: "github.get_repo",
    description: "Get a GitHub repository",
    inputSchema: {
      type: "object",
      properties: { owner: { type: "string" }, repo: { type: "string" } },
      required: ["owner", "repo"],
      additionalProperties: false,
    },
    risk: "network",
    namespace: "github",
  };
  const provider: FabricProvider & { sliceDescriptors: () => FabricActionDescriptor[] } = {
    name: "mcp",
    description: "Mock MCP provider",
    async list() { return [descriptor]; },
    async describe(name) { return name === descriptor.name ? descriptor : undefined; },
    async invoke(_name, args) { return { mirrored: args }; },
    sliceDescriptors: () => [descriptor],
  };

  it("rejects argument-shape mistakes before executing known MCP tools", async () => {
    const registry = new ActionRegistry();
    registry.register(provider);
    const result = await new FabricExecutionService(
      registry,
      structuredClone(DEFAULT_FABRIC_CONFIG),
    ).execute({
      code: 'return mcp.github.get_repo({ owner: "octo", repo: "hello", branchs: "main" });',
      signal: undefined,
      parentToolCallId: "typed-mcp",
      context: context(),
      onPartial() {},
    });
    expect(result.success).toBe(false);
    expect(result.audits).toEqual([]);
    expect(result.typeErrors?.map((error) => error.message).join(" ")).toMatch(/branchs|known properties/);
  });
});
