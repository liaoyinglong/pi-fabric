import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
  FabricScopedProviderResult,
} from "../protocol.js";

/**
 * Hard capability boundary for recursive children. The child Pi CLI may load
 * provider/tool extensions for model registration and lifecycle hooks, but
 * Fabric only exposes actions that were in the profile's original --tools
 * allowlist before Lean hides those direct tools from the recursive model.
 */
export class RestrictedFabricProvider implements FabricProvider {
  readonly name: string;
  readonly description: string;
  readonly #allowed: ReadonlySet<string>;

  constructor(
    readonly inner: FabricProvider,
    allowedActions: Iterable<string>,
  ) {
    this.name = inner.name;
    this.description = inner.description;
    this.#allowed = new Set(allowedActions);
  }

  #assertAllowed(actionName: string): void {
    if (this.#allowed.has(actionName)) return;
    throw new Error(
      `Fabric action ${this.name}.${actionName} is not granted to this recursive child profile`,
    );
  }

  async list(
    request: FabricProviderListRequest,
    context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor[]> {
    const actions = await this.inner.list(request, context);
    return actions.filter((action) => this.#allowed.has(action.name));
  }

  async describe(
    actionName: string,
    context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor | undefined> {
    if (!this.#allowed.has(actionName)) return undefined;
    return this.inner.describe(actionName, context);
  }

  prepareArguments(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>> {
    this.#assertAllowed(actionName);
    return this.inner.prepareArguments?.(actionName, args, context) ?? args;
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    this.#assertAllowed(actionName);
    return this.inner.invoke(actionName, args, context);
  }

  async acquire(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<FabricScopedProviderResult> {
    this.#assertAllowed(actionName);
    if (!this.inner.acquire) {
      throw new Error(`Fabric provider ${this.name} does not support scoped acquisition`);
    }
    return this.inner.acquire(actionName, args, context);
  }

  async invocationEnded(parentToolCallId: string): Promise<void> {
    await this.inner.invocationEnded?.(parentToolCallId);
  }

  subscribeCatalog(listener: () => void): () => void {
    return this.inner.subscribeCatalog?.(listener) ?? (() => undefined);
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
