import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TodoItem, TodoStatus } from "../todo-store.js";

const COLLAPSED_TODO_ITEMS = 8;
const TODO_STATUS_SET = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

const safeText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export const normalizedTodos = (value: unknown): TodoItem[] => {
  if (!Array.isArray(value)) return [];
  const todos: TodoItem[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    if (typeof record.content !== "string" || !record.content.trim()) continue;
    if (typeof record.status !== "string" || !TODO_STATUS_SET.has(record.status as TodoStatus)) continue;
    const activeForm = typeof record.activeForm === "string" && record.activeForm.trim()
      ? record.activeForm.trim()
      : undefined;
    todos.push({
      content: record.content.trim(),
      status: record.status as TodoStatus,
      ...(activeForm ? { activeForm } : {}),
    });
  }
  return todos;
};

const counts = (todos: readonly TodoItem[]): { completed: number; active: number } => ({
  completed: todos.filter((todo) => todo.status === "completed").length,
  active: todos.filter((todo) => todo.status === "in_progress").length,
});

const todoLine = (todo: TodoItem, theme: Theme): string => {
  const activeLabel = todo.activeForm ?? todo.content;
  if (todo.status === "completed") {
    return `${theme.fg("success", "✓")} ${theme.fg("dim", safeText(todo.content))}`;
  }
  if (todo.status === "in_progress") {
    return `${theme.fg("warning", "◆")} ${theme.fg("accent", safeText(activeLabel))}`;
  }
  return `${theme.fg("dim", "○")} ${theme.fg("muted", safeText(todo.content))}`;
};

export const todoSummary = (todos: readonly TodoItem[]): string => {
  if (todos.length === 0) return "empty";
  const { completed, active } = counts(todos);
  return `${completed}/${todos.length} done${active > 0 ? ` · ${active} active` : ""}`;
};

export const renderLeanTodoLines = (
  todos: readonly TodoItem[],
  theme: Theme,
  expanded: boolean,
): string[] => {
  if (todos.length === 0) return [];
  const limit = expanded ? todos.length : Math.min(todos.length, COLLAPSED_TODO_ITEMS);
  const lines = [
    `${theme.fg("dim", `todo · ${todoSummary(todos)}`)}`,
    ...todos.slice(0, limit).map((todo) => todoLine(todo, theme)),
  ];
  if (!expanded && todos.length > limit) {
    lines.push(theme.fg("dim", `… ${todos.length - limit} more · Ctrl+O to expand`));
  }
  return lines;
};
