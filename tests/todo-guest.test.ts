import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { TodoProvider } from "../src/providers/todo-provider.js";
import { injectTodoGuest } from "../src/todo-guest.js";
import {
  TODO_ACTIVE_FORM_MAX_LENGTH,
  TODO_CONTENT_MAX_LENGTH,
  TODO_MAX_ITEMS,
  TodoStore,
} from "../src/todo-store.js";
import { renderLeanTodoLines } from "../src/ui/lean-todo-render.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("fabric_exec todo built-in", () => {
  it("stores normalized complete-list replacements and returns defensive snapshots", () => {
    const store = new TodoStore();
    const first = store.replace([
      { content: " Inspect runtime ", status: "completed" },
      { content: "Implement todo", status: "in_progress", activeForm: " Implementing todo UI " },
      { content: "Add tests", status: "pending" },
    ]);

    expect(first).toEqual([
      { content: "Inspect runtime", status: "completed" },
      { content: "Implement todo", status: "in_progress", activeForm: "Implementing todo UI" },
      { content: "Add tests", status: "pending" },
    ]);
    first[0]!.content = "mutated";
    expect(store.snapshot()[0]?.content).toBe("Inspect runtime");
    store.replace([]);
    expect(store.snapshot()).toEqual([]);
  });

  it("enforces item count, status, and text bounds in the backing store", () => {
    const store = new TodoStore();
    expect(() => store.replace(Array.from({ length: TODO_MAX_ITEMS + 1 }, (_, index) => ({
      content: `Task ${index}`,
      status: "pending",
    })))).toThrow(`Todo list must contain at most ${TODO_MAX_ITEMS} items`);

    expect(() => store.replace([{
      content: "x".repeat(TODO_CONTENT_MAX_LENGTH + 1),
      status: "pending",
    }])).toThrow(`Todo content must be at most ${TODO_CONTENT_MAX_LENGTH} characters`);

    expect(() => store.replace([{
      content: "Implement bounded todo state",
      status: "in_progress",
      activeForm: "x".repeat(TODO_ACTIVE_FORM_MAX_LENGTH + 1),
    }])).toThrow(`Todo activeForm must be at most ${TODO_ACTIVE_FORM_MAX_LENGTH} characters`);

    expect(() => store.replace([{ content: "Unknown", status: "started" }])).toThrow(
      "Todo status must be one of",
    );
  });

  it.each(["quickjs", "node-process"] as const)(
    "executes todo() inside the %s fabric runtime without a Pi todo tool",
    async (runtime) => {
      const store = new TodoStore();
      const registry = new ActionRegistry();
      registry.register(new TodoProvider(store));
      const config = structuredClone(DEFAULT_FABRIC_CONFIG);
      config.executor.runtime = runtime;
      config.approvals.read = "allow";
      if (runtime === "node-process") config.executor.memoryLimitBytes = 128 * 1024 * 1024;
      const service = new FabricExecutionService(registry, config);

      const result = await service.execute({
        code: injectTodoGuest(`
await todo([
  { content: "Inspect runtime", status: "completed" },
  { content: "Implement guest API", status: "in_progress", activeForm: "Implementing guest API" },
]);
return "done";
`),
        signal: undefined,
        parentToolCallId: `todo-${runtime}`,
        context: { cwd: process.cwd(), hasUI: false } as ExtensionContext,
        onPartial() {},
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe("done");
      expect(store.snapshot()).toEqual([
        { content: "Inspect runtime", status: "completed" },
        { content: "Implement guest API", status: "in_progress", activeForm: "Implementing guest API" },
      ]);
      expect(result.audits.map((audit) => audit.ref)).toContain("todo.replace");
    },
  );

  it("supports the object form and clear operation", async () => {
    const store = new TodoStore();
    const registry = new ActionRegistry();
    registry.register(new TodoProvider(store));
    const config = structuredClone(DEFAULT_FABRIC_CONFIG);
    config.approvals.read = "allow";
    const service = new FabricExecutionService(registry, config);
    const context = { cwd: process.cwd(), hasUI: false } as ExtensionContext;

    await service.execute({
      code: injectTodoGuest('await todo({ todos: [{ content: "One", status: "pending" }] }); return true;'),
      signal: undefined,
      parentToolCallId: "todo-object",
      context,
      onPartial() {},
    });
    expect(store.snapshot()).toEqual([{ content: "One", status: "pending" }]);

    await service.execute({
      code: injectTodoGuest("await todo([]); return true;"),
      signal: undefined,
      parentToolCallId: "todo-clear",
      context,
      onPartial() {},
    });
    expect(store.snapshot()).toEqual([]);
  });

  it("renders a compact Claude-style checklist and bounds collapsed output", () => {
    const todos = [
      { content: "Inspect runtime", status: "completed" as const },
      { content: "Implement todo", status: "in_progress" as const, activeForm: "Implementing todo UI" },
      ...Array.from({ length: 8 }, (_, index) => ({
        content: `Task ${index + 3}`,
        status: "pending" as const,
      })),
    ];
    const collapsed = renderLeanTodoLines(todos, plainTheme, false).join("\n");
    const expanded = renderLeanTodoLines(todos, plainTheme, true).join("\n");

    expect(collapsed).toContain("todo · 1/10 done · 1 active");
    expect(collapsed).toContain("✓ Inspect runtime");
    expect(collapsed).toContain("◆ Implementing todo UI");
    expect(collapsed).toContain("… 2 more · Ctrl+O to expand");
    expect(expanded).toContain("Task 10");
  });
});
