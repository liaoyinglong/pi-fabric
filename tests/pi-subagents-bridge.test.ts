import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  SUBAGENT_DELEGATION_REQUEST_EVENT,
  SUBAGENT_DELEGATION_RESPONSE_EVENT,
} from "pi-subagents/delegation";
import type { AgentRunRequest } from "../src/agents/types.js";
import { PiSubagentsBridge } from "../src/pi-subagents-bridge.js";
import type { FabricInvocationContext } from "../src/protocol.js";

class FakeEvents {
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, handler: (payload: unknown) => void): () => void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    this.emitted.push({ event, payload });
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

const context = (): FabricInvocationContext => ({
  cwd: "/repo",
  signal: undefined,
  parentToolCallId: "parent-1",
  nestedToolCallId: "nested-1",
  extensionContext: {
    isProjectTrusted: () => true,
  } as unknown as FabricInvocationContext["extensionContext"],
  update: () => undefined,
});

const request = (): AgentRunRequest => ({
  task: "Inspect auth flow",
  name: "auth scout",
  runner: "pi",
  model: "cliproxyapi/gpt-5.6-luna",
  thinking: "medium",
  tools: ["read", "grep", "find", "ls"],
});

describe("PiSubagentsBridge", () => {
  it("maps Fabric policies to package agents", () => {
    const events = new FakeEvents();
    const bridge = new PiSubagentsBridge({ events } as unknown as ExtensionAPI);
    const run = request();

    expect(bridge.supports(run, "inspect")).toBe(true);
    expect(bridge.supports({ ...run, worktree: true }, "isolated")).toBe(false);
  });

  it("delegates a Fabric run through the structured pi-subagents event contract", async () => {
    const events = new FakeEvents();
    const bridge = new PiSubagentsBridge({ events } as unknown as ExtensionAPI);
    const runPromise = bridge.run(request(), "inspect", context());

    const launch = events.emitted.find((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT);
    expect(launch).toBeDefined();
    const payload = launch!.payload as Record<string, unknown>;
    expect(payload.agent).toBe("fabric-inspect");
    expect(payload.ownerRunId).toBe("parent-1");
    expect(payload.nodeId).toBe("nested-1");
    expect(payload.model).toBe("cliproxyapi/gpt-5.6-luna");

    events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
      requestId: payload.requestId,
      ownerRunId: "parent-1",
      nodeId: "nested-1",
      status: "completed",
      runId: "child-1",
      agent: "fabric-inspect",
      model: "cliproxyapi/gpt-5.6-luna",
      result: { kind: "text", text: "Found auth.ts" },
      usage: {
        input: 10,
        output: 4,
        cacheRead: 3,
        cacheWrite: 0,
        cost: 0,
        turns: 2,
        toolCalls: 3,
        durationMs: 50,
      },
    });

    await expect(runPromise).resolves.toMatchObject({
      id: "child-1",
      name: "auth scout",
      status: "completed",
      text: "Found auth.ts",
      turns: 2,
      toolCalls: 3,
      usage: { input: 10, output: 4, cacheRead: 3 },
    });
  });
});
