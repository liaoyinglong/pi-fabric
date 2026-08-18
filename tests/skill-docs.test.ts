import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultFabricExecutionGuidance,
  fabricExecutionKernelGuidance,
} from "../src/core/system-guidance.js";

const shippedSkills = [
  "fabric-exec",
  "fabric-subagents",
  "fabric-workflow",
] as const;

const legacySkills = [
  "fabric-advisor",
  "fabric-ambient",
  "fabric-council",
  "fabric-fusion",
  "fabric-guide",
  "fabric-rlm",
  "fabric-schema",
  "fabric-spec",
  "fabric-supervisor",
  "fabric-swarm",
] as const;

const shippedDocs = [
  "docs/usage.md",
  "docs/configuration.md",
  "docs/lean-code-mode.md",
  "docs/subagents-and-workflows.md",
] as const;

describe("lean Fabric skill surface", () => {
  it("registers only exec, subagents, and workflow with Pi", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      files: string[];
      pi: { skills: string[] };
    };

    expect(manifest.pi.skills).toEqual(
      shippedSkills.map((name) => `./skills/${name}`),
    );
    expect(manifest.files).not.toContain("skills/");
    for (const name of shippedSkills) {
      expect(manifest.files).toContain(`skills/${name}/`);
    }
    for (const file of shippedDocs) {
      expect(manifest.files).toContain(file);
    }
  });

  it("keeps local and child-Pi discovery on the same three skills", () => {
    const entry = fs.readFileSync("src/lean-index.ts", "utf8");
    for (const name of shippedSkills) {
      expect(entry).toContain(`path.join(skillsRoot, \"${name}\")`);
    }
    for (const name of legacySkills) {
      expect(entry).not.toContain(`path.join(skillsRoot, \"${name}\")`);
    }
    expect(entry).toContain('LEAN_MODEL_FACING_TOOL_NAMES = ["fabric_exec"]');
    expect(entry).not.toContain("createLeanTodoTool");
    expect(entry).not.toContain("registerTool(todo");
  });

  it("advertises autonomous routing and the built-in todo guest API", () => {
    const guidance = [
      fabricExecutionKernelGuidance(true),
      defaultFabricExecutionGuidance(true),
    ].join("\n");

    expect(guidance).toContain("fabric_exec");
    expect(guidance).toContain("pi.*");
    expect(guidance).toContain("extensions.*");
    expect(guidance).toContain("mcp.<server>.<tool>");
    expect(guidance).toContain("agents.*");
    expect(guidance).toContain("workflow");
    expect(guidance).toContain("todo([...])");
    expect(guidance).toContain("await todo([])");
    expect(guidance).toContain("Main owns delegation");
    expect(guidance).toContain("fast");
    expect(guidance).toContain("balance");
    expect(guidance).toContain("strong");
    expect(guidance).toContain("inspect");
    expect(guidance).toContain("execute");
    expect(guidance).toContain("modify");
    expect(guidance).toContain("isolated");
    expect(guidance).toContain("agents.run({tier,policy,role,task})");
    expect(guidance).toContain("agents.routing({})");
    expect(guidance).toContain("Prefer the lowest tier");
    expect(guidance).toContain("Main remains responsible for synthesis");
    expect(guidance).not.toContain("agents.profiles");
    expect(guidance).not.toContain("semantic profile");
    expect(guidance).not.toContain('profile: "');

    for (const legacy of ["memory.*", "state.*", "schema.*", "mesh.*", "actors"] as const) {
      expect(guidance).not.toContain(legacy);
    }
  });

  it("does not advertise disabled MCP or subagent routing", () => {
    const guidance = defaultFabricExecutionGuidance(true, {
      agentsEnabled: false,
      mcpEnabled: false,
    });
    expect(guidance).not.toContain("mcp.<server>.<tool>");
    expect(guidance).not.toContain("Main owns delegation");
    expect(guidance).not.toContain("agents.routing({})");
    expect(guidance).not.toContain("agents.run({tier,policy,role,task})");
    expect(guidance).toContain("todo([...])");
    expect(guidance).toContain("agents and agent-backed workflow delegation are disabled");
  });

  it("keeps the progressive exec skill focused on the lean product surface", () => {
    const skill = fs.readFileSync("skills/fabric-exec/SKILL.md", "utf8");
    expect(skill).toContain("Pi Code Mode");
    expect(skill).toContain("Built-in Todo");
    expect(skill).toContain("await todo([");
    expect(skill).toContain("Main does not receive a separate Pi `todo` tool");
    expect(skill).toContain("Captured extension tools");
    expect(skill).toContain("Tier/policy subagents");
    expect(skill).toContain("Thin workflow composition");
    expect(skill).toContain('tier: "fast"');
    expect(skill).toContain('policy: "inspect"');
    expect(skill).not.toContain("agents.profiles");
    expect(skill).not.toContain('profile: "');
    expect(skill).not.toContain("memory.recall");
    expect(skill).not.toContain("state.transition");
    expect(skill).not.toContain("schema.hypothesize");
    expect(skill).not.toContain("Persistent actors");
  });

  it("packs the lean skills and user documentation", () => {
    const packed = JSON.parse(execFileSync(
      process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm", "pack", "--ignore-scripts", "--dry-run", "--json"]
        : ["pack", "--ignore-scripts", "--dry-run", "--json"],
      { cwd: process.cwd(), encoding: "utf8" },
    )) as Array<{ files: Array<{ path: string }> }>;

    const files = new Set(packed[0]!.files.map((entry) => entry.path));
    for (const name of shippedSkills) {
      expect(files).toContain(`skills/${name}/SKILL.md`);
    }
    for (const file of shippedDocs) {
      expect(files).toContain(file);
    }
    for (const name of legacySkills) {
      expect(files).not.toContain(`skills/${name}/SKILL.md`);
    }
  }, 30_000);

  it("keeps delegation skills visible to the ambient model catalog", () => {
    for (const name of ["fabric-subagents", "fabric-workflow"] as const) {
      const skill = fs.readFileSync(path.join("skills", name, "SKILL.md"), "utf8");
      const frontmatter = skill.slice(0, skill.indexOf("---", 4));
      expect(frontmatter).not.toContain("disable-model-invocation: true");
      expect(frontmatter).toContain("Use proactively");
    }
  });

  it("does not ship executable profile selectors in the three lean skills", () => {
    for (const name of shippedSkills) {
      const skill = fs.readFileSync(path.join("skills", name, "SKILL.md"), "utf8");
      expect(skill).not.toContain("agents.profiles");
      expect(skill).not.toContain('profile: "');
      expect(skill).not.toContain("roles:\n  research:");
    }
  });
});
