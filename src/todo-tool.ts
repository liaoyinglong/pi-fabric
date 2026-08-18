import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderLeanTodoCall, renderLeanTodoResult } from "./ui/lean-todo-render.js";

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export const TODO_CONTENT_MAX_LENGTH = 200;
export const TODO_ACTIVE_FORM_MAX_LENGTH = 120;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

const normalizeTodo = (item: TodoItem): TodoItem => {
  const content = item.content.trim();
  if (!content) throw new Error("Todo content must not be empty");
  if (content.length > TODO_CONTENT_MAX_LENGTH) {
    throw new Error(`Todo content must be at most ${TODO_CONTENT_MAX_LENGTH} characters`);
  }
  const activeForm = item.activeForm?.trim();
  if (activeForm && activeForm.length > TODO_ACTIVE_FORM_MAX_LENGTH) {
    throw new Error(`Todo activeForm must be at most ${TODO_ACTIVE_FORM_MAX_LENGTH} characters`);
  }
  return {
    content,
    status: item.status,
    ...(activeForm ? { activeForm } : {}),
  };
};

export class TodoStore {
  #items: TodoItem[] = [];

  replace(items: readonly TodoItem[]): TodoItem[] {
    this.#items = items.map((item) => normalizeTodo(item));
    return this.snapshot();
  }

  snapshot(): TodoItem[] {
    return this.#items.map((item) => ({ ...item }));
  }

  reset(): void {
    this.#items = [];
  }
}

const todoSummary = (todos: readonly TodoItem[]): string => {
  if (todos.length === 0) return "Todo list cleared.";
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const active = todos.filter((todo) => todo.status === "in_progress").length;
  return `Todo list updated: ${completed}/${todos.length} completed${active > 0 ? `, ${active} in progress` : ""}.`;
};

export const createLeanTodoTool = (
  store: TodoStore,
): ToolDefinition<any, any, any> => defineTool({
  name: "todo",
  label: "Todo",
  description:
    "Maintain a small session-local task list for multi-step work. Submit the complete current list whenever priorities or statuses change.",
  promptSnippet: "session-local task tracking for multi-step work",
  promptGuidelines: [
    "Use todo for non-trivial work with multiple meaningful steps; skip it for simple one-step requests.",
    "Send the complete current todo list on every update. Mark work in_progress before starting it and completed when it is actually finished.",
    "Keep content outcome-oriented. activeForm is optional and should briefly describe what is happening now for an in-progress item.",
  ],
  parameters: Type.Object({
    todos: Type.Array(
      Type.Object({
        content: Type.String({
          minLength: 1,
          maxLength: TODO_CONTENT_MAX_LENGTH,
          description: "Short outcome-oriented task",
        }),
        status: Type.Union(TODO_STATUSES.map((status) => Type.Literal(status))),
        activeForm: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: TODO_ACTIVE_FORM_MAX_LENGTH,
            description: "Short present-progress label for in_progress items",
          }),
        ),
      }),
      { maxItems: 64, description: "Complete current todo list; use an empty array to clear it" },
    ),
  }),
  renderCall(params, theme, context) {
    return renderLeanTodoCall(params as { todos?: unknown }, theme, context.expanded);
  },
  renderResult(result, { expanded }, theme) {
    return renderLeanTodoResult(result, theme, expanded);
  },
  async execute(_toolCallId, params) {
    const todos = store.replace((params.todos ?? []) as TodoItem[]);
    const completed = todos.filter((todo) => todo.status === "completed").length;
    const active = todos.filter((todo) => todo.status === "in_progress").length;
    return {
      content: [{ type: "text", text: todoSummary(todos) }],
      details: {
        todos,
        completed,
        active,
        total: todos.length,
      },
    };
  },
});
