import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { renderLeanExecResult } from "../src/ui/lean-exec-render.js";
import type { FabricResultInspectorLike } from "../src/ui/result-inspector.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("Lean fabric_exec inspect rendering", () => {
  it("uses the local inspect action instead of the global Ctrl+O hint when available", () => {
    const renderAction = vi.fn(() => "[inspect]");
    const inspector = { renderAction } satisfies FabricResultInspectorLike;
    const output = Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join("\n");

    const rendered = renderLeanExecResult(
      { content: [{ type: "text", text: output }], details: { elapsedMs: 80 } },
      plainTheme,
      false,
      false,
      { inspectId: "call-42", inspector },
    ).render(120).join("\n");

    expect(rendered).toContain("result · 30 lines");
    expect(rendered).toContain("[inspect]");
    expect(rendered).not.toContain("Ctrl+O to inspect");
    expect(renderAction).toHaveBeenCalledWith(
      expect.objectContaining({ inspectId: "call-42", output }),
      plainTheme,
    );
  });
});
