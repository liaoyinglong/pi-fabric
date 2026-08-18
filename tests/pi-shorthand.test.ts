import { describe, expect, it, vi } from "vitest";
import { GUEST_TYPE_DECLARATIONS } from "../src/runtime/guest-types.js";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const options = { timeoutMs: 5_000, memoryLimitBytes: 32 * 1024 * 1024 };

describe("Pi guest shorthands", () => {
  it("type-checks bare-string calls for string-primary tools", () => {
    const result = typeCheckFabricCode(
      'const a = await pi.bash("echo hi"); const b = await pi.read("x"); const c = await pi.ls("y"); const d = await pi.grep("z"); const e = await pi.find("w"); return { a: a.output, b, c, d, e };',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("coerces bare strings and leaves canonical object calls intact", async () => {
    const hostCall = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      if (ref === "pi.bash") return { ok: true, output: String(args.command), details: null };
      if (ref === "pi.read") return String(args.path);
      throw new Error("Unexpected call: " + ref);
    });
    const result = await new QuickJsRuntime().execute(
      'const a = await pi.bash("echo hi"); const b = await pi.bash({ command: "ls", timeout: 5 }); const c = await pi.read("/x"); return { a: a.output, b: b.output, c };',
      hostCall,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(hostCall.mock.calls[0]?.[1]).toEqual({ command: "echo hi" });
    expect(hostCall.mock.calls[1]?.[1]).toEqual({ command: "ls", timeout: 5 });
    expect(hostCall.mock.calls[2]?.[1]).toEqual({ path: "/x" });
  });

  it("normalizes common aliases and flat edit arguments", async () => {
    const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
    const result = await new QuickJsRuntime().execute(
      `
await pi.read({ file_path: "/x" });
await pi.grep({ q: "TODO" });
await pi.write({ target_file: "/y", fileContent: "z" });
await pi.edit({ absolutePath: "/x", from: "a", to: "b" });
await pi.ls({ directoryPath: "/s" });
await pi.find({ include: "*.ts" });
await pi.bash({ commandLine: "pwd" });
return "done";
`,
      async (ref, args) => {
        calls.push({ ref, args });
        return ref === "pi.bash" || ref === "pi.edit" || ref === "pi.write"
          ? { ok: true, output: "ok", details: null }
          : "ok";
      },
      options,
    );
    expect(result.error).toBeUndefined();
    expect(calls.map((call) => call.args)).toEqual([
      { path: "/x" },
      { pattern: "TODO" },
      { path: "/y", content: "z" },
      { path: "/x", edits: [{ oldText: "a", newText: "b" }] },
      { path: "/s" },
      { pattern: "*.ts" },
      { command: "pwd" },
    ]);
  });

  it("normalizes aliases inside batched edits", async () => {
    const hostCall = vi.fn(async (_ref: string, _args: Record<string, unknown>) => ({ ok: true, output: "edited", details: null }));
    const result = await new QuickJsRuntime().execute(
      'return pi.edit({ path: "/x", edits: [{ old: "a", replacement: "b", all: true }] });',
      hostCall,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(hostCall).toHaveBeenCalledWith("pi.edit", {
      path: "/x",
      edits: [{ oldText: "a", newText: "b", all: true }],
    }, expect.any(AbortSignal));
  });

  it("maps positional arguments to canonical object form", async () => {
    const hostCall = vi.fn(async (ref: string, _args: Record<string, unknown>) =>
      ref === "pi.write" || ref === "pi.edit"
        ? { ok: true, output: "ok", details: null }
        : "ok",
    );
    const result = await new QuickJsRuntime().execute(
      'await pi.grep("TODO", "src"); await pi.find("*.ts", "src", 10); await pi.write("/x", "content"); await pi.edit("/y", "old", "new"); return "done";',
      hostCall,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(hostCall.mock.calls.map((call) => call[1])).toEqual([
      { pattern: "TODO", path: "src" },
      { pattern: "*.ts", path: "src", limit: 10 },
      { path: "/x", content: "content" },
      { path: "/y", edits: [{ oldText: "old", newText: "new" }] },
    ]);
  });

  it("merges a string primary argument with an options object", async () => {
    const hostCall = vi.fn(async (ref: string, _args: Record<string, unknown>) =>
      ref === "pi.bash" ? { ok: true, output: "ok", details: null } : "ok",
    );
    const result = await new QuickJsRuntime().execute(
      'await pi.read("/x", { offset: 3, limit: 4 }); await pi.bash("echo hi", { timeout: 2 }); return "done";',
      hostCall,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(hostCall.mock.calls[0]?.[1]).toEqual({ path: "/x", offset: 3, limit: 4 });
    expect(hostCall.mock.calls[1]?.[1]).toEqual({ command: "echo hi", timeout: 2 });
  });

  it("coerces numeric string options before host validation", async () => {
    const hostCall = vi.fn(async (ref: string, _args: Record<string, unknown>) =>
      ref === "pi.bash" ? { ok: true, output: "ok", details: null } : "ok",
    );
    const result = await new QuickJsRuntime().execute(
      'await pi.read({ path: "/x", offset: "3", limit: "4" }); await pi.bash({ command: "pwd", timeout: "2" }); return "done";',
      hostCall,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(hostCall.mock.calls[0]?.[1]).toEqual({ path: "/x", offset: 3, limit: 4 });
    expect(hostCall.mock.calls[1]?.[1]).toEqual({ command: "pwd", timeout: 2 });
  });

  it("settles nonzero bash exits only when requested", async () => {
    const hostCall = vi.fn(async (_ref: string, _args: Record<string, unknown>) => {
      throw new Error("before\n\nCommand exited with code 7");
    });
    const result = await new QuickJsRuntime().execute(
      `let rejected = false;
try { await pi.bash({ command: "exit 7" }); } catch { rejected = true; }
const settled = await pi.bash({ command: "exit 7", settle: true });
return { rejected, settled };`,
      hostCall,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      rejected: true,
      settled: { ok: false, exitCode: 7 },
    });
    expect(hostCall.mock.calls[1]?.[1]).toEqual({ command: "exit 7" });
  });

  it("provides actionable errors for treating envelope results as strings", async () => {
    const result = await new QuickJsRuntime().execute(
      'const result = await pi.bash("echo hi"); return result.trim();',
      async () => ({ ok: true, output: "hi", details: null }),
      options,
    );
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("resolves an envelope");
    expect(result.error).toContain(".output");
  });
});
