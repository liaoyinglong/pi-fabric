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

  it("describes this fork as an execution layer", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      description?: string;
      repository?: { url?: string };
      homepage?: string;
      bugs?: { url?: string };
      keywords?: string[];
    };

    expect(manifest.description).toBe("Programmatic tool-calling execution layer for Pi");
    expect(manifest.repository?.url).toContain("liaoyinglong/pi-fabric");
    expect(manifest.homepage).toContain("liaoyinglong/pi-fabric");
    expect(manifest.bugs?.url).toContain("liaoyinglong/pi-fabric");
    expect(manifest.keywords).toContain("execution-layer");
    expect(manifest.keywords).not.toContain("codemode");
  });
});
