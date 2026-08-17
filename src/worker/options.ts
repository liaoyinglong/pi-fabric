import type { AgentWorkerOptions } from "../agents/types.js";

const argumentMap = (argv: readonly string[]): Map<string, string> => {
  const result = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid worker argument near ${key ?? "<end>"}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
};

const required = (args: Map<string, string>, name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing worker argument: --${name}`);
  return value;
};

const optional = (args: Map<string, string>, name: string): string | undefined =>
  args.get(name) || undefined;

export const parseWorkerOptions = (
  argv: readonly string[] = process.argv,
): AgentWorkerOptions => {
  const args = argumentMap(argv);
  const model = optional(args, "model");
  const thinking = optional(args, "thinking");
  const fabricExtensionPath = optional(args, "fabric-extension");
  const schemaFile = optional(args, "schema-file");
  const imagesFile = optional(args, "images-file");
  const systemPrompt = optional(args, "system-prompt");
  const sessionFile = optional(args, "session-file");
  const sessionExportFile = optional(args, "session-export-file");
  const projectRoot = optional(args, "project-root");
  const runRoot = optional(args, "run-root");
  const steerFile = optional(args, "steer-file");
  const branch = optional(args, "branch");
  const worktree = optional(args, "worktree");
  const maxTokens = optional(args, "max-tokens");
  const runnerSessionId = optional(args, "runner-session-id");
  const mainAgentId = optional(args, "main-agent-id");
  const cliAdapter = optional(args, "cli-adapter");
  const cliBinary = optional(args, "cli-binary");
  const runner = required(args, "runner");
  if (runner !== "pi" && runner !== "claude" && runner !== "cli") {
    throw new Error(`Unsupported Fabric agent runner: ${runner}`);
  }
  if (runner === "cli") {
    if (cliAdapter !== "agy" && cliAdapter !== "droid") {
      throw new Error(`Unsupported Fabric CLI adapter: ${cliAdapter ?? "<missing>"}`);
    }
    if (!cliBinary) throw new Error("Missing worker argument: --cli-binary");
  }
  return {
    id: required(args, "id"),
    runner,
    ...(cliAdapter === "agy" || cliAdapter === "droid" ? { cliAdapter } : {}),
    ...(cliBinary ? { cliBinary } : {}),
    // Internal defaults keep the pre-existing Pi/Claude worker's dead Veda
    // branch type-safe. New runs never receive runner=veda from this parser.
    vedaBinary: "veda",
    vedaBackend: "agy",
    vedaPersona: "navigator-chat",
    name: required(args, "name"),
    taskFile: required(args, "task-file"),
    ...(imagesFile ? { imagesFile } : {}),
    statusFile: required(args, "status-file"),
    lifecycleFile: required(args, "lifecycle-file"),
    logFile: required(args, "log-file"),
    ...(schemaFile ? { schemaFile } : {}),
    cwd: required(args, "cwd"),
    piBinary: required(args, "pi-binary"),
    claudeBinary: required(args, "claude-binary"),
    timeoutMs: Number(required(args, "timeout-ms")),
    depth: Number(required(args, "depth")),
    fullCodeMode: required(args, "full-code-mode") === "true",
    ...(mainAgentId ? { mainAgentId } : {}),
    extensions: required(args, "extensions") === "true",
    tools: JSON.parse(required(args, "tools")) as string[],
    grantedRisks: JSON.parse(required(args, "granted-risks")) as string[],
    transport: required(args, "transport") as AgentWorkerOptions["transport"],
    ...(fabricExtensionPath ? { fabricExtensionPath } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(sessionFile ? { sessionFile } : {}),
    ...(sessionExportFile ? { sessionExportFile } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    ...(runnerSessionId ? { runnerSessionId } : {}),
    ...(runRoot ? { runRoot } : {}),
    ...(steerFile ? { steerFile } : {}),
    ...(branch ? { branch } : {}),
    ...(worktree ? { worktree } : {}),
    ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
  };
};
