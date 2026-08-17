import { describe, expect, it } from "vitest";
import { GUEST_TYPE_DECLARATIONS, guestTypeDeclarations } from "../src/runtime/guest-types.js";
import {
  normalizeTypeScriptPath,
  typeCheckFabricCode,
} from "../src/runtime/type-checker.js";

describe("Fabric guest type checker", () => {
  it("normalizes Windows paths for TypeScript compiler host comparisons", () => {
    expect(normalizeTypeScriptPath("C:\\work\\__pi_fabric_guest_1.ts")).toBe(
      "C:/work/__pi_fabric_guest_1.ts",
    );
  });

  it("accepts typed Fabric code with top-level return", () => {
    const result = typeCheckFabricCode(
      'const text = await pi.read({ path: "README.md" });\nreturn text.length;',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
    expect(result.javascript).toContain("async function __piFabricMain()");
    expect(result.javascript).not.toContain("path: string");
  });

  it("accepts a Veda persona and backend model on agents.run", () => {
    const result = typeCheckFabricCode(
      `
const run = await agents.run({
  runner: "veda",
  persona: "frontend",
  model: "claude-opus-4-6-thinking",
  task: "Polish the landing page",
});
return run.status;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("accepts dynamic MCP namespaces and supported orchestration helpers", () => {
    const result = typeCheckFabricCode(
      `
const mcpResult = await mcp.context7.resolve_library_id({ libraryName: "react" });
const review = await agents.run({ task: "Review it", transport: "localterm" });
console.log(review.status);
return { mcpResult, review };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects removed trajectory handoff APIs", () => {
    const result = typeCheckFabricCode(
      `
await pi.edit({ path: "src/a.ts", old: "a", new: "b" });
return agents.handoff({ model: "anthropic/executor" });
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.some((error) => /handoff/.test(error.message))).toBe(true);
  });

  it("rejects removed actor APIs", () => {
    const result = typeCheckFabricCode(
      `
const actor = await agents.create({ name: "reviewer", instructions: "Review once" });
return agents.ask({ id: actor.id, message: "Review once" });
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.some((error) => /create|ask/.test(error.message))).toBe(true);
  });

  it("rejects removed first-class provider globals", () => {
    const result = typeCheckFabricCode(
      `
const recalled = await memory.recall({ query: "proxy", branches: "active" });
const current = await state.get();
const status = await schema.status();
const pending = await compact.status();
return { recalled, current, status, pending };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    for (const name of ["memory", "state", "schema", "compact"]) {
      expect(result.errors.some((error) => error.message.includes(`Cannot find name '${name}'`))).toBe(true);
    }
  });

  it("keeps supported providers typed when Pi core tools are omitted", () => {
    const declarations = guestTypeDeclarations(false);
    expect(declarations).not.toContain("declare const pi: PiToolsApi");
    expect(declarations).not.toContain("declare const extensions: FabricExtensionsApi");
    expect(declarations).toContain("declare const agents: FabricAgentsApi");
    expect(declarations).toContain("declare const mcp: FabricMcpApi");
    expect(declarations).toContain("declare const workflow: FabricWorkflowApi");

    const result = typeCheckFabricCode(
      'const run = await agents.run({ task: "x" }); return run.status;',
      declarations,
    );
    expect(result.errors).toEqual([]);
  });

  it("excludes globals for providers marked unavailable", () => {
    const declarations = guestTypeDeclarations(false, { excludeGlobals: ["mcp"] });
    expect(declarations).not.toContain("declare const mcp: FabricMcpApi;");
    expect(declarations).toContain("declare const agents: FabricAgentsApi;");

    const excluded = typeCheckFabricCode(
      'return mcp.call({ server: "docs", tool: "lookup" });',
      declarations,
    );
    expect(excluded.errors.some((error) => /Cannot find name 'mcp'/.test(error.message))).toBe(true);

    const untouched = typeCheckFabricCode(
      'return (await agents.run({ task: "x" })).status;',
      declarations,
    );
    expect(untouched.errors).toEqual([]);
  });

  it("accepts workflow and one-shot agent primitives", () => {
    const result = typeCheckFabricCode(
      `
const captured = await extensions.project_status({ verbose: true });
console.log(captured.text);
const handle = await agents.spawn({ name: "review", task: "Review the result" });
await agents.followUp({ id: handle.id, message: "focus on correctness" });
await phase("Review");
const findings = await parallel([
  () => agent<{ issues: string[] }>("Find issues", {
    label: "issue scan",
    name: "review",
    schema: {
      type: "object",
      properties: { issues: { type: "array", items: { type: "string" } } },
      required: ["issues"],
    },
  }),
]);
const review = await agents.wait({ id: handle.id });
return { findings, review };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("rejects removed mesh primitives", () => {
    const result = typeCheckFabricCode(
      'await mesh.publish({ topic: "team.review", text: "start" }); return "never";',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.some((error) => /Cannot find name 'mesh'/.test(error.message))).toBe(true);
  });

  it("accepts parallel(items, mapper, concurrency) and infers item types", () => {
    const result = typeCheckFabricCode(
      `
const items = [{ q: "a", n: 3 }, { q: "b", n: 2 }];
const out = await parallel(items, ({ q, n }) => agent(q + ":" + n, { label: q }), 2);
return out;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("reports user-facing line numbers for functional errors", () => {
    // Wrong arg type (path: 42) is deferred to runtime (functional-errors-only);
    // an undefined name is a genuine breakage still caught at type-check.
    const result = typeCheckFabricCode(
      'await pi.read({ path: missingFile });\nreturn "never";',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.line).toBe(1);
    expect(result.errors[0]?.message).toContain("Cannot find name");
  });
});