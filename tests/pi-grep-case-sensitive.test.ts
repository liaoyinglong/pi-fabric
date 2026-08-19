import { describe, expect, it } from "vitest";
import { PiToolsProvider } from "../src/providers/pi-tools-provider.js";
import { GUEST_TYPE_DECLARATIONS } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

describe("pi.grep caseSensitive compatibility", () => {
  it("type-checks caseSensitive in object and options forms", () => {
    const result = typeCheckFabricCode(
      `
await pi.grep({ pattern: "needle", path: "src", caseSensitive: true });
await pi.grep("needle", { path: "src", caseSensitive: false });
return "done";
`,
      GUEST_TYPE_DECLARATIONS,
    );

    expect(result.errors).toEqual([]);
  });

  it("normalizes caseSensitive to Pi's canonical ignoreCase option", () => {
    const provider = new PiToolsProvider(process.cwd());

    expect(provider.prepareArguments("grep", {
      pattern: "needle",
      caseSensitive: true,
    })).toEqual({
      pattern: "needle",
      ignoreCase: false,
    });

    expect(provider.prepareArguments("grep", {
      pattern: "needle",
      caseSensitive: false,
    })).toEqual({
      pattern: "needle",
      ignoreCase: true,
    });
  });

  it("prefers an explicit ignoreCase value when both are supplied", () => {
    const provider = new PiToolsProvider(process.cwd());

    expect(provider.prepareArguments("grep", {
      pattern: "needle",
      caseSensitive: false,
      ignoreCase: false,
    })).toEqual({
      pattern: "needle",
      ignoreCase: false,
    });
  });
});
