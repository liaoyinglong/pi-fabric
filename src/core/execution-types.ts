import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type FabricRisk = "read" | "write" | "execute" | "network";
export type FabricEffectKind = "none" | "transactional" | "emission";
export type FabricEffectOrdering = "commutative" | "ordered" | "unknown";

export interface FabricActionEffect {
  kind: FabricEffectKind;
  resources?: string[];
  ordering?: FabricEffectOrdering;
}

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
  descriptorHash: string;
}

export interface FabricCommittedCapabilityView {
  digest: string;
  bindings: Record<string, FabricCapabilityBindingView>;
}

export interface FabricCapabilityRequirement {
  ref: string;
  optional?: boolean;
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
  attachMedia?(blocks: FabricMediaBlock[], note?: string): void;
  updateArguments?(args: Record<string, unknown>): void;
  attachPreview?(preview: unknown): void;
  capabilityView?: FabricCommittedCapabilityView;
  effectPolicy?: "advisory" | "strict";
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
  close?(): Promise<void>;
}
