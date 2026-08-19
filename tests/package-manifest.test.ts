import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("ships one Lean extension and its on-demand reference skill", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      files: string[];
      pi: { extensions: string[]; skills: string[] };
    };

    expect(manifest.pi.extensions).toEqual(["./dist/lean-index.js"]);
    expect(manifest.pi.skills).toEqual(["./skills/fabric-exec"]);
    expect(manifest.files).toContain("skills/fabric-exec/");
  });

  it("publishes only the narrow public protocol entrypoint", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      exports?: Record<string, { types?: string; import?: string }>;
      files: string[];
    };
    expect(Object.keys(manifest.exports ?? {})).toEqual([".", "./protocol"]);
    expect(manifest.exports?.["./protocol"]).toEqual({
      types: "./dist/public-protocol.d.ts",
      import: "./dist/public-protocol.js",
    });
    expect(manifest.files.some((file) => /worker|subagent|workflow/i.test(file))).toBe(false);
  });
});
