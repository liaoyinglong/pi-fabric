import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../protocol.js";
import {
  TODO_ACTIVE_FORM_MAX_LENGTH,
  TODO_CONTENT_MAX_LENGTH,
  TODO_MAX_ITEMS,
  TODO_STATUSES,
  TodoStore,
} from "../todo-store.js";
import { updateLeanTodoWidget } from "../ui/lean-todo-render.js";

const replaceSchema = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      maxItems: TODO_MAX_ITEMS,
      items: {
        type: "object",
        properties: {
          content: { type: "string", minLength: 1, maxLength: TODO_CONTENT_MAX_LENGTH },
          status: { type: "string", enum: [...TODO_STATUSES] },
          activeForm: { type: "string", minLength: 1, maxLength: TODO_ACTIVE_FORM_MAX_LENGTH },
        },
        required: ["content", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["todos"],
  additionalProperties: false,
};

const replaceAction: FabricActionDescriptor = {
  name: "replace",
  description: "Replace the session-local Fabric todo list",
  inputSchema: replaceSchema,
  risk: "read",
};

export class TodoProvider implements FabricProvider {
  readonly name = "todo";
  readonly description = "Internal backing provider for the fabric_exec todo() built-in";

  constructor(readonly store: TodoStore) {}

  async list(request: FabricProviderListRequest): Promise<FabricActionDescriptor[]> {
    const query = request.query?.toLowerCase();
    return query && !"todo replace session task list".includes(query) ? [] : [replaceAction];
  }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return actionName === "replace" ? replaceAction : undefined;
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    if (actionName !== "replace") throw new Error(`Unknown todo action: ${actionName}`);
    if (!Array.isArray(args.todos)) throw new Error("todo() expects a complete todos array");
    const todos = this.store.replace(args.todos);
    updateLeanTodoWidget(context.extensionContext, todos);
    return todos;
  }
}
