import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  explicitFabricConfigOverride,
  loadLeanConfigForScope,
  saveLeanConfigPartial,
  type LeanSettingsPersistenceOptions,
} from "../src/settings/lean-persistence.js";

const roots: string[] = [];
const previousFabricConfig = process.env.PI_FABRIC_CONFIG;

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
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("lean settings persistence", () => {
  it("keeps global defaults and project overrides in separate files", () => {
    const options = fixture();
    saveLeanConfigPartial("global", options, { executor: { timeoutMs: 2_000 } });
    saveLeanConfigPartial("project", options, { executor: { timeoutMs: 7_000 } });

    expect(loadLeanConfigForScope("global", options).executor.timeoutMs).toBe(2_000);
    expect(loadLeanConfigForScope("project", options).executor.timeoutMs).toBe(7_000);

    const global = JSON.parse(fs.readFileSync(path.join(options.agentDir, "fabric.json"), "utf8"));
    const project = JSON.parse(fs.readFileSync(path.join(options.cwd, ".pi", "fabric.json"), "utf8"));
    expect(global.executor.timeoutMs).toBe(2_000);
    expect(project.executor.timeoutMs).toBe(7_000);
  });

  it("refuses project writes when the project is untrusted", () => {
    const options = { ...fixture(), projectTrusted: false };
    expect(() => saveLeanConfigPartial("project", options, { mcp: { enabled: false } })).toThrow(
      "untrusted project",
    );
  });

  it("reports explicit config overrides without writing through them", () => {
    const options = fixture();
    const explicit = path.join(path.dirname(options.cwd), "host-fabric.json");
    fs.writeFileSync(explicit, JSON.stringify({ executor: { timeoutMs: 99_000 } }));
    process.env.PI_FABRIC_CONFIG = explicit;

    saveLeanConfigPartial("project", options, { executor: { timeoutMs: 5_000 } });
    expect(explicitFabricConfigOverride()).toBe(path.resolve(explicit));
    expect(loadLeanConfigForScope("project", options).executor.timeoutMs).toBe(5_000);
    expect(JSON.parse(fs.readFileSync(explicit, "utf8")).executor.timeoutMs).toBe(99_000);
  });

  it("does not expose orchestration config from legacy files", () => {
    const options = fixture();
    fs.writeFileSync(
      path.join(options.agentDir, "fabric.json"),
      JSON.stringify({ agents: { enabled: true }, retention: { oneShotRunMs: 1 } }),
    );
    const config = loadLeanConfigForScope("global", options) as unknown as Record<string, unknown>;
    expect(config.agents).toBeUndefined();
    expect(config.retention).toBeUndefined();
  });
});
