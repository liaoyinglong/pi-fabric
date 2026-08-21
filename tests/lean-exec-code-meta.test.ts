import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { renderLeanExecCall } from "../src/ui/lean-exec-render.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("fabric_exec code metadata", () => {
  it("shows both input lines and input chars in the call title", () => {
    const code = "const files = await pi.find({ pattern: '**/*.ts' });\nreturn files;";
    const rendered = renderLeanExecCall({ code }, plainTheme, false)
      .render(120)
      .join("\n");

    expect(code).toHaveLength(66);
    expect(rendered).toContain("fabric TypeScript · 2 lines · 66 chars");
  });
});
