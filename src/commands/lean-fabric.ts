import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { AgentHandleInfo, AgentRunRecord, FabricLogLine } from "../agents/types.js";
import type { AgentManager } from "../agents/manager.js";
import type { LeanCodeModeRuntime } from "../lean-runtime.js";

const MAX_INLINE_TEXT = 1_200;
const DEFAULT_LOG_LINES = 40;
const MAX_LOG_LINES = 500;
const HIDDEN_LOG_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "tool_execution_update",
  "extension_ui_request",
  "queue_update",
  "system",
  "user",
  "stream_event",
  "result",
]);

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const clip = (value: string, limit = MAX_INLINE_TEXT): string => {
  const text = compactWhitespace(value);
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1))}…`;
};

const isRunRecord = (value: AgentRunRecord | AgentHandleInfo): value is AgentRunRecord =>
  "startedAt" in value;

const runnerLabel = (value: AgentRunRecord | AgentHandleInfo): string =>
  value.runner === "cli" && value.cli ? `cli/${value.cli}` : value.runner;

const totalTokens = (value: AgentRunRecord): number =>
  value.usage.input + value.usage.output + value.usage.cacheRead + value.usage.cacheWrite;

export const formatLeanFabricAgent = (
  value: AgentRunRecord | AgentHandleInfo,
  indent = "",
): string => {
  const bits = [
    `${indent}${value.id.slice(0, 8)}`,
    value.status,
    runnerLabel(value),
    value.transport,
  ];
  if (value.model) bits.push(value.model);
  if (isRunRecord(value)) {
    if (value.currentTool) bits.push(`tool:${value.currentTool}`);
    if (value.toolCalls > 0) bits.push(`${value.toolCalls} calls`);
    const tokens = totalTokens(value);
    if (tokens > 0) bits.push(`${tokens} tok`);
  }
  return `${bits.join(" · ")} — ${clip(value.name, 160)}`;
};

const nestedAgentLines = (value: AgentRunRecord, depth = 1): string[] =>
  (value.nestedAgents ?? []).flatMap((nested) => [
    formatLeanFabricAgent(nested, `${"  ".repeat(depth)}↳ `),
    ...nestedAgentLines(nested, depth + 1),
  ]);

export const formatLeanFabricAgentList = (
  values: Array<AgentRunRecord | AgentHandleInfo>,
): string => {
  if (values.length === 0) return "No Fabric subagents in this session.";
  return values
    .flatMap((value) => [
      formatLeanFabricAgent(value),
      ...(isRunRecord(value) ? nestedAgentLines(value) : []),
    ])
    .join("\n");
};

const contentText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join(" ");
};

export const formatLeanFabricLogLine = (line: FabricLogLine): string => {
  const value = line.parsed;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return clip(line.raw, 500);
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (type && HIDDEN_LOG_EVENT_TYPES.has(type)) return "";

  if (type === "tool_execution_start") {
    return typeof record.toolName === "string" ? `tool: ${clip(record.toolName, 500)}` : "tool";
  }
  if (type === "tool_execution_end") {
    if (record.isError !== true) return "";
    return typeof record.toolName === "string"
      ? `tool_error: ${clip(record.toolName, 500)}`
      : "tool_error";
  }

  const message = record.message;
  if (typeof message === "object" && message !== null && !Array.isArray(message)) {
    const msg = message as Record<string, unknown>;
    const role = typeof msg.role === "string" ? msg.role : "message";
    if ((type === "message_end" || type === "assistant") && role !== "assistant") return "";
    const model = typeof msg.model === "string" ? ` [${msg.model}]` : "";
    const text = contentText(msg.content);
    if (text) return `${role}${model}: ${clip(text, 500)}`;
  }
  const detail =
    typeof record.error === "string"
      ? record.error
      : typeof record.text === "string"
        ? record.text
        : typeof record.toolName === "string"
          ? record.toolName
          : typeof record.message === "string"
            ? record.message
            : "";
  if (type) return detail ? `${type}: ${clip(detail, 500)}` : type;
  return clip(line.raw, 500);
};

const resolveAgentId = (manager: AgentManager, candidate: string): string => {
  const runs = manager.list();
  const exact = runs.find((run) => run.id === candidate);
  if (exact) return exact.id;
  const matches = runs.filter((run) => run.id.startsWith(candidate));
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length === 0) throw new Error(`Unknown Fabric agent: ${candidate}`);
  throw new Error(`Ambiguous Fabric agent id prefix: ${candidate}`);
};

const formatStatus = (value: AgentRunRecord | AgentHandleInfo): string => {
  const lines = [formatLeanFabricAgent(value)];
  if (isRunRecord(value)) {
    if (value.task) lines.push(`task: ${clip(value.task)}`);
    if (value.error) lines.push(`error: ${clip(value.error)}`);
    if (value.text) lines.push(`output: ${clip(value.text)}`);
    if (value.attachCommand) lines.push(`attach: ${value.attachCommand}`);
  } else if (value.attachCommand) {
    lines.push(`attach: ${value.attachCommand}`);
  }
  return lines.join("\n");
};

const parseLogLines = (args: string[]): number => {
  let lines = DEFAULT_LOG_LINES;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if ((arg === "--lines" || arg === "-n") && index + 1 < args.length) {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value)) lines = Math.max(1, Math.min(Math.floor(value), MAX_LOG_LINES));
      index++;
    }
  }
  return lines;
};

const agentCompletions = (manager: AgentManager, prefix: string): AutocompleteItem[] | null => {
  const items = manager.list().map((run) => ({
    value: run.id.slice(0, 8),
    label: run.id.slice(0, 8),
    description: `${run.status} ${runnerLabel(run)} — ${run.name}`,
  }));
  const filtered = items.filter((item) => item.value.startsWith(prefix));
  return filtered.length > 0 ? filtered : null;
};

const openLeanFabricDashboard = async (
  manager: AgentManager,
  context: ExtensionContext,
): Promise<"settings" | undefined> => {
  if (context.mode !== "tui") {
    context.ui.notify(formatLeanFabricAgentList(manager.listForUi()), "info");
    return undefined;
  }
  const { LeanFabricDashboard } = await import("../ui/lean-dashboard.js");
  let dispose: (() => void) | undefined;
  try {
    return await context.ui.custom<"settings" | undefined>(
      (tui, theme, _keybindings, done) => {
        const dashboard = new LeanFabricDashboard(tui, theme, manager, (action) => done(action));
        dispose = () => dashboard.dispose();
        return dashboard;
      },
      {
        overlay: true,
        overlayOptions: {
          width: "94%",
          minWidth: 36,
          maxHeight: "90%",
          anchor: "center",
          margin: 1,
        },
      },
    );
  } finally {
    dispose?.();
  }
};

const openLeanFabricSettings = async (context: ExtensionContext): Promise<void> => {
  if (context.mode !== "tui") {
    context.ui.notify("/fabric settings is available in TUI mode.", "warning");
    return;
  }
  const { LeanFabricSettings } = await import("../ui/lean-settings.js");
  await context.ui.custom<void>(
    (_tui, theme, _keybindings, done) => new LeanFabricSettings(
      theme,
      {
        cwd: context.cwd,
        agentDir: getAgentDir(),
        projectTrusted: context.isProjectTrusted(),
      },
      () => done(undefined),
    ),
    {
      overlay: true,
      overlayOptions: {
        width: "88%",
        minWidth: 44,
        maxHeight: "90%",
        anchor: "center",
        margin: 1,
      },
    },
  );
};

export function registerLeanFabricCommand(
  pi: ExtensionAPI,
  runtime: LeanCodeModeRuntime,
): void {
  pi.registerCommand("fabric", {
    description: "Open the Lean Fabric dashboard/settings or inspect subagent output",
    getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
      const subcommands = ["dashboard", "settings", "agents", "status", "log", "stop"];
      const firstSpace = argumentPrefix.indexOf(" ");
      if (firstSpace < 0) {
        const matches = subcommands.filter((name) => name.startsWith(argumentPrefix));
        return matches.length > 0 ? matches.map((name) => ({ value: name, label: name })) : null;
      }
      const command = argumentPrefix.slice(0, firstSpace);
      if (command !== "status" && command !== "log" && command !== "stop") return null;
      const manager = runtime.agentManager;
      if (!manager) return null;
      return agentCompletions(manager, argumentPrefix.slice(firstSpace + 1));
    },
    async handler(argumentsText, context) {
      await runtime.initialize(context);
      const args = argumentsText.trim().split(/\s+/).filter(Boolean);
      const command = args[0] ?? "dashboard";

      try {
        if (command === "settings") {
          await openLeanFabricSettings(context);
          return;
        }

        const manager = runtime.agentManager;
        if (!manager) {
          context.ui.notify("Fabric subagents are disabled by configuration. Use /fabric settings to configure them.", "warning");
          return;
        }

        if (command === "dashboard" || command === "ui") {
          const action = await openLeanFabricDashboard(manager, context);
          if (action === "settings") await openLeanFabricSettings(context);
          return;
        }

        if (command === "agents") {
          context.ui.notify(formatLeanFabricAgentList(manager.listForUi()), "info");
          return;
        }

        if (command === "status") {
          const candidate = args[1];
          if (!candidate) {
            context.ui.notify("Usage: /fabric status <agent-id>", "warning");
            return;
          }
          const id = resolveAgentId(manager, candidate);
          context.ui.notify(formatStatus(manager.status(id)), "info");
          return;
        }

        if (command === "log") {
          const candidate = args[1];
          if (!candidate) {
            context.ui.notify("Usage: /fabric log <agent-id> [--lines N]", "warning");
            return;
          }
          const id = resolveAgentId(manager, candidate);
          const log = manager.readLog(id, { lines: parseLogLines(args.slice(1)) });
          const body = log.events.map(formatLeanFabricLogLine).filter(Boolean).join("\n");
          const status = log.status ? formatLeanFabricAgent(log.status) : `${id.slice(0, 8)} running`;
          context.ui.notify(
            `${status}\n${body || "No output recorded yet."}${log.hasMore ? "\n… older events available with a larger --lines value" : ""}`,
            "info",
          );
          return;
        }

        if (command === "stop") {
          const candidate = args[1];
          if (!candidate) {
            context.ui.notify("Usage: /fabric stop <agent-id>", "warning");
            return;
          }
          const id = resolveAgentId(manager, candidate);
          const result = await manager.stop(id);
          context.ui.notify(`Fabric agent ${id.slice(0, 8)} ${result.status}.`, "info");
          return;
        }

        context.ui.notify(
          "Usage: /fabric [dashboard] | /fabric settings | /fabric agents | /fabric status <id> | /fabric log <id> [--lines N] | /fabric stop <id>",
          "warning",
        );
      } catch (error) {
        context.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
