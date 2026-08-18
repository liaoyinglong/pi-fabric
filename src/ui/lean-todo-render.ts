import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import type { TodoItem, TodoStatus } from "../todo-tool.js";
import { safeExecDisplayText } from "./lean-exec-render.js";

const COLLAPSED_TODO_ITEMS = 8;
const TODO_STATUS_SET = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const normalizedTodos = (value: unknown): TodoItem[] => {
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
    return `${theme.fg("success", "✓")} ${theme.fg("dim", safeExecDisplayText(todo.content))}`;
  }
  if (todo.status === "in_progress") {
    return `${theme.fg("warning", "◆")} ${theme.fg("accent", safeExecDisplayText(activeLabel))}`;
  }
  return `${theme.fg("dim", "○")} ${theme.fg("muted", safeExecDisplayText(todo.content))}`;
};

const todoLines = (todos: readonly TodoItem[], theme: Theme, expanded: boolean): string[] => {
  const limit = expanded ? todos.length : Math.min(todos.length, COLLAPSED_TODO_ITEMS);
  const lines = todos.slice(0, limit).map((todo) => todoLine(todo, theme));
  if (!expanded && todos.length > limit) {
    lines.push(theme.fg("dim", `… ${todos.length - limit} more · Ctrl+O to expand`));
  }
  return lines;
};

const summary = (todos: readonly TodoItem[]): string => {
  if (todos.length === 0) return "empty";
  const { completed, active } = counts(todos);
  return `${completed}/${todos.length} done${active > 0 ? ` · ${active} active` : ""}`;
};

export const renderLeanTodoCall = (
  params: { todos?: unknown },
  theme: Theme,
  expanded: boolean,
): Component => {
  const todos = normalizedTodos(params.todos);
  const header = `${theme.fg("toolTitle", theme.bold("todo"))} ${theme.fg("dim", `· ${summary(todos)}`)}`;
  const lines = todoLines(todos, theme, expanded);
  return new Text(lines.length > 0 ? `${header}\n${lines.join("\n")}` : header, 0, 0);
};

export const renderLeanTodoResult = (
  result: { content?: unknown; details?: unknown },
  theme: Theme,
  expanded: boolean,
): Component => {
  const details = asRecord(result.details);
  const todos = normalizedTodos(details?.todos);
  const header = todos.length === 0
    ? theme.fg("success", "✓ Todo list cleared")
    : `${theme.fg("success", "✓ Todo updated")} ${theme.fg("dim", `· ${summary(todos)}`)}`;
  if (!expanded || todos.length === 0) return new Text(header, 0, 0);
  return new Text(`${header}\n${todoLines(todos, theme, true).join("\n")}`, 0, 0);
};
