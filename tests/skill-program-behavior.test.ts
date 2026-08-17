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

describe("lean workflow skill behavior", () => {
  it("extracts TypeScript programs from CRLF Markdown", () => {
    expect(extractMarkdownProgram("before\r\n```ts\r\nreturn 42;\r\n```\r\n", "fixture.md"))
      .toBe("return 42;");
  });

  it("fans out with explore and verifies with review profiles", async () => {
    const calls: Array<{ profile?: string; label?: string; prompt: string }> = [];
    const result = await runWorkflow({
      parallel,
      agent: async (prompt: string, options: { profile?: string; label?: string }) => {
        calls.push({ prompt, ...options });
        if (options.profile === "review") return "verified result";
        return `${options.label} evidence`;
      },
    });

    expect(result).toBe("verified result");
    expect(calls.filter((call) => call.profile === "explore")).toHaveLength(3);
    expect(calls.at(-1)?.profile).toBe("review");
    expect(calls.at(-1)?.prompt).toContain("Independently verify these findings");
  });

  it("keeps labels distinct while routing policy stays in profiles", async () => {
    const labels: string[] = [];
    await runWorkflow({
      parallel,
      agent: async (_prompt: string, options: { profile?: string; label?: string }) => {
        if (options.label) labels.push(options.label);
        return options.profile === "review" ? "ok" : "evidence";
      },
    });

    expect(labels).toEqual([
      "explore auth",
      "explore routing",
      "explore caching",
      "verify findings",
    ]);
  });
});