import fs from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";

type Context = Record<string, unknown>;
type AsyncCallable = (...values: unknown[]) => Promise<unknown>;
type AsyncFunctionConstructor = new (...args: string[]) => AsyncCallable;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor;

function extractMarkdownProgram(markdown: string, file: string): string {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const match = normalized.match(/```ts\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`No TypeScript program in ${file}`);
  return match[1]!;
}

async function runWorkflow(context: Context): Promise<unknown> {
  const file = "skills/fabric-workflow/SKILL.md";
  const program = extractMarkdownProgram(fs.readFileSync(file, "utf8"), file);
  const javascript = transpileModule(program, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText;
  const keys = Object.keys(context);
  const fn = new AsyncFunction(...keys, javascript);
  return await fn(...keys.map((key) => context[key]));
}

const parallel = async (thunks: Array<() => Promise<unknown>>) => Promise.all(
  thunks.map((thunk) => thunk()),
);

type AgentOptions = {
  tier?: string;
  policy?: string;
  role?: string;
  label?: string;
};

describe("lean workflow skill behavior", () => {
  it("extracts TypeScript programs from CRLF Markdown", () => {
    expect(extractMarkdownProgram("before\r\n```ts\r\nreturn 42;\r\n```\r\n", "fixture.md"))
      .toBe("return 42;");
  });

  it("fans out with fast inspectors and verifies with a strong inspector", async () => {
    const calls: Array<AgentOptions & { prompt: string }> = [];
    const result = await runWorkflow({
      parallel,
      agent: async (prompt: string, options: AgentOptions) => {
        calls.push({ prompt, ...options });
        if (options.tier === "strong") return "verified result";
        return `${options.label} evidence`;
      },
    });

    expect(result).toBe("verified result");
    expect(calls.filter((call) => call.tier === "fast")).toHaveLength(3);
    expect(calls.slice(0, 3).every((call) => call.policy === "inspect")).toBe(true);
    expect(calls.at(-1)?.tier).toBe("strong");
    expect(calls.at(-1)?.policy).toBe("inspect");
    expect(calls.at(-1)?.role).toBe("independent reviewer");
    expect(calls.at(-1)?.prompt).toContain("Independently verify these findings");
  });

  it("lets Main create distinct temporary roles without configured profiles", async () => {
    const labels: string[] = [];
    const roles: string[] = [];
    await runWorkflow({
      parallel,
      agent: async (_prompt: string, options: AgentOptions) => {
        if (options.label) labels.push(options.label);
        if (options.role) roles.push(options.role);
        return options.tier === "strong" ? "ok" : "evidence";
      },
    });

    expect(labels).toEqual([
      "inspect auth",
      "inspect routing",
      "inspect caching",
      "verify findings",
    ]);
    expect(roles).toEqual([
      "auth repository scout",
      "routing repository scout",
      "caching repository scout",
      "independent reviewer",
    ]);
  });
});
