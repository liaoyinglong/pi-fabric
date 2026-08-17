import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  explicitFabricConfigOverride,
  loadEditableSubagentCatalog,
  loadLeanConfigForScope,
  profileFilePath,
  saveEditableSubagentProfile,
  saveLeanConfigPartial,
  type LeanSettingsPersistenceOptions,
} from "../src/settings/lean-persistence.js";

const roots: string[] = [];
const previousFabricConfig = process.env.PI_FABRIC_CONFIG;
const previousProfilesFile = process.env.PI_FABRIC_SUBAGENTS_FILE;

const fixture = (): LeanSettingsPersistenceOptions => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-settings-"));
  roots.push(root);
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  return { cwd, agentDir, projectTrusted: true };
};

afterEach(() => {
  if (previousFabricConfig === undefined) delete process.env.PI_FABRIC_CONFIG;
  else process.env.PI_FABRIC_CONFIG = previousFabricConfig;
  if (previousProfilesFile === undefined) delete process.env.PI_FABRIC_SUBAGENTS_FILE;
  else process.env.PI_FABRIC_SUBAGENTS_FILE = previousProfilesFile;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("lean settings persistence", () => {
  it("keeps global defaults and project overrides in separate files", () => {
    const options = fixture();
    saveLeanConfigPartial("global", options, { agents: { maxConcurrent: 2 } });
    saveLeanConfigPartial("project", options, { agents: { maxConcurrent: 7 } });

    expect(loadLeanConfigForScope("global", options).agents.maxConcurrent).toBe(2);
    expect(loadLeanConfigForScope("project", options).agents.maxConcurrent).toBe(7);

    const global = JSON.parse(fs.readFileSync(path.join(options.agentDir, "fabric.json"), "utf8"));
    const project = JSON.parse(fs.readFileSync(path.join(options.cwd, ".pi", "fabric.json"), "utf8"));
    expect(global.agents.maxConcurrent).toBe(2);
    expect(project.agents.maxConcurrent).toBe(7);
  });

  it("refuses project writes when the project is untrusted", () => {
    const options = { ...fixture(), projectTrusted: false };
    expect(() => saveLeanConfigPartial("project", options, { agents: { enabled: false } })).toThrow(
      "untrusted project",
    );
  });

  it("warns about explicit config overrides without writing through them", () => {
    const options = fixture();
    const explicit = path.join(path.dirname(options.cwd), "host-fabric.json");
    fs.writeFileSync(explicit, JSON.stringify({ agents: { maxConcurrent: 99 } }));
    process.env.PI_FABRIC_CONFIG = explicit;

    saveLeanConfigPartial("project", options, { agents: { maxConcurrent: 5 } });
    expect(explicitFabricConfigOverride()).toBe(path.resolve(explicit));
    expect(loadLeanConfigForScope("project", options).agents.maxConcurrent).toBe(5);
    expect(JSON.parse(fs.readFileSync(explicit, "utf8")).agents.maxConcurrent).toBe(99);
  });

  it("saves profile edits to the selected scope and does not merge explicit profile overrides", () => {
    const options = fixture();
    saveEditableSubagentProfile("global", options, "research", {
      runner: "cli",
      cli: "agy",
      thinking: "low",
    });
    saveEditableSubagentProfile("project", options, "review", {
      runner: "cli",
      cli: "droid",
      thinking: "high",
    });

    const explicit = path.join(path.dirname(options.cwd), "explicit-subagents.yaml");
    fs.writeFileSync(explicit, "roles:\n  hidden:\n    runner: pi\n");
    process.env.PI_FABRIC_SUBAGENTS_FILE = explicit;

    const catalog = loadEditableSubagentCatalog("project", options);
    expect(catalog.profiles.research?.cli).toBe("agy");
    expect(catalog.profiles.review?.cli).toBe("droid");
    expect(catalog.profiles.hidden).toBeUndefined();
    expect(catalog.explicitOverride).toBe(path.resolve(explicit));
    expect(profileFilePath("project", options)).toContain(path.join(".pi", "fabric", "subagents.yaml"));
  });
});
