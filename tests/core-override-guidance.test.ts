import { describe, expect, it } from "vitest";
import type { CapturedToolCatalog } from "../src/capture/catalog.js";
import { coreOverridePromptGuidance } from "../src/core/core-override-guidance.js";

describe("coreOverridePromptGuidance", () => {
  it("preserves authored guidance for hidden exact-name core overrides", () => {
    const catalog = {
      get(name: string) {
        if (name !== "grep") return undefined;
        return {
          definition: {
            promptSnippet: "search through the FFF override",
            promptGuidelines: ["Use grep override semantics for repository search."],
          },
        };
      },
    } as unknown as CapturedToolCatalog;

    const guidance = coreOverridePromptGuidance(catalog);
    expect(guidance).toContain("pi.grep");
    expect(guidance).toContain("search through the FFF override");
    expect(guidance).toContain("Use grep override semantics for repository search.");
    expect(guidance).not.toContain("pi.read");
  });
});
