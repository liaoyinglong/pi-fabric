import { describe, expect, it } from "vitest";
import type { AgentRunRecord, FabricLogLine } from "../src/agents/types.js";
import {
  formatLeanFabricAgent,
  formatLeanFabricAgentList,
  formatLeanFabricLogLine,
} from "../src/commands/lean-fabric.js";
import { flattenLeanDashboardAgents } from "../src/ui/lean-dashboard.js";

const run = (overrides: Partial<AgentRunRecord> = {}): AgentRunRecord => ({
  id: "1234567890abcdef",
  name: "research current behavior",
  task: "inspect the runtime",
  status: "running",
  runner: "pi",
  transport: "process",
  cwd: "/repo",
  startedAt: 1,
  updatedAt: 2,
  currentTool: "read",
  turns: 1,
  toolCalls: 2,
  text: "partial child output",
  usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 0, cost: 0 },
  ...overrides,
});

describe("lean /fabric command formatting", () => {
  it("summarizes live subagent state", () => {
    expect(formatLeanFabricAgent(run())).toContain(
      "12345678 · running · pi · process · tool:read · 2 calls · 130 tok — research current behavior",
    );
  });

  it("includes nested recursive agents in the session snapshot", () => {
    const nested = run({
      id: "abcdef1234567890",
      name: "nested check",
      currentTool: "grep",
    });
    const root = run({ nestedAgents: [nested] });
    const output = formatLeanFabricAgentList([root]);
    expect(output).toContain("12345678 · running");
    expect(output).toContain("↳ abcdef12 · running");
  });

  it("flattens recursive agents for dashboard selection without a second runtime model", () => {
    const grandchild = run({ id: "fedcba9876543210", name: "deep child" });
    const child = run({
      id: "abcdef1234567890",
      name: "nested check",
      nestedAgents: [grandchild],
    });
    const rows = flattenLeanDashboardAgents([run({ nestedAgents: [child] })]);
    expect(rows.map((row) => [row.run.id.slice(0, 8), row.depth])).toEqual([
      ["12345678", 0],
      ["abcdef12", 1],
      ["fedcba98", 2],
    ]);
  });

  it("renders structured worker messages instead of raw JSONL", () => {
    const line: FabricLogLine = {
      offset: 0,
      raw: "ignored",
      parsed: {
        type: "message_end",
        message: {
          role: "assistant",
          model: "gpt-5.6-luna",
          content: [{ type: "text", text: "found the relevant implementation" }],
        },
      },
    };
    expect(formatLeanFabricLogLine(line)).toBe(
      "assistant [gpt-5.6-luna]: found the relevant implementation",
    );
  });

  it("renders tool activity from worker events", () => {
    const line: FabricLogLine = {
      offset: 1,
      raw: "ignored",
      parsed: { type: "tool_call", toolName: "grep" },
    };
    expect(formatLeanFabricLogLine(line)).toBe("tool_call: grep");
  });
});
