import type { FabricAgentRunner } from "../config.js";

export const FABRIC_LIFECYCLE_EVENTS = [
  "pi.turn_end",
  "run.completed",
  "run.failed",
  "run.stopped",
  "run.timed_out",
  "tokens.usage",
] as const;

export type FabricLifecycleEventType = (typeof FABRIC_LIFECYCLE_EVENTS)[number];

export interface FabricLifecycleSource {
  id: string;
  name: string;
  kind: "agent" | "actor";
  rootId: string;
  runner: FabricAgentRunner;
  ownerHostId?: string;
  ownerIdentityId?: string;
}

export interface FabricLifecyclePublishRequest {
  source: FabricLifecycleSource;
  event: FabricLifecycleEventType;
  occurredAt?: number;
  runId?: string;
  status?: string;
  data?: unknown;
}

export interface FabricTokenUsagePayload {
  runId: string;
  name: string;
  runner: FabricAgentRunner;
  depth: number;
  actorId?: string;
  actorName?: string;
  cumulativeTokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

const lifecycleEvents = new Set<string>(FABRIC_LIFECYCLE_EVENTS);

export const isFabricLifecycleEventType = (
  value: unknown,
): value is FabricLifecycleEventType =>
  typeof value === "string" && lifecycleEvents.has(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const tokenUsagePayloadFromValue = (
  value: unknown,
): FabricTokenUsagePayload | undefined => {
  if (!isObject(value)) return undefined;
  const runner =
    value.runner === "pi" || value.runner === "claude" || value.runner === "veda"
      ? value.runner
      : undefined;
  if (
    typeof value.runId !== "string" ||
    typeof value.name !== "string" ||
    runner === undefined ||
    typeof value.depth !== "number" ||
    typeof value.cumulativeTokens !== "number" ||
    typeof value.input !== "number" ||
    typeof value.output !== "number" ||
    typeof value.cacheRead !== "number" ||
    typeof value.cacheWrite !== "number" ||
    typeof value.cost !== "number"
  ) return undefined;
  return value as unknown as FabricTokenUsagePayload;
};
