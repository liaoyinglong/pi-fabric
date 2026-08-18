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

const makeProject = (routingYaml = ""): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-provider-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".git"));
  const configDir = path.join(root, ".pi", "fabric");
  fs.mkdirSync(configDir, { recursive: true });
  if (routingYaml) fs.writeFileSync(path.join(configDir, "subagents.yaml"), routingYaml);
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
  name: "architecture reviewer",
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

describe("LeanAgentsProvider tier/policy contract", () => {
  it("lets Main define a temporary role while routing execution through strong + inspect", async () => {
    const cwd = makeProject();
    const run = vi.fn(async (_request: AgentRunRequest) => completedRun());
    const provider = new LeanAgentsProvider(fakeManager(cwd, run));

    await provider.invoke("run", {
      tier: "strong",
      policy: "inspect",
      role: "architecture reviewer",
      instructions: "Challenge the proposed boundary.",
      task: "Analyze the issue",
    }, contextFor(cwd));

    const request = run.mock.calls[0]?.[0];
    expect(request?.runner).toBe("pi");
    expect(request?.model).toBe("cliproxyapi/gpt-5.6-sol");
    expect(request?.thinking).toBe("medium");
    expect(request?.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(request?.worktree).toBe(false);
    expect(request?.name).toBe("architecture reviewer");
    expect(request?.task).toContain("Assigned role: architecture reviewer");
    expect(request?.task).toContain("Challenge the proposed boundary.");
    expect(request?.recursive).toBeUndefined();
  });

  it("maps capability policies to concrete worker boundaries", async () => {
    const cwd = makeProject();
    const run = vi.fn(async (_request: AgentRunRequest) => completedRun());
    const provider = new LeanAgentsProvider(fakeManager(cwd, run));

    await provider.invoke("run", {
      tier: "balance",
      policy: "modify",
      role: "implementer",
      task: "Apply the bounded fix",
    }, contextFor(cwd));
    expect(run.mock.calls[0]?.[0]?.tools).toEqual(["read", "grep", "find", "ls", "bash", "edit", "write"]);
    expect(run.mock.calls[0]?.[0]?.worktree).toBe(false);

    await provider.invoke("run", {
      tier: "balance",
      policy: "isolated",
      role: "experimenter",
      task: "Try the alternative implementation",
    }, contextFor(cwd));
    expect(run.mock.calls[1]?.[0]?.worktree).toBe(true);
  });

  it("enables recursion only through agents.recurse and returns a compact result", async () => {
    const cwd = makeProject();
    const run = vi.fn(async (_request: AgentRunRequest) => completedRun());
    const provider = new LeanAgentsProvider(fakeManager(cwd, run));

    const result = await provider.invoke(
      "recurse",
      {
        tier: "strong",
        policy: "inspect",
        role: "decomposer",
        task: "Decompose the cross-module problem",
      },
      contextFor(cwd),
    ) as Record<string, unknown>;

    expect(run.mock.calls[0]?.[0]?.recursive).toBe(true);
    expect(result).toEqual({
      id: "agent-1",
      name: "architecture reviewer",
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

  it("rejects recursive delegation when a tier override resolves to a CLI worker", async () => {
    const cwd = makeProject(`
tiers:
  fast:
    runner: cli
    cli: agy
`);
    const run = vi.fn(async (_request: AgentRunRequest) => completedRun());
    const provider = new LeanAgentsProvider(fakeManager(cwd, run));

    await expect(provider.invoke(
      "recurse",
      { tier: "fast", policy: "inspect", role: "researcher", task: "Research recursively" },
      contextFor(cwd),
    )).rejects.toThrow("Recursive subagent tier must resolve to runner: pi");
    expect(run).not.toHaveBeenCalled();
  });

  it("exposes tier, policy, and temporary role instead of profile/model routing", async () => {
    const cwd = makeProject();
    const provider = new LeanAgentsProvider(fakeManager(cwd));
    const descriptor = await provider.describe("run");
    const schema = descriptor?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    const keys = Object.keys(schema?.properties ?? {});

    expect(keys).toContain("tier");
    expect(keys).toContain("policy");
    expect(keys).toContain("role");
    expect(keys).toContain("instructions");
    expect(keys).not.toContain("profile");
    expect(keys).not.toContain("runner");
    expect(keys).not.toContain("model");
    expect(keys).not.toContain("thinking");
    expect(keys).not.toContain("tools");
    expect(keys).not.toContain("worktree");
  });

  it("exposes active routing semantics without leaking raw model ids", async () => {
    const cwd = makeProject();
    const provider = new LeanAgentsProvider(fakeManager(cwd));
    const result = await provider.invoke("routing", {}, contextFor(cwd)) as {
      tiers: Array<Record<string, unknown>>;
      policies: Array<Record<string, unknown>>;
    };

    expect(result.tiers.map((entry) => entry.name)).toEqual(["fast", "balance", "strong"]);
    expect(result.policies.map((entry) => entry.name)).toEqual(["inspect", "execute", "modify", "isolated"]);
    expect(result.tiers.every((entry) => entry.model === undefined)).toBe(true);
  });
});