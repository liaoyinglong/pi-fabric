import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createLeanFabricExecTool } from "../src/lean-exec-tool.js";
import type { LeanCodeModeRuntime } from "../src/lean-runtime.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const tool = createLeanFabricExecTool({} as LeanCodeModeRuntime);

const renderContext = (expanded = false) => ({
  args: {},
  toolCallId: "lean-exec-render",
  invalidate: () => {},
  lastComponent: undefined,
  state: {},
  cwd: process.cwd(),
  executionStarted: true,
  argsComplete: true,
  isPartial: false,
  expanded,
  showImages: true,
  isError: false,
});

const renderCall = (args: Record<string, unknown>, expanded = false): string =>
  tool.renderCall!(args as never, plainTheme, renderContext(expanded) as never)
    .render(120)
    .join("\n");

const renderResult = (
  output: string,
  details: Record<string, unknown>,
  expanded = false,
): string =>
  tool.renderResult!(
    { content: [{ type: "text", text: output }], details } as never,
    { expanded, isPartial: false },
    plainTheme,
    renderContext(expanded) as never,
  )
    .render(120)
    .join("\n");

describe("Lean fabric_exec TUI rendering", () => {
  it("shows generated TypeScript code in the tool call", () => {
    const rendered = renderCall({
      code: "const files = await pi.find({ pattern: '**/*.ts' });\nreturn files;",
      display: { name: "Find sources", description: "Locate TypeScript files" },
    });

    expect(rendered).toContain("fabric Find sources TypeScript · 2 lines");
    expect(rendered).toContain("Locate TypeScript files");
    expect(rendered).toContain("1 const files = await pi.find");
    expect(rendered).toContain("2 return files;");
  });

  it("previews eight code lines collapsed and shows the full program expanded", () => {
    const code = Array.from({ length: 12 }, (_, index) => `const line${index + 1} = ${index + 1};`).join("\n");
    const collapsed = renderCall({ code });
    const expanded = renderCall({ code }, true);

    expect(collapsed).toContain("TypeScript · 12 lines");
    expect(collapsed).toContain("const line8 = 8;");
    expect(collapsed).not.toContain("const line9 = 9;");
    expect(collapsed).toContain("… 4 lines hidden · Ctrl+O to expand");
    expect(expanded).toContain("const line12 = 12;");
    expect(expanded).not.toContain("hidden");
  });

  it("renders a concise Fabric completion instead of the generic result card", () => {
    const rendered = renderResult(
      "done",
      { elapsedMs: 125, audits: [{ ref: "pi.read" }, { ref: "pi.find" }] },
    );

    expect(rendered).toContain("✓ Fabric complete · 2 calls · 125ms");
    expect(rendered).toContain("done");
  });
});
