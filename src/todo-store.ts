export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
export const TODO_CONTENT_MAX_LENGTH = 200;
export const TODO_ACTIVE_FORM_MAX_LENGTH = 120;
export const TODO_MAX_ITEMS = 64;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

const TODO_STATUS_SET = new Set<string>(TODO_STATUSES);

const normalizeTodo = (value: unknown): TodoItem => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Todo item must be an object");
  }
  const item = value as Record<string, unknown>;
  if (typeof item.content !== "string") throw new Error("Todo content must be a string");
  const content = item.content.trim();
  if (!content) throw new Error("Todo content must not be empty");
  if (content.length > TODO_CONTENT_MAX_LENGTH) {
    throw new Error(`Todo content must be at most ${TODO_CONTENT_MAX_LENGTH} characters`);
  }
  if (typeof item.status !== "string" || !TODO_STATUS_SET.has(item.status)) {
    throw new Error(`Todo status must be one of: ${TODO_STATUSES.join(", ")}`);
  }
  if (item.activeForm !== undefined && typeof item.activeForm !== "string") {
    throw new Error("Todo activeForm must be a string when provided");
  }
  const activeForm = typeof item.activeForm === "string" ? item.activeForm.trim() : undefined;
  if (activeForm && activeForm.length > TODO_ACTIVE_FORM_MAX_LENGTH) {
    throw new Error(`Todo activeForm must be at most ${TODO_ACTIVE_FORM_MAX_LENGTH} characters`);
  }
  return {
    content,
    status: item.status as TodoStatus,
    ...(activeForm ? { activeForm } : {}),
  };
};

export class TodoStore {
  #items: TodoItem[] = [];

  replace(items: readonly unknown[]): TodoItem[] {
    if (items.length > TODO_MAX_ITEMS) {
      throw new Error(`Todo list must contain at most ${TODO_MAX_ITEMS} items`);
    }
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
