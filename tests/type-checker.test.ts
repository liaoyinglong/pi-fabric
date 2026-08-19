import { describe, expect, it } from "vitest";
import { GUEST_TYPE_DECLARATIONS, guestTypeDeclarations } from "../src/runtime/guest-types.js";
import {
  normalizeTypeScriptPath,
  typeCheckFabricCode,
  wrapFabricGuestCode,
} from "../src/runtime/type-checker.js";

describe("Fabric guest type checker", () => {
  it("normalizes Windows paths for compiler host comparisons", () => {
    expect(normalizeTypeScriptPath("C:\\work\\__pi_fabric_guest_1.ts")).toBe(
      "C:/work/__pi_fabric_guest_1.ts",
    );
  });

  it("accepts typed Fabric code with top-level return", () => {
    const result = typeCheckFabricCode(
      'const text = await pi.read({ path: "README.md" }); return text.length;',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain("async function __piFabricMain()");
  });

  it("removes orchestration globals at the guest boundary", () => {
    const wrapped = wrapFabricGuestCode("return 1;");
    for (const name of ["agents", "workflow", "agent", "parallel", "pipeline", "phase", "budget"] as const) {
      expect(wrapped).toContain(`\"${name}\"`);
    }
    expect(wrapped.split("\n")[1]).toBe("return 1;");
  });

  it.each(["agents", "workflow", "agent", "parallel", "pipeline", "phase", "budget", "todo"])(
    "rejects removed %s orchestration access",
    (name) => {
      const result = typeCheckFabricCode(`return ${name};`, GUEST_TYPE_DECLARATIONS);
      expect(result.javascript).toBeUndefined();
      expect(result.errors.some((error) => error.message.includes(`Cannot find name '${name}'`))).toBe(true);
    },
  );

  it("rejects unknown Pi core actions before runtime", () => {
    const result = typeCheckFabricCode('return await pi.exec("pwd");', GUEST_TYPE_DECLARATIONS);
    expect(result.errors.some((error) =>
      error.message.includes("Unknown Pi core action: pi.exec") && error.message.includes("pi.bash")
    )).toBe(true);
    expect(result.javascript).toBeUndefined();
  });

  it("rejects positional tools.call arguments", () => {
    const result = typeCheckFabricCode(
      'return await tools.call("pi.grep", { pattern: "target" });',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) => error.message.includes("Expected 1 arguments, but got 2"))).toBe(true);
  });

  it("rejects non-canonical tools.call object fields", () => {
    const result = typeCheckFabricCode(
      'return await tools.call({ name: "pi.grep", input: { pattern: "target" } });',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) =>
      error.message.includes("'name' does not exist") && error.message.includes("ref")
    )).toBe(true);
  });

  it("rejects unsupported native pi.bash options", () => {
    const result = typeCheckFabricCode(
      'return await pi.bash({ command: "pwd", cwd: "/tmp" });',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) =>
      error.message.includes("'cwd' does not exist") && error.message.includes("PiBash")
    )).toBe(true);
  });

  it("rejects the unsupported two-argument pi.edit patch form", () => {
    const result = typeCheckFabricCode(
      'return await pi.edit("src/file.ts", { patch: "replacement" });',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.javascript).toBeUndefined();
    expect(result.errors.some((error) => error.message.includes("No overload expects 2 arguments"))).toBe(true);
  });

  it("accepts dynamic MCP namespaces", () => {
    const result = typeCheckFabricCode(
      'return mcp.context7.resolve_library_id({ libraryName: "react" });',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("excludes globals for providers marked unavailable", () => {
    const declarations = guestTypeDeclarations({ excludeGlobals: ["mcp"] });
    expect(declarations).not.toContain("declare const mcp: FabricMcpApi;");
    const result = typeCheckFabricCode(
      'return mcp.call({ server: "docs", tool: "lookup" });',
      declarations,
    );
    expect(result.errors.some((error) => /Cannot find name 'mcp'/.test(error.message))).toBe(true);
  });

  it("reports user-facing line numbers", () => {
    const result = typeCheckFabricCode(
      'await pi.read({ path: missingFile });\nreturn "never";',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.line).toBe(1);
    expect(result.errors[0]?.message).toContain("Cannot find name");
  });
});
