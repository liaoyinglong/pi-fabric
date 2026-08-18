import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import type { FabricActionDescriptor, FabricProvider } from "../src/protocol.js";

const routingDescriptor: FabricActionDescriptor = {
  name: "routing",
  description: "routing",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  risk: "read",
};
const recurseDescriptor: FabricActionDescriptor = {
  name: "recurse",
  description: "recurse",
  inputSchema: {
    type: "object",
    properties: {
      tier: { type: "string", enum: ["fast", "balance", "strong"] },
      policy: { type: "string", enum: ["inspect", "execute", "modify", "isolated"] },
      role: { type: "string" },
      task: { type: "string" },
    },
    required: ["tier", "policy", "task"],
    additionalProperties: false,
  },
  risk: "agent",
};

const agentsProvider = (): FabricProvider => ({
  name: "agents",
  description: "agent fixture",
  async list() {
    return [routingDescriptor, recurseDescriptor];
  },
  async describe(name) {
    if (name === "routing") return routingDescriptor;
    if (name === "recurse") return recurseDescriptor;
    return undefined;
  },
  async invoke(name, args) {
    if (name === "routing") {
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
    }
    if (name === "recurse") {
      return {
        id: "child-1",
        name: String(args.role ?? `${args.tier}:${args.policy}`),
        status: "completed",
        text: String(args.task),
        turns: 1,
        toolCalls: 0,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 },
      };
    }
    throw new Error(`unexpected action ${name}`);
  },
});

describe("canonical agents guest execution", () => {
  it.each(["quickjs", "node-process"] as const)(
    "dispatches agents.routing and tier/policy recurse through %s ExecutionService",
    async (runtime) => {
      const registry = new ActionRegistry();
      registry.register(agentsProvider());
      const config = structuredClone(DEFAULT_FABRIC_CONFIG);
      config.executor.runtime = runtime;
      if (runtime === "node-process") config.executor.memoryLimitBytes = 128 * 1024 * 1024;
      config.approvals.read = "allow";
      config.approvals.agent = "allow";
      const service = new FabricExecutionService(registry, config);
      const context = { cwd: process.cwd(), hasUI: false } as ExtensionContext;

      const routing = await service.execute({
        code: "return agents.routing({});",
        signal: undefined,
        parentToolCallId: `routing-${runtime}`,
        context,
        onPartial() {},
      });
      expect(routing.success).toBe(true);
      expect(routing.value).toEqual({
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
      expect(routing.audits.map((audit) => audit.ref)).toEqual(["agents.routing"]);

      const recurse = await service.execute({
        code: 'return agents.recurse({ tier: "strong", policy: "inspect", role: "decomposer", task: "inspect" });',
        signal: undefined,
        parentToolCallId: `recurse-${runtime}`,
        context,
        onPartial() {},
      });
      expect(recurse.success).toBe(true);
      expect(recurse.value).toMatchObject({
        id: "child-1",
        name: "decomposer",
        status: "completed",
        text: "inspect",
      });
      expect(recurse.audits.map((audit) => audit.ref)).toEqual(["agents.recurse"]);
    },
  );
});
