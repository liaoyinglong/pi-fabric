import type { FabricExecutionTraceV1 } from "./audit/trace.js";
import type { FabricCallAudit } from "./core/action-registry.js";

const LARGE_RESULT_CHARS = 10_000;
const VERY_LARGE_RESULT_CHARS = 50_000;

const compactCount = (count: number): string => {
  if (count < 1_000) return String(Math.round(count));
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}m`;
};

const durationLabel = (value: number): string => {
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
};

const resultLines = (text: string | undefined): number =>
  !text ? 0 : text.split("\n").length;

const codeLines = (code: string): number =>
  code.length === 0 ? 0 : code.split("\n").length;

const serializedChars = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value)?.length;
  } catch {
    return undefined;
  }
};

const discoveryRef = (ref: string): string | undefined => {
  switch (ref) {
    case "fabric.discovery.providers": return "tools.providers";
    case "fabric.discovery.catalog": return "tools.catalog";
    case "fabric.discovery.list": return "tools.list";
    case "fabric.discovery.search": return "tools.search";
    case "fabric.discovery.describe": return "tools.describe";
    default: return undefined;
  }
};

interface MutableCallStats {
  ref: string;
  calls: number;
  succeeded: number;
  failed: number;
  totalDurationMs: number;
  measuredDurations: number;
  totalResultChars: number;
  maxResultChars: number;
  measuredResults: number;
  truncatedResults: number;
}

export interface FabricSessionCallStats {
  ref: string;
  calls: number;
  succeeded: number;
  failed: number;
  totalDurationMs: number;
  measuredDurations: number;
  totalResultChars: number;
  maxResultChars: number;
  measuredResults: number;
  truncatedResults: number;
}

export interface FabricSessionStatsSnapshot {
  executions: number;
  succeeded: number;
  failed: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
  p95ElapsedMs: number;
  totalCodeLines: number;
  totalCodeChars: number;
  averageCodeLines: number;
  averageCodeChars: number;
  maxCodeLines: number;
  maxCodeChars: number;
  totalResultLines: number;
  totalResultChars: number;
  estimatedResultTokens: number;
  averageResultChars: number;
  maxResultChars: number;
  resultsOver10kChars: number;
  resultsOver50kChars: number;
  calls: FabricSessionCallStats[];
}

export interface RecordFabricExecutionInput {
  code: string;
  resultText?: string;
  success: boolean;
  elapsedMs: number;
  audits?: readonly FabricCallAudit[];
  trace?: FabricExecutionTraceV1;
}

const percentile95 = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

export class FabricSessionStats {
  #executions = 0;
  #succeeded = 0;
  #failed = 0;
  #elapsed: number[] = [];
  #totalCodeLines = 0;
  #totalCodeChars = 0;
  #maxCodeLines = 0;
  #maxCodeChars = 0;
  #totalResultLines = 0;
  #totalResultChars = 0;
  #maxResultChars = 0;
  #resultsOver10kChars = 0;
  #resultsOver50kChars = 0;
  readonly #calls = new Map<string, MutableCallStats>();

  reset(): void {
    this.#executions = 0;
    this.#succeeded = 0;
    this.#failed = 0;
    this.#elapsed = [];
    this.#totalCodeLines = 0;
    this.#totalCodeChars = 0;
    this.#maxCodeLines = 0;
    this.#maxCodeChars = 0;
    this.#totalResultLines = 0;
    this.#totalResultChars = 0;
    this.#maxResultChars = 0;
    this.#resultsOver10kChars = 0;
    this.#resultsOver50kChars = 0;
    this.#calls.clear();
  }

  recordExecution(input: RecordFabricExecutionInput): void {
    const lines = codeLines(input.code);
    const chars = input.code.length;
    const outputChars = input.resultText?.length ?? 0;

    this.#executions++;
    if (input.success) this.#succeeded++;
    else this.#failed++;
    if (Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0) this.#elapsed.push(input.elapsedMs);

    this.#totalCodeLines += lines;
    this.#totalCodeChars += chars;
    this.#maxCodeLines = Math.max(this.#maxCodeLines, lines);
    this.#maxCodeChars = Math.max(this.#maxCodeChars, chars);

    this.#totalResultLines += resultLines(input.resultText);
    this.#totalResultChars += outputChars;
    this.#maxResultChars = Math.max(this.#maxResultChars, outputChars);
    if (outputChars > LARGE_RESULT_CHARS) this.#resultsOver10kChars++;
    if (outputChars > VERY_LARGE_RESULT_CHARS) this.#resultsOver50kChars++;

    for (const audit of input.audits ?? []) this.#recordAudit(audit);
    for (const operation of input.trace?.operations ?? []) {
      const ref = discoveryRef(operation.ref);
      if (!ref) continue;
      this.#recordCall({
        ref,
        success: operation.outcome === "succeeded",
        failed: operation.outcome !== "succeeded",
        resultChars: serializedChars(operation.result),
        truncated: operation.resultTruncated === true,
      });
    }
  }

  snapshot(): FabricSessionStatsSnapshot {
    const totalElapsedMs = this.#elapsed.reduce((total, value) => total + value, 0);
    const divisor = this.#executions || 1;
    return {
      executions: this.#executions,
      succeeded: this.#succeeded,
      failed: this.#failed,
      totalElapsedMs,
      averageElapsedMs: this.#elapsed.length > 0 ? totalElapsedMs / this.#elapsed.length : 0,
      p95ElapsedMs: percentile95(this.#elapsed),
      totalCodeLines: this.#totalCodeLines,
      totalCodeChars: this.#totalCodeChars,
      averageCodeLines: this.#totalCodeLines / divisor,
      averageCodeChars: this.#totalCodeChars / divisor,
      maxCodeLines: this.#maxCodeLines,
      maxCodeChars: this.#maxCodeChars,
      totalResultLines: this.#totalResultLines,
      totalResultChars: this.#totalResultChars,
      estimatedResultTokens: Math.ceil(this.#totalResultChars / 4),
      averageResultChars: this.#totalResultChars / divisor,
      maxResultChars: this.#maxResultChars,
      resultsOver10kChars: this.#resultsOver10kChars,
      resultsOver50kChars: this.#resultsOver50kChars,
      calls: [...this.#calls.values()]
        .map((entry) => ({ ...entry }))
        .sort((left, right) =>
          right.totalResultChars - left.totalResultChars ||
          right.calls - left.calls ||
          left.ref.localeCompare(right.ref),
        ),
    };
  }

  format(): string {
    return formatFabricSessionStats(this.snapshot());
  }

  #recordAudit(audit: FabricCallAudit): void {
    const duration =
      typeof audit.endedAt === "number" && Number.isFinite(audit.endedAt) &&
      typeof audit.startedAt === "number" && Number.isFinite(audit.startedAt)
        ? Math.max(0, audit.endedAt - audit.startedAt)
        : undefined;
    this.#recordCall({
      ref: audit.ref || [audit.provider, audit.tool].filter(Boolean).join(".") || "tool",
      success: audit.success === true,
      failed: audit.success === false,
      durationMs: duration,
      resultChars: audit.resultChars,
      truncated: audit.resultTruncated === true,
    });
  }

  #recordCall(input: {
    ref: string;
    success: boolean;
    failed: boolean;
    durationMs?: number | undefined;
    resultChars?: number | undefined;
    truncated: boolean;
  }): void {
    let stats = this.#calls.get(input.ref);
    if (!stats) {
      stats = {
        ref: input.ref,
        calls: 0,
        succeeded: 0,
        failed: 0,
        totalDurationMs: 0,
        measuredDurations: 0,
        totalResultChars: 0,
        maxResultChars: 0,
        measuredResults: 0,
        truncatedResults: 0,
      };
      this.#calls.set(input.ref, stats);
    }
    stats.calls++;
    if (input.success) stats.succeeded++;
    if (input.failed) stats.failed++;
    if (input.durationMs !== undefined && Number.isFinite(input.durationMs)) {
      stats.totalDurationMs += Math.max(0, input.durationMs);
      stats.measuredDurations++;
    }
    if (input.resultChars !== undefined && Number.isFinite(input.resultChars)) {
      const chars = Math.max(0, input.resultChars);
      stats.totalResultChars += chars;
      stats.maxResultChars = Math.max(stats.maxResultChars, chars);
      stats.measuredResults++;
    }
    if (input.truncated) stats.truncatedResults++;
  }
}

export const formatFabricSessionStats = (stats: FabricSessionStatsSnapshot): string => {
  if (stats.executions === 0) {
    return "Fabric session stats\n\nNo fabric_exec executions in this session yet.";
  }

  const lines = [
    "Fabric session stats",
    "",
    `Executions  ${stats.executions} (${stats.succeeded} ok / ${stats.failed} failed)`,
    `Code        ${compactCount(stats.totalCodeLines)} lines · ${compactCount(stats.totalCodeChars)} chars · avg ${stats.averageCodeLines.toFixed(1)} lines / ${compactCount(stats.averageCodeChars)} chars · max ${compactCount(stats.maxCodeLines)} lines / ${compactCount(stats.maxCodeChars)} chars`,
    `Result      ${compactCount(stats.totalResultLines)} lines · ${compactCount(stats.totalResultChars)} chars · ~${compactCount(stats.estimatedResultTokens)} tokens est. · ${compactCount(stats.maxResultChars)} chars max`,
    `Large       >10k chars: ${stats.resultsOver10kChars} · >50k chars: ${stats.resultsOver50kChars}`,
    `Elapsed     ${durationLabel(stats.totalElapsedMs)} total · ${durationLabel(stats.averageElapsedMs)} avg · ${durationLabel(stats.p95ElapsedMs)} p95`,
  ];

  if (stats.calls.length > 0) {
    lines.push("", "Nested calls");
    for (const call of stats.calls) {
      const result = call.measuredResults > 0
        ? `${compactCount(call.totalResultChars)} chars · ${compactCount(call.maxResultChars)} max`
        : "result size n/a";
      const suffix = [
        call.failed > 0 ? `${call.failed} failed` : "",
        call.truncatedResults > 0 ? `${call.truncatedResults} truncated` : "",
        call.measuredDurations > 0 ? `${durationLabel(call.totalDurationMs)} total` : "",
      ].filter(Boolean);
      lines.push(`${call.ref.padEnd(20)} ${String(call.calls).padStart(4)} · ${result}${suffix.length > 0 ? ` · ${suffix.join(" · ")}` : ""}`);
    }
  }

  return lines.join("\n");
};
