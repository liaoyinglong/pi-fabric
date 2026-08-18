import {
  createSyntheticSourceInfo,
  defineTool,
  type ExtensionRunner,
  type RegisteredTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { CapturedToolCatalog } from "../src/capture/catalog.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { isPiSubagentsSourcePath } from "../src/lean-index.js";

const registered = (name: string, sourcePath: string): RegisteredTool => ({
  definition: defineTool({
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text" as const, text: name }], details: {} };
    },
  }),
  sourceInfo: createSyntheticSourceInfo(sourcePath, { source: "test" }),
});

describe("internal pi-subagents capture", () => {
  it("recognizes bundled pi-subagents source paths on Unix and Windows", () => {
    expect(isPiSubagentsSourcePath("/pkg/node_modules/pi-subagents/index.ts")).toBe(true);
    expect(isPiSubagentsSourcePath("C:\\pkg\\node_modules\\pi-subagents\\index.ts")).toBe(true);
    expect(isPiSubagentsSourcePath("/pkg/node_modules/pi-subagents-extra/index.ts")).toBe(false);
    expect(isPiSubagentsSourcePath("/extensions/my-subagent/index.ts")).toBe(false);
  });

  it("hides pi-subagents tools without exposing them through extensions.*", () => {
    const catalog = new CapturedToolCatalog({
      hideOnly: (tool) => isPiSubagentsSourcePath(tool.sourceInfo.path),
    });
    const runner = {} as ExtensionRunner;
    catalog.replace(
      [
        registered("subagent", "/pkg/node_modules/pi-subagents/index.ts"),
        registered("normal_extension", "/extensions/normal/index.ts"),
      ],
      runner,
      DEFAULT_FABRIC_CONFIG.capture,
      "/pkg/dist/lean-index.js",
    );

    expect(catalog.hiddenOnlyNames()).toEqual(["subagent"]);
    expect(catalog.list().map((entry) => entry.name)).toEqual(["normal_extension"]);
    expect(catalog.get("subagent")).toBeUndefined();
  });
});
