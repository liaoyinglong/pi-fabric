import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ActionRegistry,
  type FabricCallAudit,
  type FabricRegistryActivityEvent,
  type ResolvedFabricAction,
} from "./core/action-registry.js";
import type { FabricInvocationActivityUpdate } from "./protocol.js";
import {
  CodeModeRuntimeV2,
  type CodeModeV2ExecutionResult,
  type CodeModeV2RuntimeOptions,
} from "./runtime-v2.js";

const DEFAULT_MAX_NESTED_RESULT_CHARS = 64_000;
const DEFAULT_MAX_AGENT_CALLS = 8;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Execution cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("Execution cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

export interface FabricRuntimeV2AdapterOptions extends CodeModeV2RuntimeOptions {
  maxNestedResultChars?: number;
  maxAgentCalls?: number;
  effectPolicy?: "advisory" | "strict";
  authorize?: (
    action: ResolvedFabricAction,
    parentToolCallId: string,
  ) => void | Promise<void>;
  approve?: (
    action: ResolvedFabricAction,
    args: Record<string, unknown>,
  ) => void | Promise<void>;
}

export interface FabricRuntimeV2ExecuteOptions {
  code: string;
  strings?: Record<string, string>;
  signal?: AbortSignal;
  parentToolCallId: string;
  context: ExtensionContext;
  tokenBudget?: number;
  agentBudget?: number;
  onPartial?: (snapshot: {
    audits: FabricCallAudit[];
    phases: string[];
    progress?: string;
  }) => void;
}

export interface FabricRuntimeV2ExecutionResult extends CodeModeV2ExecutionResult {
  audits: FabricCallAudit[];
  phases: string[];
}

export const buildFabricRuntimeV2GuestSetup = (tokenBudget?: number): string => {
  const budget =
    typeof tokenBudget === "number" && Number.isFinite(tokenBudget) && tokenBudget > 0
      ? String(Math.floor(tokenBudget))
      : "Number.POSITIVE_INFINITY";
  return `
(() => {
  const dispatch = globalThis.host.dispatch;
  delete globalThis.host;
  const call = (ref, args = {}) => dispatch({ ref, args: args ?? {} });

  globalThis.tools = Object.freeze({
    providers: () => call("fabric.$providers", {}),
    catalog: (args = {}) => call("fabric.$catalog", args),
    list: (args = {}) => call("fabric.$list", args),
    search: (input) => call("fabric.$search", typeof input === "string" ? { query: input } : input),
    describe: (args) => call("fabric.$describe", args),
    call: (args) => call("fabric.$call", args),
    progress: (args) => call("fabric.$progress", args),
    models: () => call("fabric.$models", {}),
  });

  const primaryFields = { read: "path", bash: "command", grep: "pattern", find: "pattern", ls: "path" };
  const positionalFields = {
    grep: ["pattern", "path", "limit"],
    find: ["pattern", "path", "limit"],
    write: ["path", "content"],
    edit: ["path", "oldText", "newText"],
  };
  const normalizePiArgs = (name, values) => {
    if (values.length === 0) return {};
    if (values.length === 1) {
      const value = values[0];
      if (typeof value === "string" && primaryFields[name]) return { [primaryFields[name]]: value };
      return value ?? {};
    }
    if (
      values.length === 2 && typeof values[0] === "string" && primaryFields[name] &&
      values[1] && typeof values[1] === "object" && !Array.isArray(values[1])
    ) {
      return { ...values[1], [primaryFields[name]]: values[0] };
    }
    const fields = positionalFields[name];
    if (!fields) return values[0] ?? {};
    const args = {};
    for (let index = 0; index < values.length && index < fields.length; index++) {
      if (values[index] !== undefined) args[fields[index]] = values[index];
    }
    if (name === "edit" && !Array.isArray(args.edits) && ("oldText" in args || "newText" in args)) {
      args.edits = [{ oldText: args.oldText, newText: args.newText }];
      delete args.oldText;
      delete args.newText;
    }
    return args;
  };
  globalThis.pi = new Proxy({}, {
    get(_target, property) {
      if (property === "then" || typeof property === "symbol") return undefined;
      const name = String(property);
      return (...values) => call("pi." + name, normalizePiArgs(name, values));
    },
  });

  const providerProxy = (provider) => new Proxy({}, {
    get(_target, property) {
      if (property === "then" || typeof property === "symbol") return undefined;
      return (args = {}) => call(provider + "." + String(property), args);
    },
  });
  globalThis.extensions = providerProxy("extensions");

  globalThis.agents = Object.freeze({
    run: (args) => call("agents.run", args),
    spawn: (args) => call("agents.spawn", args),
    recurse: (args) => call("agents.recurse", args),
    wait: (args) => call("agents.wait", args),
    status: (args) => call("agents.status", args),
    list: (args = {}) => call("agents.list", args),
    routing: (args = {}) => call("agents.routing", args),
    stop: (args) => call("agents.stop", args),
    cleanup: (args) => call("agents.cleanup", args),
    steer: (args) => call("agents.steer", args),
    followUp: (args) => call("agents.followUp", args),
    setSteeringMode: (args) => call("agents.setSteeringMode", args),
    setFollowUpMode: (args) => call("agents.setFollowUpMode", args),
    compact: (args) => call("agents.compact", args),
  });

  globalThis.mcp = new Proxy({}, {
    get(_target, server) {
      if (server === "then" || typeof server === "symbol") return undefined;
      if (server === "servers") return () => call("mcp.$servers", {});
      if (server === "tools") {
        return (serverName) => call("fabric.$list", {
          provider: "mcp",
          namespace: typeof serverName === "string" ? serverName : String(serverName && serverName.server || ""),
          limit: 1000,
        });
      }
      if (server === "reload") return () => call("mcp.$reload", {});
      if (server === "register") return (args) => call("mcp.$register", args);
      if (server === "call") return (args) => call("mcp.$call", args);
      return new Proxy({}, {
        get(_serverTarget, tool) {
          if (tool === "then" || typeof tool === "symbol") return undefined;
          return (args = {}) => call("mcp." + String(server) + "." + String(tool), args);
        },
      });
    },
  });

  let spentTokens = 0;
  const budgetTotal = ${budget};
  const recordAgentUsage = (result) => {
    const usage = result && result.usage;
    if (usage) spentTokens += Number(usage.input || 0) + Number(usage.output || 0);
    return result;
  };
  const workflowAgent = async (prompt, options = {}) => {
    if (spentTokens >= budgetTotal) throw new Error("Fabric workflow token budget exhausted");
    const { label, ...agentOptions } = options;
    const result = recordAgentUsage(await agents.run({
      ...agentOptions,
      ...(label && !agentOptions.name ? { name: label } : {}),
      task: prompt,
    }));
    if (!result || result.status !== "completed") {
      throw new Error((label || agentOptions.name || "Fabric workflow agent") + " failed: " + (result && result.error || "agent did not complete"));
    }
    return result.value !== undefined ? result.value : result.text;
  };
  const runParallel = async (thunks, options) => {
    if (!Array.isArray(thunks) || thunks.some((thunk) => typeof thunk !== "function")) {
      throw new TypeError("workflow.parallel expects functions or (items, mapper)");
    }
    if (thunks.length === 0) return [];
    const raw = typeof options === "number" ? options : options && options.concurrency;
    const requested = raw === undefined ? thunks.length : Number(raw);
    if (!Number.isFinite(requested) || requested < 1) throw new RangeError("workflow.parallel concurrency must be positive");
    const concurrency = Math.max(1, Math.min(thunks.length, Math.floor(requested)));
    const results = new Array(thunks.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < thunks.length) {
        const index = cursor++;
        results[index] = await thunks[index]();
      }
    }));
    return results;
  };
  const workflowParallel = async (items, mapperOrOptions, options) => {
    await call("fabric.$spanStart", { kind: "parallel", itemCount: Array.isArray(items) ? items.length : 0 });
    try {
      const value = typeof mapperOrOptions === "function"
        ? await runParallel(items.map((item, index) => () => mapperOrOptions(item, index)), options)
        : await runParallel(items, mapperOrOptions);
      await call("fabric.$spanEnd", { kind: "parallel", outcome: "succeeded" });
      return value;
    } catch (error) {
      try { await call("fabric.$spanEnd", { kind: "parallel", outcome: "failed" }); } catch {}
      throw error;
    }
  };
  const workflowPipeline = async (items, ...stages) => {
    if (!Array.isArray(items) || stages.some((stage) => typeof stage !== "function")) {
      throw new TypeError("workflow.pipeline expects an array followed by stage functions");
    }
    return workflowParallel(items, async (original, index) => {
      let value = original;
      for (const stage of stages) value = await stage(value, original, index);
      return value;
    });
  };
  globalThis.workflow = Object.freeze({
    agent: workflowAgent,
    parallel: workflowParallel,
    pipeline: workflowPipeline,
    configure: (args) => call("fabric.$configure", args),
    phase: (nameOrInput, options = {}) => call(
      "fabric.$phase",
      nameOrInput && typeof nameOrInput === "object" && !Array.isArray(nameOrInput)
        ? nameOrInput
        : { ...options, name: nameOrInput },
    ),
    item: (args) => call("fabric.$item", args),
    event: (args) => call("fabric.$event", args),
    log: (...values) => print(...values),
    budget: Object.freeze({
      total: budgetTotal,
      spent: () => spentTokens,
      remaining: () => Math.max(0, budgetTotal - spentTokens),
    }),
  });
  globalThis.agent = workflowAgent;
  globalThis.parallel = workflowParallel;
  globalThis.pipeline = workflowPipeline;
  globalThis.phase = workflow.phase;
  globalThis.log = workflow.log;
  globalThis.budget = workflow.budget;
})();
`;
};

export class FabricRuntimeV2HostAdapter {
  readonly #registry: ActionRegistry;
  readonly #options: FabricRuntimeV2AdapterOptions;

  constructor(registry: ActionRegistry, options: FabricRuntimeV2AdapterOptions = {}) {
    this.#registry = registry;
    this.#options = options;
  }

  async execute(options: FabricRuntimeV2ExecuteOptions): Promise<FabricRuntimeV2ExecutionResult> {
    const audits: FabricCallAudit[] = [];
    const phases: string[] = [];
    let progress: string | undefined;
    let agentCalls = 0;
    const configuredMaxAgentCalls = Math.max(1, Math.floor(this.#options.maxAgentCalls ?? DEFAULT_MAX_AGENT_CALLS));
    const maxAgentCalls = Math.max(
      1,
      Math.min(
        typeof options.agentBudget === "number" && Number.isFinite(options.agentBudget)
          ? Math.floor(options.agentBudget)
          : configuredMaxAgentCalls,
        configuredMaxAgentCalls,
      ),
    );
    const emit = (): void => options.onPartial?.({
      audits: audits.slice(),
      phases: phases.slice(),
      ...(progress ? { progress } : {}),
    });
    const update = (message: string): void => {
      progress = message;
      emit();
    };
    const observeInvocation = (event: FabricRegistryActivityEvent): void => {
      if (event.type === "call_end") emit();
    };
    const guardAgentCall = (ref: string): void => {
      if (ref !== "agents.run" && ref !== "agents.spawn" && ref !== "agents.recurse") return;
      agentCalls += 1;
      if (agentCalls > maxAgentCalls) {
        throw new Error(`Fabric agent budget exhausted (${maxAgentCalls} per execution)`);
      }
    };
    const invocationContext = (signal: AbortSignal) => ({
      cwd: options.context.cwd,
      signal,
      parentToolCallId: options.parentToolCallId,
      nestedToolCallId: `${options.parentToolCallId}_runtime_v2`,
      extensionContext: options.context,
      update,
      activity: (_activity: FabricInvocationActivityUpdate) => undefined,
      ...(this.#options.effectPolicy ? { effectPolicy: this.#options.effectPolicy } : {}),
    });
    const invoke = async (
      ref: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<unknown> => {
      guardAgentCall(ref);
      return this.#registry.invoke(ref, args, {
        ...invocationContext(signal),
        ...(this.#options.authorize
          ? { authorize: (action: ResolvedFabricAction) => this.#options.authorize!(action, options.parentToolCallId) }
          : {}),
        approve: (action: ResolvedFabricAction, preparedArgs: Record<string, unknown>) =>
          Promise.resolve(this.#options.approve?.(action, preparedArgs)),
        audits,
        maxResultChars: this.#options.maxNestedResultChars ?? DEFAULT_MAX_NESTED_RESULT_CHARS,
        observeInvocation,
      });
    };
    const dispatch = async (
      payload: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<unknown> => {
      const ref = String(payload.ref ?? "");
      const args = asRecord(payload.args);
      const context = invocationContext(signal);
      switch (ref) {
        case "fabric.$providers":
          return this.#registry.providers();
        case "fabric.$catalog":
          return this.#registry.catalog(context, {
            ...(typeof args.provider === "string" ? { provider: args.provider } : {}),
            ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
          });
        case "fabric.$list":
          return this.#registry.list({
            ...(typeof args.provider === "string" ? { provider: args.provider } : {}),
            ...(typeof args.namespace === "string" ? { namespace: args.namespace } : {}),
            ...(typeof args.query === "string" ? { query: args.query } : {}),
            ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
          }, context);
        case "fabric.$search":
          return this.#registry.search(
            String(args.query ?? ""),
            context,
            typeof args.limit === "number" ? args.limit : undefined,
          );
        case "fabric.$describe":
          return this.#registry.describe(String(args.ref ?? ""), context);
        case "fabric.$call":
          return invoke(String(args.ref ?? ""), asRecord(args.args), signal);
        case "fabric.$models": {
          const registry = options.context.modelRegistry;
          const available = typeof registry?.getAvailable === "function" ? registry.getAvailable() : [];
          return available.map((model) => ({
            provider: String(model.provider),
            id: String(model.id),
            name: String(model.name ?? model.id),
            key: `${model.provider}/${model.id}`,
          }));
        }
        case "fabric.$progress":
          update(String(args.message ?? "Working"));
          return undefined;
        case "fabric.$configure":
          return args;
        case "fabric.$phase": {
          const name = typeof args.name === "string" ? args.name.trim() : "";
          if (!name) throw new Error("Workflow phase name must be a non-empty string");
          phases.push(name);
          update(`Phase: ${name}`);
          return { name, index: phases.length - 1, ...(typeof args.id === "string" ? { id: args.id } : {}) };
        }
        case "fabric.$item":
          return args;
        case "fabric.$event":
        case "fabric.$spanStart":
        case "fabric.$spanEnd":
          return undefined;
        case "fabric.$timer":
          await abortableDelay(Number(args.ms ?? 0), signal);
          return undefined;
        default:
          if (!ref) throw new Error("Fabric Runtime V2 dispatch requires a ref");
          return invoke(ref, args, signal);
      }
    };

    const runtime = new CodeModeRuntimeV2(
      { dispatch },
      {
        ...(this.#options.timeoutMs !== undefined ? { timeoutMs: this.#options.timeoutMs } : {}),
        ...(this.#options.memoryLimitBytes !== undefined ? { memoryLimitBytes: this.#options.memoryLimitBytes } : {}),
        ...(this.#options.maxLogChars !== undefined ? { maxLogChars: this.#options.maxLogChars } : {}),
      },
    );
    try {
      const result = await runtime.execute({
        code: options.code,
        ...(options.strings ? { strings: options.strings } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        guestSetup: buildFabricRuntimeV2GuestSetup(options.tokenBudget),
      });
      return { ...result, audits, phases };
    } finally {
      await this.#registry.endInvocation(options.parentToolCallId);
    }
  }
}
