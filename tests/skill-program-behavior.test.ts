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

async function runWorkflow(context: Context): Promise<Record<string, unknown>> {
  const file = "skills/fabric-workflow/SKILL.md";
  const program = extractMarkdownProgram(fs.readFileSync(file, "utf8"), file);
  const javascript = transpileModule(program, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText;
  const keys = Object.keys(context);
  const fn = new AsyncFunction(...keys, javascript);
  return await fn(...keys.map((key) => context[key])) as Record<string, unknown>;
}

const workflow = {
  configure: async () => undefined,
  event: async () => undefined,
};
const phase = async () => undefined;
const parallel = async (thunks: Array<() => Promise<unknown>>) => Promise.all(
  thunks.map((thunk) => thunk()),
);

describe("lean workflow skill behavior", () => {
  it("extracts TypeScript programs from CRLF Markdown", () => {
    expect(extractMarkdownProgram("before\r\n```ts\r\nreturn 42;\r\n```\r\n", "fixture.md"))
      .toBe("return 42;");
  });

  it("preserves successful items, role names, and verification", async () => {
    const calls: Array<{ label: string; name?: string; prompt: string }> = [];
    const result = await runWorkflow({
      π: { task: "audit authentication" },
      workflow,
      phase,
      parallel,
      agent: async (prompt: string, options: { label: string; name?: string }) => {
        calls.push({ label: options.label, name: options.name, prompt });
        if (options.label === "inventory") return { items: ["a", "b", "c"] };
        if (options.label === "analyze b") throw new Error("worker failed");
        if (options.label === "verify synthesis") return "verified result";
        return `${options.label} finding`;
      },
    });

    expect(result).toMatchObject({
      status: "partial",
      coverage: { requested: 3, completed: 2 },
      result: "verified result",
    });
    expect(result).not.toHaveProperty("fallback");
    expect(calls.every((call) => call.prompt.includes("audit authentication"))).toBe(true);
    expect(calls.find((call) => call.label === "inventory")?.name).toBe("explore");
    expect(calls.find((call) => call.label === "analyze a")?.name).toBe("explore");
    expect(calls.find((call) => call.label === "verify synthesis")?.name).toBe("review");
  });

  it("returns compact completed findings only when verification fails", async () => {
    const result = await runWorkflow({
      π: { task: "audit one module" },
      workflow,
      phase,
      parallel,
      agent: async (_prompt: string, options: { label: string }) => {
        if (options.label === "inventory") return { items: ["one"] };
        if (options.label === "verify synthesis") throw new Error("verifier unavailable");
        return "bounded finding";
      },
    });

    expect(result).toMatchObject({
      status: "partial",
      coverage: { requested: 1, completed: 1 },
      result: null,
      verificationError: "verifier unavailable",
    });
    expect(result.fallback).toEqual([
      { item: "one", status: "completed", finding: "bounded finding" },
    ]);
  });
});
