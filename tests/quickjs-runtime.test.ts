import { describe, expect, it, vi } from "vitest";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";

const options = {
  timeoutMs: 5_000,
  memoryLimitBytes: 32 * 1024 * 1024,
};

describe("QuickJsRuntime", () => {
  it("rejects memory limits that overflow the WASM32 size_t", async () => {
    const result = await new QuickJsRuntime().execute(
      "return 1;",
      async () => undefined,
      { ...options, memoryLimitBytes: 4 * 1024 ** 3 },
    );
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("WASM32 maximum");
  });

  it("runs independent host calls in parallel", async () => {
    const hostCall = vi.fn(async (_ref: string, args: Record<string, unknown>) => args);
    const result = await new QuickJsRuntime().execute(
      `return Promise.all([
  tools.call({ ref: "demo.echo", args: { value: 1 } }),
  tools.call({ ref: "demo.echo", args: { value: 2 } }),
]);`,
      hostCall,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual([
      { ref: "demo.echo", args: { value: 1 } },
      { ref: "demo.echo", args: { value: 2 } },
    ]);
    expect(hostCall).toHaveBeenCalledTimes(2);
  });

  it("calls captured extension tools through the lazy proxy", async () => {
    const result = await new QuickJsRuntime().execute(
      'return extensions.deploy_release({ environment: "staging" });',
      async (ref, args) => ({ ref, args }),
      options,
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      ref: "extensions.deploy_release",
      args: { environment: "staging" },
    });
  });

  it("routes MCP aliases through the direct MCP proxy", async () => {
    const result = await new QuickJsRuntime().execute(
      'return mcp.github.get_repo({ owner: "octo", repo: "hello" });',
      async (ref, args) => ({ ref, args }),
      options,
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      ref: "mcp.github.get_repo",
      args: { owner: "octo", repo: "hello" },
    });
  });

  it("normalizes the string shorthand for tools.search", async () => {
    const result = await new QuickJsRuntime().execute(
      'return tools.search("fovea");',
      async (ref, args) => ({ ref, args }),
      options,
    );
    expect(result.value).toEqual({ ref: "fabric.$search", args: { query: "fovea" } });
  });

  it("does not expose Node globals", async () => {
    const result = await new QuickJsRuntime().execute(
      "return { process: typeof process, require: typeof require };",
      async () => undefined,
      options,
    );
    expect(result.value).toEqual({ process: "undefined", require: "undefined" });
  });

  it("resumes guest timers through event-driven job pumping", async () => {
    const result = await new QuickJsRuntime().execute(
      'return new Promise((resolve) => setTimeout(() => resolve("timer done"), 20));',
      async () => undefined,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("timer done");
  });

  it("times out unresolved guest promises", async () => {
    const result = await new QuickJsRuntime().execute(
      "await new Promise(() => {});",
      async () => undefined,
      { ...options, timeoutMs: 50 },
    );
    expect(result.terminationReason).toBe("timed_out");
    expect(result.error).toContain("timed out");
  });

  it("returns an aborted termination for an external signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const result = await new QuickJsRuntime().execute(
      "return 1;",
      async () => undefined,
      { ...options, signal: controller.signal },
    );
    expect(result.terminationReason).toBe("aborted");
  });

  it("extends the active deadline for a host call when requested", async () => {
    const result = await new QuickJsRuntime().execute(
      'return tools.call({ ref: "demo.slow" });',
      async () => new Promise((resolve) => setTimeout(() => resolve("ok"), 150)),
      {
        ...options,
        timeoutMs: 50,
        minimumTimeoutMsForHostCall(ref, args) {
          return ref === "fabric.$call" && args.ref === "demo.slow" ? 1_000 : undefined;
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toBe("ok");
  });

  it("aborts sibling host calls when guest code fails", async () => {
    let hostCallAborted = false;
    const result = await new QuickJsRuntime().execute(
      `await Promise.all([
  tools.call({ ref: "demo.wait" }),
  Promise.reject(new Error("branch failed")),
]);`,
      async (_ref, _args, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          hostCallAborted = true;
          reject(new Error("host call aborted"));
        }, { once: true });
      }),
      options,
    );
    expect(result.terminationReason).toBe("runtime_error");
    expect(result.error).toContain("branch failed");
    expect(hostCallAborted).toBe(true);
  });
});
