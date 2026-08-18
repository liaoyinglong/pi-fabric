import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  createLeanTodoTool,
  TODO_ACTIVE_FORM_MAX_LENGTH,
  TODO_CONTENT_MAX_LENGTH,
  TodoStore,
} from "../src/todo-tool.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const renderContext = (expanded = false) => ({
  args: {},
  toolCallId: "todo-render",
  invalidate: () => {},
  lastComponent: undefined,
  state: {},
  cwd: process.cwd(),
  executionStarted: true,
  argsComplete: true,
  isPartial: false,
  expanded,
  showImages: true,
  isError: false,
});

describe("built-in todo tool", () => {
  it("stores the normalized complete list and clears with an empty update", async () => {
    const store = new TodoStore();
    const tool = createLeanTodoTool(store);

    const result = await tool.execute!(
      "todo-call",
      {
        todos: [
          { content: " Inspect runtime ", status: "completed" },
          { content: "Implement todo", status: "in_progress", activeForm: " Implementing todo UI " },
          { content: "Add tests", status: "pending" },
        ],
      } as never,
      new AbortController().signal,
      undefined,
      {} as never,
    );

    expect(store.snapshot()).toEqual([
      { content: "Inspect runtime", status: "completed" },
      { content: "Implement todo", status: "in_progress", activeForm: "Implementing todo UI" },
      { content: "Add tests", status: "pending" },
    ]);
    expect(result.content).toEqual([
      { type: "text", text: "Todo list updated: 1/3 completed, 1 in progress." },
    ]);
    expect(result.details).toEqual(expect.objectContaining({
      completed: 1,
      active: 1,
      total: 3,
    }));

    await tool.execute!(
      "todo-clear",
      { todos: [] } as never,
      new AbortController().signal,
      undefined,
      {} as never,
    );
    expect(store.snapshot()).toEqual([]);
  });

  it("returns defensive snapshots", () => {
    const store = new TodoStore();
    const first = store.replace([{ content: "One", status: "pending" }]);
    first[0]!.content = "mutated";
    expect(store.snapshot()).toEqual([{ content: "One", status: "pending" }]);
    store.reset();
    expect(store.snapshot()).toEqual([]);
  });

  it("rejects todo text that exceeds the bounded state contract", () => {
    const store = new TodoStore();
    expect(() => store.replace([{
      content: "x".repeat(TODO_CONTENT_MAX_LENGTH + 1),
      status: "pending",
    }])).toThrow(`Todo content must be at most ${TODO_CONTENT_MAX_LENGTH} characters`);

    expect(() => store.replace([{
      content: "Implement bounded todo state",
      status: "in_progress",
      activeForm: "x".repeat(TODO_ACTIVE_FORM_MAX_LENGTH + 1),
    }])).toThrow(`Todo activeForm must be at most ${TODO_ACTIVE_FORM_MAX_LENGTH} characters`);
  });

  it("renders a compact Claude-style checklist and uses activeForm for current work", () => {
    const tool = createLeanTodoTool(new TodoStore());
    const rendered = tool.renderCall!(
      {
        todos: [
          { content: "Inspect runtime", status: "completed" },
          { content: "Implement todo", status: "in_progress", activeForm: "Implementing todo UI" },
          { content: "Add tests", status: "pending" },
        ],
      } as never,
      plainTheme,
      renderContext() as never,
    ).render(120).join("\n");

    expect(rendered).toContain("todo · 1/3 done · 1 active");
    expect(rendered).toContain("✓ Inspect runtime");
    expect(rendered).toContain("◆ Implementing todo UI");
    expect(rendered).toContain("○ Add tests");
  });

  it("bounds collapsed todo output", () => {
    const tool = createLeanTodoTool(new TodoStore());
    const todos = Array.from({ length: 10 }, (_, index) => ({
      content: `Task ${index + 1}`,
      status: "pending" as const,
    }));
    const collapsed = tool.renderCall!(
      { todos } as never,
      plainTheme,
      renderContext() as never,
    ).render(120).join("\n");
    const expanded = tool.renderCall!(
      { todos } as never,
      plainTheme,
      renderContext(true) as never,
    ).render(120).join("\n");

    expect(collapsed).toContain("Task 8");
    expect(collapsed).not.toContain("Task 9");
    expect(collapsed).toContain("… 2 more · Ctrl+O to expand");
    expect(expanded).toContain("Task 10");
  });
});
