import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { stringify as stringifyYaml } from "yaml";
import { prepareFabricExecArguments } from "./fabric-exec-arguments.js";
import type { LeanCodeModeRuntime } from "./lean-runtime.js";
import { renderLeanExecCall, renderLeanExecResult } from "./ui/lean-exec-render.js";

const RESULT_FORMATS = ["auto", "yaml", "json", "text"] as const;

const displayValue = (value: unknown): { name?: string; description?: string } | undefined => {
  if (typeof value === "string") return value.trim() ? { name: value.trim() } : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined;
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : undefined;
  return name || description ? { ...(name ? { name } : {}), ...(description ? { description } : {}) } : undefined;
};

const resultText = (value: unknown, format: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (format === "text" || format === "auto" || format === undefined) {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }
  if (format === "yaml") return stringifyYaml(value).trimEnd();
  return JSON.stringify(value, null, 2);
};

export const createLeanFabricExecTool = (
  runtime: LeanCodeModeRuntime,
): ToolDefinition<any, any, any> => defineTool({
  name: "fabric_exec",
  label: "Code Mode",
  description:
    "Execute one type-checked TypeScript program that can compose Pi core tools, captured Pi extension tools, MCP tools, named subagents, and workflow helpers. Intermediate values stay inside the runtime; return only the bounded value needed by the caller.",
  promptSnippet: "programmatic tool calling through one bounded TypeScript execution",
  promptGuidelines: [
    "Batch related tool operations inside one fabric_exec program. Use sequential await when one result determines the next step and parallel/all only for independent work.",
    "Use pi.* for Pi core coding tools, extensions.* for captured Pi extension tools, mcp.* for known MCP tools, and agents.* or workflow agent(...) for one-shot subagents.",
    "Return compact decisions, evidence, or changed results. Keep raw logs and unused intermediate values inside the program.",
  ],
  parameters: Type.Object({
    code: Type.String({ description: "TypeScript function body with top-level await and return" }),
    strings: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Named strings exposed to the program as π.key",
      }),
    ),
    resultFormat: Type.Optional(Type.Union(RESULT_FORMATS.map((value) => Type.Literal(value)))),
    tokenBudget: Type.Optional(Type.Number({ minimum: 1 })),
    agentBudget: Type.Optional(Type.Number({ minimum: 1 })),
    display: Type.Optional(
      Type.Union([
        Type.String(),
        Type.Object({
          name: Type.Optional(Type.String()),
          description: Type.Optional(Type.String()),
        }),
      ]),
    ),
  }),
  prepareArguments(args) {
    return prepareFabricExecArguments(args) as any;
  },
  renderCall(params, theme, context) {
    return renderLeanExecCall(params as Record<string, unknown>, theme, context.expanded);
  },
  renderResult(result, { expanded, isPartial }, theme) {
    return renderLeanExecResult(result, theme, expanded, isPartial);
  },
  async execute(toolCallId, params, signal, onUpdate, context) {
    const code = Array.isArray(params.code) ? params.code.join("\n") : String(params.code ?? "");
    const display = displayValue(params.display);
    const result = await runtime.execute({
      code,
      ...(params.strings ? { strings: params.strings } : {}),
      signal,
      parentToolCallId: toolCallId,
      context,
      ...(typeof params.tokenBudget === "number" ? { tokenBudget: params.tokenBudget } : {}),
      ...(typeof params.agentBudget === "number" ? { agentBudget: params.agentBudget } : {}),
      ...(display ? { display } : {}),
      onPartial(snapshot) {
        onUpdate?.({
          content: [],
          details: {
            audits: snapshot.audits,
            phases: snapshot.phases,
            ...(snapshot.progress ? { progress: snapshot.progress } : {}),
          },
        } as never);
      },
    });

    if (!result.success) {
      const typeErrors = result.typeErrors?.map((error) => error.message).filter(Boolean) ?? [];
      throw new Error(typeErrors.length > 0 ? typeErrors.join("\n") : result.error ?? "Code Mode execution failed");
    }

    const text = resultText(result.value, params.resultFormat);
    return {
      content: text === undefined || text === "" ? [] : [{ type: "text", text }],
      details: {
        success: true,
        elapsedMs: result.elapsedMs,
        phases: result.phases,
        audits: result.audits,
        trace: result.trace,
        ...(result.usage ? { usage: result.usage } : {}),
      },
    };
  },
});
