import releaseSyncVariant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import ts from "typescript";
import { runAbortable, settleWithin } from "./async-settlement.js";

export type CodeModeV2Capability = "read" | "grep" | "bash" | "mcp";

export type CodeModeV2HostHandler = (
  args: Record<string, unknown>,
  signal: AbortSignal,
) => unknown | PromiseLike<unknown>;

export type CodeModeV2Host = Partial<Record<CodeModeV2Capability, CodeModeV2HostHandler>>;

export type CodeModeV2TerminationReason =
  | "completed"
  | "runtime_error"
  | "timed_out"
  | "aborted";

export interface CodeModeV2RuntimeOptions {
  timeoutMs?: number;
  memoryLimitBytes?: number;
  maxLogChars?: number;
}

export interface CodeModeV2ExecuteOptions {
  code: string;
  strings?: Record<string, string>;
  signal?: AbortSignal;
}

export interface CodeModeV2ExecutionResult {
  value: unknown;
  logs: string[];
  terminationReason: CodeModeV2TerminationReason;
  elapsedMs: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_LOG_CHARS = 20_000;
const HOST_TASK_SETTLE_GRACE_MS = 250;
const QUICKJS_MAX_STACK_SIZE_BYTES = 256 * 1024;
const QUICKJS_GC_LIST_ASSERTION = "list_empty(&rt->gc_obj_list)";

const CAPABILITIES = new Set<CodeModeV2Capability>(["read", "grep", "bash", "mcp"]);

export const CODE_MODE_V2_GUEST_SETUP = `
(() => {
  const bridge = globalThis.__codeModeV2HostCall;
  delete globalThis.__codeModeV2HostCall;
  const call = (name, args = {}) => bridge(name, args ?? {});
  globalThis.host = Object.freeze({
    read: (args = {}) => call("read", args),
    grep: (args = {}) => call("grep", args),
    bash: (args = {}) => call("bash", args),
    mcp: (args = {}) => call("mcp", args),
  });
  globalThis.console = Object.freeze({
    log: (...values) => print(...values),
    info: (...values) => print(...values),
    warn: (...values) => print(...values),
    error: (...values) => print(...values),
  });
})();
`;

export const wrapCodeModeV2Program = (code: string): string =>
  `async function __codeModeV2Main() {\n${code}\n}\n`;

const transpileCodeModeV2Program = (code: string): string =>
  ts.transpileModule(wrapCodeModeV2Program(code), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;

const formatValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const jsonText = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
};

const jsonHandle = (
  context: any,
  jsonObject: any,
  jsonParse: any,
  value: unknown,
): any => {
  if (value === undefined) return context.undefined;
  if (value === null) return context.null;
  if (typeof value === "string") return context.newString(value);
  if (typeof value === "boolean") return value ? context.true : context.false;
  if (typeof value === "number") {
    return Number.isFinite(value) ? context.newNumber(value) : context.null;
  }
  const serialized = context.newString(jsonText(value));
  try {
    return context.unwrapResult(context.callFunction(jsonParse, jsonObject, serialized));
  } finally {
    serialized.dispose();
  }
};

const disposeQuickJsContext = (context: any): void => {
  try {
    context.dispose();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(QUICKJS_GC_LIST_ASSERTION) && message.includes("JS_FreeRuntime")) return;
    throw error;
  }
};

type QuickJsModule = Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>;
let quickJsModulePromise: Promise<QuickJsModule> | undefined;
const quickJsModule = (): Promise<QuickJsModule> => {
  quickJsModulePromise ??= newQuickJSWASMModuleFromVariant(releaseSyncVariant);
  return quickJsModulePromise;
};

export class CodeModeRuntimeV2 {
  readonly #host: CodeModeV2Host;
  readonly #options: Required<CodeModeV2RuntimeOptions>;

  constructor(host: CodeModeV2Host = {}, options: CodeModeV2RuntimeOptions = {}) {
    this.#host = host;
    this.#options = {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
      maxLogChars: options.maxLogChars ?? DEFAULT_MAX_LOG_CHARS,
    };
  }

  async execute(options: CodeModeV2ExecuteOptions): Promise<CodeModeV2ExecutionResult> {
    const startedAt = performance.now();
    const finish = (
      result: Omit<CodeModeV2ExecutionResult, "elapsedMs">,
    ): CodeModeV2ExecutionResult => ({
      ...result,
      elapsedMs: performance.now() - startedAt,
    });

    if (options.signal?.aborted) {
      return finish({
        value: undefined,
        logs: [],
        terminationReason: "aborted",
        error: "Execution cancelled",
      });
    }

    const { timeoutMs, memoryLimitBytes, maxLogChars } = this.#options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return finish({
        value: undefined,
        logs: [],
        terminationReason: "runtime_error",
        error: "Code Mode V2 timeout must be a positive finite number",
      });
    }
    if (
      !Number.isSafeInteger(memoryLimitBytes) ||
      memoryLimitBytes < 1 ||
      memoryLimitBytes > 0xffff_ffff
    ) {
      return finish({
        value: undefined,
        logs: [],
        terminationReason: "runtime_error",
        error: "Code Mode V2 memory limit must be an integer between 1 byte and 4294967295 bytes",
      });
    }

    const module = await quickJsModule();
    const context = module.newContext();
    const runtime = context.runtime;
    const jsonObject = context.getProp(context.global, "JSON");
    const jsonParse = context.getProp(jsonObject, "parse");
    const deadlineAt = Date.now() + timeoutMs;
    const logs: string[] = [];
    let logChars = 0;
    let logsTruncated = false;
    let cancelled = false;
    let timedOut = false;
    let closing = false;
    let timeout: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;
    let executionGate: any;
    let activePromiseHandle: any;
    let pendingResolution: Promise<any> | undefined;
    const pendingHostPromises = new Set<any>();
    const hostTasks = new Set<Promise<void>>();
    const hostAbortController = new AbortController();

    runtime.setMemoryLimit(memoryLimitBytes);
    runtime.setMaxStackSize(QUICKJS_MAX_STACK_SIZE_BYTES);
    runtime.setInterruptHandler(() => {
      if (options.signal?.aborted) return true;
      if (Date.now() <= deadlineAt) return false;
      timedOut = true;
      return true;
    });

    const abortHostCalls = (reason: string): void => {
      if (!hostAbortController.signal.aborted) hostAbortController.abort(new Error(reason));
    };

    const rejectExecutionGate = (message: string): void => {
      if (!executionGate || executionGate.alive === false) return;
      const errorHandle = context.newError(message);
      executionGate.reject(errorHandle);
      errorHandle.dispose();
      runtime.executePendingJobs();
    };

    const dispatchHostCall = async (
      reference: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<unknown> => {
      if (!CAPABILITIES.has(reference as CodeModeV2Capability)) {
        throw new Error(`Unknown Code Mode V2 host capability: ${reference}`);
      }
      const handler = this.#host[reference as CodeModeV2Capability];
      if (!handler) throw new Error(`Code Mode V2 host capability unavailable: ${reference}`);
      return handler(args, signal);
    };

    try {
      const hostFunction = context.newFunction(
        "__codeModeV2HostCall",
        (referenceHandle: any, argsHandle: any) => {
          const reference = context.getString(referenceHandle);
          const dumpedArgs = context.dump(argsHandle);
          const args =
            typeof dumpedArgs === "object" && dumpedArgs !== null && !Array.isArray(dumpedArgs)
              ? (dumpedArgs as Record<string, unknown>)
              : {};
          const promise = context.newPromise();
          pendingHostPromises.add(promise);
          void promise.settled.then(() => pendingHostPromises.delete(promise));
          const task = runAbortable(hostAbortController.signal, () =>
            dispatchHostCall(reference, args, hostAbortController.signal),
          )
            .then((value) => {
              if (closing || promise.alive === false) return;
              const handle = jsonHandle(context, jsonObject, jsonParse, value);
              promise.resolve(handle);
              handle.dispose();
            })
            .catch((error) => {
              if (closing || promise.alive === false) return;
              const errorHandle = context.newError(
                error instanceof Error ? error.message : String(error),
              );
              promise.reject(errorHandle);
              errorHandle.dispose();
            })
            .finally(() => {
              if (!closing) runtime.executePendingJobs();
            });
          hostTasks.add(task);
          void task.finally(() => hostTasks.delete(task));
          return promise.handle;
        },
      );
      context.setProp(context.global, "__codeModeV2HostCall", hostFunction);
      hostFunction.dispose();

      const printFunction = context.newFunction("print", (...handles: any[]) => {
        if (logsTruncated) return;
        const line = handles.map((handle) => formatValue(context.dump(handle))).join(" ");
        const remaining = maxLogChars - logChars;
        if (line.length > remaining) {
          if (remaining > 0) logs.push(line.slice(0, remaining));
          logs.push("[Code Mode V2 log output truncated]");
          logsTruncated = true;
          return;
        }
        logs.push(line);
        logChars += line.length;
      });
      context.setProp(context.global, "print", printFunction);
      printFunction.dispose();

      const strings = jsonHandle(context, jsonObject, jsonParse, options.strings ?? {});
      context.setProp(context.global, "π", strings);
      strings.dispose();

      const setupResult = context.evalCode(CODE_MODE_V2_GUEST_SETUP, "code-mode-v2-setup.js");
      if (setupResult.error) {
        const error = formatValue(context.dump(setupResult.error));
        setupResult.error.dispose();
        return finish({ value: undefined, logs, terminationReason: "runtime_error", error });
      }
      setupResult.value.dispose();

      executionGate = context.newPromise();
      context.setProp(context.global, "__codeModeV2ExecutionGate", executionGate.handle);
      const transpiled = transpileCodeModeV2Program(options.code);
      const evaluation = context.evalCode(
        `${transpiled}\nPromise.race([__codeModeV2Main(), globalThis.__codeModeV2ExecutionGate])`,
        "code-mode-v2-guest.js",
      );
      runtime.executePendingJobs();
      if (evaluation.error) {
        const deadlineExceeded = timedOut || Date.now() > deadlineAt;
        if (deadlineExceeded) timedOut = true;
        const error = options.signal?.aborted
          ? "Execution cancelled"
          : deadlineExceeded
            ? `Execution timed out after ${timeoutMs}ms`
            : formatValue(context.dump(evaluation.error));
        evaluation.error.dispose();
        abortHostCalls(error);
        return finish({
          value: undefined,
          logs,
          terminationReason: options.signal?.aborted
            ? "aborted"
            : deadlineExceeded
              ? "timed_out"
              : "runtime_error",
          error,
        });
      }

      activePromiseHandle = evaluation.value;
      const cancellation = new Promise<never>((_resolve, reject) => {
        abortHandler = () => {
          cancelled = true;
          abortHostCalls("Execution cancelled");
          rejectExecutionGate("Execution cancelled");
          reject(new Error("Execution cancelled"));
        };
        if (options.signal?.aborted) abortHandler();
        else options.signal?.addEventListener("abort", abortHandler, { once: true });
      });
      void cancellation.catch(() => undefined);
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          const message = `Execution timed out after ${timeoutMs}ms`;
          abortHostCalls(message);
          rejectExecutionGate(message);
          reject(new Error(message));
        }, timeoutMs);
        timeout.unref?.();
      });
      void deadline.catch(() => undefined);

      pendingResolution = context.resolvePromise(activePromiseHandle);
      runtime.executePendingJobs();
      const resolution = await Promise.race([pendingResolution, cancellation, deadline]);
      pendingResolution = undefined;
      activePromiseHandle.dispose();
      activePromiseHandle = undefined;
      if (resolution.error) {
        const error = options.signal?.aborted
          ? "Execution cancelled"
          : timedOut
            ? `Execution timed out after ${timeoutMs}ms`
            : formatValue(context.dump(resolution.error));
        resolution.error.dispose();
        return finish({
          value: undefined,
          logs,
          terminationReason: cancelled ? "aborted" : timedOut ? "timed_out" : "runtime_error",
          error,
        });
      }

      const value = context.dump(resolution.value);
      resolution.value.dispose();
      return finish({ value, logs, terminationReason: "completed" });
    } catch (error) {
      const deadlineExceeded = timedOut || Date.now() > deadlineAt;
      if (deadlineExceeded) timedOut = true;
      const message = cancelled
        ? "Execution cancelled"
        : timedOut
          ? `Execution timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      abortHostCalls(message);
      return finish({
        value: undefined,
        logs,
        terminationReason: cancelled ? "aborted" : timedOut ? "timed_out" : "runtime_error",
        error: message,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
      if (hostTasks.size > 0) {
        const settled = await settleWithin(hostTasks, HOST_TASK_SETTLE_GRACE_MS);
        if (!settled) {
          abortHostCalls("Code Mode V2 execution ended before host calls settled");
          await settleWithin(hostTasks, HOST_TASK_SETTLE_GRACE_MS);
        }
        runtime.executePendingJobs();
      }
      closing = true;
      if (pendingHostPromises.size > 0) {
        const message = cancelled
          ? "Execution cancelled"
          : timedOut
            ? `Execution timed out after ${timeoutMs}ms`
            : "Code Mode V2 execution ended before host calls settled";
        const errorHandle = context.newError(message);
        for (const promise of pendingHostPromises) promise.reject(errorHandle);
        errorHandle.dispose();
        runtime.executePendingJobs();
        await new Promise((resolve) => setImmediate(resolve));
        const settled = await Promise.race<any>([
          pendingResolution ? pendingResolution.catch(() => undefined) : Promise.resolve(undefined),
          new Promise<undefined>((resolve) => {
            const timer = setTimeout(() => resolve(undefined), 1_000);
            timer.unref?.();
          }),
        ]);
        if (settled?.error) settled.error.dispose();
        if (settled?.value) settled.value.dispose();
        for (const promise of pendingHostPromises) {
          if (promise.alive !== false) promise.dispose();
        }
      }
      if (activePromiseHandle?.alive !== false) activePromiseHandle?.dispose();
      if (executionGate?.alive !== false) executionGate?.dispose();
      runtime.executePendingJobs();
      jsonParse.dispose();
      jsonObject.dispose();
      disposeQuickJsContext(context);
    }
  }
}
