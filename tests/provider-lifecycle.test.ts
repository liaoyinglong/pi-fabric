import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
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

const provider = (
  value: string,
  options: { close?: () => void | Promise<void>; wait?: Promise<void> } = {},
): FabricProvider => ({
  name: "demo",
  description: `Demo ${value}`,
  async list() {
    return [await this.describe("echo", context)].filter((entry) => entry !== undefined);
  },
  async describe(name) {
    return name === "echo"
      ? {
          name: "echo",
          description: `Echo ${value}`,
          inputSchema: { type: "object", additionalProperties: false },
          risk: "read",
          effect: { kind: "none", resources: [`demo:${value}`], ordering: "commutative" },
        }
      : undefined;
  },
  async invoke() {
    await options.wait;
    return value;
  },
  async close() {
    await options.close?.();
  },
});

const invoke = (
  registry: ActionRegistry,
  invocationContext: FabricInvocationContext = context,
): Promise<unknown> => registry.invoke("demo.echo", {}, {
  ...invocationContext,
  approve: async () => {},
  audits: [],
  maxResultChars: 10_000,
});

describe("provider lifecycle and capability views", () => {
  it("pins committed actions to the registered provider and rejects descriptor drift", async () => {
    const registry = new ActionRegistry();
    let description = "before";
    registry.register({
      ...provider("value"),
      async describe(name) {
        return name === "echo"
          ? {
              name: "echo",
              description,
              inputSchema: { type: "object", additionalProperties: false },
              risk: "read",
            }
          : undefined;
      },
    });

    const pinned = await registry.acquireCapabilityView(["demo.echo"], context);
    expect(pinned.satisfied).toBe(true);
    expect(pinned.view?.bindings["demo.echo"]).toMatchObject({
      provider: "demo",
      generation: 1,
      providerBindingId: expect.any(String),
      descriptorHash: expect.any(String),
    });
    await expect(registry.describe("demo.uncommitted", {
      ...context,
      capabilityView: pinned.view!,
    })).rejects.toThrow("outside the committed view");
    expect(await invoke(registry, { ...context, capabilityView: pinned.view! })).toBe("value");

    description = "after";
    await expect(invoke(registry, { ...context, capabilityView: pinned.view! }))
      .rejects.toThrow("Fabric capability descriptor changed: demo.echo");
    await pinned.release();
    await registry.close();
  });

  it("records overlapping effect footprints and enforces strict policy", async () => {
    const registry = new ActionRegistry();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const active = new Promise<void>((resolve) => { started = resolve; });
    registry.register({
      name: "effects",
      description: "Effect conflicts",
      async list() { return []; },
      async describe(name) {
        if (!["first", "second", "distinct"].includes(name)) return undefined;
        return {
          name,
          description: name,
          inputSchema: { type: "object", additionalProperties: false },
          risk: "write",
          effect: {
            kind: "transactional",
            resources: [name === "distinct" ? "workspace:b" : "workspace:a"],
            ordering: "ordered",
          },
        };
      },
      async invoke(name) {
        if (name === "first") {
          started();
          await gate;
        }
        return name;
      },
    });
    const call = (
      name: string,
      effectPolicy: "advisory" | "strict",
      audits: Parameters<ActionRegistry["invoke"]>[2]["audits"] = [],
    ) => registry.invoke(`effects.${name}`, {}, {
      ...context,
      effectPolicy,
      approve: async () => {},
      audits,
      maxResultChars: 10_000,
    });

    const first = call("first", "advisory");
    await active;
    const advisoryAudits: Parameters<ActionRegistry["invoke"]>[2]["audits"] = [];
    await expect(call("second", "advisory", advisoryAudits)).resolves.toBe("second");
    expect(advisoryAudits[0]?.effectConflicts).toEqual([{
      withRef: "effects.first",
      resources: ["workspace:a"],
      reason: "shared_resource",
    }]);
    await expect(call("second", "strict")).rejects.toThrow("Fabric effect conflict");
    await expect(call("distinct", "strict")).resolves.toBe("distinct");
    release();
    await first;
    await registry.close();
  });

  it("allows explicitly commutative calls on the same resource", async () => {
    const registry = new ActionRegistry();
    let release!: () => void;
    let started!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const active = new Promise<void>((resolve) => { started = resolve; });
    registry.register({
      name: "commute",
      description: "Commutative effects",
      async list() { return []; },
      async describe(name) {
        return name === "write"
          ? {
              name,
              description: name,
              inputSchema: { type: "object", additionalProperties: false },
              risk: "write",
              effect: {
                kind: "transactional",
                resources: ["workspace:a"],
                ordering: "commutative",
              },
            }
          : undefined;
      },
      async invoke() {
        calls++;
        if (calls === 1) {
          started();
          await gate;
        }
        return calls;
      },
    });
    const invokeCommutative = () => registry.invoke("commute.write", {}, {
      ...context,
      effectPolicy: "strict",
      approve: async () => {},
      audits: [],
      maxResultChars: 10_000,
    });

    const first = invokeCommutative();
    await active;
    await expect(invokeCommutative()).resolves.toBe(2);
    release();
    await first;
    await registry.close();
  });

  it("rejects scoped provider effects because Lean has no acquisition runtime", async () => {
    const registry = new ActionRegistry();
    registry.register({
      name: "lease",
      description: "Scoped lease",
      async list() { return []; },
      async describe(name) {
        return name === "open"
          ? {
              name,
              description: "Open a lease",
              inputSchema: { type: "object", additionalProperties: false },
              risk: "execute",
              effect: { kind: "scoped", resources: ["lease:key"], ordering: "ordered" },
            }
          : undefined;
      },
      async invoke() { return "unexpected"; },
    });
    await expect(registry.invoke("lease.open", {}, {
      ...context,
      approve: async () => {},
      audits: [],
      maxResultChars: 10_000,
    })).rejects.toThrow("unsupported by the Lean execution runtime");
  });

  it("owns provider shutdown exactly once", async () => {
    const registry = new ActionRegistry();
    const closed = vi.fn(async () => {});
    registry.register(provider("value", { close: closed }));
    await registry.close();
    await registry.close();
    expect(closed).toHaveBeenCalledOnce();
    expect(registry.providers()).toEqual([]);
  });
});
