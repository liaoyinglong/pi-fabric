import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { AgentManager, effectiveAgentTimeoutMs } from "../src/agents/manager.js";

const managers: AgentManager[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const createManager = (worker = "tests/fixtures/fake-worker.mjs"): AgentManager => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-mode-agent-"));
  roots.push(root);
  const manager = new AgentManager(process.cwd(), DEFAULT_FABRIC_CONFIG.agents, {
    workerPath: path.resolve(worker),
    runRoot: root,
    fullCodeMode: true,
  });
  managers.push(manager);
  return manager;
};

describe("effectiveAgentTimeoutMs", () => {
  it("uses the larger of configured and per-call timeout", () => {
    expect(effectiveAgentTimeoutMs(3_600_000, 240_000)).toBe(3_600_000);
    expect(effectiveAgentTimeoutMs(3_600_000, 7_200_000)).toBe(7_200_000);
  });
});

describe("lean AgentManager", () => {
  it("runs a one-shot worker through process transport", async () => {
    const manager = createManager();
    const result = await manager.run({
      task: "Inspect this repository",
      transport: "process",
    });
    expect(result.status).toBe("completed");
    expect(result.text).toBe("fake worker complete");
    expect(result.transport).toBe("process");
    expect(manager.list()).toHaveLength(1);
  });

  it("spawns and waits for a one-shot worker", async () => {
    const manager = createManager();
    const handle = await manager.spawn({
      task: "Background inspection",
      transport: "process",
    });
    expect(handle.status === "queued" || handle.status === "running").toBe(true);
    const result = await manager.wait(handle.id);
    expect(result.status).toBe("completed");
    expect(result.text).toBe("fake worker complete");
  });

  it("can stop a running worker", async () => {
    const manager = createManager();
    const handle = await manager.spawn({
      task: "HANG until stopped",
      transport: "process",
    });
    const stopped = await manager.stop(handle.id);
    expect(stopped.status).toBe("stopped");
  });

  it("coalesces concurrent Pi model preparation by provider", async () => {
    let preparations = 0;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-code-mode-agent-"));
    roots.push(root);
    const manager = new AgentManager(process.cwd(), DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: root,
      fullCodeMode: true,
      preparePiModel: async () => {
        preparations += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
    });
    managers.push(manager);

    const results = await Promise.all([
      manager.run({ task: "one", model: "openai-codex/model-one", transport: "process" }),
      manager.run({ task: "two", model: "openai-codex/model-two", transport: "process" }),
    ]);
    expect(results.every((result) => result.status === "completed")).toBe(true);
    expect(preparations).toBe(1);
  });
});
