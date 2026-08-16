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
  });

  it("keeps local and child-Pi discovery on the same three skills", () => {
    const entry = fs.readFileSync("src/lean-index.ts", "utf8");
    for (const name of shippedSkills) {
      expect(entry).toContain(`path.join(skillsRoot, \"${name}\")`);
    }
    for (const name of legacySkills) {
      expect(entry).not.toContain(`path.join(skillsRoot, \"${name}\")`);
    }
  });

  it("keeps legacy Fabric providers out of default lean system guidance", () => {
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

    for (const legacy of ["memory.*", "state.*", "schema.*", "mesh.*", "actors"] as const) {
      expect(guidance).not.toContain(legacy);
    }
  });

  it("keeps the progressive exec skill focused on the lean product surface", () => {
    const skill = fs.readFileSync("skills/fabric-exec/SKILL.md", "utf8");
    expect(skill).toContain("Pi Code Mode");
    expect(skill).toContain("Captured extension tools");
    expect(skill).toContain("Named subagents");
    expect(skill).toContain("Workflow composition");
    expect(skill).not.toContain("memory.recall");
    expect(skill).not.toContain("state.transition");
    expect(skill).not.toContain("schema.hypothesize");
    expect(skill).not.toContain("Persistent actors");
  });

  it("packs only the three lean Fabric skills", () => {
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
    for (const name of legacySkills) {
      expect(files).not.toContain(`skills/${name}/SKILL.md`);
    }
  }, 30_000);

  it("does not make hidden workflow skills part of the ambient model catalog", () => {
    for (const name of ["fabric-subagents", "fabric-workflow"] as const) {
      const skill = fs.readFileSync(path.join("skills", name, "SKILL.md"), "utf8");
      const frontmatter = skill.slice(0, skill.indexOf("---", 4));
      expect(frontmatter).toContain("disable-model-invocation: true");
    }
  });
});
