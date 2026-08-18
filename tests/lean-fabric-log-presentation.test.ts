import { describe, expect, it } from "vitest";
import type { FabricLogLine } from "../src/agents/types.js";
import { formatLeanFabricLogLine } from "../src/commands/lean-fabric.js";

const line = (parsed: Record<string, unknown>, offset = 0): FabricLogLine => ({
  offset,
  raw: JSON.stringify(parsed),
  parsed,
});

describe("Lean Fabric log presentation", () => {
  it.each([
    "message_update",
    "message_start",
    "extension_ui_request",
    "agent_start",
    "agent_end",
    "agent_settled",
    "turn_start",
    "turn_end",
    "queue_update",
    "stream_event",
  ])("hides transport and streaming event %s", (type) => {
    expect(formatLeanFabricLogLine(line({ type }))).toBe("");
  });

  it("hides message_update even when it contains a full assistant snapshot", () => {
    expect(formatLeanFabricLogLine(line({
      type: "message_update",
      message: {
        role: "assistant",
        model: "gpt-5.6-luna",
        content: [{ type: "text", text: "partial findings" }],
      },
    }))).toBe("");
  });

  it("keeps the completed assistant message", () => {
    expect(formatLeanFabricLogLine(line({
      type: "message_end",
      message: {
        role: "assistant",
        model: "gpt-5.6-luna",
        content: [{ type: "text", text: "verified findings" }],
      },
    }))).toBe("assistant [gpt-5.6-luna]: verified findings");
  });

  it("shows tool starts and only error completions", () => {
    expect(formatLeanFabricLogLine(line({
      type: "tool_execution_start",
      toolName: "grep",
    }))).toBe("tool: grep");

    expect(formatLeanFabricLogLine(line({
      type: "tool_execution_end",
      toolName: "grep",
      isError: false,
    }))).toBe("");

    expect(formatLeanFabricLogLine(line({
      type: "tool_execution_end",
      toolName: "grep",
      isError: true,
    }))).toBe("tool_error: grep");
  });
});
