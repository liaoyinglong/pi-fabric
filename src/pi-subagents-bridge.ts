import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentRunRequest, AgentRunResult } from "./agents/types.js";
import type { FabricInvocationContext } from "./protocol.js";
import type { SubagentPolicy } from "./subagents/routing.js";

const ACTIVATION_TIMEOUT_MS = 5_000;

// Stable extension-to-extension event contract exported by pi-subagents.
// Keep these literal here so Fabric's built JS never runtime-imports the
// dependency's TypeScript source from node_modules.
export const SUBAGENT_DELEGATION_REQUEST_EVENT = "prompt-template:subagent:request";
export const SUBAGENT_DELEGATION_STARTED_EVENT = "prompt-template:subagent:started";
export const SUBAGENT_DELEGATION_UPDATE_EVENT = "prompt-template:subagent:update";
export const SUBAGENT_DELEGATION_RESPONSE_EVENT = "prompt-template:subagent:response";
export const SUBAGENT_DELEGATION_CANCEL_EVENT = "prompt-template:subagent:cancel";

interface SubagentDelegationStarted {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
}

interface SubagentDelegationUpdate extends SubagentDelegationStarted {
  runId?: string;
  currentTool?: string;
  recentOutput?: string;
  model?: string;
  toolCount?: number;
  durationMs?: number;
  tokens?: number;
}

type SubagentDelegationStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "interrupted"
  | "turn_budget_exhausted"
  | "tool_budget_exhausted"
  | "structured_output_failed"
  | "acceptance_failed"
  | "invalid_request"
  | "unavailable_context"
  | "duplicate_node";

type SubagentDelegationValue =
  | { kind: "text"; text: string }
  | { kind: "structured"; value: unknown };

interface SubagentDelegationUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
  toolCalls: number;
  durationMs: number;
}

interface SubagentDelegationResponse {
  requestId: string;
  ownerRunId?: string;
  nodeId?: string;
  status: SubagentDelegationStatus;
  error?: string;
  runId?: string;
  agent?: string;
  model?: string;
  thinking?: string;
  exitCode?: number;
  result?: SubagentDelegationValue;
  usage?: SubagentDelegationUsage;
}

export const PI_SUBAGENT_POLICY_AGENTS: Partial<Record<SubagentPolicy, string>> = {
  inspect: "fabric-inspect",
  execute: "fabric-execute",
  modify: "fabric-modify",
};

const PI_SUBAGENT_POLICY_TOOLS: Partial<Record<SubagentPolicy, readonly string[]>> = {
  inspect: ["read", "grep", "find", "ls"],
  execute: ["read", "grep", "find", "ls", "bash"],
  modify: ["read", "grep", "find", "ls", "bash", "edit", "write"],
};

const sameToolset = (actual: readonly string[] | undefined, expected: readonly string[]): boolean => {
  if (!actual || actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return expected.every((tool) => actualSet.has(tool));
};

const completedStatus = (
  status: SubagentDelegationStatus,
): AgentRunResult["status"] => {
  switch (status) {
    case "completed":
      return "completed";
    case "timed_out":
      return "timed_out";
    case "cancelled":
    case "interrupted":
      return "stopped";
    default:
      return "failed";
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const identityMatches = (
  value: unknown,
  requestId: string,
  ownerRunId: string,
  nodeId: string,
): boolean => {
  if (!isRecord(value) || value.requestId !== requestId) return false;
  if (typeof value.ownerRunId === "string" && value.ownerRunId !== ownerRunId) return false;
  if (typeof value.nodeId === "string" && value.nodeId !== nodeId) return false;
  return true;
};

const responseText = (response: SubagentDelegationResponse): {
  text: string;
  value?: unknown;
} => {
  if (!response.result) return { text: "" };
  if (response.result.kind === "text") return { text: response.result.text };
  return {
    text: JSON.stringify(response.result.value) ?? "null",
    value: response.result.value,
  };
};

export const delegationResponseToAgentResult = (
  response: SubagentDelegationResponse,
  request: AgentRunRequest,
  context: FabricInvocationContext,
  fallbackName: string,
  startedAt: number,
): AgentRunResult => {
  const finishedAt = Date.now();
  const output = responseText(response);
  const usage = response.usage;

  return {
    id: response.runId ?? randomUUID(),
    name: request.name ?? fallbackName,
    task: request.task,
    status: completedStatus(response.status),
    runner: "pi",
    transport: "process",
    cwd: context.cwd,
    ...(response.model ?? request.model ? { model: response.model ?? request.model } : {}),
    ...(request.thinking ? { thinking: request.thinking } : {}),
    startedAt,
    updatedAt: finishedAt,
    finishedAt,
    turns: usage?.turns ?? 0,
    toolCalls: usage?.toolCalls ?? 0,
    text: output.text,
    ...(output.value !== undefined ? { value: output.value } : {}),
    ...(response.error ? { error: response.error } : {}),
    ...(response.exitCode !== undefined ? { exitCode: response.exitCode } : {}),
    usage: {
      input: usage?.input ?? 0,
      output: usage?.output ?? 0,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
      cost: usage?.cost ?? 0,
    },
  };
};

export class PiSubagentsBridge {
  constructor(readonly pi: ExtensionAPI) {}

  supports(request: AgentRunRequest, policy: SubagentPolicy): boolean {
    const expectedTools = PI_SUBAGENT_POLICY_TOOLS[policy];
    return (
      policy !== "isolated" &&
      request.runner === "pi" &&
      request.recursive !== true &&
      request.worktree !== true &&
      request.extensions === undefined &&
      (request.transport === undefined || request.transport === "process") &&
      PI_SUBAGENT_POLICY_AGENTS[policy] !== undefined &&
      expectedTools !== undefined &&
      sameToolset(request.tools, expectedTools)
    );
  }

  async run(
    request: AgentRunRequest,
    policy: SubagentPolicy,
    context: FabricInvocationContext,
  ): Promise<AgentRunResult> {
    const agent = PI_SUBAGENT_POLICY_AGENTS[policy];
    if (!agent) throw new Error(`pi-subagents bridge does not support policy: ${policy}`);
    if (context.signal?.aborted) throw new Error("Subagent delegation was aborted before launch");

    const requestId = randomUUID();
    const ownerRunId = context.parentToolCallId;
    const nodeId = context.nestedToolCallId;
    const startedAt = Date.now();

    return new Promise<AgentRunResult>((resolve, reject) => {
      let settled = false;
      let activated = false;
      let activationTimer: ReturnType<typeof setTimeout> | undefined;
      const dispose: Array<() => void> = [];

      const cleanup = () => {
        if (activationTimer) clearTimeout(activationTimer);
        for (const fn of dispose.splice(0)) fn();
        context.signal?.removeEventListener("abort", abort);
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const finish = (response: SubagentDelegationResponse) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(delegationResponseToAgentResult(response, request, context, agent, startedAt));
      };

      const subscribe = (event: string, handler: (payload: unknown) => void) => {
        const unsubscribe = this.pi.events.on(event, handler);
        if (typeof unsubscribe === "function") dispose.push(unsubscribe);
      };

      const activate = () => {
        if (activated) return;
        activated = true;
        if (activationTimer) {
          clearTimeout(activationTimer);
          activationTimer = undefined;
        }
        context.activity?.({ type: "entity", id: requestId, kind: "agent", name: request.name ?? agent });
      };

      subscribe(SUBAGENT_DELEGATION_STARTED_EVENT, (payload) => {
        if (!identityMatches(payload, requestId, ownerRunId, nodeId)) return;
        activate();
      });

      subscribe(SUBAGENT_DELEGATION_UPDATE_EVENT, (payload) => {
        if (!identityMatches(payload, requestId, ownerRunId, nodeId)) return;
        activate();
        const update = payload as SubagentDelegationUpdate;
        const progress = update.currentTool
          ? `${request.name ?? agent}: ${update.currentTool}`
          : update.recentOutput?.trim();
        if (progress) context.update(progress);
        if (typeof update.tokens === "number" || typeof update.toolCount === "number") {
          context.activity?.({
            type: "metrics",
            ...(typeof update.tokens === "number" ? { tokens: update.tokens } : {}),
            ...(typeof update.toolCount === "number" ? { toolCalls: update.toolCount } : {}),
          });
        }
      });

      subscribe(SUBAGENT_DELEGATION_RESPONSE_EVENT, (payload) => {
        if (!identityMatches(payload, requestId, ownerRunId, nodeId)) return;
        activate();
        finish(payload as SubagentDelegationResponse);
      });

      const abort = () => {
        this.pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, {
          requestId,
          ownerRunId,
          nodeId,
        } satisfies SubagentDelegationStarted);
        fail(new Error("Subagent delegation was aborted"));
      };

      context.signal?.addEventListener("abort", abort, { once: true });
      activationTimer = setTimeout(() => {
        fail(new Error(
          "pi-subagents delegation bridge is not active. Reinstall pi-fabric so its bundled pi-subagents extension is loaded.",
        ));
      }, ACTIVATION_TIMEOUT_MS);

      this.pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, {
        requestId,
        ownerRunId,
        nodeId,
        agent,
        task: request.task,
        context: "fresh",
        cwd: context.cwd,
        ...(request.model ? { model: request.model } : {}),
        ...(request.thinking ? { thinking: request.thinking } : {}),
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        result: request.schema
          ? { kind: "structured", schema: request.schema }
          : { kind: "text" },
      });
    });
  }
}
