import { describe, expect, it } from "vitest";
import type { FabricLogLine } from "../src/agents/types.js";
import {
  formatLeanDashboardLogLine,
  wrapLeanDashboardText,
} from "../src/ui/lean-dashboard.js";

const line = (parsed: Record<string, unknown>, offset = 0): FabricLogLine => ({
  offset,
  raw: JSON.stringify(parsed),
  parsed,
});

describe("Lean Fabric dashboard output", () => {
  it("preserves completed assistant line breaks instead of compacting them", () => {
    expect(formatLeanDashboardLogLine(line({
      type: "message_end",
      message: {
        role: "assistant",
        model: "gpt-5.6-luna",
        content: [{
          type: "text",
          text: "**产品目的**\n- 项目名：ZDAS Hotwallet Frontend\n\n第二段",
        }],
      },
    }))).toBe(
      "assistant [gpt-5.6-luna]: **产品目的**\n- 项目名：ZDAS Hotwallet Frontend\n\n第二段",
    );
  });

  it("keeps hidden streaming events hidden", () => {
    expect(formatLeanDashboardLogLine(line({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
      },
    }))).toBe("");
  });

  it("wraps long lines while preserving explicit blank lines", () => {
    expect(wrapLeanDashboardText("abcdefghij\n\nklm", 4)).toEqual([
      "abcd",
      "efgh",
      "ij",
      "",
      "klm",
    ]);
  });
});
