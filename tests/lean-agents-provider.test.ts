import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentManager } from "../src/agents/manager.js";
import type { AgentRunRequest, AgentRunResult } from "../src/agents/types.js";
import { LeanAgentsProvider } from "../src/lean-agents-provider.js";
import type { FabricInvocationContext } from "../src/protocol.js";

const roots: string[] = [];
const originalProjectRoot = process.env.PI_FABRIC_PROJECT_ROOT;

const makeProject = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-provider-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(path.join(root, ".pi", "fabric"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".pi", "fabric", "subagents.yaml"),
    `roles:\n  deep:\n    runner: pi\n    model: provider/strong\n    thinking: high\n    recursive: true\n  research:\n    runner: veda\n    thinking: low\n`,
  );
  process.env.PI_FABRIC_PROJECT_ROOT = root;
  return root;
};

const contextFor = (cwd: string): FabricInvocationContext => ({
  cwd,
  signal: undefined,
  parentToolCallId: "parent",
  nestedToolCallId: "nested",
  extensionContext: {
    isProjectTrusted: () => true,
    model: undefined,
  } as FabricInvocationContext["extensionContext"],
  update: () => {},
});

const completedRun = (): AgentRunResult => ({
  id: "agent-1",
  name: "deep",
  task: "Analyze the issue",
  status: "completed",
  runner: "pi",
  transport: "process",
  cwd: "/tmp/project",
  startedAt: 1,
  updatedAt: 2,
  finishedAt: 2,
  text: "verified conclusion",
  value: { ok: true },
  turns: 3,
  toolCalls: 7,
  usage: {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.01,
  },
});

const fakeManager = (cwd: string, run = vi.fn(async (_request: AgentRunRequest) => completedRun())) => ({
  cwd,
  config: {
    runner: "pi",
    model: undefined,
    timeoutMs: 60_000,
  },
  run,
}) as unknown as AgentManager;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (originalProjectRoot === undefined) delete process.env.PI_FABRIC_PROJECT_ROOT;
  else process.env.PI_FABRIC_PROJECT_ROOT = originalProjectRoot;
});

describe("LeanAgentsProvider profile contract", () => {
  it("keeps ordinary profile runs one-shot even if an old profile contains recursive: true", async () => {
    const cwd = makeProject();
    const run = vi.fn(async (_request: AgentRunRequest) => completedRun());
    const provider = new LeanAgentsProvider(fakeManager(cwd, run));

    await provider.invoke("run", { profile: "deep", task: "Analyze the issue" }, contextFor(cwd));

    const request = run.mock.calls[0]?.[0];
    expect(request?.runner).toBe("pi");
    expect(request?.model).toBe("provider/strong");
    expect(request?.thinking).toBe("high");
    expect(request?.recursive).toBeUndefined();
  });

  it("enables recursion only through agents.recurse and returns a compact result", async () => {
    const cwd = makeProject();
    const run = vi.fn(async (_request: AgentRunRequest) => completedRun());
    const provider = new LeanAgentsProvider(fakeManager(cwd, run));

    const result = await provider.invoke(
      "recurse",
      { profile: "deep", task: "Decompose the cross-module problem" },
      contextFor(cwd),
    ) as Record<string, unknown>;

    expect(run.mock.calls[0]?.[0]?.recursive).toBe(true);
    expect(result).toEqual({
      id: "agent-1",
      name: "deep",
      status: "completed",
      text: "verified conclusion",
      value: { ok: true },
      turns: 3,
      toolCalls: 7,
      usage: completedRun().usage,
    });
    expect(result).not.toHaveProperty("runner");
    expect(result).not.toHaveProperty("transport");
  });

  it("rejects recursive delegation through a non-Pi profile", async () => {
    const cwd = makeProject();
    const run = vi.fn(async (_request: AgentRunRequest) => completedRun());
    const provider = new LeanAgentsProvider(fakeManager(cwd, run));

    await expect(provider.invoke(
      "recurse",
      { profile: "research", task: "Research recursively" },
      contextFor(cwd),
    )).rejects.toThrow("Recursive subagent profiles must use runner: pi");
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps raw model-routing fields out of the model-facing run schema", async () => {
    const cwd = makeProject();
    const provider = new LeanAgentsProvider(fakeManager(cwd));
    const descriptor = await provider.describe("run");
    const schema = descriptor?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    const keys = Object.keys(schema?.properties ?? {});

    expect(keys).toContain("profile");
    expect(keys).toContain("name");
    expect(keys).not.toContain("runner");
    expect(keys).not.toContain("model");
    expect(keys).not.toContain("thinking");
    expect(keys).not.toContain("recursive");
  });
});
