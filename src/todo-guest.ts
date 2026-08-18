export const TODO_GUEST_PREAMBLE = `const todo = (input: Array<{ content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }> | { todos: Array<{ content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }> }) => tools.call({ ref: "todo.replace", args: Array.isArray(input) ? { todos: input } : input }) as Promise<Array<{ content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }>>;`;

export const injectTodoGuest = (code: string): string => `${TODO_GUEST_PREAMBLE}\n${code}`;
