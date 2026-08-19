import { describe, expect, it } from "vitest";
import { PiToolsProvider } from "../src/providers/pi-tools-provider.js";

describe("Pi core argument guard", () => {
  it("rejects unsupported native arguments instead of silently ignoring them", () => {
    const provider = new PiToolsProvider(process.cwd());

    expect(() =>
      provider.prepareArguments("bash", {
        command: "rg target lib",
        cwd: "/tmp/other-project",
      }),
    ).toThrow(/Unsupported arguments for pi\.bash: cwd.*change directory inside the command/);
  });

  it("keeps supported compatibility normalization valid", () => {
    const provider = new PiToolsProvider(process.cwd());

    expect(provider.prepareArguments("grep", {
      pattern: "target",
      caseSensitive: true,
    })).toEqual({
      pattern: "target",
      ignoreCase: false,
    });
  });
});
