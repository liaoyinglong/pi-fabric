import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { stringify as stringifyYaml } from "yaml";
import { prepareFabricExecArguments } from "./fabric-exec-arguments.js";
import type { LeanFabricRuntime } from "./lean-runtime.js";
import type { FabricSessionStats } from "./session-stats.js";
import { renderLeanExecCall, renderLeanExecResult } from "./ui/lean-exec-render.js";
import type { FabricResultInspectorLike } from "./ui/result-inspector.js";

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
  resultInspector?: FabricResultInspectorLike,
  sessionStats?: FabricSessionStats,
): ToolDefinition<any, any, any> => defineTool({
  name: "fabric_exec",
  label: "Code Mode",
  description:
    "Execute one type-checked TypeScript program that composes Pi core tools, captured Pi extension tools, and MCP tools. Prefer it for data-heavy work where raw output may be large or unpredictable: intermediate values stay inside the runtime; return only the bounded value needed by the caller.",
  promptSnippet: "programmatic tool calling through one bounded TypeScript execution",
  promptGuidelines: [
    "Use fabric_exec to batch related tool operations. Use sequential await when one result determines the next step and Promise.all(...) only for independent work.",
    "Prefer fabric_exec when tool output size/shape is unknown or potentially large (repo-wide search, logs, list/query endpoints, browser/MCP snapshots), especially when you only need derived facts.",
    "When nested calls return more data than the answer needs, filter, count, aggregate, parse, compare, or transform inside fabric_exec. The final return should contain only the decision plus the smallest bounded evidence needed to support it; do not forward raw logs, broad listings, full files, or unused fields.",
    "Treat shell stdout as data to reduce before returning. For potentially large pi.bash output, constrain it at the source with focused commands/filters or parse the output in TypeScript and return only selected lines, counts, fields, or summaries.",
    "For unfamiliar tools, use progressive discovery: tools.list()/tools.search() return schema-light summaries by default. Prefer a small explicit candidate limit such as tools.search({query, limit:5}), then call tools.describe({ref}) only for the selected tool(s). Avoid includeSchemas:true unless bulk schemas are required.",
    "Inside fabric_exec, Pi core tools are pi.read, pi.bash, pi.edit, pi.write, pi.grep, pi.find, and pi.ls; shell execution is pi.bash, not pi.exec.",
    "Inside fabric_exec, pi.read/pi.grep/pi.find/pi.ls return strings, while pi.bash/pi.edit/pi.write return {ok, output, details} envelopes.",
    "pi.bash accepts a command string/object or (command, options); options include timeout/timeoutMs/settle, not cwd. Change directory inside the command, and use settle: true when a nonzero exit is an expected result such as rg/grep finding no matches.",
    "pi.edit accepts {path, oldText, newText}, {path, edits:[...]}, or (path, oldText, newText); there is no patch or two-argument form. Put multiline or template-heavy payloads in fabric_exec strings and reference them as π.key.",
    "fabric_exec runs in a sandbox, not a Node.js module environment; process and require are unavailable to guest code.",
    "Use extensions.* for captured Pi extension tools and mcp.* for known MCP tools. For computed refs use tools.call({ref,args}); tools.call takes one object, with ref/args fields.",
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
  renderResult(result, { expanded, isPartial }, theme, context) {
    resultInspector?.captureExecution?.({
      inspectId: context.toolCallId,
      args: context.args as Record<string, unknown>,
      ...(result.details === undefined ? {} : { details: result.details }),
    });
    return renderLeanExecResult(result, theme, expanded, isPartial, {
      inspectId: context.toolCallId,
      ...(resultInspector ? { inspector: resultInspector } : {}),
    });
  },
  async execute(toolCallId, params, signal, onUpdate, context) {
    const code = Array.isArray(params.code) ? params.code.join("\n") : String(params.code ?? "");
    const startedAt = performance.now();
    let recorded = false;
    try {
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

      const text = resultText(result.value, params.resultFormat);
      sessionStats?.recordExecution({
        code,
        ...(text === undefined ? {} : { resultText: text }),
        success: result.success,
        elapsedMs: result.elapsedMs,
        audits: result.audits,
        trace: result.trace,
      });
      recorded = true;

      if (!result.success) {
        const typeErrors = result.typeErrors?.map((error) => error.message).filter(Boolean) ?? [];
        throw new Error(typeErrors.length > 0 ? typeErrors.join("\n") : result.error ?? "Code Mode execution failed");
      }

      return {
        content: text === undefined || text === "" ? [] : [{ type: "text", text }],
        details: {
          success: true,
          elapsedMs: result.elapsedMs,
          audits: result.audits,
          trace: result.trace,
        },
      };
    } catch (error) {
      if (!recorded) {
        sessionStats?.recordExecution({
          code,
          success: false,
          elapsedMs: performance.now() - startedAt,
        });
      }
      throw error;
    }
  },
});
