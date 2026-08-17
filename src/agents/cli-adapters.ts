import type { FabricCliAdapter } from "../config.js";
import type { FabricThinking } from "../thinking.js";

export interface CliAdapterRunArguments {
  prompt: string;
  model?: string;
  thinking?: FabricThinking;
  tools: readonly string[];
}

export interface CliAdapterUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface CliAdapterResult {
  text: string;
  sessionId?: string;
  model?: string;
  turns: number;
  toolCalls?: number;
  usage?: CliAdapterUsage;
  error?: string;
}

export interface CliAdapter {
  readonly id: FabricCliAdapter;
  readonly oneShot: true;
  buildArguments(input: CliAdapterRunArguments): string[];
  normalizeModel(model: string): string;
  mapTools(tools: readonly string[]): string[];
  parseOutput(output: string): CliAdapterResult;
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const numberField = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizePrefixedModel = (model: string, prefix: string): string => {
  const value = model.trim();
  if (!value) throw new Error("CLI adapter model must not be empty");
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
};

const unsupportedTool = (adapter: FabricCliAdapter, tool: string): never => {
  throw new Error(`CLI adapter ${adapter} does not support Fabric tool: ${tool}`);
};

const AGY_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);

const agyAdapter: CliAdapter = {
  id: "agy",
  oneShot: true,
  mapTools(tools) {
    for (const tool of tools) {
      if (!AGY_TOOLS.has(tool)) unsupportedTool("agy", tool);
    }
    // Antigravity CLI currently has no per-run tool allowlist in headless mode.
    // Keep the Fabric list as an advisory prompt boundary instead of silently
    // enabling --dangerously-skip-permissions, which would weaken user policy.
    return [...new Set(tools)];
  },
  normalizeModel(model) {
    return normalizePrefixedModel(model, "agy/");
  },
  buildArguments(input) {
    const tools = this.mapTools(input.tools);
    const toolPolicy = tools.length > 0
      ? `Fabric requested this tool allowlist: ${tools.join(", ")}. Do not use tools outside this list.`
      : "Fabric requested an empty tool allowlist. Do not use tools for this task.";
    const prompt = `${toolPolicy}\n\n${input.prompt}`;
    const args: string[] = [];
    if (input.model) args.push("--model", this.normalizeModel(input.model));
    if (input.thinking) args.push("--effort", input.thinking);
    args.push("-p", prompt);
    return args;
  },
  parseOutput(output) {
    const text = output.trim();
    if (!text) throw new Error("Antigravity CLI returned no output");
    return { text, turns: 1 };
  },
};

const DROID_TOOL_MAP: Record<string, readonly string[]> = {
  read: ["Read"],
  grep: ["Grep"],
  find: ["Glob"],
  ls: ["LS"],
  bash: ["Execute"],
  edit: ["Edit", "ApplyPatch"],
  write: ["Create"],
};

const DROID_KNOWN_TOOLS = ["Read", "LS", "Grep", "Glob", "Create", "Edit", "ApplyPatch", "Execute"];

const mapDroidTools = (tools: readonly string[]): string[] => {
  const mapped: string[] = [];
  for (const tool of tools) {
    const ids = DROID_TOOL_MAP[tool];
    if (!ids) unsupportedTool("droid", tool);
    mapped.push(...ids);
  }
  return [...new Set(mapped)];
};

const droidAdapter: CliAdapter = {
  id: "droid",
  oneShot: true,
  mapTools: mapDroidTools,
  normalizeModel(model) {
    return normalizePrefixedModel(model, "droid/");
  },
  buildArguments(input) {
    const tools = this.mapTools(input.tools);
    const args = ["exec", "--output-format", "json"];
    if (input.model) args.push("--model", this.normalizeModel(input.model));
    if (input.thinking) args.push("--reasoning-effort", input.thinking);
    if (tools.length === 0) {
      args.push("--disabled-tools", DROID_KNOWN_TOOLS.join(","));
    } else {
      args.push("--restrict-tools", tools.join(","));
      if (tools.includes("Execute")) args.push("--auto", "medium");
      else if (tools.some((tool) => tool === "Create" || tool === "Edit" || tool === "ApplyPatch")) {
        args.push("--auto", "low");
      }
    }
    args.push(input.prompt);
    return args;
  },
  parseOutput(output) {
    const trimmed = output.trim();
    if (!trimmed) throw new Error("Droid CLI returned no output");
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Droid CLI returned an invalid JSON result");
    }
    const result = parsed as Record<string, unknown>;
    const text = nonEmpty(result.result) ?? "";
    const failed = result.is_error === true || (result.subtype !== undefined && result.subtype !== "success");
    const usageValue =
      typeof result.usage === "object" && result.usage !== null && !Array.isArray(result.usage)
        ? result.usage as Record<string, unknown>
        : undefined;
    const usage = usageValue
      ? {
          input: numberField(usageValue.input_tokens ?? usageValue.input),
          output: numberField(usageValue.output_tokens ?? usageValue.output),
          cacheRead: numberField(usageValue.cache_read_input_tokens ?? usageValue.cacheRead),
          cacheWrite: numberField(usageValue.cache_creation_input_tokens ?? usageValue.cacheWrite),
          cost: numberField(result.total_cost_usd ?? usageValue.cost),
        }
      : undefined;
    return {
      text,
      turns: Math.max(1, Math.floor(numberField(result.num_turns))),
      ...(nonEmpty(result.session_id) ? { sessionId: nonEmpty(result.session_id)! } : {}),
      ...(nonEmpty(result.model) ? { model: nonEmpty(result.model)! } : {}),
      ...(usage ? { usage } : {}),
      ...(failed ? { error: text || nonEmpty(result.error) || `Droid returned ${String(result.subtype ?? "an error")}` } : {}),
    };
  },
};

const ADAPTERS: Record<FabricCliAdapter, CliAdapter> = {
  agy: agyAdapter,
  droid: droidAdapter,
};

export const resolveCliAdapter = (adapter: FabricCliAdapter): CliAdapter => ADAPTERS[adapter];

export const mapCliTools = (adapter: FabricCliAdapter, tools: readonly string[]): string[] =>
  resolveCliAdapter(adapter).mapTools(tools);

export const normalizeCliModel = (adapter: FabricCliAdapter, model: string): string =>
  resolveCliAdapter(adapter).normalizeModel(model);
