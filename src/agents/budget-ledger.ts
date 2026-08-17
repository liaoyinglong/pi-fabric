import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Cross-process cost budget ledger for a recursive Fabric agent tree.
 *
 * A recursive tree spans one Pi process per node. Each node's AgentManager
 * records the cost of the children it spawns into a single append-only JSONL
 * file, and checks the accumulated spend before spawning another child. The
 * ledger path and budget travel to descendants through PI_FABRIC_BUDGET*
 * environment variables, which the worker forwards to child Pi processes via
 * `{ ...process.env }`.
 *
 * The check is best-effort: concurrent children can each pass the check before
 * any cost lands, so a tree may slightly overshoot. The race-free ceiling
 * remains the per-execution call count (`agents.maxPerExecution`). Cost is
 * recorded after a child finishes.
 */

export interface BudgetLedgerEntry {
  id: string;
  depth: number;
  cost: number;
  tokens: number;
  ts: number;
  runner?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface BudgetLedgerSummary {
  cost: number;
  tokens: number;
}

export interface BudgetLedgerDetail {
  cost: number;
  tokens: number;
  byRunner: Record<string, { cost: number; tokens: number }>;
  entries: BudgetLedgerEntry[];
}

export interface BudgetLedgerState {
  budget: number;
  file: string;
  id: string;
}

const ENV_BUDGET = "PI_FABRIC_BUDGET";
const ENV_BUDGET_FILE = "PI_FABRIC_BUDGET_FILE";
const ENV_BUDGET_ID = "PI_FABRIC_BUDGET_ID";

const parseFloatFinite = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Read the active budget state inherited from the recursive tree root. */
export function activeBudgetState(): BudgetLedgerState | undefined {
  const file = process.env[ENV_BUDGET_FILE];
  const budget = parseFloatFinite(process.env[ENV_BUDGET]);
  if (!file || budget === undefined || budget <= 0) return undefined;
  return { budget, file, id: process.env[ENV_BUDGET_ID] ?? "" };
}

/** Initialize a shared ledger at the recursive tree root. */
export function initBudgetLedger(budget: number): BudgetLedgerState {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-budget-"));
  const file = path.join(directory, "cost.jsonl");
  fs.writeFileSync(file, "", { mode: 0o600 });
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  process.env[ENV_BUDGET] = String(budget);
  process.env[ENV_BUDGET_FILE] = file;
  process.env[ENV_BUDGET_ID] = id;
  return { budget, file, id };
}

/** Re-apply an inherited budget ledger to the current process. */
export function useBudgetLedger(state: BudgetLedgerState): void {
  process.env[ENV_BUDGET] = String(state.budget);
  process.env[ENV_BUDGET_FILE] = state.file;
  process.env[ENV_BUDGET_ID] = state.id;
}

/** Clear budget variables owned by a depth-zero manager. */
export function clearOwnedBudgetEnv(): void {
  delete process.env[ENV_BUDGET];
  delete process.env[ENV_BUDGET_FILE];
  delete process.env[ENV_BUDGET_ID];
}

/** Sum the append-only ledger while tolerating malformed lines. */
export function readBudgetLedger(file: string): BudgetLedgerSummary {
  let cost = 0;
  let tokens = 0;
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { cost, tokens };
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<BudgetLedgerEntry>;
      cost += Number(parsed.cost) || 0;
      tokens += Number(parsed.tokens) || 0;
    } catch {
      // Ignore malformed cost lines; the ledger is best-effort.
    }
  }
  return { cost, tokens };
}

/** Append one child's incurred cost to the shared ledger. */
export function appendBudgetLedger(file: string, entry: BudgetLedgerEntry): void {
  try {
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // A ledger write failure must not break the agent run; the next check
    // still guards against runaway spend via the per-execution call ceiling.
  }
}

/** Parse one attributed ledger entry while accepting older minimal rows. */
const parseBudgetLedgerEntry = (value: unknown): BudgetLedgerEntry | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.cost !== "number" ||
    typeof candidate.tokens !== "number" ||
    typeof candidate.ts !== "number"
  ) {
    return undefined;
  }
  return candidate as unknown as BudgetLedgerEntry;
};

/** Sum the ledger with per-runner attribution for orchestration decisions. */
export function readBudgetLedgerDetailed(file: string): BudgetLedgerDetail {
  const detail: BudgetLedgerDetail = {
    cost: 0,
    tokens: 0,
    byRunner: {},
    entries: [],
  };
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return detail;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = parseBudgetLedgerEntry(JSON.parse(line));
      if (!entry) continue;
      detail.cost += Number(entry.cost) || 0;
      detail.tokens += Number(entry.tokens) || 0;
      detail.entries.push(entry);
      const runnerKey = entry.runner ?? "unknown";
      const runnerRollup = (detail.byRunner[runnerKey] ??= { cost: 0, tokens: 0 });
      runnerRollup.cost += entry.cost;
      runnerRollup.tokens += entry.tokens;
    } catch {
      // Ignore malformed cost lines; the ledger is best-effort.
    }
  }
  return detail;
}
