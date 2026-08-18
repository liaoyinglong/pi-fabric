export const TODO_GUEST_PREAMBLE = `const todo = (input: Array<{ content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }> | { todos: Array<{ content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }> }) => tools.call({ ref: "todo.replace", args: Array.isArray(input) ? { todos: input } : input }) as Promise<Array<{ content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }>>;`;

export const WORKFLOW_COMPAT_GUEST_PREAMBLE = `
const __fabricBaseWorkflow = (globalThis as any).workflow as Record<string, unknown>;
const __fabricBaseAgent = (globalThis as any).agent as (...args: any[]) => Promise<any>;
const __fabricBaseParallel = (globalThis as any).parallel as (...args: any[]) => Promise<any>;
const __fabricCompatAgent = (promptOrRequest: unknown, options: Record<string, unknown> = {}) => {
  if (typeof promptOrRequest === "object" && promptOrRequest !== null && !Array.isArray(promptOrRequest)) {
    const { task, ...requestOptions } = promptOrRequest as { task?: unknown; [key: string]: unknown };
    if (typeof task !== "string" || !task.trim()) {
      throw new TypeError("workflow.agent object form requires a non-empty task string");
    }
    return __fabricBaseAgent(task, requestOptions);
  }
  return __fabricBaseAgent(promptOrRequest, options);
};
const __fabricCompatParallel = (items: unknown[], arg2?: unknown, arg3?: unknown) => {
  if (typeof arg2 === "function") return __fabricBaseParallel(items, arg2, arg3);
  if (!Array.isArray(items)) return __fabricBaseParallel(items, arg2);
  const hasFunctions = items.some((item) => typeof item === "function");
  const hasNonFunctions = items.some((item) => typeof item !== "function");
  if (hasFunctions && hasNonFunctions) {
    throw new TypeError("workflow.parallel cannot mix functions with already-started values/promises");
  }
  if (hasNonFunctions) {
    if (arg2 !== undefined) {
      throw new TypeError("workflow.parallel cannot enforce a concurrency limit after promises have started; pass functions or use Promise.all");
    }
    return __fabricBaseParallel(items.map((item) => () => item));
  }
  return __fabricBaseParallel(items, arg2);
};
(globalThis as any).agent = __fabricCompatAgent;
(globalThis as any).parallel = __fabricCompatParallel;
(globalThis as any).workflow = Object.freeze({
  ...__fabricBaseWorkflow,
  agent: __fabricCompatAgent,
  parallel: __fabricCompatParallel,
});
`;

export const injectTodoGuest = (code: string): string =>
  `${TODO_GUEST_PREAMBLE}\n${WORKFLOW_COMPAT_GUEST_PREAMBLE}\n${code}`;
