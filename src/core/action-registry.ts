import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import { runAbortable } from "../async-settlement.js";
import type { FabricCapabilityRequirement } from "../components/types.js";
import {
  executionOutcomeFromError,
  FabricResolutionError,
  FabricTraceSafeError,
  type FabricExecutionTraceOperationHandle,
  type FabricExecutionTraceRecorder,
} from "../audit/trace.js";
import {
  FABRIC_NESTED_TOOL_CALL_ID_PREFIX,
  type FabricActionDescriptor,
  type FabricActionEffect,
  type FabricCapabilityBindingView,
  type FabricCapabilityCatalog,
  type FabricCapabilityResolution,
  type FabricCommittedCapabilityView,
  type FabricGuestTypeSources,
  type FabricInvocationContext,
  type FabricMediaBlock,
  type FabricNamedActionTypeSource,
  type FabricProvider,
  type FabricProviderListRequest,
} from "../protocol.js";
import { stableJsonHash } from "./stable-hash.js";
import type { FabricNestedToolResultProxy } from "./tool-result-proxy.js";

export interface ResolvedFabricAction extends FabricActionDescriptor {
  ref: string;
  provider: string;
}

interface FabricEffectConflict {
  withRef: string;
  resources: string[];
  reason: "shared_resource" | "unknown_resource";
}

interface RegisteredFabricProvider {
  id: string;
  name: string;
  generation: number;
  provider: FabricProvider;
}

export interface FabricCallAudit {
  ref: string;
  nestedToolCallId: string;
  startedAt: number;
  endedAt?: number;
  success?: boolean;
  error?: string;
  resultChars?: number;
  resultTruncated?: boolean;
  tool?: string;
  provider?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  media?: FabricMediaBlock[];
  mediaNote?: string;
  preview?: unknown;
  effectConflicts?: FabricEffectConflict[];
}

export interface FabricCapabilityViewLease extends FabricCapabilityResolution {
  release(): Promise<void>;
}

export interface FabricRegistryInvocationContext extends FabricInvocationContext {
  approve(
    action: ResolvedFabricAction,
    args: Record<string, unknown>,
  ): Promise<void>;
  audits: FabricCallAudit[];
  maxResultChars: number;
  trace?: FabricExecutionTraceRecorder;
  traceOperation?: FabricExecutionTraceOperationHandle;
  onInvocationEnd?(): void;
}

/**
 * Prefix pi-fabric prepends to every nested tool-call id it generates inside a
 * fabric_exec run (one per pi., mcp., or extensions. invocation). Extensions
 * can detect that a tool_call/tool_result event came from a nested Fabric call
 * by checking `event.toolCallId.startsWith(NESTED_TOOL_CALL_ID_PREFIX)`.
 */
export const NESTED_TOOL_CALL_ID_PREFIX = FABRIC_NESTED_TOOL_CALL_ID_PREFIX;

const providerNamePattern = /^[a-z][a-z0-9_-]*$/;

const PREVIEW_ARG_CHARS = 2_000;
const WRITE_PREVIEW_CONTENT_CHARS = 16_000;
const PREVIEW_ARG_KEYS = 32;
const PREVIEW_RESULT_CHARS = 16_000;
const PREVIEW_NESTED_CHARS = 16_000;
const MAX_AUDIT_VALUE_CHARS = 64_000;
const MAX_VALIDATION_MESSAGE_CHARS = 2_000;

const truncateString = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}…`;

const boundedPreviewValue = (value: unknown, maxChars: number): unknown => {
  if (value === undefined || value === null || typeof value !== "object") return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars) return JSON.parse(serialized) as unknown;
    return {
      fabricTruncated: true,
      originalChars: serialized.length,
      preview: serialized.slice(0, Math.max(1, maxChars - 100)),
    };
  } catch {
    return truncateString(String(value), maxChars);
  }
};

const previewArgs = (ref: string, args: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(args)) {
    if (count++ >= PREVIEW_ARG_KEYS) break;
    const maxChars =
      ref === "pi.write" && key === "content"
        ? WRITE_PREVIEW_CONTENT_CHARS
        : PREVIEW_ARG_CHARS;
    out[key] =
      typeof value === "string"
        ? truncateString(value, maxChars)
        : boundedPreviewValue(value, PREVIEW_NESTED_CHARS);
  }
  return out;
};

const previewResult = (value: unknown): unknown => {
  if (typeof value === "string") return truncateString(value, PREVIEW_RESULT_CHARS);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (count++ >= PREVIEW_ARG_KEYS) break;
      out[key] =
        typeof val === "string"
          ? truncateString(val, PREVIEW_RESULT_CHARS)
          : boundedPreviewValue(val, PREVIEW_NESTED_CHARS);
    }
    return out;
  }
  return boundedPreviewValue(value, PREVIEW_RESULT_CHARS);
};

const boundedResult = (
  value: unknown,
  maxChars: number,
): { value: unknown; chars: number; truncated: boolean } => {
  let serialized: string;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined && value !== undefined) {
      throw new Error(`unsupported result type: ${typeof value}`);
    }
    serialized = encoded ?? "null";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Fabric action returned a non-JSON-serializable value: ${message}`);
  }
  if (serialized.length <= maxChars) {
    return { value, chars: serialized.length, truncated: false };
  }
  const previewChars = Math.max(1, maxChars - 200);
  return {
    value: {
      fabricTruncated: true,
      originalChars: serialized.length,
      preview: serialized.slice(0, previewChars),
    },
    chars: serialized.length,
    truncated: true,
  };
};

const resolveDescriptor = (
  provider: FabricProvider,
  descriptor: FabricActionDescriptor,
): ResolvedFabricAction => ({
  ...descriptor,
  effect: descriptor.effect ?? (descriptor.risk === "read"
    ? { kind: "none", ordering: "commutative" }
    : { kind: "emission", ordering: "unknown" }),
  provider: provider.name,
  ref: `${provider.name}.${descriptor.name}`,
});

const descriptorHash = stableJsonHash;

const actionDescriptorHash = (action: ResolvedFabricAction): string =>
  descriptorHash({
    ref: action.ref,
    description: action.description,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    risk: action.risk,
    namespace: action.namespace,
    effect: action.effect,
  });

const discoveryTerms = (value: string): string[] =>
  [...value.normalize("NFKC").matchAll(/[\p{L}\p{N}_]+/gu)]
    .map((match) => match[0].toLowerCase());

const conflictBetween = (
  left: FabricActionEffect,
  right: FabricActionEffect,
): { resources: string[]; reason: FabricEffectConflict["reason"] } | undefined => {
  if (left.kind === "none" || right.kind === "none") return undefined;
  const resources = (effect: FabricActionEffect): string[] =>
    [...new Set((effect.resources ?? []).filter(
      (resource): resource is string => typeof resource === "string" && resource.length > 0,
    ).map((resource) => resource.slice(0, 256)))].slice(0, 64);
  const leftResources = resources(left);
  const rightResources = resources(right);
  if (leftResources.length === 0 || rightResources.length === 0) {
    if (left.ordering === "commutative" && right.ordering === "commutative") return undefined;
    return { resources: ["*"], reason: "unknown_resource" };
  }
  const rightSet = new Set(rightResources);
  const overlap = leftResources.filter((resource) => rightSet.has(resource)).sort();
  if (overlap.length === 0) return undefined;
  if (left.ordering === "commutative" && right.ordering === "commutative") return undefined;
  return { resources: overlap, reason: "shared_resource" };
};

const unexpectedKeys = (
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
): string[] => {
  if ((schema as { type?: unknown }).type !== "object") return [];
  if ((schema as { additionalProperties?: unknown }).additionalProperties !== false) return [];
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties) return [];
  return Object.keys(value).filter((key) => !(key in properties));
};

const validationMessage = (
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
): string | undefined => {
  try {
    if (Value.Check(schema, value)) return undefined;
    const messages = [...Value.Errors(schema, value)]
      .slice(0, 5)
      .map((error) => {
        const at = (error as { path?: unknown }).path;
        return typeof at === "string" && at !== "" && at !== "/"
          ? `${at}: ${error.message}`
          : error.message;
      });
    for (const key of unexpectedKeys(schema, value).slice(0, 5)) {
      messages.push(`/${key}: must not have additional properties`);
    }
    return truncateString(
      messages.join("; ") || "Schema validation failed",
      MAX_VALIDATION_MESSAGE_CHARS,
    );
  } catch {
    return "Schema validator failed";
  }
};

export class ActionRegistry {
  readonly #providers = new Map<string, RegisteredFabricProvider>();
  readonly #providersById = new Map<string, RegisteredFabricProvider>();
  readonly #activeEffects = new Map<string, { ref: string; effect: FabricActionEffect }>();
  readonly #unavailable = new Map<string, string>();

  constructor(readonly toolResultProxy?: FabricNestedToolResultProxy) {}

  register(provider: FabricProvider): void {
    if (!providerNamePattern.test(provider.name)) {
      throw new Error(`Invalid Fabric provider name: ${provider.name}`);
    }
    if (this.#providers.has(provider.name)) {
      throw new Error(`Fabric provider already registered: ${provider.name}`);
    }
    const registered: RegisteredFabricProvider = {
      id: randomUUID(),
      name: provider.name,
      generation: 1,
      provider,
    };
    this.#providers.set(provider.name, registered);
    this.#providersById.set(registered.id, registered);
    this.#unavailable.delete(provider.name);
  }

  has(name: string): boolean {
    return this.#providers.has(name);
  }

  markUnavailable(name: string, reason: string): void {
    if (!providerNamePattern.test(name)) {
      throw new Error(`Invalid Fabric provider name: ${name}`);
    }
    if (this.#providers.has(name)) {
      throw new Error(`Cannot mark a registered Fabric provider unavailable: ${name}`);
    }
    this.#unavailable.set(name, reason);
  }

  unavailableProviders(): Array<{ name: string; reason: string }> {
    return [...this.#unavailable.entries()]
      .map(([name, reason]) => ({ name, reason }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  providers(): Array<{ name: string; description: string }> {
    return [...this.#providers.values()]
      .map(({ provider }) => ({ name: provider.name, description: provider.description }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async inspectCapabilities(
    requirements: readonly (string | FabricCapabilityRequirement)[],
    context: FabricInvocationContext,
  ): Promise<FabricCapabilityResolution> {
    const { release: _release, ...resolution } = await this.#resolveCapabilities(requirements, context);
    return resolution;
  }

  async acquireCapabilityView(
    requirements: readonly (string | FabricCapabilityRequirement)[],
    context: FabricInvocationContext,
  ): Promise<FabricCapabilityViewLease> {
    return this.#resolveCapabilities(requirements, context);
  }

  async guestTypeSources(context: FabricInvocationContext): Promise<FabricGuestTypeSources> {
    const sources: FabricGuestTypeSources = {};
    if (context.capabilityView) {
      const actions = await this.list({ limit: 1_000 }, context);
      const byServer = new Map<string, FabricNamedActionTypeSource[]>();
      for (const action of actions.filter((candidate) => candidate.provider === "mcp")) {
        const server = action.namespace;
        if (!server || server === "management" || action.name.startsWith("$")) continue;
        const prefix = `${server}.`;
        const name = action.name.startsWith(prefix)
          ? action.name.slice(prefix.length)
          : action.name;
        const tools = byServer.get(server) ?? [];
        tools.push({ name, inputSchema: action.inputSchema });
        byServer.set(server, tools);
      }
      if (byServer.size > 0) {
        sources.mcpServers = [...byServer.entries()].map(([server, tools]) => ({ server, tools }));
      }
      const extensionTools = actions
        .filter((action) => action.provider === "extensions")
        .map((action) => ({ name: action.name, inputSchema: action.inputSchema }));
      if (extensionTools.length > 0) sources.extensionTools = extensionTools;
      return sources;
    }

    const mcp = this.#providers.get("mcp")?.provider as
      | (FabricProvider & { sliceDescriptors?: () => FabricActionDescriptor[] })
      | undefined;
    const mcpDescriptors = mcp?.sliceDescriptors?.();
    if (mcpDescriptors && mcpDescriptors.length > 0) {
      const byServer = new Map<string, Map<string, FabricNamedActionTypeSource>>();
      for (const descriptor of mcpDescriptors) {
        const server = descriptor.namespace;
        if (!server || server === "management" || descriptor.name.startsWith("$")) continue;
        const prefix = `${server}.`;
        const toolName = descriptor.name.startsWith(prefix)
          ? descriptor.name.slice(prefix.length)
          : descriptor.name;
        let tools = byServer.get(server);
        if (!tools) {
          tools = new Map();
          byServer.set(server, tools);
        }
        tools.set(toolName, { name: toolName, inputSchema: descriptor.inputSchema });
      }
      if (byServer.size > 0) {
        sources.mcpServers = [...byServer.entries()].map(([server, tools]) => ({
          server,
          tools: [...tools.values()],
        }));
      }
    }

    const extensions = this.#providers.get("extensions")?.provider;
    if (extensions) {
      try {
        const descriptors = await extensions.list({}, context);
        if (descriptors.length > 0) {
          sources.extensionTools = descriptors.map((descriptor) => ({
            name: descriptor.name,
            inputSchema: descriptor.inputSchema,
          }));
        }
      } catch {
        // Capture catalog not ready yet; the loose extensions surface stands
        // for this execution.
      }
    }
    return sources;
  }

  async list(
    request: FabricProviderListRequest & { provider?: string },
    context: FabricInvocationContext,
  ): Promise<ResolvedFabricAction[]> {
    if (context.capabilityView) {
      const refs = Object.keys(context.capabilityView.bindings)
        .filter((ref) => !request.provider || ref.startsWith(`${request.provider}.`))
        .sort();
      const actions = await Promise.all(refs.map((ref) => this.describe(ref, context)));
      const query = request.query?.normalize("NFKC").trim().toLowerCase();
      return actions
        .filter((action) => !request.namespace || action.namespace === request.namespace)
        .filter((action) =>
          !query || `${action.ref} ${action.description}`.toLowerCase().includes(query),
        )
        .slice(0, Math.max(1, Math.min(request.limit ?? 100, 1_000)));
    }
    const providers = request.provider
      ? [this.#requireProvider(request.provider)]
      : [...this.#providers.values()].map(({ provider }) => provider);
    const lists = await Promise.all(
      providers.map(async (provider) => {
        const descriptors = await provider.list(request, context);
        return descriptors.map((descriptor) => resolveDescriptor(provider, descriptor));
      }),
    );
    const limit = Math.max(1, Math.min(request.limit ?? 100, 1_000));
    return lists.flat().slice(0, limit);
  }

  async catalog(
    context: FabricInvocationContext,
    options: {
      provider?: string;
      limit?: number;
      includeProvider?: (provider: string) => boolean;
    } = {},
  ): Promise<FabricCapabilityCatalog> {
    const providers = (context.capabilityView
      ? [...new Map(
          Object.values(context.capabilityView.bindings).flatMap((pinned) => {
            const registered = this.#providersById.get(pinned.providerBindingId);
            return registered ? [[registered.name, registered.provider] as const] : [];
          }),
        ).values()]
      : options.provider
        ? [this.#requireProvider(options.provider)]
        : [...this.#providers.values()].map(({ provider }) => provider))
      .filter((provider) => !options.provider || provider.name === options.provider)
      .filter((provider) => options.includeProvider?.(provider.name) ?? true)
      .sort((left, right) => left.name.localeCompare(right.name));
    const lists = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        actions: context.capabilityView
          ? await this.list({ provider: provider.name, limit: 1_000 }, context)
          : (await provider.list({}, context))
              .map((descriptor) => resolveDescriptor(provider, descriptor)),
      })),
    );
    const allActions = lists.flatMap(({ actions }) => actions)
      .sort((left, right) => left.ref.localeCompare(right.ref));
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 1_000), 1_000));
    const retainedRefs = new Set(allActions.slice(0, limit).map((action) => action.ref));
    const providerHeads = lists.map(({ provider, actions }) => {
      const actionHeads = actions
        .filter((action) => retainedRefs.has(action.ref))
        .sort((left, right) => left.ref.localeCompare(right.ref))
        .map((action) => ({
          key: `action:${action.ref}`,
          parentKey: `provider:${provider.name}`,
          ref: action.ref,
          name: action.name,
          description: action.description,
          descriptorHash: actionDescriptorHash(action),
          risk: action.risk,
          ...(action.namespace === undefined ? {} : { namespace: action.namespace }),
          ...(action.effect === undefined ? {} : { effect: action.effect }),
        }));
      return {
        key: `provider:${provider.name}`,
        parentKey: "capability:fabric",
        name: provider.name,
        description: provider.description,
        descriptorHash: descriptorHash({
          name: provider.name,
          description: provider.description,
          actions: actionHeads.map((action) => action.descriptorHash),
        }),
        actions: actionHeads,
      };
    });
    const indexedActions = providerHeads.reduce((total, provider) => total + provider.actions.length, 0);
    const rootHash = descriptorHash(providerHeads.map((provider) => provider.descriptorHash));
    return {
      kind: "pi-fabric.capability-catalog",
      version: 1,
      root: {
        key: "capability:fabric",
        name: "Fabric capabilities",
        description: context.capabilityView
          ? "Committed provider and action metadata for this execution; not historical session evidence."
          : "Current registered provider and action metadata for navigation; not historical session evidence.",
        descriptorHash: rootHash,
      },
      providers: providerHeads,
      totalActions: allActions.length,
      indexedActions,
      complete: indexedActions === allActions.length,
      reasons: indexedActions === allActions.length ? [] : ["action_limit"],
    };
  }

  async search(
    query: string,
    context: FabricInvocationContext,
    limit = 30,
  ): Promise<ResolvedFabricAction[]> {
    const normalizedQuery = query.normalize("NFKC").trim().toLowerCase();
    if (!normalizedQuery) return [];
    const queryTerms = [...new Set(discoveryTerms(normalizedQuery))];
    const listed = await this.list({ limit: 1_000 }, context);
    return listed
      .map((action) => {
        const providerDescription = this.#providers.get(action.provider)?.provider.description ?? "";
        const ref = action.ref.normalize("NFKC").toLowerCase();
        const name = action.name.normalize("NFKC").toLowerCase();
        const description = action.description.normalize("NFKC").toLowerCase();
        const provider = action.provider.normalize("NFKC").toLowerCase();
        const providerBody = providerDescription.normalize("NFKC").toLowerCase();
        const namespace = (action.namespace ?? "").normalize("NFKC").toLowerCase();
        const schema = JSON.stringify(action.inputSchema).normalize("NFKC").toLowerCase();
        const tokenSets = {
          ref: new Set(discoveryTerms(ref)),
          name: new Set(discoveryTerms(name)),
          description: new Set(discoveryTerms(description)),
          provider: new Set(discoveryTerms(provider)),
          providerBody: new Set(discoveryTerms(providerBody)),
          namespace: new Set(discoveryTerms(namespace)),
          schema: new Set(discoveryTerms(schema)),
        };
        const fields = Object.values(tokenSets);
        let score = 0;
        if (ref === normalizedQuery) score += 1_000;
        if (name === normalizedQuery) score += 800;
        if (ref.startsWith(normalizedQuery)) score += 300;
        else if (ref.includes(normalizedQuery)) score += 120;
        if (description.includes(normalizedQuery)) score += 40;
        if (providerBody.includes(normalizedQuery)) score += 20;
        if (schema.includes(normalizedQuery)) score += 10;
        let matchedTerms = 0;
        for (const term of queryTerms) {
          const matched = fields.some((field) => field.has(term));
          if (!matched) continue;
          matchedTerms += 1;
          if (tokenSets.ref.has(term) || tokenSets.name.has(term)) score += 30;
          if (tokenSets.provider.has(term)) score += 20;
          if (tokenSets.description.has(term)) score += 8;
          if (tokenSets.providerBody.has(term)) score += 4;
          if (tokenSets.namespace.has(term)) score += 6;
          if (tokenSets.schema.has(term)) score += 2;
        }
        if (queryTerms.length > 0 && matchedTerms === queryTerms.length) score += 15;
        return { action, score };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.action.ref.localeCompare(right.action.ref),
      )
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((entry) => entry.action);
  }

  async describe(ref: string, context: FabricInvocationContext): Promise<ResolvedFabricAction> {
    if (ref.includes(".")) {
      const { provider, actionName, expectedDescriptorHash } = this.#parseRef(
        ref,
        context.capabilityView,
      );
      const descriptor = await provider.describe(actionName, context);
      if (!descriptor) throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
      const action = resolveDescriptor(provider, descriptor);
      if (expectedDescriptorHash && actionDescriptorHash(action) !== expectedDescriptorHash) {
        throw new FabricResolutionError(`Fabric capability descriptor changed: ${ref}`);
      }
      return action;
    }
    if (context.capabilityView) {
      const pinned = await Promise.all(
        Object.keys(context.capabilityView.bindings).map((candidate) =>
          this.describe(candidate, context),
        ),
      );
      const matches = pinned.filter((action) => action.name === ref);
      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1) {
        throw new Error(
          `"${ref}" matches ${matches.length} committed Fabric actions; qualify with provider.action: ` +
            matches.map((match) => match.ref).sort().join(", "),
        );
      }
      throw new FabricResolutionError(`Unknown Fabric action in committed view: ${ref}`);
    }
    const matches: ResolvedFabricAction[] = [];
    for (const { provider } of this.#providers.values()) {
      let descriptors: FabricActionDescriptor[];
      try {
        descriptors = await provider.list({}, context);
      } catch {
        continue;
      }
      for (const descriptor of descriptors) {
        if (descriptor.name === ref) matches.push(resolveDescriptor(provider, descriptor));
      }
    }
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(
        `"${ref}" matches ${matches.length} Fabric actions; qualify with provider.action: ` +
          matches.map((match) => match.ref).sort().join(", "),
      );
    }
    throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
  }

  async invoke(
    ref: string,
    args: Record<string, unknown>,
    context: FabricRegistryInvocationContext,
  ): Promise<unknown> {
    const traceOperation = context.traceOperation ?? context.trace?.issueCall(ref, args);
    let failureStage: "resolve" | "guard" | "prepare" | "validate" | "approve" | "invoke" = "resolve";
    let audit: FabricCallAudit | undefined;
    let invocationActive = false;
    try {
      const { provider, actionName, expectedDescriptorHash } = this.#parseRef(
        ref,
        context.capabilityView,
      );
      const descriptor = await runAbortable(context.signal, () =>
        provider.describe(actionName, context),
      );
      if (!descriptor) throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
      const action = resolveDescriptor(provider, descriptor);
      if (expectedDescriptorHash && actionDescriptorHash(action) !== expectedDescriptorHash) {
        throw new FabricResolutionError(`Fabric capability descriptor changed: ${ref}`);
      }
      traceOperation?.resolved(action.provider, action.name);

      failureStage = "guard";
      if (action.effect?.kind === "scoped") {
        throw new FabricTraceSafeError(
          `Fabric scoped action ${ref} is unsupported by the Lean execution runtime`,
        );
      }

      failureStage = "prepare";
      const preparedArgs = provider.prepareArguments
        ? await runAbortable(context.signal, () =>
            provider.prepareArguments!(actionName, args, context),
          )
        : args;
      if (typeof preparedArgs !== "object" || preparedArgs === null || Array.isArray(preparedArgs)) {
        throw new FabricTraceSafeError(`Argument preparation for ${ref} did not return an object`);
      }
      traceOperation?.prepared(preparedArgs);

      failureStage = "validate";
      const invalid = validationMessage(action.inputSchema, preparedArgs);
      if (invalid) throw new FabricTraceSafeError(`Invalid arguments for ${ref}: ${invalid}`);

      failureStage = "approve";
      await runAbortable(context.signal, () => context.approve(action, preparedArgs));

      failureStage = "invoke";
      const nestedToolCallId = `${NESTED_TOOL_CALL_ID_PREFIX}${randomUUID()}`;
      const effect = action.effect!;
      const effectConflicts = [...this.#activeEffects.values()].flatMap((active) => {
        const conflict = conflictBetween(effect, active.effect);
        return conflict ? [{ withRef: active.ref, ...conflict }] : [];
      }).slice(0, 32);
      if (effectConflicts.length > 0 && context.effectPolicy === "strict") {
        failureStage = "guard";
        throw new FabricTraceSafeError(
          `Fabric effect conflict for ${ref}: ${effectConflicts
            .map((conflict) => `${conflict.withRef} [${conflict.resources.join(", ")}]`)
            .join("; ")}`,
        );
      }
      const argsPreview = previewArgs(ref, preparedArgs);
      const activeAudit: FabricCallAudit = {
        ref,
        nestedToolCallId,
        startedAt: Date.now(),
        tool: action.name,
        provider: action.provider,
        args: boundedPreviewValue(argsPreview, MAX_AUDIT_VALUE_CHARS) as Record<string, unknown>,
        ...(effectConflicts.length > 0 ? { effectConflicts } : {}),
      };
      audit = activeAudit;
      invocationActive = true;
      context.audits.push(activeAudit);
      context.update(`Calling ${ref}`);
      this.#activeEffects.set(nestedToolCallId, { ref, effect });
      let providerValue: unknown;
      try {
        providerValue = await runAbortable(context.signal, () =>
          provider.invoke(actionName, preparedArgs, {
            ...context,
            nestedToolCallId,
            update(message) {
              if (!invocationActive) return;
              context.update(message);
            },
            activity(update) {
              if (!invocationActive) return;
              context.activity?.(update);
            },
            attachMedia(blocks, note) {
              if (!invocationActive) return;
              if (!activeAudit.media) activeAudit.media = [];
              for (const block of blocks) activeAudit.media.push(block);
              if (note) activeAudit.mediaNote = note;
            },
            updateArguments(updatedArgs) {
              if (!invocationActive) return;
              const updatedPreview = previewArgs(ref, updatedArgs);
              activeAudit.args = boundedPreviewValue(
                updatedPreview,
                MAX_AUDIT_VALUE_CHARS,
              ) as Record<string, unknown>;
              traceOperation?.prepared(updatedArgs);
            },
            attachPreview(preview) {
              if (!invocationActive) return;
              activeAudit.preview = preview;
            },
          }),
        );
      } finally {
        this.#activeEffects.delete(nestedToolCallId);
      }
      const value = this.toolResultProxy
        ? await runAbortable(context.signal, () => this.toolResultProxy!.proxy({
            action,
            args: preparedArgs,
            toolCallId: nestedToolCallId,
            value: providerValue,
            ...(context.signal ? { signal: context.signal } : {}),
          }))
        : providerValue;
      const bounded = boundedResult(value, context.maxResultChars);
      activeAudit.success = true;
      activeAudit.resultChars = bounded.chars;
      activeAudit.resultTruncated = bounded.truncated;
      const resultPreview = previewResult(bounded.value);
      activeAudit.result = boundedPreviewValue(resultPreview, MAX_AUDIT_VALUE_CHARS);
      activeAudit.endedAt = Date.now();
      traceOperation?.succeed(bounded.value, { resultTruncated: bounded.truncated });
      return bounded.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      traceOperation?.fail(failureStage, error, executionOutcomeFromError(error, context.signal));
      if (audit) {
        audit.success = false;
        audit.error = message;
        audit.endedAt = Date.now();
      }
      throw error;
    } finally {
      invocationActive = false;
      if (audit) {
        audit.endedAt ??= Date.now();
        try {
          context.onInvocationEnd?.();
        } catch {
          // UI refresh is observational and must not change invocation outcome.
        }
      }
    }
  }

  async close(): Promise<void> {
    const providers = [...this.#providers.values()].map(({ provider }) => provider);
    this.#providers.clear();
    this.#providersById.clear();
    this.#activeEffects.clear();
    await Promise.allSettled(
      providers.flatMap((provider) => provider.close ? [provider.close()] : []),
    );
  }

  async #resolveCapabilities(
    requirements: readonly (string | FabricCapabilityRequirement)[],
    context: FabricInvocationContext,
  ): Promise<FabricCapabilityViewLease> {
    const normalized = new Map<string, boolean>();
    for (const requirement of requirements) {
      const ref = (typeof requirement === "string" ? requirement : requirement.ref).trim();
      if (!ref || ref.length > 256 || !ref.includes(".")) {
        throw new Error(`Fabric capability requirements must use provider.action: ${ref || "<empty>"}`);
      }
      const optional = typeof requirement === "string" ? false : requirement.optional === true;
      normalized.set(ref, (normalized.get(ref) ?? true) && optional);
    }

    const missing: string[] = [];
    const optionalMissing: string[] = [];
    const resolved = new Map<string, FabricCapabilityBindingView>();
    for (const [ref, optional] of [...normalized].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      try {
        const { registered, provider, actionName } = this.#parseRef(ref);
        const descriptor = await runAbortable(context.signal, () =>
          provider.describe(actionName, context),
        );
        if (!descriptor) throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
        const action = resolveDescriptor(provider, descriptor);
        resolved.set(ref, {
          ref,
          provider: provider.name,
          providerBindingId: registered.id,
          generation: registered.generation,
          descriptorHash: actionDescriptorHash(action),
        });
      } catch (error) {
        if (!(error instanceof FabricResolutionError)) throw error;
        (optional ? optionalMissing : missing).push(ref);
      }
    }

    let view: FabricCommittedCapabilityView | undefined;
    if (missing.length === 0) {
      const bindings = Object.fromEntries(resolved);
      const values = [...resolved.values()];
      view = {
        id: randomUUID(),
        digest: descriptorHash(values),
        semanticDigest: descriptorHash(
          values.map(({ ref, provider, descriptorHash: hash }) => ({
            ref,
            provider,
            descriptorHash: hash,
          })),
        ),
        bindings,
      };
    }
    return {
      satisfied: missing.length === 0,
      missing,
      optionalMissing,
      ...(view ? { view } : {}),
      async release() {},
    };
  }

  #parseRef(
    ref: string,
    view?: FabricCommittedCapabilityView,
  ): {
    registered: RegisteredFabricProvider;
    provider: FabricProvider;
    actionName: string;
    expectedDescriptorHash?: string;
  } {
    const separator = ref.indexOf(".");
    if (separator <= 0 || separator === ref.length - 1) {
      throw new Error(`Fabric action references must use provider.action: ${ref}`);
    }
    const providerName = ref.slice(0, separator);
    const pinned = view?.bindings[ref];
    if (view && !pinned) {
      throw new FabricResolutionError(`Fabric capability is outside the committed view: ${ref}`);
    }
    const registered = pinned
      ? this.#providersById.get(pinned.providerBindingId)
      : this.#providers.get(providerName);
    if (!registered || registered.name !== providerName) {
      if (pinned) {
        throw new FabricResolutionError(
          `Fabric capability binding is no longer available: ${ref} (${pinned.providerBindingId})`,
        );
      }
      this.#requireProvider(providerName);
      throw new FabricResolutionError(`Unknown Fabric provider: ${providerName}`);
    }
    return {
      registered,
      provider: registered.provider,
      actionName: ref.slice(separator + 1),
      ...(pinned ? { expectedDescriptorHash: pinned.descriptorHash } : {}),
    };
  }

  #requireProvider(name: string): FabricProvider {
    const provider = this.#providers.get(name)?.provider;
    if (provider) return provider;
    const unavailableReason = this.#unavailable.get(name);
    if (unavailableReason) {
      throw new FabricResolutionError(
        `Fabric provider "${name}" is unavailable: ${unavailableReason}`,
      );
    }
    const registered = [...this.#providers.keys()].sort((left, right) => left.localeCompare(right));
    throw new FabricResolutionError(
      `Unknown Fabric provider: ${name}` +
        (registered.length > 0 ? ` (registered providers: ${registered.join(", ")})` : ""),
    );
  }
}
