import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  FabricExecutionTraceRecorder,
  FabricTraceSafeError,
  executionOutcomeFromError,
  type FabricExecutionFailureStageV1,
  type FabricExecutionTraceV1,
} from "./audit/trace.js";
import type { CapturedToolCatalog } from "./capture/catalog.js";
import {
  MAX_HOST_CALL_TIMEOUT_MS,
  type FabricConfig,
} from "./config.js";
import {
  ActionRegistry,
  type FabricCallAudit,
  type FabricRegistryActivityEvent,
} from "./core/action-registry.js";
import {
  ApprovalController,
  FabricSessionApprovals,
} from "./core/approval-controller.js";
import type { FabricCommittedCapabilityView } from "./protocol.js";
import type {
  QuickJsRuntime,
  FabricSandboxResult,
  FabricSandboxTerminationReason,
} from "./runtime/quickjs-runtime.js";
import type { NodeProcessRuntime } from "./runtime/node-process-runtime.js";
import type { FabricTypeError } from "./runtime/type-checker.js";

let runtimeDependencies:
  | Promise<{
      QuickJsRuntime: typeof import("./runtime/quickjs-runtime.js").QuickJsRuntime;
      NodeProcessRuntime: typeof import("./runtime/node-process-runtime.js").NodeProcessRuntime;
      typeCheckFabricCode: typeof import("./runtime/type-checker.js").typeCheckFabricCode;
      guestTypeDeclarations: typeof import("./runtime/guest-types.js").guestTypeDeclarations;
      buildDynamicGuestDeclarations: typeof import("./runtime/dynamic-guest-types.js").buildDynamicGuestDeclarations;
      buildCoreOverrideGuestDeclarations: typeof import("./runtime/core-override-guest-types.js").buildCoreOverrideGuestDeclarations;
    }>
  | undefined;

const loadRuntimeDependencies = () =>
  runtimeDependencies ??= Promise.all([
    import("./runtime/quickjs-runtime.js"),
    import("./runtime/node-process-runtime.js"),
    import("./runtime/type-checker.js"),
    import("./runtime/guest-types.js"),
    import("./runtime/dynamic-guest-types.js"),
    import("./runtime/core-override-guest-types.js"),
  ]).then(([quickjs, nodeProcess, checker, guest, dynamicGuest, coreOverrides]) => ({
    QuickJsRuntime: quickjs.QuickJsRuntime,
    NodeProcessRuntime: nodeProcess.NodeProcessRuntime,
    typeCheckFabricCode: checker.typeCheckFabricCode,
    guestTypeDeclarations: guest.guestTypeDeclarations,
    buildDynamicGuestDeclarations: dynamicGuest.buildDynamicGuestDeclarations,
    buildCoreOverrideGuestDeclarations: coreOverrides.buildCoreOverrideGuestDeclarations,
  }));

const executionOutcomeFromTermination = (
  reason: FabricSandboxTerminationReason,
): "succeeded" | "failed" | "aborted" | "timed_out" => {
  switch (reason) {
    case "completed":
      return "succeeded";
    case "aborted":
      return "aborted";
    case "timed_out":
      return "timed_out";
    case "runtime_error":
      return "failed";
  }
};

export interface FabricExecutionResult {
  success: boolean;
  value: unknown;
  logs: string[];
  audits: FabricCallAudit[];
  phases: string[];
  trace: FabricExecutionTraceV1;
  elapsedMs: number;
  typeErrors?: FabricTypeError[];
  error?: string;
}

interface FabricExecutionPartial {
  audits: FabricCallAudit[];
  phases: string[];
  progress?: string | undefined;
}

export interface FabricExecutionAuthorizer {
  authorize(ref: string, parentToolCallId: string): Promise<void>;
}

export interface FabricExecutionOptions {
  code: string;
  strings?: Record<string, string>;
  signal: AbortSignal | undefined;
  parentToolCallId: string;
  context: ExtensionContext;
  tokenBudget?: number;
  onPartial(snapshot: FabricExecutionPartial): void;
}

export class FabricExecutionService {
  #runtime: QuickJsRuntime | NodeProcessRuntime | undefined;
  #runtimeKind: FabricConfig["executor"]["runtime"] | undefined;
  #capabilityView: FabricCommittedCapabilityView | undefined;

  constructor(
    readonly registry: ActionRegistry,
    readonly config: FabricConfig,
    readonly authorizer?: FabricExecutionAuthorizer,
    readonly sessionApprovals = new FabricSessionApprovals(),
    readonly capturedTools?: CapturedToolCatalog,
  ) {}

  setCapabilityView(view: FabricCommittedCapabilityView | undefined): void {
    this.#capabilityView = view;
  }

  async execute(options: FabricExecutionOptions): Promise<FabricExecutionResult> {
    const startedAt = performance.now();
    const traceRecorder = new FabricExecutionTraceRecorder();

    const dependencies = await loadRuntimeDependencies();
    const effectiveFullCodeMode =
      this.config.fullCodeMode || this.config.schema.mode === "enforce";
    const unavailable = new Map(
      this.registry.unavailableProviders().map((entry) => [entry.name, entry.reason]),
    );
    const guestTypeSources = await this.registry.guestTypeSources({
      cwd: options.context.cwd,
      signal: options.signal,
      parentToolCallId: options.parentToolCallId,
      nestedToolCallId: `${options.parentToolCallId}_typedecls`,
      extensionContext: options.context,
      update() {},
      ...(this.#capabilityView ? { capabilityView: this.#capabilityView } : {}),
    });
    const coreOverrideDeclarations = effectiveFullCodeMode
      ? dependencies.buildCoreOverrideGuestDeclarations(
          this.capturedTools?.list().map((entry) => ({
            name: entry.name,
            inputSchema: entry.definition.parameters,
          })) ?? [],
        )
      : undefined;
    const checked = dependencies.typeCheckFabricCode(
      options.code,
      dependencies.guestTypeDeclarations(effectiveFullCodeMode, {
        excludeGlobals: [...unavailable.keys()],
        dynamic: dependencies.buildDynamicGuestDeclarations(guestTypeSources),
        ...(coreOverrideDeclarations ? { coreOverrides: coreOverrideDeclarations } : {}),
      }),
    );

    if (checked.errors.length > 0) {
      for (const error of checked.errors) {
        const missing = /^Cannot find name '([^']+)'/.exec(error.message);
        const reason = missing?.[1] ? unavailable.get(missing[1]) : undefined;
        if (missing && reason) {
          error.message = `${error.message} Fabric provider "${missing[1]}" is unavailable: ${reason}`;
        }
      }
      return {
        success: false,
        value: undefined,
        logs: [],
        audits: [],
        phases: [],
        trace: traceRecorder.seal(
          "failed",
          [],
          `Type checking failed (${checked.errors.length} ${checked.errors.length === 1 ? "error" : "errors"})`,
        ),
        elapsedMs: performance.now() - startedAt,
        typeErrors: checked.errors,
      };
    }

    const approval = new ApprovalController(
      this.config.approvals,
      options.context,
      this.sessionApprovals,
    );
    const audits: FabricCallAudit[] = [];
    const phases: string[] = [];

    const fullCodeProvider = (value: string): "pi" | "extensions" | undefined => {
      const separator = value.indexOf(".");
      const provider = separator > 0 ? value.slice(0, separator) : value;
      return provider === "pi" || provider === "extensions" ? provider : undefined;
    };
    const guardFullCodeRef = (ref: string): void => {
      if (effectiveFullCodeMode) return;
      const provider = fullCodeProvider(ref);
      if (!provider) return;
      throw new FabricTraceSafeError(
        `Fabric full code mode is disabled; call ${provider === "pi" ? "Pi core" : "registered extension"} tools directly outside fabric_exec`,
      );
    };

    let currentProgress: string | undefined;
    let emitPending = false;
    let emitTimer: NodeJS.Timeout | undefined;
    const emitNow = (): void => {
      emitPending = false;
      options.onPartial({
        audits: audits.slice(),
        phases: phases.slice(),
        progress: currentProgress,
      });
    };
    const flushEmit = (): void => {
      if (emitTimer) clearTimeout(emitTimer);
      emitTimer = undefined;
      if (emitPending) emitNow();
    };
    const emit = (): void => {
      emitPending = true;
      const debounceMs = this.config.ui.updateDebounceMs;
      if (debounceMs <= 0) {
        flushEmit();
        return;
      }
      if (emitTimer) return;
      emitTimer = setTimeout(() => {
        emitTimer = undefined;
        if (emitPending) emitNow();
      }, debounceMs);
      emitTimer.unref?.();
    };
    const update = (message: string): void => {
      currentProgress = message;
      emit();
    };
    const observeInvocation = (event: FabricRegistryActivityEvent): void => {
      if (event.type === "call_end") emit();
    };
    const baseContext = {
      cwd: options.context.cwd,
      signal: options.signal,
      parentToolCallId: options.parentToolCallId,
      nestedToolCallId: `${options.parentToolCallId}_metadata`,
      extensionContext: options.context,
      update,
      ...(this.#capabilityView ? { capabilityView: this.#capabilityView } : {}),
    };
    const minimumTimeoutMsForHostCall = (
      ref: string,
      args: Record<string, unknown>,
    ): number | undefined => {
      const targetRef = ref === "fabric.$call" && typeof args.ref === "string" ? args.ref : ref;
      const targetArgs =
        ref === "fabric.$call" &&
        typeof args.args === "object" &&
        args.args !== null &&
        !Array.isArray(args.args)
          ? (args.args as Record<string, unknown>)
          : args;
      if (targetRef !== "pi.bash") return undefined;
      const seconds = targetArgs.timeout;
      const milliseconds = targetArgs.timeoutMs;
      const requested =
        typeof seconds === "number" && Number.isFinite(seconds)
          ? seconds * 1_000
          : typeof milliseconds === "number" && Number.isFinite(milliseconds)
            ? milliseconds
            : 0;
      if (requested <= 0) return undefined;
      return Math.max(
        this.config.executor.timeoutMs,
        Math.min(Math.floor(requested) + 5_000, MAX_HOST_CALL_TIMEOUT_MS),
      );
    };
    const traceAttempt = async <T>(
      ref: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
      run: (setStage: (stage: FabricExecutionFailureStageV1) => void) => T | Promise<T>,
    ): Promise<T> => {
      const operation = traceRecorder.issueCall(ref, args);
      let stage: FabricExecutionFailureStageV1 = "invoke";
      try {
        const value = await run((nextStage) => {
          stage = nextStage;
        });
        operation.succeed(undefined);
        return value;
      } catch (error) {
        operation.fail(stage, error, executionOutcomeFromError(error, signal));
        throw error;
      }
    };
    const invokeAction = async (
      ref: string,
      args: Record<string, unknown>,
      callContext: typeof baseContext & { signal: AbortSignal },
    ): Promise<unknown> => {
      const traceOperation = traceRecorder.issueCall(ref, args);
      try {
        guardFullCodeRef(ref);
      } catch (error) {
        traceOperation.fail(
          "guard",
          error,
          executionOutcomeFromError(error, callContext.signal),
        );
        throw error;
      }
      return this.registry.invoke(ref, args, {
        ...callContext,
        ...(this.authorizer
          ? {
              authorize: (action) =>
                this.authorizer!.authorize(action.ref, options.parentToolCallId),
            }
          : {}),
        approve: async (action, preparedArgs) => {
          if (action.ref === "schema.commit") {
            await approval.approve({ ...action, risk: "write" }, preparedArgs);
            await approval.approve({ ...action, risk: "execute" }, preparedArgs);
            return;
          }
          await approval.approve(action, preparedArgs);
        },
        audits,
        maxResultChars: this.config.executor.maxNestedResultChars,
        traceOperation,
        observeInvocation,
      });
    };

    let sandboxResult: FabricSandboxResult;
    try {
      const runtimeKind = this.config.executor.runtime;
      if (!this.#runtime || this.#runtimeKind !== runtimeKind) {
        this.#runtime = runtimeKind === "node-process"
          ? new dependencies.NodeProcessRuntime()
          : new dependencies.QuickJsRuntime();
        this.#runtimeKind = runtimeKind;
      }
      sandboxResult = await this.#runtime.execute(
        options.code,
        async (ref, args, runtimeSignal) => {
          const callContext = { ...baseContext, signal: runtimeSignal };
          switch (ref) {
            case "fabric.$providers":
              return traceAttempt(
                "fabric.discovery.providers",
                args,
                runtimeSignal,
                () =>
                  this.registry
                    .providers()
                    .filter((provider) =>
                      !callContext.capabilityView ||
                      Object.values(callContext.capabilityView.bindings)
                        .some((binding) => binding.provider === provider.name),
                    )
                    .filter((provider) => effectiveFullCodeMode || !fullCodeProvider(provider.name)),
              );
            case "fabric.$catalog":
              return traceAttempt(
                "fabric.discovery.catalog",
                args,
                runtimeSignal,
                async (setStage) => {
                  const provider = typeof args.provider === "string" ? args.provider : undefined;
                  setStage("guard");
                  if (provider) guardFullCodeRef(`${provider}.*`);
                  setStage(provider && !this.registry.has(provider) ? "resolve" : "invoke");
                  return this.registry.catalog(callContext, {
                    ...(provider ? { provider } : {}),
                    ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
                    includeProvider: (name) => effectiveFullCodeMode || !fullCodeProvider(name),
                  });
                },
              );
            case "fabric.$list":
              return traceAttempt(
                "fabric.discovery.list",
                args,
                runtimeSignal,
                async (setStage) => {
                  setStage("guard");
                  if (typeof args.provider === "string") guardFullCodeRef(`${args.provider}.*`);
                  setStage(
                    typeof args.provider === "string" && !this.registry.has(args.provider)
                      ? "resolve"
                      : "invoke",
                  );
                  const actions = await this.registry.list(
                    {
                      ...(typeof args.provider === "string" ? { provider: args.provider } : {}),
                      ...(typeof args.namespace === "string" ? { namespace: args.namespace } : {}),
                      ...(typeof args.query === "string" ? { query: args.query } : {}),
                      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
                    },
                    callContext,
                  );
                  return actions.filter((action) => effectiveFullCodeMode || !fullCodeProvider(action.provider));
                },
              );
            case "fabric.$search":
              return traceAttempt(
                "fabric.discovery.search",
                args,
                runtimeSignal,
                async () => {
                  const actions = await this.registry.search(
                    String(args.query ?? ""),
                    callContext,
                    typeof args.limit === "number" ? args.limit : undefined,
                  );
                  return actions.filter((action) => effectiveFullCodeMode || !fullCodeProvider(action.provider));
                },
              );
            case "fabric.$describe":
              return traceAttempt(
                "fabric.discovery.describe",
                args,
                runtimeSignal,
                async (setStage) => {
                  const targetRef = String(args.ref ?? "");
                  setStage("guard");
                  guardFullCodeRef(targetRef);
                  setStage("resolve");
                  return this.registry.describe(targetRef, callContext);
                },
              );
            case "fabric.$call": {
              const callArgs =
                typeof args.args === "object" && args.args !== null && !Array.isArray(args.args)
                  ? (args.args as Record<string, unknown>)
                  : {};
              return invokeAction(String(args.ref ?? ""), callArgs, callContext);
            }
            case "fabric.$progress":
              return traceAttempt(
                "fabric.execution.progress",
                args,
                runtimeSignal,
                () => update(String(args.message ?? "Working")),
              );
            default:
              return invokeAction(ref, args, callContext);
          }
        },
        {
          timeoutMs: this.config.executor.timeoutMs,
          memoryLimitBytes: this.config.executor.memoryLimitBytes,
          maxLogChars: this.config.executor.maxOutputChars,
          minimumTimeoutMsForHostCall,
          ...(checked.javascript ? { transpiledCode: checked.javascript } : {}),
          ...(checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {}),
          ...(options.strings ? { strings: options.strings } : {}),
          ...(options.tokenBudget !== undefined ? { tokenBudget: options.tokenBudget } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
    } finally {
      await this.registry.endInvocation(options.parentToolCallId);
      flushEmit();
    }

    const runOutcome = executionOutcomeFromTermination(sandboxResult.terminationReason);
    const succeeded = runOutcome === "succeeded";
    return {
      success: succeeded,
      value: sandboxResult.value,
      logs: sandboxResult.logs,
      audits,
      phases,
      trace: traceRecorder.seal(runOutcome, phases),
      elapsedMs: performance.now() - startedAt,
      ...(sandboxResult.error ? { error: sandboxResult.error } : {}),
    };
  }
}
