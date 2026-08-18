import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  createFabricPersistedExecutionDetails,
  readFabricExecutionRenderDetails,
} from "../src/audit/details.js";
import {
  FabricExecutionTraceRecorder,
  executionOutcomeFromError,
  isFabricExecutionTraceV1,
  readFabricExecutionTraceV1,
} from "../src/audit/trace.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import type { FabricProvider } from "../src/protocol.js";

const descriptor = {
  name: "echo",
  description: "Echo a value",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
  risk: "read" as const,
};

const demoProvider = (overrides: Partial<FabricProvider> = {}): FabricProvider => ({
  name: "demo",
  description: "Demo",
  async list() { return [descriptor]; },
  async describe(name) { return name === "echo" ? descriptor : undefined; },
  async invoke(_name, args) { return { value: args.value }; },
  ...overrides,
});

const execute = async (provider: FabricProvider, code: string) => {
  const registry = new ActionRegistry();
  registry.register(provider);
  const config = structuredClone(DEFAULT_FABRIC_CONFIG);
  config.fullCodeMode = false;
  config.approvals.read = "allow";
  return new FabricExecutionService(registry, config).execute({
    code,
    signal: undefined,
    parentToolCallId: "trace-test",
    context: { cwd: process.cwd(), hasUI: false } as ExtensionContext,
    onPartial() {},
  });
};

describe("Fabric execution trace V1", () => {
  it("records a successful provider call without persisting argument values in the trace", async () => {
    const result = await execute(
      demoProvider(),
      'return tools.call({ ref: "demo.echo", args: { value: "secret-value" } });',
    );

    expect(result.success).toBe(true);
    expect(result.value).toEqual({ value: "secret-value" });
    expect(result.trace).toMatchObject({
      kind: "pi-fabric.execution",
      version: 1,
      outcome: "succeeded",
      phases: [],
      operations: [{ ref: "demo.echo", outcome: "succeeded", args: {} }],
    });
    expect(JSON.stringify(result.trace)).not.toContain("secret-value");
    expect(result.audits).toMatchObject([
      { ref: "demo.echo", provider: "demo", tool: "echo", success: true },
    ]);
    expect(isFabricExecutionTraceV1(result.trace)).toBe(true);
  });

  it("records resolve failures with a safe failure stage", async () => {
    const result = await execute(
      demoProvider(),
      'return tools.call({ ref: "demo.missing", args: { value: "hidden" } });',
    );

    expect(result.success).toBe(false);
    expect(result.trace.outcome).toBe("failed");
    expect(result.trace.operations[0]).toMatchObject({
      ref: "demo.missing",
      outcome: "failed",
      failureStage: "resolve",
      args: {},
    });
    expect(JSON.stringify(result.trace)).not.toContain("hidden");
  });

  it("keeps provider failure details in rich audits while the functional trace stays safe", async () => {
    const result = await execute(
      demoProvider({
        async invoke() {
          throw new Error("provider-secret");
        },
      }),
      'return tools.call({ ref: "demo.echo", args: { value: "argument-secret" } });',
    );

    expect(result.success).toBe(false);
    expect(result.trace.operations[0]).toMatchObject({
      ref: "demo.echo",
      outcome: "failed",
      failureStage: "invoke",
      args: {},
    });
    expect(JSON.stringify(result.trace)).not.toContain("secret");
    const persisted = createFabricPersistedExecutionDetails(result);
    expect(persisted.audits[0]).toMatchObject({
      error: "provider-secret",
      args: { value: "argument-secret" },
    });
  });

  it("round-trips trace data through persisted render details", async () => {
    const result = await execute(
      demoProvider(),
      'return tools.call({ ref: "demo.echo", args: { value: "ok" } });',
    );
    const persisted = createFabricPersistedExecutionDetails(result);
    const rendered = readFabricExecutionRenderDetails(persisted);
    expect(rendered).toMatchObject({ success: true, phases: result.phases });
    expect(rendered.audits).toEqual(persisted.audits);
    expect(readFabricExecutionTraceV1(persisted.trace)).toEqual(result.trace);
  });

  it("maps aborted signals and ordinary errors to stable outcomes", () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    expect(executionOutcomeFromError(new Error("x"), controller.signal)).toBe("aborted");
    expect(executionOutcomeFromError(new Error("ordinary failure"), undefined)).toBe("failed");
  });

  it("seals manually issued operations in sequence", () => {
    const recorder = new FabricExecutionTraceRecorder();
    const first = recorder.issueCall("demo.one", { secret: "hidden" });
    const second = recorder.issueCall("demo.two", {});
    first.succeed({ ignored: true });
    second.succeed(undefined);
    const trace = recorder.seal("succeeded", []);
    expect(trace.operations.map(({ sequence, ref, outcome }) => ({ sequence, ref, outcome }))).toEqual([
      { sequence: 0, ref: "demo.one", outcome: "succeeded" },
      { sequence: 1, ref: "demo.two", outcome: "succeeded" },
    ]);
    expect(JSON.stringify(trace)).not.toContain("hidden");
  });
});
