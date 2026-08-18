import { describe, expect, it } from "vitest";
import { QuickJsRuntime } from "../src/runtime/quickjs-runtime.js";
import { injectTodoGuest } from "../src/todo-guest.js";

const options = {
  timeoutMs: 5_000,
  memoryLimitBytes: 32 * 1024 * 1024,
};

describe("Lean workflow compatibility", () => {
  it("recovers object-form agents that were already started before parallel()", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await new QuickJsRuntime().execute(
      injectTodoGuest(`
const results = await parallel([
  agent({ tier: "fast", policy: "inspect", role: "web-auth-tracer", task: "trace web auth" }),
  agent({ tier: "balance", policy: "inspect", role: "api-auth-tracer", task: "trace api auth" }),
]);
return results;
`),
      async (ref, args) => {
        if (ref === "agents.run") {
          calls.push(args);
          return {
            status: "completed",
            text: String(args.task).toUpperCase(),
            usage: { input: 1, output: 1 },
          };
        }
        throw new Error(`Unexpected call: ${ref}`);
      },
      options,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(["TRACE WEB AUTH", "TRACE API AUTH"]);
    expect(calls).toEqual([
      {
        tier: "fast",
        policy: "inspect",
        role: "web-auth-tracer",
        task: "trace web auth",
      },
      {
        tier: "balance",
        policy: "inspect",
        role: "api-auth-tracer",
        task: "trace api auth",
      },
    ]);
  });

  it("keeps canonical thunk-based parallel() behavior intact", async () => {
    const result = await new QuickJsRuntime().execute(
      injectTodoGuest(`
return parallel([
  () => Promise.resolve("first"),
  () => Promise.resolve("second"),
], { concurrency: 1 });
`),
      async (ref) => {
        if (ref === "fabric.$spanStart" || ref === "fabric.$spanEnd") return undefined;
        throw new Error(`Unexpected call: ${ref}`);
      },
      options,
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual(["first", "second"]);
  });
});
