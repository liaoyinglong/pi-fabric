import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import type { FabricActionDescriptor, FabricProvider } from "../src/protocol.js";

const profilesDescriptor: FabricActionDescriptor = {
  name: "profiles",
  description: "profiles",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  risk: "read",
};
const recurseDescriptor: FabricActionDescriptor = {
  name: "recurse",
  description: "recurse",
  inputSchema: {
    type: "object",
    properties: { profile: { type: "string" }, task: { type: "string" } },
    required: ["profile", "task"],
    additionalProperties: false,
  },
  risk: "agent",
};

const agentsProvider = (): FabricProvider => ({
  name: "agents",
  description: "agent fixture",
  async list() {
    return [profilesDescriptor, recurseDescriptor];
  },
  async describe(name) {
    if (name === "profiles") return profilesDescriptor;
    if (name === "recurse") return recurseDescriptor;
    return undefined;
  },
  async invoke(name, args) {
    if (name === "profiles") {
      return {
        profiles: [{ name: "research", description: "read only" }],
        sources: ["global"],
      };
    }
    if (name === "recurse") {
      return {
        id: "child-1",
        name: String(args.profile),
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
    "dispatches agents.profiles and agents.recurse through %s ExecutionService",
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

      const profiles = await service.execute({
        code: "return agents.profiles({});",
        signal: undefined,
        parentToolCallId: `profiles-${runtime}`,
        context,
        onPartial() {},
      });
      expect(profiles.success).toBe(true);
      expect(profiles.value).toEqual({
        profiles: [{ name: "research", description: "read only" }],
        sources: ["global"],
      });
      expect(profiles.audits.map((audit) => audit.ref)).toEqual(["agents.profiles"]);

      const recurse = await service.execute({
        code: 'return agents.recurse({ profile: "deep", task: "inspect" });',
        signal: undefined,
        parentToolCallId: `recurse-${runtime}`,
        context,
        onPartial() {},
      });
      expect(recurse.success).toBe(true);
      expect(recurse.value).toMatchObject({
        id: "child-1",
        name: "deep",
        status: "completed",
        text: "inspect",
      });
      expect(recurse.audits.map((audit) => audit.ref)).toEqual(["agents.recurse"]);
    },
  );
});
