import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FABRIC_NESTED_TOOL_CALL_ID_PREFIX = "fabric_";
export const FABRIC_TOOL_RESULT_PROXY_KIND = "pi-fabric.tool-result-proxy.v1";

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

export type FabricRisk = "read" | "write" | "execute" | "network" | "agent";
export type FabricEffectKind = "none" | "scoped" | "transactional" | "emission";
export type FabricEffectOrdering = "commutative" | "ordered" | "unknown";

export interface FabricActionEffect {
  kind: FabricEffectKind;
  resources?: string[];
  ordering?: FabricEffectOrdering;
}

export type FabricActivityEntityKind =
  | "agent"
  | "tool"
  | "extension"
  | "mcp"
  | "task"
  | "custom";

export type FabricInvocationActivityUpdate =
  | { type: "progress"; message: string }
  | { type: "entity"; id: string; kind: FabricActivityEntityKind; name?: string }
  | { type: "metrics"; tokens?: number; toolCalls?: number; cost?: number };

export interface FabricMediaBlock {
  type: "image";
  data: string;
  mimeType: string;
}

export interface FabricActionDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk: FabricRisk;
  namespace?: string;
  effect?: FabricActionEffect;
}

export interface FabricCapabilityActionHead {
  key: string;
  parentKey: string;
  ref: string;
  name: string;
  description: string;
  descriptorHash: string;
  risk: FabricRisk;
  namespace?: string;
  effect?: FabricActionEffect;
}

export interface FabricCapabilityProviderHead {
  key: string;
  parentKey: string;
  name: string;
  description: string;
  descriptorHash: string;
  actions: FabricCapabilityActionHead[];
}

export interface FabricCapabilityBindingView {
  ref: string;
  provider: string;
  providerBindingId: string;
  generation: number;
  descriptorHash: string;
}

export interface FabricCommittedCapabilityView {
  id: string;
  digest: string;
  semanticDigest: string;
  bindings: Record<string, FabricCapabilityBindingView>;
}

export interface FabricCapabilityResolution {
  satisfied: boolean;
  missing: string[];
  optionalMissing: string[];
  view?: FabricCommittedCapabilityView;
}

export interface FabricCapabilityCatalog {
  kind: "pi-fabric.capability-catalog";
  version: 1;
  root: {
    key: "capability:fabric";
    name: "Fabric capabilities";
    description: string;
    descriptorHash: string;
  };
  providers: FabricCapabilityProviderHead[];
  totalActions: number;
  indexedActions: number;
  complete: boolean;
  reasons: string[];
}

export interface FabricProviderListRequest {
  namespace?: string;
  query?: string;
  limit?: number;
}

export interface FabricNamedActionTypeSource {
  name: string;
  inputSchema: Record<string, unknown>;
}

export interface FabricMcpServerTypeSource {
  server: string;
  tools: FabricNamedActionTypeSource[];
}

export interface FabricGuestTypeSources {
  mcpServers?: FabricMcpServerTypeSource[];
  extensionTools?: FabricNamedActionTypeSource[];
}

export interface FabricDynamicGuestDeclarations {
  mcp?: string;
  extensions?: string;
}

export interface FabricInvocationContext {
  cwd: string;
  signal: AbortSignal | undefined;
  parentToolCallId: string;
  nestedToolCallId: string;
  extensionContext: ExtensionContext;
  update(message: string): void;
  activity?(update: FabricInvocationActivityUpdate): void;
  /** @internal Legacy ExecutionService test hook pending physical handoff cleanup. */
  deferHandoff?(args: Record<string, unknown>): Record<string, unknown>;
  attachMedia?(blocks: FabricMediaBlock[], note?: string): void;
  updateArguments?(args: Record<string, unknown>): void;
  attachPreview?(preview: unknown): void;
  capabilityView?: FabricCommittedCapabilityView;
  effectPolicy?: "advisory" | "strict";
}

export interface FabricScopedProviderResult {
  value: unknown;
  dispose(): void | Promise<void>;
}

export interface FabricProvider {
  name: string;
  description: string;
  list(
    request: FabricProviderListRequest,
    context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor[]>;
  describe(
    actionName: string,
    context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor | undefined>;
  prepareArguments?(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown>;
  acquire?(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<FabricScopedProviderResult>;
  invocationEnded?(parentToolCallId: string): Promise<void>;
  subscribeCatalog?(listener: () => void): () => void;
  close?(): Promise<void>;
}
