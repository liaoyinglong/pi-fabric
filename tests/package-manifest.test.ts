import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("ships one Lean extension and one progressive skill", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      files: string[];
      pi: { extensions: string[]; skills: string[] };
    };

    expect(manifest.pi.extensions).toEqual(["./dist/lean-index.js"]);
    expect(manifest.pi.skills).toEqual(["./skills/fabric-exec"]);
    expect(manifest.files).toContain("skills/fabric-exec/");
    expect(manifest.files).not.toContain("skills/fabric-subagents/");
    expect(manifest.files).not.toContain("skills/fabric-workflow/");
    expect(manifest.files).not.toContain("internal/pi-subagents/");
  });

  it("does not publish worker or orchestration entrypoints", () => {
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      exports?: Record<string, unknown>;
      files: string[];
    };
    expect(Object.keys(manifest.exports ?? {})).toEqual([".", "./protocol"]);
    expect(manifest.files.some((file) => /worker|subagent|workflow/i.test(file))).toBe(false);
  });
});
