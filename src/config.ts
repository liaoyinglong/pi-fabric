import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FabricRisk } from "./protocol.js";

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
  /** Generic risk class for third-party actions that delegate to another agent. */
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
  advisory: boolean;
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
  advisory: FabricCapabilityAdvisoryConfig;
}

/**
 * Lean V2 config. `fullCodeMode` and `schema.mode` remain broad at the type
 * boundary only so ExecutionService's low-level unit tests can exercise legacy
 * branches. The V2 loader always normalizes them to true/off respectively.
 *
 * Agent runners, workflow scheduling, and transient todo state intentionally
 * do not belong to this config. Those concerns are owned by the calling agent.
 */
export interface FabricConfig {
  fullCodeMode: boolean;
  executor: FabricExecutorConfig;
  approvals: FabricApprovalConfig;
  mcp: FabricMcpConfig;
  capture: FabricToolCaptureConfig;
  ui: { updateDebounceMs: number };
  schema: { mode: "off" | "audit" | "enforce" };
}

export const MIN_HOST_CALL_TIMEOUT_MS = 1_000;
export const MAX_HOST_CALL_TIMEOUT_MS = 24 * 3_600_000;
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
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const stringList = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [...fallback];

const approvalMode = (value: unknown, fallback: FabricApprovalMode): FabricApprovalMode =>
  value === "allow" || value === "ask" || value === "auto" || value === "deny" ? value : fallback;
const riskValue = (value: unknown, fallback: FabricRisk): FabricRisk =>
  value === "read" || value === "write" || value === "execute" || value === "network" || value === "agent"
    ? value
    : fallback;

export const normalizeFabricConfig = (raw: Record<string, unknown>): FabricConfig => {
  const executor = isObject(raw.executor) ? raw.executor : {};
  const approvals = isObject(raw.approvals) ? raw.approvals : {};
  const mcp = isObject(raw.mcp) ? raw.mcp : {};
  const mcpCache = isObject(mcp.cache) ? mcp.cache : {};
  const capture = isObject(raw.capture) ? raw.capture : {};
  const rawRisks = isObject(capture.risks) ? capture.risks : {};
  const runtime: FabricExecutorRuntime = executor.runtime === "node-process" ? "node-process" : "quickjs";
  const resultFormat: FabricResultFormat =
    executor.resultFormat === "yaml" || executor.resultFormat === "json" || executor.resultFormat === "text"
      ? executor.resultFormat
      : "auto";
  const risks: Record<string, FabricRisk> = { ...DEFAULT_FABRIC_CONFIG.capture.risks };
  for (const [name, value] of Object.entries(rawRisks)) {
    risks[name] = riskValue(value, DEFAULT_FABRIC_CONFIG.capture.defaultRisk);
  }
  const revalidate: FabricMcpRevalidatePolicy =
    mcpCache.revalidate === "all" || mcpCache.revalidate === "off"
      ? mcpCache.revalidate
      : "changed";

  return {
    fullCodeMode: true,
    executor: {
      runtime,
      timeoutMs: numberValue(
        executor.timeoutMs,
        DEFAULT_FABRIC_CONFIG.executor.timeoutMs,
        MIN_HOST_CALL_TIMEOUT_MS,
        MAX_HOST_CALL_TIMEOUT_MS,
      ),
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
      callTimeoutMs: numberValue(
        mcp.callTimeoutMs,
        DEFAULT_FABRIC_CONFIG.mcp.callTimeoutMs,
        MIN_HOST_CALL_TIMEOUT_MS,
        MAX_HOST_CALL_TIMEOUT_MS,
      ),
      cache: {
        enabled: booleanValue(mcpCache.enabled, DEFAULT_FABRIC_CONFIG.mcp.cache.enabled),
        revalidate,
        revalidateBudgetMs: numberValue(
          mcpCache.revalidateBudgetMs,
          DEFAULT_FABRIC_CONFIG.mcp.cache.revalidateBudgetMs,
          MIN_HOST_CALL_TIMEOUT_MS,
          MAX_HOST_CALL_TIMEOUT_MS,
        ),
      },
      advisory: false,
    },
    capture: {
      enabled: booleanValue(capture.enabled, DEFAULT_FABRIC_CONFIG.capture.enabled),
      hideFromModel: booleanValue(capture.hideFromModel, DEFAULT_FABRIC_CONFIG.capture.hideFromModel),
      keepVisible: stringList(capture.keepVisible, DEFAULT_FABRIC_CONFIG.capture.keepVisible),
      defaultRisk: riskValue(capture.defaultRisk, DEFAULT_FABRIC_CONFIG.capture.defaultRisk),
      risks,
      advisory: { ...DEFAULT_FABRIC_CONFIG.capture.advisory },
    },
    ui: { updateDebounceMs: 100 },
    schema: { mode: "off" },
  };
};

export const effectiveToolCaptureConfig = (config: FabricConfig): FabricToolCaptureConfig =>
  config.capture;

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
  return normalizeFabricConfig(merge(merge(globalConfig, projectConfig), explicitConfig));
};
