import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeSubagentRoles,
  resolveSubagentRole,
} from "../src/subagents/profiles.js";

const tempRoots: string[] = [];
const originalProjectRoot = process.env.PI_FABRIC_PROJECT_ROOT;
const originalProfilesFile = process.env.PI_FABRIC_SUBAGENTS_FILE;

const project = (yaml: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-subagents-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, ".git"));
  const configDir = path.join(root, ".pi", "fabric");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "subagents.yaml"), yaml);
  process.env.PI_FABRIC_PROJECT_ROOT = root;
  delete process.env.PI_FABRIC_SUBAGENTS_FILE;
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  if (originalProjectRoot === undefined) delete process.env.PI_FABRIC_PROJECT_ROOT;
  else process.env.PI_FABRIC_PROJECT_ROOT = originalProjectRoot;
  if (originalProfilesFile === undefined) delete process.env.PI_FABRIC_SUBAGENTS_FILE;
  else process.env.PI_FABRIC_SUBAGENTS_FILE = originalProfilesFile;
});

describe("subagent role profiles", () => {
  it("applies role defaults while preserving explicit call overrides", () => {
    const root = project(`
roles:
  research:
    description: Cheap bounded research
    instructions: Gather evidence and cite concrete files.
    runner: pi
    model: provider/cheap
    thinking: low
    tools: [read, grep, find, ls]
`);

    const resolved = resolveSubagentRole({
      role: "research",
      task: "Inspect the authentication flow",
      model: "provider/strong",
    }, root);

    expect(resolved.role).toBe("research");
    expect(resolved.args.runner).toBe("pi");
    expect(resolved.args.model).toBe("provider/strong");
    expect(resolved.args.thinking).toBe("low");
    expect(resolved.args.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(resolved.args.name).toBe("research");
    expect(String(resolved.args.task)).toContain("configured subagent role \"research\"");
    expect(String(resolved.args.task)).toContain("Gather evidence and cite concrete files.");
    expect(String(resolved.args.task)).toContain("Inspect the authentication flow");
    expect(resolved.args.role).toBeUndefined();
  });

  it("accepts a matching name as a backwards-compatible role selector", () => {
    const root = project(`
roles:
  review:
    model: provider/strong
    thinking: high
`);

    const resolved = resolveSubagentRole({ name: "review", task: "Review this diff" }, root);
    expect(resolved.role).toBe("review");
    expect(resolved.args.model).toBe("provider/strong");
    expect(resolved.args.thinking).toBe("high");
  });

  it("rejects an explicitly requested unknown role", () => {
    const root = project("roles: {}\n");
    expect(() => resolveSubagentRole({ role: "missing", task: "x" }, root))
      .toThrow("Unknown subagent role: missing");
  });

  it("lists role metadata without returning role instructions", () => {
    const root = project(`
roles:
  explore:
    description: Repository evidence gathering
    instructions: Keep raw evidence bounded.
    model: provider/cheap
    thinking: low
`);

    const result = describeSubagentRoles(root) as {
      roles: Array<Record<string, unknown>>;
    };
    expect(result.roles).toEqual([
      {
        name: "explore",
        description: "Repository evidence gathering",
        model: "provider/cheap",
        thinking: "low",
      },
    ]);
    expect(result.roles[0]?.instructions).toBeUndefined();
  });
});
