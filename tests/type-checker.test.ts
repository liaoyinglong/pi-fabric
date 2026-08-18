import { describe, expect, it } from "vitest";
import { GUEST_TYPE_DECLARATIONS, guestTypeDeclarations } from "../src/runtime/guest-types.js";
import {
  normalizeAgentGuestDeclarations,
  normalizeTypeScriptPath,
  typeCheckFabricCode,
  wrapFabricGuestCode,
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

  it("accepts tier/policy routing and rejects old profile or raw routing fields", () => {
    const valid = typeCheckFabricCode(
      `
const run = await agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  instructions: "Return bounded evidence.",
  task: "Inspect the landing page",
});
return run.status;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(valid.errors).toEqual([]);

    const oldProfile = typeCheckFabricCode(
      `
return await agents.run({
  profile: "research",
  task: "Polish the landing page",
});
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(oldProfile.errors.some((error) => error.message.includes("'profile' does not exist"))).toBe(true);

    const rawRouting = typeCheckFabricCode(
      `
return await agents.run({
  tier: "balance",
  policy: "modify",
  runner: "pi",
  model: "backend/model",
  task: "Polish the landing page",
});
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(rawRouting.errors.some((error) => error.message.includes("'runner' does not exist"))).toBe(true);
  });

  it("normalizes the legacy static declaration block into the Lean tier contract", () => {
    const declarations = normalizeAgentGuestDeclarations(GUEST_TYPE_DECLARATIONS);
    expect(declarations).toContain('type FabricSubagentTier = "fast" | "balance" | "strong"');
    expect(declarations).toContain('type FabricSubagentPolicy = "inspect" | "execute" | "modify" | "isolated"');
    expect(declarations).toContain("routing(args?: Record<string, never>)");
    expect(declarations).not.toContain("profiles(args?:");
    expect(declarations).not.toContain("profile?: string");
    expect(declarations).not.toContain('FabricAgentRunner = "pi" | "claude" | "veda"');
    expect(declarations).toContain('FabricAgentRunner = "pi" | "claude" | "cli"');
  });

  it("hides old runtime routing helpers and exposes routing/recurse through the dispatcher", () => {
    const wrapped = wrapFabricGuestCode("return 1;");
    expect(wrapped).toContain('property===\"routing\"');
    expect(wrapped).toContain('ref:\"agents.routing\"');
    expect(wrapped).toContain('ref:\"agents.recurse\"');
    expect(wrapped).toContain('property===\"roles\"||property===\"profiles\"||property===\"models\"');
  });

  it("rejects unknown Pi core actions before runtime", () => {
    const result = typeCheckFabricCode(
      'return await pi.exec("pwd");',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.some((error) =>
      error.message.includes("Unknown Pi core action: pi.exec") && error.message.includes("pi.bash")
    )).toBe(true);
    expect(result.javascript).toBeUndefined();
  });

  it("accepts dynamic MCP namespaces and tier-routed orchestration", () => {
    const result = typeCheckFabricCode(
      `
const mcpResult = await mcp.context7.resolve_library_id({ libraryName: "react" });
const review = await agents.run({
  tier: "strong",
  policy: "inspect",
  role: "independent reviewer",
  task: "Review it",
});
console.log(review.status);
return { mcpResult, review };
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("does not declare removed trajectory handoff APIs", () => {
    expect(GUEST_TYPE_DECLARATIONS).not.toContain("handoff(args:");
    expect(GUEST_TYPE_DECLARATIONS).not.toContain("FabricHandoff");
  });

  it("does not declare removed actor APIs", () => {
    for (const method of ["create(args:", "ask(args:", "tell(args:", "members(args:", "main(args:"]) {
      expect(GUEST_TYPE_DECLARATIONS).not.toContain(method);
    }
    expect(GUEST_TYPE_DECLARATIONS).not.toContain("FabricActor");
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
      'const run = await agents.run({ tier: "fast", policy: "inspect", task: "x" }); return run.status;',
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
      'return (await agents.run({ tier: "balance", policy: "inspect", task: "x" })).status;',
      declarations,
    );
    expect(untouched.errors).toEqual([]);
  });

  it("accepts workflow workers and bounded recursive delegation with tiers/policies", () => {
    const result = typeCheckFabricCode(
      `
const captured = await extensions.project_status({ verbose: true });
console.log(captured.text);
const handle = await agents.spawn({
  tier: "strong",
  policy: "inspect",
  role: "reviewer",
  name: "review pass",
  task: "Review the result",
});
await agents.followUp({ id: handle.id, message: "focus on correctness" });
await phase("Review");
const findings = await parallel([
  () => agent<{ issues: string[] }>("Find issues", {
    label: "issue scan",
    tier: "fast",
    policy: "inspect",
    role: "issue scout",
    schema: {
      type: "object",
      properties: { issues: { type: "array", items: { type: "string" } } },
      required: ["issues"],
    },
  }),
]);
const recursive = await agents.recurse({
  tier: "strong",
  policy: "inspect",
  role: "problem decomposer",
  task: "Resolve the cross-module ambiguity",
});
const review = await agents.wait({ id: handle.id });
return { findings, recursive, review };
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
const out = await parallel(items, ({ q, n }) => agent(q + ":" + n, {
  label: q,
  tier: "fast",
  policy: "inspect",
  role: "scout",
}), 2);
return out;
`,
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors).toEqual([]);
  });

  it("reports user-facing line numbers for functional errors", () => {
    const result = typeCheckFabricCode(
      'await pi.read({ path: missingFile });\nreturn "never";',
      GUEST_TYPE_DECLARATIONS,
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.line).toBe(1);
    expect(result.errors[0]?.message).toContain("Cannot find name");
  });
});
