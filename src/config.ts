import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FabricRisk } from "./protocol.js";
import { DEFAULT_FABRIC_THINKING, isFabricThinking, type FabricThinking } from "./thinking.js";

export type FabricAgentTransport = "auto" | "process" | "tmux" | "screen" | "localterm" | "herdr";
export type FabricAgentRunner = "pi" | "claude" | "veda";
export type FabricResultFormat = "auto" | "yaml" | "json" | "text";
export type FabricExecutorRuntime = "quickjs" | "node-process";
export type FabricConfigScope = "global" | "project";

type FabricApprovalMode = "allow" | "ask" | "auto" | "deny";
type FabricMcpRevalidatePolicy = "changed" | "all" | "off";

export interface FabricExecutorConfig {
  runtime: FabricExecutorRuntime;
  timeoutMs: number;
  memoryLimitBytes: number;
  maxOutputChars: number;
  maxNestedResultChars: number;
  resultFormat: FabricResultFormat;
}

export interface FabricApprovalConfig {
  read: FabricApprovalMode;
  write: FabricApprovalMode;
  execute: FabricApprovalMode;
  network: FabricApprovalMode;
  agent: FabricApprovalMode;
  model?: string;
}

export interface FabricMcpConfig {
  enabled: boolean;
  configPath?: string;
  disableOAuth: boolean;
  allowDynamicServers: boolean;
  callTimeoutMs: number;
  cache: {
    enabled: boolean;
    revalidate: FabricMcpRevalidatePolicy;
    revalidateBudgetMs: number;
  };
  /** Kept for config compatibility; the lean runtime does not emit capability advisories. */
  advisory: boolean;
}

export interface FabricAgentConfig {
  enabled: boolean;
  runner: FabricAgentRunner;
  transport: FabricAgentTransport;
  model?: string;
  claude: { binary: string; model?: string };
  veda: { binary: string; backend: string; model?: string; persona: string };
  thinking: FabricThinking;
  maxConcurrent: number;
  maxPerExecution: number;
  maxDepth: number;
  timeoutMs: number;
  extensions: boolean;
  defaultTools: string[];
  retainRuns: boolean;
  notifyOnComplete: boolean;
  budgetUsd: number;
  maxTokensPerChild: number;
  sessionExport: boolean;
  sessionExportDir: string;
}

export interface FabricCapabilityAdvisoryConfig {
  mode: "enabled" | "hidden" | "disabled";
  threshold: number;
  maxPerSession: number;
  budget: number;
}

export interface FabricToolCaptureConfig {
  enabled: boolean;
  hideFromModel: boolean;
  keepVisible: string[];
  defaultRisk: FabricRisk;
  risks: Record<string, FabricRisk>;
  /** Shape retained for capture-policy compatibility; always disabled by the lean runtime. */
  advisory: FabricCapabilityAdvisoryConfig;
}

export interface FabricRetentionConfig {
  orphanedTempRunMs: number;
  oneShotRunMs: number;
  /** Retained only because AgentManager understands old run archives; no actors are created in V2. */
  actorRunArchiveMs: number;
}

/**
 * V2 runtime configuration. The two undersized compatibility fields (`ui` and
 * `schema`) exist only until ExecutionService stops reading those historical
 * locations; there is no UI dashboard or schema runtime in this branch.
 */
export interface FabricConfig {
  fullCodeMode: true;
  executor: FabricExecutorConfig;
  approvals: FabricApprovalConfig;
  mcp: FabricMcpConfig;
  agents: FabricAgentConfig;
  capture: FabricToolCaptureConfig;
  retention: FabricRetentionConfig;
  ui: { updateDebounceMs: number };
  schema: { mode: "off" };
}

export const MIN_AGENT_TIMEOUT_MS = 1_000;
export const MAX_AGENT_TIMEOUT_MS = 24 * 3_600_000;
const DEFAULT_AGENT_TIMEOUT_MS = 3_600_000;
export const QUICKJS_MAX_MEMORY_LIMIT_BYTES = 0xffff_ffff;
export const MAX_EXECUTOR_MEMORY_LIMIT_BYTES = Math.max(
  8 * 1024 * 1024,
  Math.min(Number.MAX_SAFE_INTEGER, Math.floor(os.totalmem())),
);

export const maxExecutorMemoryLimitBytes = (runtime: FabricExecutorRuntime): number =>
  runtime === "quickjs"
    ? Math.min(QUICKJS_MAX_MEMORY_LIMIT_BYTES, MAX_EXECUTOR_MEMORY_LIMIT_BYTES)
    : MAX_EXECUTOR_MEMORY_LIMIT_BYTES;

export const DEFAULT_FABRIC_CONFIG: FabricConfig = {
  fullCodeMode: true,
  executor: {
    runtime: "quickjs",
    timeoutMs: 120_000,
    memoryLimitBytes: 64 * 1024 * 1024,
    maxOutputChars: 50_000,
    maxNestedResultChars: 2_000_000,
    resultFormat: "auto",
  },
  approvals: {
    read: "allow",
    write: "allow",
    execute: "allow",
    network: "allow",
    agent: "allow",
  },
  mcp: {
    enabled: true,
    disableOAuth: true,
    allowDynamicServers: true,
    callTimeoutMs: 120_000,
    cache: {
      enabled: true,
      revalidate: "changed",
      revalidateBudgetMs: 60_000,
    },
    advisory: false,
  },
  agents: {
    enabled: true,
    runner: "pi",
    transport: "process",
    claude: { binary: "claude" },
    veda: { binary: "veda", backend: "agy", persona: "navigator-chat" },
    thinking: DEFAULT_FABRIC_THINKING,
    maxConcurrent: 4,
    maxPerExecution: 100,
    maxDepth: 2,
    timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
    extensions: true,
    defaultTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    retainRuns: false,
    notifyOnComplete: true,
    budgetUsd: 0,
    maxTokensPerChild: 0,
    sessionExport: true,
    sessionExportDir: "",
  },
  capture: {
    enabled: true,
    hideFromModel: true,
    keepVisible: ["fabric_exec"],
    defaultRisk: "execute",
    risks: {
      read: "read",
      grep: "read",
      find: "read",
      ls: "read",
      edit: "write",
      write: "write",
      bash: "execute",
    },
    advisory: { mode: "disabled", threshold: 0.9, maxPerSession: 0, budget: 0 },
  },
  retention: {
    orphanedTempRunMs: 6 * 60 * 60 * 1_000,
    oneShotRunMs: 24 * 60 * 60 * 1_000,
    actorRunArchiveMs: 7 * 24 * 60 * 60 * 1_000,
  },
  ui: { updateDebounceMs: 100 },
  schema: { mode: "off" },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readObject = (filePath: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isObject(parsed)) throw new Error("configuration root must be an object");
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const merge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isObject(current) && isObject(value) ? merge(current, value) : value;
  }
  return result;
};

const numberValue = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const stringValue = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const stringList = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [...fallback];

const approvalMode = (value: unknown, fallback: FabricApprovalMode): FabricApprovalMode =>
  value === "allow" || value === "ask" || value === "auto" || value === "deny" ? value : fallback;
const runnerValue = (value: unknown, fallback: FabricAgentRunner): FabricAgentRunner =>
  value === "pi" || value === "claude" || value === "veda" ? value : fallback;
const transportValue = (value: unknown, fallback: FabricAgentTransport): FabricAgentTransport =>
  value === "auto" || value === "process" || value === "tmux" || value === "screen" ||
  value === "localterm" || value === "herdr" ? value : fallback;
const riskValue = (value: unknown, fallback: FabricRisk): FabricRisk =>
  value === "read" || value === "write" || value === "execute" || value === "network" || value === "agent"
    ? value
    : fallback;

const normalize = (raw: Record<string, unknown>): FabricConfig => {
  const executor = isObject(raw.executor) ? raw.executor : {};
  const approvals = isObject(raw.approvals) ? raw.approvals : {};
  const mcp = isObject(raw.mcp) ? raw.mcp : {};
  const mcpCache = isObject(mcp.cache) ? mcp.cache : {};
  const agents = isObject(raw.agents) ? raw.agents : {};
  const claude = isObject(agents.claude) ? agents.claude : {};
  const veda = isObject(agents.veda) ? agents.veda : {};
  const capture = isObject(raw.capture) ? raw.capture : {};
  const rawRisks = isObject(capture.risks) ? capture.risks : {};
  const retention = isObject(raw.retention) ? raw.retention : {};
  const runtime: FabricExecutorRuntime = executor.runtime === "node-process" ? "node-process" : "quickjs";
  const resultFormat: FabricResultFormat =
    executor.resultFormat === "yaml" || executor.resultFormat === "json" || executor.resultFormat === "text"
      ? executor.resultFormat
      : "auto";
  const risks: Record<string, FabricRisk> = { ...DEFAULT_FABRIC_CONFIG.capture.risks };
  for (const [name, value] of Object.entries(rawRisks)) risks[name] = riskValue(value, DEFAULT_FABRIC_CONFIG.capture.defaultRisk);
  const thinking = isFabricThinking(agents.thinking) ? agents.thinking : DEFAULT_FABRIC_CONFIG.agents.thinking;
  const revalidate: FabricMcpRevalidatePolicy =
    mcpCache.revalidate === "all" || mcpCache.revalidate === "off" ? mcpCache.revalidate : "changed";

  return {
    fullCodeMode: true,
    executor: {
      runtime,
      timeoutMs: numberValue(executor.timeoutMs, DEFAULT_FABRIC_CONFIG.executor.timeoutMs, 1_000, MAX_AGENT_TIMEOUT_MS),
      memoryLimitBytes: numberValue(
        executor.memoryLimitBytes,
        DEFAULT_FABRIC_CONFIG.executor.memoryLimitBytes,
        8 * 1024 * 1024,
        maxExecutorMemoryLimitBytes(runtime),
      ),
      maxOutputChars: numberValue(executor.maxOutputChars, DEFAULT_FABRIC_CONFIG.executor.maxOutputChars, 1_000, 10_000_000),
      maxNestedResultChars: numberValue(executor.maxNestedResultChars, DEFAULT_FABRIC_CONFIG.executor.maxNestedResultChars, 1_000, 20_000_000),
      resultFormat,
    },
    approvals: {
      read: approvalMode(approvals.read, DEFAULT_FABRIC_CONFIG.approvals.read),
      write: approvalMode(approvals.write, DEFAULT_FABRIC_CONFIG.approvals.write),
      execute: approvalMode(approvals.execute, DEFAULT_FABRIC_CONFIG.approvals.execute),
      network: approvalMode(approvals.network, DEFAULT_FABRIC_CONFIG.approvals.network),
      agent: approvalMode(approvals.agent, DEFAULT_FABRIC_CONFIG.approvals.agent),
      ...(optionalString(approvals.model) ? { model: optionalString(approvals.model)! } : {}),
    },
    mcp: {
      enabled: booleanValue(mcp.enabled, DEFAULT_FABRIC_CONFIG.mcp.enabled),
      ...(optionalString(mcp.configPath) ? { configPath: optionalString(mcp.configPath)! } : {}),
      disableOAuth: booleanValue(mcp.disableOAuth, DEFAULT_FABRIC_CONFIG.mcp.disableOAuth),
      allowDynamicServers: booleanValue(mcp.allowDynamicServers, DEFAULT_FABRIC_CONFIG.mcp.allowDynamicServers),
      callTimeoutMs: numberValue(mcp.callTimeoutMs, DEFAULT_FABRIC_CONFIG.mcp.callTimeoutMs, 1_000, MAX_AGENT_TIMEOUT_MS),
      cache: {
        enabled: booleanValue(mcpCache.enabled, DEFAULT_FABRIC_CONFIG.mcp.cache.enabled),
        revalidate,
        revalidateBudgetMs: numberValue(mcpCache.revalidateBudgetMs, DEFAULT_FABRIC_CONFIG.mcp.cache.revalidateBudgetMs, 1_000, MAX_AGENT_TIMEOUT_MS),
      },
      advisory: false,
    },
    agents: {
      enabled: booleanValue(agents.enabled, DEFAULT_FABRIC_CONFIG.agents.enabled),
      runner: runnerValue(agents.runner, DEFAULT_FABRIC_CONFIG.agents.runner),
      transport: transportValue(agents.transport, DEFAULT_FABRIC_CONFIG.agents.transport),
      ...(optionalString(agents.model) ? { model: optionalString(agents.model)! } : {}),
      claude: {
        binary: stringValue(claude.binary, DEFAULT_FABRIC_CONFIG.agents.claude.binary),
        ...(optionalString(claude.model) ? { model: optionalString(claude.model)! } : {}),
      },
      veda: {
        binary: stringValue(veda.binary, DEFAULT_FABRIC_CONFIG.agents.veda.binary),
        backend: stringValue(veda.backend, DEFAULT_FABRIC_CONFIG.agents.veda.backend),
        persona: stringValue(veda.persona, DEFAULT_FABRIC_CONFIG.agents.veda.persona),
        ...(optionalString(veda.model) ? { model: optionalString(veda.model)! } : {}),
      },
      thinking,
      maxConcurrent: Math.floor(numberValue(agents.maxConcurrent, DEFAULT_FABRIC_CONFIG.agents.maxConcurrent, 1, 32)),
      maxPerExecution: Math.floor(numberValue(agents.maxPerExecution, DEFAULT_FABRIC_CONFIG.agents.maxPerExecution, 1, 1_000)),
      maxDepth: Math.floor(numberValue(agents.maxDepth, DEFAULT_FABRIC_CONFIG.agents.maxDepth, 0, 16)),
      timeoutMs: numberValue(agents.timeoutMs, DEFAULT_FABRIC_CONFIG.agents.timeoutMs, MIN_AGENT_TIMEOUT_MS, MAX_AGENT_TIMEOUT_MS),
      extensions: booleanValue(agents.extensions, DEFAULT_FABRIC_CONFIG.agents.extensions),
      defaultTools: stringList(agents.defaultTools, DEFAULT_FABRIC_CONFIG.agents.defaultTools),
      retainRuns: booleanValue(agents.retainRuns, DEFAULT_FABRIC_CONFIG.agents.retainRuns),
      notifyOnComplete: booleanValue(agents.notifyOnComplete, DEFAULT_FABRIC_CONFIG.agents.notifyOnComplete),
      budgetUsd: numberValue(agents.budgetUsd, DEFAULT_FABRIC_CONFIG.agents.budgetUsd, 0),
      maxTokensPerChild: Math.floor(numberValue(agents.maxTokensPerChild, DEFAULT_FABRIC_CONFIG.agents.maxTokensPerChild, 0)),
      sessionExport: booleanValue(agents.sessionExport, DEFAULT_FABRIC_CONFIG.agents.sessionExport),
      sessionExportDir: typeof agents.sessionExportDir === "string" ? agents.sessionExportDir.trim() : DEFAULT_FABRIC_CONFIG.agents.sessionExportDir,
    },
    capture: {
      enabled: booleanValue(capture.enabled, DEFAULT_FABRIC_CONFIG.capture.enabled),
      hideFromModel: booleanValue(capture.hideFromModel, DEFAULT_FABRIC_CONFIG.capture.hideFromModel),
      keepVisible: stringList(capture.keepVisible, DEFAULT_FABRIC_CONFIG.capture.keepVisible),
      defaultRisk: riskValue(capture.defaultRisk, DEFAULT_FABRIC_CONFIG.capture.defaultRisk),
      risks,
      advisory: { ...DEFAULT_FABRIC_CONFIG.capture.advisory },
    },
    retention: {
      orphanedTempRunMs: numberValue(retention.orphanedTempRunMs, DEFAULT_FABRIC_CONFIG.retention.orphanedTempRunMs, 0),
      oneShotRunMs: numberValue(retention.oneShotRunMs, DEFAULT_FABRIC_CONFIG.retention.oneShotRunMs, 0),
      actorRunArchiveMs: numberValue(retention.actorRunArchiveMs, DEFAULT_FABRIC_CONFIG.retention.actorRunArchiveMs, 0),
    },
    ui: { updateDebounceMs: 100 },
    schema: { mode: "off" },
  };
};

export interface LoadFabricConfigOptions {
  cwd: string;
  agentDir: string;
  projectTrusted?: boolean;
}

export const fabricConfigPath = (scope: FabricConfigScope, options: LoadFabricConfigOptions): string =>
  scope === "global"
    ? path.join(options.agentDir, "fabric.json")
    : path.join(options.cwd, ".pi", "fabric.json");

export const loadFabricConfig = (options: LoadFabricConfigOptions): FabricConfig => {
  const globalConfig = readObject(fabricConfigPath("global", options)) ?? {};
  const projectConfig = options.projectTrusted === false
    ? {}
    : readObject(fabricConfigPath("project", options)) ?? {};
  const explicitPath = process.env.PI_FABRIC_CONFIG?.trim();
  const explicitConfig = explicitPath ? readObject(path.resolve(explicitPath)) ?? {} : {};
  const merged = merge(merge(globalConfig, projectConfig), explicitConfig);
  return normalize(merged);
};
