import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeSubagentRouting,
  resolveSubagentRouting,
} from "../src/subagents/routing.js";

const tempRoots: string[] = [];
let tempHome = "";
const originalProjectRoot = process.env.PI_FABRIC_PROJECT_ROOT;
const originalRoutingFile = process.env.PI_FABRIC_SUBAGENTS_FILE;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-home-"));
  vi.spyOn(os, "homedir").mockReturnValue(tempHome);
});

const project = (yaml = ""): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-subagents-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, ".git"));
  const configDir = path.join(root, ".pi", "fabric");
  fs.mkdirSync(configDir, { recursive: true });
  if (yaml) fs.writeFileSync(path.join(configDir, "subagents.yaml"), yaml);
  process.env.PI_FABRIC_PROJECT_ROOT = root;
  delete process.env.PI_FABRIC_SUBAGENTS_FILE;
  return root;
};

afterEach(() => {
  vi.restoreAllMocks();
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (originalProjectRoot === undefined) delete process.env.PI_FABRIC_PROJECT_ROOT;
  else process.env.PI_FABRIC_PROJECT_ROOT = originalProjectRoot;
  if (originalRoutingFile === undefined) delete process.env.PI_FABRIC_SUBAGENTS_FILE;
  else process.env.PI_FABRIC_SUBAGENTS_FILE = originalRoutingFile;
});

describe("subagent tier and policy routing", () => {
  it("ships fast, balance, and strong defaults without configured roles", () => {
    const root = project();

    const fast = resolveSubagentRouting({
      tier: "fast",
      policy: "inspect",
      role: "repository scout",
      task: "Locate the retry implementation",
    }, root);
    expect(fast.tier).toBe("fast");
    expect(fast.policy).toBe("inspect");
    expect(fast.args.runner).toBe("pi");
    expect(fast.args.model).toBe("azure-openai-responses/gpt-5.6-luna");
    expect(fast.args.thinking).toBe("medium");
    expect(fast.args.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(fast.args.worktree).toBe(false);
    expect(fast.args.name).toBe("repository scout");
    expect(String(fast.args.task)).toContain("Assigned role: repository scout");
    expect(String(fast.args.task)).toContain("Execution tier: fast");
    expect(String(fast.args.task)).toContain("Capability policy: inspect");
    expect(String(fast.args.task)).toContain("Return a compact result");

    const balance = resolveSubagentRouting({ tier: "balance", policy: "execute", task: "Run tests" }, root);
    expect(balance.args.runner).toBe("pi");
    expect(balance.args.model).toBe("azure-openai-responses/gpt-5.6-terra");
    expect(balance.args.thinking).toBe("medium");
    expect(balance.args.tools).toContain("bash");
    expect(balance.args.tools).not.toContain("edit");

    const strong = resolveSubagentRouting({ tier: "strong", policy: "inspect", task: "Review architecture" }, root);
    expect(strong.args.runner).toBe("pi");
    expect(strong.args.model).toBe("azure-openai-responses/gpt-5.6-sol");
    expect(strong.args.thinking).toBe("medium");
  });

  it("lets subagents.yaml override tier process settings and policy boundaries", () => {
    const root = project(`
tiers:
  fast:
    runner: cli
    cli: droid
    model: droid/custom-fast
    thinking: medium
    instructions: Prefer exact file references.
policies:
  inspect:
    tools: [read, grep]
    instructions: Read only the smallest relevant surface.
  isolated:
    worktree: false
`);

    const resolved = resolveSubagentRouting({
      tier: "fast",
      policy: "inspect",
      role: "evidence collector",
      instructions: "Return at most five findings.",
      task: "Inspect auth handling",
    }, root);

    expect(resolved.args.runner).toBe("cli");
    expect(resolved.args.cli).toBe("droid");
    expect(resolved.args.model).toBe("droid/custom-fast");
    expect(resolved.args.thinking).toBe("medium");
    expect(resolved.args.tools).toEqual(["read", "grep"]);
    expect(String(resolved.args.task)).toContain("Prefer exact file references.");
    expect(String(resolved.args.task)).toContain("Read only the smallest relevant surface.");
    expect(String(resolved.args.task)).toContain("Return at most five findings.");

    const isolated = resolveSubagentRouting({ tier: "balance", policy: "isolated", task: "Try a patch" }, root);
    expect(isolated.args.worktree).toBe(false);
  });

  it("does not interpret legacy roles as routing configuration", () => {
    const root = project(`
roles:
  research:
    runner: cli
    cli: droid
    model: legacy/model
    thinking: high
`);

    const resolved = resolveSubagentRouting({
      tier: "balance",
      policy: "inspect",
      role: "research",
      task: "Gather evidence",
    }, root);

    expect(resolved.args.runner).toBe("pi");
    expect(resolved.args.model).toBe("azure-openai-responses/gpt-5.6-terra");
    expect(resolved.args.thinking).toBe("medium");
  });

  it("does not load project routing overrides for an untrusted project", () => {
    const root = project(`
tiers:
  strong:
    model: provider/project-only
policies:
  inspect:
    tools: [read]
`);

    const resolved = resolveSubagentRouting(
      { tier: "strong", policy: "inspect", task: "x" },
      root,
      { projectTrusted: false },
    );
    expect(resolved.args.model).toBe("azure-openai-responses/gpt-5.6-sol");
    expect(resolved.args.tools).toEqual(["read", "grep", "find", "ls"]);

    const result = describeSubagentRouting(root, { projectTrusted: false }) as {
      sources: string[];
    };
    expect(result.sources.some((source) => source.startsWith(root))).toBe(false);
  });

  it("describes semantics without exposing raw model routing", () => {
    const root = project();
    const result = describeSubagentRouting(root) as {
      tiers: Array<Record<string, unknown>>;
      policies: Array<Record<string, unknown>>;
    };

    expect(result.tiers.map((entry) => entry.name)).toEqual(["fast", "balance", "strong"]);
    expect(result.policies.map((entry) => entry.name)).toEqual(["inspect", "execute", "modify", "isolated"]);
    expect(result.tiers.every((entry) => entry.model === undefined)).toBe(true);
    expect(result.tiers.every((entry) => entry.runner === undefined)).toBe(true);
  });

  it("rejects unknown tiers and policies", () => {
    const root = project();
    expect(() => resolveSubagentRouting({ tier: "research", policy: "inspect", task: "x" }, root))
      .toThrow("Unknown subagent tier: research");
    expect(() => resolveSubagentRouting({ tier: "fast", policy: "review", task: "x" }, root))
      .toThrow("Unknown subagent policy: review");
  });
});