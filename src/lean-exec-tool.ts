import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { stringify as stringifyYaml } from "yaml";
import { prepareFabricExecArguments } from "./fabric-exec-arguments.js";
import type { LeanFabricRuntime } from "./lean-runtime.js";
import { renderLeanExecCall, renderLeanExecResult } from "./ui/lean-exec-render.js";

const RESULT_FORMATS = ["auto", "yaml", "json", "text"] as const;

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
  runtime: LeanFabricRuntime,
): ToolDefinition<any, any, any> => defineTool({
  name: "fabric_exec",
  label: "Code Mode",
  description:
    "Execute one type-checked TypeScript program that composes Pi core tools, captured Pi extension tools, and MCP tools. Intermediate values stay inside the runtime; return only the bounded value needed by the caller.",
  promptSnippet: "programmatic tool calling through one bounded TypeScript execution",
  promptGuidelines: [
    "Use fabric_exec to batch related tool operations. Use sequential await when one result determines the next step and Promise.all(...) only for independent work.",
    "Inside fabric_exec, Pi core tools are pi.read, pi.bash, pi.edit, pi.write, pi.grep, pi.find, and pi.ls; shell execution is pi.bash, not pi.exec.",
    "Inside fabric_exec, pi.read/pi.grep/pi.find/pi.ls return strings, while pi.bash/pi.edit/pi.write return {ok, output, details} envelopes.",
    "fabric_exec runs in a sandbox, not a Node.js module environment; process and require are unavailable to guest code.",
    "Inside fabric_exec, use extensions.* for captured Pi extension tools, mcp.* for known MCP tools, and tools.search/tools.describe/tools.call for dynamic discovery.",
    "Return compact decisions, evidence, or changed results from fabric_exec. Keep raw logs and unused intermediate values inside the program.",
  ],
  parameters: Type.Object({
    code: Type.String({ description: "TypeScript function body with top-level await and return" }),
    strings: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Named strings exposed to the program as π.key",
      }),
    ),
    resultFormat: Type.Optional(Type.Union(RESULT_FORMATS.map((value) => Type.Literal(value)))),
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
    const result = await runtime.execute({
      code,
      ...(params.strings ? { strings: params.strings } : {}),
      signal,
      parentToolCallId: toolCallId,
      context,
      onPartial(snapshot) {
        onUpdate?.({
          content: [],
          details: {
            audits: snapshot.audits,
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
        audits: result.audits,
        trace: result.trace,
      },
    };
  },
});
