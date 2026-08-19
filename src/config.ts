import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FabricRisk } from "./core/execution-types.js";

export type FabricResultFormat = "auto" | "yaml" | "json" | "text";
export type FabricConfigScope = "global" | "project";

type FabricApprovalMode = "allow" | "ask" | "deny";
type FabricMcpRevalidatePolicy = "changed" | "all" | "off";

export interface FabricExecutorConfig {
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
}

export interface FabricToolCaptureConfig {
  /** Internal capture lifecycle switch. Lean configuration always normalizes this to true. */
  enabled: boolean;
  keepVisible: string[];
  defaultRisk: FabricRisk;
  risks: Record<string, FabricRisk>;
}

/** Lean V2 configuration contains execution mechanics only. */
export interface FabricConfig {
  executor: FabricExecutorConfig;
  approvals: FabricApprovalConfig;
  mcp: FabricMcpConfig;
  capture: FabricToolCaptureConfig;
  ui: { updateDebounceMs: number };
}

export const MIN_HOST_CALL_TIMEOUT_MS = 1_000;
export const MAX_HOST_CALL_TIMEOUT_MS = 24 * 3_600_000;
export const QUICKJS_MAX_MEMORY_LIMIT_BYTES = 0xffff_ffff;
export const MAX_EXECUTOR_MEMORY_LIMIT_BYTES = Math.max(
  8 * 1024 * 1024,
  Math.min(QUICKJS_MAX_MEMORY_LIMIT_BYTES, Math.floor(os.totalmem())),
);

export const DEFAULT_FABRIC_CONFIG: FabricConfig = {
  executor: {
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
  },
  capture: {
    enabled: true,
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
  },
  ui: { updateDebounceMs: 100 },
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

const numberValue = (
  value: unknown,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number => typeof value === "number" && Number.isFinite(value)
  ? Math.max(min, Math.min(max, value))
  : fallback;
const booleanValue = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const stringList = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim()).filter(Boolean)
    : [...fallback];

const approvalMode = (value: unknown, fallback: FabricApprovalMode): FabricApprovalMode => {
  if (value === "allow" || value === "ask" || value === "deny") return value;
  if (value === "auto") return "ask";
  return fallback;
};

const riskValue = (value: unknown, fallback: FabricRisk): FabricRisk => {
  if (value === "read" || value === "write" || value === "execute" || value === "network") {
    return value;
  }
  // Historical agent risk represented delegated execution. Lean V2 no longer
  // has an agent provider; map old capture config to the retained execute gate.
  if (value === "agent") return "execute";
  return fallback;
};

export const normalizeFabricConfig = (raw: Record<string, unknown>): FabricConfig => {
  const executor = isObject(raw.executor) ? raw.executor : {};
  const approvals = isObject(raw.approvals) ? raw.approvals : {};
  const mcp = isObject(raw.mcp) ? raw.mcp : {};
  const mcpCache = isObject(mcp.cache) ? mcp.cache : {};
  const capture = isObject(raw.capture) ? raw.capture : {};
  const rawRisks = isObject(capture.risks) ? capture.risks : {};
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
    executor: {
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
        MAX_EXECUTOR_MEMORY_LIMIT_BYTES,
      ),
      maxOutputChars: numberValue(
        executor.maxOutputChars,
        DEFAULT_FABRIC_CONFIG.executor.maxOutputChars,
        1_000,
        10_000_000,
      ),
      maxNestedResultChars: numberValue(
        executor.maxNestedResultChars,
        DEFAULT_FABRIC_CONFIG.executor.maxNestedResultChars,
        1_000,
        20_000_000,
      ),
      resultFormat,
    },
    approvals: {
      read: approvalMode(approvals.read, DEFAULT_FABRIC_CONFIG.approvals.read),
      write: approvalMode(approvals.write, DEFAULT_FABRIC_CONFIG.approvals.write),
      execute: approvalMode(approvals.execute, DEFAULT_FABRIC_CONFIG.approvals.execute),
      network: approvalMode(approvals.network, DEFAULT_FABRIC_CONFIG.approvals.network),
    },
    mcp: {
      enabled: booleanValue(mcp.enabled, DEFAULT_FABRIC_CONFIG.mcp.enabled),
      ...(optionalString(mcp.configPath) ? { configPath: optionalString(mcp.configPath)! } : {}),
      disableOAuth: booleanValue(mcp.disableOAuth, DEFAULT_FABRIC_CONFIG.mcp.disableOAuth),
      allowDynamicServers: booleanValue(
        mcp.allowDynamicServers,
        DEFAULT_FABRIC_CONFIG.mcp.allowDynamicServers,
      ),
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
    },
    capture: {
      // Lean always captures registered extension tools so `extensions.*` and
      // exact-name core overrides have one stable execution contract.
      enabled: true,
      keepVisible: stringList(capture.keepVisible, DEFAULT_FABRIC_CONFIG.capture.keepVisible),
      defaultRisk: riskValue(capture.defaultRisk, DEFAULT_FABRIC_CONFIG.capture.defaultRisk),
      risks,
    },
    ui: { updateDebounceMs: 100 },
  };
};

export const effectiveToolCaptureConfig = (config: FabricConfig): FabricToolCaptureConfig =>
  config.capture;

export interface LoadFabricConfigOptions {
  cwd: string;
  agentDir: string;
  projectTrusted?: boolean;
}

export const fabricConfigPath = (
  scope: FabricConfigScope,
  options: LoadFabricConfigOptions,
): string => scope === "global"
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