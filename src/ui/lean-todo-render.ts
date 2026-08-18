import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { TodoItem } from "../todo-store.js";

const VISIBLE_TODO_ITEMS = 8;
const SPINNER = ["✳", "✴", "✵", "✶", "✷", "✸", "✹", "✺", "✻", "✼", "✽"];
export const TODO_WIDGET_ID = "fabric-todo";

type TodoWidgetTui = {
  terminal: { columns: number };
  requestRender(): void;
};

type TodoWidgetState = {
  todos: TodoItem[];
  frame: number;
  interval?: ReturnType<typeof setInterval> | undefined;
  tui?: TodoWidgetTui;
  registered: boolean;
};

const widgetStates = new WeakMap<object, TodoWidgetState>();

const safeText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const todoSummary = (todos: readonly TodoItem[]): string => {
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
  const pending = todos.filter((todo) => todo.status === "pending").length;
  const parts: string[] = [];
  if (completed > 0) parts.push(`${completed} done`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  if (pending > 0) parts.push(`${pending} open`);
  return `${todos.length} tasks (${parts.join(", ")})`;
};

const todoLine = (todo: TodoItem, theme: Theme, spinner: string): string => {
  if (todo.status === "completed") {
    return `  ${theme.fg("success", "✔")} ${theme.fg("dim", theme.strikethrough(safeText(todo.content)))}`;
  }
  if (todo.status === "in_progress") {
    const activeLabel = todo.activeForm ?? todo.content;
    return `  ${theme.fg("accent", spinner)} ${theme.fg("accent", `${safeText(activeLabel)}…`)}`;
  }
  return `  ${theme.fg("dim", "◻")} ${theme.fg("muted", safeText(todo.content))}`;
};

export const renderLeanTodoWidgetLines = (
  todos: readonly TodoItem[],
  theme: Theme,
  frame = 0,
  width?: number,
): string[] => {
  if (todos.length === 0) return [];
  const truncate = (line: string): string => width ? truncateToWidth(line, width) : line;
  const spinner = SPINNER[frame % SPINNER.length]!;
  const limit = Math.min(todos.length, VISIBLE_TODO_ITEMS);
  const lines = [
    truncate(`${theme.fg("accent", "●")} ${theme.fg("accent", todoSummary(todos))}`),
    ...todos.slice(0, limit).map((todo) => truncate(todoLine(todo, theme, spinner))),
  ];
  if (todos.length > limit) {
    lines.push(truncate(theme.fg("dim", `    … and ${todos.length - limit} more`)));
  }
  return lines;
};

const stopAnimation = (state: TodoWidgetState): void => {
  if (!state.interval) return;
  clearInterval(state.interval);
  state.interval = undefined;
};

const syncAnimation = (state: TodoWidgetState): void => {
  const hasActive = state.todos.some((todo) => todo.status === "in_progress");
  if (!hasActive) {
    stopAnimation(state);
    return;
  }
  if (state.interval) return;
  state.interval = setInterval(() => {
    state.frame += 1;
    state.tui?.requestRender();
  }, 150);
};

export const updateLeanTodoWidget = (
  context: ExtensionContext,
  todos: readonly TodoItem[],
): void => {
  if (!context.hasUI) return;
  const uiKey = context.ui as unknown as object;
  const existing = widgetStates.get(uiKey);

  if (todos.length === 0) {
    if (existing) stopAnimation(existing);
    context.ui.setWidget(TODO_WIDGET_ID, undefined, { placement: "belowEditor" });
    widgetStates.delete(uiKey);
    return;
  }

  const state = existing ?? {
    todos: [],
    frame: 0,
    registered: false,
  };
  state.todos = todos.map((todo) => ({ ...todo }));
  widgetStates.set(uiKey, state);
  syncAnimation(state);

  if (!state.registered) {
    context.ui.setWidget(
      TODO_WIDGET_ID,
      (tui, theme) => {
        state.tui = tui as TodoWidgetTui;
        return {
          render: () => renderLeanTodoWidgetLines(
            state.todos,
            theme,
            state.frame,
            state.tui?.terminal.columns,
          ),
          invalidate() {},
        };
      },
      { placement: "belowEditor" },
    );
    state.registered = true;
    return;
  }

  state.tui?.requestRender();
};
