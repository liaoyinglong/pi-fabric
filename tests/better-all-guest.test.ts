import { describe, expect, it, vi } from "vitest";
import { rewriteFabricExecGuideline } from "../src/fabric-exec-tool.js";
import { GUEST_TYPE_DECLARATIONS } from "../src/runtime/guest-types.js";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const options = { timeoutMs: 5_000, memoryLimitBytes: 32 * 1024 * 1024 };

describe("dependency-aware all() guest prelude", () => {
  it("type-checks this.$ dependency edges with inferred results", () => {
    const checked = typeCheckFabricCode(
      `const result = await all({
         manifest: () => pi.read("package.json"),
         sources: () => pi.find("*.ts", "src"),
         async summary() {
           const manifest = await this.$.manifest;
           const sources = await this.$.sources;
           return JSON.parse(manifest).name + ":" + sources.length;
         },
       });
       return result.summary.toUpperCase();`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(checked.errors).toEqual([]);
  });

  it("accepts eager promise entries alongside dependency tasks", () => {
    const checked = typeCheckFabricCode(
      `const result = await all({
         manifest: pi.read("package.json"),
         sources: pi.find("*.ts", "src"),
         async summary() {
           const manifest = await this.$.manifest;
           const sources = await this.$.sources;
           return JSON.parse(manifest).name + ":" + sources.length;
         },
       });
       return result.summary.toUpperCase();`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(checked.errors).toEqual([]);
  });

  it("executes eager values and resolves dependent tasks in QuickJS", async () => {
    const hostCall = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      if (ref === "pi.read") return String(args.path).toUpperCase();
      throw new Error(`Unexpected call: ${ref}`);
    });
    const result = await new QuickJsRuntime().execute(
      `const values = await all({
         first: pi.read("a"),
         second: pi.read("b"),
         staticValue: "C",
         async joined() {
           return (await this.$.first) + (await this.$.second) + (await this.$.staticValue);
         },
       });
       return values;`,
      hostCall,
      options,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({ first: "A", second: "B", staticValue: "C", joined: "ABC" });
    expect(hostCall).toHaveBeenCalledTimes(2);
  });

  it("propagates a failed eager dependency instead of running dependent work", async () => {
    const hostCall = vi.fn(async (_ref: string, args: Record<string, unknown>) => {
      if (args.path === "bad") throw new Error("read failed");
      return String(args.path);
    });
    const result = await new QuickJsRuntime().execute(
      `return all({
         bad: pi.read("bad"),
         async dependent() {
           await this.$.bad;
           return pi.read("should-not-run");
         },
       });`,
      hostCall,
      options,
    );

    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("read failed");
    expect(hostCall).toHaveBeenCalledTimes(1);
  });

  it("preserves model-facing type error line numbers", () => {
    const checked = typeCheckFabricCode(
      "const present = 1;\nawait definitelyMissing();",
      GUEST_TYPE_DECLARATIONS,
    );
    expect(checked.errors[0]?.line).toBe(2);
  });

  it("rewrites the model guideline away from Promise.all by default", () => {
    const legacy =
      "Batch independent operations in one `fabric_exec` program (`Promise.all` for parallel, sequential `await` for ordered), not one call per tool; keep dependent/conditional steps sequential. Keep the rest.";
    const rewritten = rewriteFabricExecGuideline(legacy);
    expect(rewritten).toContain("Prefer `all({...})` for dependency graphs");
    expect(rewritten).toContain("bounded homogeneous fan-out");
    expect(rewritten).not.toContain("`Promise.all` for parallel");
  });
});
