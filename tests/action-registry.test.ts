import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  ActionRegistry,
  type FabricCallAudit,
} from "../src/core/action-registry.js";
import type {
  FabricInvocationContext,
  FabricProvider,
} from "../src/protocol.js";

const context: FabricInvocationContext = {
  cwd: process.cwd(),
  signal: undefined,
  parentToolCallId: "parent",
  nestedToolCallId: "metadata",
  extensionContext: {} as ExtensionContext,
  update() {},
};

const provider = (): FabricProvider => ({
  name: "demo",
  description: "Demo provider",
  async list() {
    return [{
      name: "echo",
      description: "Echo a string",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      risk: "read",
    }];
  },
  async describe(name) {
    return name === "echo" ? (await this.list({}, context))[0] : undefined;
  },
  async invoke(_name, args, invocationContext) {
    invocationContext.activity?.({ type: "progress", message: "echoing" });
    invocationContext.attachPreview?.({ renderer: "rich" });
    return args.value;
  },
});

const invoke = (
  registry: ActionRegistry,
  ref = "demo.echo",
  args: Record<string, unknown> = { value: "hello" },
  extra: Partial<Parameters<ActionRegistry["invoke"]>[2]> = {},
) => registry.invoke(ref, args, {
  ...context,
  approve: async () => {},
  audits: [],
  maxResultChars: 10_000,
  ...extra,
});

describe("ActionRegistry", () => {
  it("lists, searches, describes, and invokes registered providers", async () => {
    const registry = new ActionRegistry();
    registry.register(provider());
    expect((await registry.list({}, context))[0]?.ref).toBe("demo.echo");
    expect((await registry.search("echo", context))[0]?.ref).toBe("demo.echo");
    expect((await registry.describe("demo.echo", context)).risk).toBe("read");

    const approve = vi.fn(async () => {});
    const audits: FabricCallAudit[] = [];
    const result = await registry.invoke("demo.echo", { value: "hello" }, {
      ...context,
      approve,
      audits,
      maxResultChars: 10_000,
    });
    expect(result).toBe("hello");
    expect(approve).toHaveBeenCalledOnce();
    expect(audits).toMatchObject([{
      ref: "demo.echo",
      provider: "demo",
      tool: "echo",
      args: { value: "hello" },
      success: true,
    }]);
  });

  it("resolves unique bare action names and rejects ambiguous ones", async () => {
    const registry = new ActionRegistry();
    registry.register(provider());
    expect((await registry.describe("echo", context)).ref).toBe("demo.echo");
    registry.register({ ...provider(), name: "demo-two" });
    await expect(registry.describe("echo", context)).rejects.toThrow(
      /qualify with provider\.action: demo-two\.echo, demo\.echo/,
    );
    await expect(registry.describe("missing", context)).rejects.toThrow(
      "Unknown Fabric action: missing",
    );
  });

  it("builds deterministic catalogs and searches descriptor schemas", async () => {
    const registry = new ActionRegistry();
    const descriptors = [{
      name: "inspect",
      description: "Inspect stored records",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Local filesystem path" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      risk: "read" as const,
      namespace: "records",
    }];
    registry.register({
      name: "storage",
      description: "Filesystem discovery capabilities",
      async list() { return descriptors; },
      async describe(name) { return name === "inspect" ? descriptors[0] : undefined; },
      async invoke() { return null; },
    });

    expect((await registry.search("local filesystem path", context))[0]?.ref)
      .toBe("storage.inspect");
    expect((await registry.search("filesystem discovery", context))[0]?.ref)
      .toBe("storage.inspect");

    const first = await registry.catalog(context);
    const second = await registry.catalog(context);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      kind: "pi-fabric.capability-catalog",
      version: 1,
      complete: true,
      totalActions: 1,
      indexedActions: 1,
      providers: [{
        key: "provider:storage",
        actions: [{ ref: "storage.inspect" }],
      }],
    });
    const originalHash = first.root.descriptorHash;
    descriptors[0]!.description = "Inspect archived records";
    expect((await registry.catalog(context)).root.descriptorHash).not.toBe(originalHash);
  });

  it("notifies the execution service when an audited invocation settles", async () => {
    const registry = new ActionRegistry();
    registry.register(provider());
    const ended = vi.fn();
    await invoke(registry, "demo.echo", { value: "ok" }, { onInvocationEnd: ended });
    expect(ended).toHaveBeenCalledOnce();

    registry.register({
      name: "failure",
      description: "Failure provider",
      async list() { return [(await this.describe("run", context))!]; },
      async describe(name) {
        return name === "run"
          ? {
              name,
              description: "Fail",
              inputSchema: { type: "object", additionalProperties: false },
              risk: "execute",
            }
          : undefined;
      },
      async invoke() { throw new Error("boom"); },
    });
    await expect(invoke(registry, "failure.run", {}, { onInvocationEnd: ended }))
      .rejects.toThrow("boom");
    expect(ended).toHaveBeenCalledTimes(2);
  });

  it("populates audit metadata before invoking the provider", async () => {
    const registry = new ActionRegistry();
    const audits: FabricCallAudit[] = [];
    let observed: FabricCallAudit | undefined;
    registry.register({
      ...provider(),
      async invoke(_name, args) {
        observed = audits[0] ? { ...audits[0] } : undefined;
        return args.value;
      },
    });
    await registry.invoke("demo.echo", { value: "in flight" }, {
      ...context,
      approve: async () => {},
      audits,
      maxResultChars: 10_000,
    });
    expect(observed).toMatchObject({
      ref: "demo.echo",
      provider: "demo",
      tool: "echo",
      args: { value: "in flight" },
    });
    expect(observed?.success).toBeUndefined();
  });

  it("keeps a larger bounded content preview for transient writes", async () => {
    const registry = new ActionRegistry();
    const audits: FabricCallAudit[] = [];
    const content = "x".repeat(20_000);
    registry.register({
      name: "pi",
      description: "Pi tools",
      async list() {
        return [{
          name: "write",
          description: "Write a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
            additionalProperties: false,
          },
          risk: "write",
        }];
      },
      async describe(name) { return name === "write" ? (await this.list({}, context))[0] : undefined; },
      async invoke() { return { ok: true }; },
    });
    await registry.invoke("pi.write", { path: "preview.md", content }, {
      ...context,
      approve: async () => {},
      audits,
      maxResultChars: 10_000,
    });
    const preview = audits[0]?.args?.content;
    expect(typeof preview).toBe("string");
    expect((preview as string).length).toBeGreaterThan(2_000);
    expect((preview as string).length).toBeLessThan(content.length);
    expect(preview).toMatch(/…$/);
  });

  it("bounds retained audit previews without shrinking provider results", async () => {
    const registry = new ActionRegistry();
    const large = "x".repeat(20_000);
    registry.register({
      ...provider(),
      async invoke() {
        return Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`field${index}`, large]));
      },
    });
    const audits: FabricCallAudit[] = [];
    const result = (await registry.invoke("demo.echo", { value: "large" }, {
      ...context,
      approve: async () => {},
      audits,
      maxResultChars: 1_000_000,
    })) as Record<string, string>;
    expect(result.field0).toHaveLength(20_000);
    expect(audits[0]?.result).toMatchObject({ fabricTruncated: true });
    expect(JSON.stringify(audits[0]?.result).length).toBeLessThanOrEqual(64_000);
  });

  it("caps nested results before crossing the sandbox bridge", async () => {
    const registry = new ActionRegistry();
    registry.register(provider());
    const audits: FabricCallAudit[] = [];
    const result = await registry.invoke("demo.echo", { value: "x".repeat(100) }, {
      ...context,
      approve: async () => {},
      audits,
      maxResultChars: 40,
    });
    expect(result).toMatchObject({ fabricTruncated: true, originalChars: 102 });
    expect(audits).toMatchObject([{ resultTruncated: true, resultChars: 102 }]);
  });

  it("validates arguments before approval or execution", async () => {
    const registry = new ActionRegistry();
    registry.register(provider());
    const approve = vi.fn(async () => {});
    await expect(registry.invoke("demo.echo", { value: 42 }, {
      ...context,
      approve,
      audits: [],
      maxResultChars: 10_000,
    })).rejects.toThrow("Invalid arguments");
    expect(approve).not.toHaveBeenCalled();
  });

  it("rejects duplicate and malformed provider names", () => {
    const registry = new ActionRegistry();
    registry.register(provider());
    expect(() => registry.register(provider())).toThrow("already registered");
    expect(() => registry.register({ ...provider(), name: "Bad Name" })).toThrow(
      "Invalid Fabric provider name",
    );
  });

  it("keeps unavailable-provider errors for optional execution providers", async () => {
    const registry = new ActionRegistry();
    registry.register(provider());
    registry.markUnavailable("mcp", "disabled by configuration (mcp.enabled=false)");
    expect(registry.unavailableProviders()).toEqual([
      { name: "mcp", reason: "disabled by configuration (mcp.enabled=false)" },
    ]);
    await expect(registry.describe("mcp.github", context)).rejects.toThrow(
      'Fabric provider "mcp" is unavailable: disabled by configuration (mcp.enabled=false)',
    );
    await expect(registry.describe("memry.recall", context)).rejects.toThrow(
      "Unknown Fabric provider: memry (registered providers: demo)",
    );
  });

  it("clears an unavailable mark when the provider registers", async () => {
    const registry = new ActionRegistry();
    registry.markUnavailable("demo", "off");
    registry.register(provider());
    expect(registry.unavailableProviders()).toEqual([]);
    await expect(registry.describe("demo.echo", context)).resolves.toMatchObject({ ref: "demo.echo" });
  });
});
