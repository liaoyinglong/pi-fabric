import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import type { FabricActionDescriptor, FabricProvider } from "../src/protocol.js";

const descriptor: FabricActionDescriptor = {
  name: "huge",
  description: "A tool with a deliberately large schema",
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `field_${index}`,
        { type: "string", description: "x".repeat(80) },
      ]),
    ),
    additionalProperties: false,
  },
  outputSchema: { type: "object" },
  risk: "read",
};

const provider: FabricProvider = {
  name: "demo",
  description: "Demo provider",
  async list() { return [descriptor]; },
  async describe(name) { return name === descriptor.name ? descriptor : undefined; },
  async invoke() { return {}; },
};

const execute = async (code: string) => {
  const registry = new ActionRegistry();
  registry.register(provider);
  return new FabricExecutionService(registry, structuredClone(DEFAULT_FABRIC_CONFIG)).execute({
    code,
    signal: undefined,
    parentToolCallId: "progressive-discovery",
    context: { cwd: process.cwd(), hasUI: false } as ExtensionContext,
    onPartial() {},
  });
};

describe("progressive discovery", () => {
  it("keeps tools.list schema-light by default", async () => {
    const result = await execute("return await tools.list();");
    expect(result.success).toBe(true);
    expect(result.value).toEqual([
      expect.objectContaining({
        ref: "demo.huge",
        provider: "demo",
        name: "huge",
        description: descriptor.description,
      }),
    ]);
    expect(JSON.stringify(result.value)).not.toContain("inputSchema");
    expect(JSON.stringify(result.value).length).toBeLessThan(1_000);
  });

  it("keeps tools.search schema-light by default", async () => {
    const result = await execute('return await tools.search("huge");');
    expect(result.success).toBe(true);
    expect(JSON.stringify(result.value)).not.toContain("inputSchema");
  });

  it("loads the selected schema with tools.describe", async () => {
    const result = await execute('return await tools.describe({ ref: "demo.huge" });');
    expect(result.success).toBe(true);
    expect(result.value).toMatchObject({ ref: "demo.huge", inputSchema: descriptor.inputSchema });
  });

  it("preserves an explicit bulk-schema compatibility escape hatch", async () => {
    const result = await execute("return await tools.list({ includeSchemas: true });");
    expect(result.success).toBe(true);
    expect(result.value).toEqual([
      expect.objectContaining({ ref: "demo.huge", inputSchema: descriptor.inputSchema }),
    ]);
  });
});
