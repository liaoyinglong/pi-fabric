export const FABRIC_NESTED_TOOL_CALL_ID_PREFIX = "fabric_";
export const FABRIC_TOOL_RESULT_PROXY_KIND = "pi-fabric.tool-result-proxy.v1";

/** Stable middleware envelope used by Pi extensions that patch nested Fabric results. */
export interface FabricToolResultProxyDetailsV1 {
  kind: typeof FABRIC_TOOL_RESULT_PROXY_KIND;
  ref: string;
  result: unknown;
}

export const readFabricToolResultProxyDetailsV1 = (
  value: unknown,
): FabricToolResultProxyDetailsV1 | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.kind !== FABRIC_TOOL_RESULT_PROXY_KIND ||
    typeof record.ref !== "string" ||
    !Object.prototype.hasOwnProperty.call(record, "result")
  ) return undefined;
  return record as unknown as FabricToolResultProxyDetailsV1;
};
