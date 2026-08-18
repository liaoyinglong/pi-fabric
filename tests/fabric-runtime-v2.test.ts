import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricRuntimeV2HostAdapter } from "../src/fabric-runtime-v2.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../src/protocol.js";

const descriptor = (
  name: string,
  options: Partial<FabricActionDescriptor> = {},
): FabricActionDescriptor => ({
  name,
  description: options.description ?? name,
  inputSchema: options.inputSchema ?? { type: "object", additionalProperties: true },
  risk: options.risk ?? "read",
  ...(options.namespace ? { namespace: options.namespace } : {}),
});

const provider = (
  name: string,
  descriptors: FabricActionDescriptor[],
  invoke: (action: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
): FabricProvider => ({
  name,
  description: `${name} test provider`,
  async list(request: FabricProviderListRequest) {
    return descriptors.filter((entry) =>
      (!request.namespace || entry.namespace === request.namespace) &&
      (!request.query || `${entry.name} ${entry.description}`.toLowerCase().includes(request.query.toLowerCase()))
    ).slice(0, request.limit ?? descriptors.length);
  },
  async describe(actionName: string) {
    return descriptors.find((entry) => entry.name === actionName);
  },
  async invoke(actionName: string, args: Record<string, unknown>, _context: FabricInvocationContext) {
    return invoke(actionName, args);
  },
});

const extensionContext = (): ExtensionContext => ({
  cwd: "/tmp/pi-fabric-v2",
  isProjectTrusted: () => true,
  modelRegistry: {
    getAvailable: () => [
      { provider: "test", id: "fast", name: "Fast" },
      { provider: "test", id: "strong", name: "Strong" },
    ],
  },
} as unknown as ExtensionContext);

const testRegistry = (): ActionRegistry => {
  const registry = new ActionRegistry();
  registry.register(provider("pi", [
    descriptor("read"),
    descriptor("grep"),
    descriptor("bash", { risk: "execute" }),
  ], async (action, args) => {
    if (action === "read") return `read:${String(args.path)}`;
    if (action === "grep") return `grep:${String(args.pattern)}`;
    if (action === "bash") return { ok: true, output: `bash:${String(args.command)}`, details: null };
    throw new Error(`unknown pi action: ${action}`);
  }));
  registry.register(provider("extensions", [descriptor("echo")], async (_action, args) => ({
    text: String(args.value),
  })));
  registry.register(provider("mcp", [
    descriptor("$servers", { namespace: "management" }),
    descriptor("$call", { namespace: "management", risk: "network" }),
    descriptor("demo.ping", {
      namespace: "demo",
      risk: "network",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
    }),
  ], async (action, args) => {
    if (action === "$servers") return [{ name: "demo", description: "demo server", transport: "stdio" }];
    if (action === "$call") return { text: `${String(args.server)}:${String(args.tool)}` };
    if (action === "demo.ping") return { text: `pong:${String(args.value)}` };
    throw new Error(`unknown mcp action: ${action}`);
  }));
  registry.register(provider("agents", [
    descriptor("run", { risk: "agent" }),
    descriptor("spawn", { risk: "agent" }),
    descriptor("recurse", { risk: "agent" }),
    descriptor("routing"),
  ], async (action, args) => {
    if (action === "routing") return { tiers: ["fast", "balance", "strong"], policies: ["inspect", "execute", "modify", "isolated"] };
    if (action === "spawn") return { id: "spawned", status: "running" };
    if (action === "run" || action === "recurse") {
      return {
        id: action,
        status: "completed",
        text: `agent:${String(args.task)}`,
        usage: { input: 10, output: 5 },
      };
    }
    throw new Error(`unknown agents action: ${action}`);
  }));
  return registry;
};

describe("FabricRuntimeV2HostAdapter", () => {
  it("restores Pi, extensions, MCP discovery/invocation, agents, and workflow above the kernel", async () => {
    const runtime = new FabricRuntimeV2HostAdapter(testRegistry(), { timeoutMs: 10_000 });
    const result = await runtime.execute({
      parentToolCallId: "call-v2",
      context: extensionContext(),
      tokenBudget: 100,
      code: `
const read = await pi.read("README.md");
const grep = await pi.grep("RuntimeV2", { path: "src" });
const ext = await extensions.echo({ value: "extension-ok" });
const servers = await mcp.servers();
const mcpTools = await mcp.tools("demo");
const ping = await mcp.demo.ping({ value: "hello" });
const routing = await agents.routing();
const child = await agents.run({ tier: "fast", policy: "inspect", task: "inspect runtime" });
const parallelResult = await parallel([
  () => Promise.resolve("left"),
  () => Promise.resolve("right"),
]);
const workflowChild = await agent("workflow check", { tier: "fast", policy: "inspect" });
await phase("verify");
return {
  read,
  grep,
  ext,
  servers,
  mcpTools,
  ping,
  routing,
  child: child.text,
  parallelResult,
  workflowChild,
  host: typeof globalThis.host,
  budgetSpent: budget.spent(),
};
`,
    });

    expect(result.terminationReason).toBe("completed");
    expect(result.error).toBeUndefined();
    expect(result.phases).toEqual(["verify"]);
    expect(result.value).toMatchObject({
      read: "read:README.md",
      grep: "grep:RuntimeV2",
      ext: { text: "extension-ok" },
      servers: [{ name: "demo" }],
      ping: { text: "pong:hello" },
      child: "agent:inspect runtime",
      parallelResult: ["left", "right"],
      workflowChild: "agent:workflow check",
      host: "undefined",
      budgetSpent: 15,
    });
    expect((result.value as any).routing.tiers).toEqual(["fast", "balance", "strong"]);
    expect((result.value as any).mcpTools[0]).toMatchObject({
      ref: "mcp.demo.ping",
      namespace: "demo",
      inputSchema: {
        required: ["value"],
      },
    });
    expect(result.audits.map((audit) => audit.ref)).toEqual(expect.arrayContaining([
      "pi.read",
      "pi.grep",
      "extensions.echo",
      "mcp.$servers",
      "mcp.demo.ping",
      "agents.routing",
      "agents.run",
    ]));
  });

  it("keeps agent-call budgeting above the kernel", async () => {
    const runtime = new FabricRuntimeV2HostAdapter(testRegistry(), {
      timeoutMs: 10_000,
      maxAgentCalls: 1,
    });
    const result = await runtime.execute({
      parentToolCallId: "agent-budget",
      context: extensionContext(),
      code: `
await agents.run({ tier: "fast", policy: "inspect", task: "one" });
return agents.run({ tier: "fast", policy: "inspect", task: "two" });
`,
    });
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("Fabric agent budget exhausted (1 per execution)");
  });

  it("exposes MCP schemas through discovery before a tool is called", async () => {
    const runtime = new FabricRuntimeV2HostAdapter(testRegistry(), { timeoutMs: 10_000 });
    const result = await runtime.execute({
      parentToolCallId: "mcp-discovery",
      context: extensionContext(),
      code: `
const servers = await mcp.servers();
const tools = await mcp.tools({ server: "demo" });
return { servers, tools };
`,
    });
    expect(result.terminationReason).toBe("completed");
    expect((result.value as any).tools).toHaveLength(1);
    expect((result.value as any).tools[0].inputSchema.properties.value.type).toBe("string");
  });
});
