import {
  readFabricExecutionTraceV1,
  type FabricExecutionTraceOperationV1,
  type FabricExecutionTraceV1,
} from "./trace.js";

export const FABRIC_EXECUTION_DETAILS_MAX_BYTES = 512 * 1024;

export interface FabricPersistedExecutionDetailsV1 {
  success: boolean;
  trace: FabricExecutionTraceV1;
  /** Rich render audits persisted verbatim (minus in-memory media). */
  audits: FabricLegacyRenderAudit[];
  error?: string;
  outputFormat?: "yaml" | "json";
  outputFormatStartLine?: number;
  outputFormatLines?: number;
}

export interface FabricPersistableAuditInput {
  ref: string;
  tool?: string;
  provider?: string;
  success?: boolean;
  error?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  resultTruncated?: boolean;
  preview?: unknown;
  startedAt?: number;
  endedAt?: number;
}

export interface FabricLegacyRenderAudit {
  ref: string;
  tool?: string;
  provider?: string;
  success?: boolean;
  error?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  resultTruncated?: boolean;
  preview?: unknown;
  /** Set only when reconstructed from the durable trace. */
  fromTrace?: boolean;
  startedAt?: number;
  endedAt?: number;
}

export interface FabricExecutionRenderDetails {
  success?: boolean;
  error?: string;
  progress?: string;
  outputFormat?: "yaml" | "json";
  outputFormatStartLine?: number;
  outputFormatLines?: number;
  audits: FabricLegacyRenderAudit[];
}

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const cloneTrace = (trace: FabricExecutionTraceV1): FabricExecutionTraceV1 =>
  structuredClone(trace);

const persistableAudit = (audit: FabricPersistableAuditInput): FabricLegacyRenderAudit =>
  structuredClone({
    ref: audit.ref,
    ...(audit.tool !== undefined ? { tool: audit.tool } : {}),
    ...(audit.provider !== undefined ? { provider: audit.provider } : {}),
    ...(audit.success !== undefined ? { success: audit.success } : {}),
    ...(audit.error !== undefined ? { error: audit.error } : {}),
    ...(audit.args !== undefined ? { args: audit.args } : {}),
    ...(audit.result !== undefined ? { result: audit.result } : {}),
    ...(audit.resultTruncated !== undefined ? { resultTruncated: audit.resultTruncated } : {}),
    ...(audit.preview !== undefined ? { preview: audit.preview } : {}),
    ...(audit.startedAt !== undefined ? { startedAt: audit.startedAt } : {}),
    ...(audit.endedAt !== undefined ? { endedAt: audit.endedAt } : {}),
  });

export const createFabricPersistedExecutionDetails = (input: {
  success: boolean;
  trace: FabricExecutionTraceV1;
  audits?: readonly FabricPersistableAuditInput[];
  error?: string;
  outputFormat?: "yaml" | "json";
  outputFormatStartLine?: number;
  outputFormatLines?: number;
}): FabricPersistedExecutionDetailsV1 => {
  const details: FabricPersistedExecutionDetailsV1 = {
    success: input.success,
    trace: cloneTrace(input.trace),
    audits: (input.audits ?? []).map(persistableAudit),
    ...(typeof input.error === "string" && input.error ? { error: input.error } : {}),
    ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}),
    ...(input.outputFormatStartLine !== undefined
      ? { outputFormatStartLine: Math.max(0, Math.floor(input.outputFormatStartLine)) }
      : {}),
    ...(input.outputFormatLines !== undefined
      ? { outputFormatLines: Math.max(0, Math.floor(input.outputFormatLines)) }
      : {}),
  };
  while (
    serializedBytes(details) > FABRIC_EXECUTION_DETAILS_MAX_BYTES &&
    details.audits.length > 0
  ) {
    details.audits.pop();
  }
  while (
    serializedBytes(details) > FABRIC_EXECUTION_DETAILS_MAX_BYTES &&
    details.trace.operations.length > 0
  ) {
    details.trace.operations.pop();
    details.trace.counts.droppedOperations++;
  }
  if (serializedBytes(details) > FABRIC_EXECUTION_DETAILS_MAX_BYTES) {
    delete details.trace.error;
    details.trace.counts.droppedValues++;
  }
  return details;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const legacyAudit = (value: unknown): FabricLegacyRenderAudit | undefined => {
  if (!isRecord(value) || typeof value.ref !== "string") return undefined;
  return {
    ref: value.ref,
    ...(typeof value.tool === "string" ? { tool: value.tool } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.success === "boolean" ? { success: value.success } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(isRecord(value.args) ? { args: value.args } : {}),
    ...(value.result !== undefined ? { result: value.result } : {}),
    ...(typeof value.resultTruncated === "boolean"
      ? { resultTruncated: value.resultTruncated }
      : {}),
    ...(value.preview !== undefined ? { preview: value.preview } : {}),
    ...(typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.endedAt === "number" ? { endedAt: value.endedAt } : {}),
  };
};

const auditFromOperation = (
  operation: FabricExecutionTraceOperationV1,
): FabricLegacyRenderAudit => ({
  ref: operation.ref,
  fromTrace: true,
  ...(operation.action ? { tool: operation.action } : {}),
  ...(operation.provider ? { provider: operation.provider } : {}),
  success: operation.outcome === "succeeded",
  ...(operation.error ? { error: operation.error } : {}),
  ...(Object.keys(operation.args).length > 0 ? { args: operation.args } : {}),
  ...(operation.result !== undefined ? { result: operation.result } : {}),
  ...(operation.resultTruncated === true ? { resultTruncated: true } : {}),
});

/** Adapts legacy audit-bearing details and current trace details for rendering. */
export const readFabricExecutionRenderDetails = (
  value: unknown,
): FabricExecutionRenderDetails => {
  if (!isRecord(value)) return { audits: [] };
  const trace = readFabricExecutionTraceV1(value.trace);
  const oldAudits = Array.isArray(value.audits)
    ? value.audits.map(legacyAudit).filter((audit): audit is FabricLegacyRenderAudit => audit !== undefined)
    : undefined;
  return {
    ...(typeof value.success === "boolean"
      ? { success: value.success }
      : trace
        ? { success: trace.outcome === "succeeded" }
        : {}),
    ...(typeof value.error === "string"
      ? { error: value.error }
      : trace?.error
        ? { error: trace.error }
        : {}),
    ...(typeof value.progress === "string" ? { progress: value.progress } : {}),
    ...(value.outputFormat === "yaml" || value.outputFormat === "json"
      ? { outputFormat: value.outputFormat }
      : {}),
    ...(typeof value.outputFormatStartLine === "number" &&
      Number.isFinite(value.outputFormatStartLine) &&
      value.outputFormatStartLine >= 0
      ? { outputFormatStartLine: Math.floor(value.outputFormatStartLine) }
      : {}),
    ...(typeof value.outputFormatLines === "number" &&
      Number.isFinite(value.outputFormatLines) &&
      value.outputFormatLines >= 0
      ? { outputFormatLines: Math.floor(value.outputFormatLines) }
      : {}),
    audits: oldAudits ?? trace?.operations.map(auditFromOperation) ?? [],
  };
};
