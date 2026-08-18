import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TodoItem } from "../todo-store.js";

const VISIBLE_TODO_ITEMS = 8;
export const TODO_WIDGET_ID = "fabric-todo";

const safeText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const todoSummary = (todos: readonly TodoItem[]): string => {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const active = todos.filter((todo) => todo.status === "in_progress").length;
  return `${completed}/${todos.length} done${active > 0 ? ` · ${active} active` : ""}`;
};

const todoLine = (todo: TodoItem, theme: Theme): string => {
  const activeLabel = todo.activeForm ?? todo.content;
  if (todo.status === "completed") {
    return `${theme.fg("success", "✓")} ${theme.fg("dim", theme.strikethrough(safeText(todo.content)))}`;
  }
  if (todo.status === "in_progress") {
    return `${theme.fg("warning", "◆")} ${theme.fg("accent", safeText(activeLabel))}`;
  }
  return `${theme.fg("dim", "○")} ${theme.fg("muted", safeText(todo.content))}`;
};

export const renderLeanTodoWidgetLines = (
  todos: readonly TodoItem[],
  theme: Theme,
): string[] => {
  if (todos.length === 0) return [];
  const limit = Math.min(todos.length, VISIBLE_TODO_ITEMS);
  const lines = [
    `${theme.fg("accent", theme.bold("Todos"))} ${theme.fg("dim", `· ${todoSummary(todos)}`)}`,
    ...todos.slice(0, limit).map((todo) => todoLine(todo, theme)),
  ];
  if (todos.length > limit) {
    lines.push(theme.fg("dim", `… ${todos.length - limit} more`));
  }
  return lines;
};

export const updateLeanTodoWidget = (
  context: ExtensionContext,
  todos: readonly TodoItem[],
): void => {
  if (!context.hasUI) return;
  const lines = renderLeanTodoWidgetLines(todos, context.ui.theme);
  context.ui.setWidget(
    TODO_WIDGET_ID,
    lines.length > 0 ? lines : undefined,
    { placement: "belowEditor" },
  );
};
