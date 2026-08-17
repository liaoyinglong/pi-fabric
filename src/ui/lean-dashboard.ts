import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import type { AgentHandleInfo, AgentRunRecord, FabricLogLine } from "../agents/types.js";
import type { AgentManager } from "../agents/manager.js";
import { readJsonlPage } from "../log-tail.js";
import { formatLeanFabricLogLine } from "../commands/lean-fabric.js";

const DASHBOARD_REFRESH_MS = 250;
const DASHBOARD_HEIGHT_PERCENT = 90;
const MIN_TWO_PANE_WIDTH = 76;
const MIN_AGENT_PANE_WIDTH = 28;
const MAX_AGENT_PANE_WIDTH = 46;

export interface LeanDashboardAgentRow {
  run: AgentRunRecord | AgentHandleInfo;
  depth: number;
}

const isRunRecord = (value: AgentRunRecord | AgentHandleInfo): value is AgentRunRecord =>
  "startedAt" in value;

const runnerLabel = (value: AgentRunRecord | AgentHandleInfo): string =>
  value.runner === "cli" && value.cli ? `cli/${value.cli}` : value.runner;

const totalTokens = (value: AgentRunRecord): number =>
  value.usage.input + value.usage.output + value.usage.cacheRead + value.usage.cacheWrite;

export const flattenLeanDashboardAgents = (
  values: Array<AgentRunRecord | AgentHandleInfo>,
): LeanDashboardAgentRow[] => {
  const rows: LeanDashboardAgentRow[] = [];
  const visit = (value: AgentRunRecord | AgentHandleInfo, depth: number): void => {
    rows.push({ run: value, depth });
    if (!isRunRecord(value)) return;
    for (const nested of value.nestedAgents ?? []) visit(nested, depth + 1);
  };
  for (const value of values) visit(value, 0);
  return rows;
};

const fit = (value: string, width: number): string => {
  if (width <= 0) return "";
  const clipped = truncateToWidth(value, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};

const compact = (value: string, width: number): string =>
  truncateToWidth(value.replace(/\s+/g, " ").trim(), Math.max(1, width));

const statusGlyph = (status: AgentRunRecord["status"]): string => {
  switch (status) {
    case "running":
      return "◆";
    case "queued":
      return "○";
    case "completed":
      return "✓";
    case "failed":
    case "timed_out":
      return "×";
    case "stopped":
      return "■";
  }
};

const colorStatus = (theme: Theme, status: AgentRunRecord["status"], text: string): string => {
  switch (status) {
    case "running":
      return theme.fg("accent", text);
    case "completed":
      return theme.fg("success", text);
    case "failed":
    case "timed_out":
      return theme.fg("error", text);
    case "queued":
      return theme.fg("warning", text);
    case "stopped":
      return theme.fg("muted", text);
  }
};

const dashboardRows = (tui: TUI): number => {
  const terminalRows = Math.max(1, tui.terminal?.rows ?? process.stdout.rows ?? 28);
  return Math.max(10, Math.min(Math.floor((terminalRows * DASHBOARD_HEIGHT_PERCENT) / 100), terminalRows - 2));
};

const agentSummary = (value: AgentRunRecord | AgentHandleInfo, width: number): string => {
  const indent = value === undefined ? "" : "";
  const details: string[] = [runnerLabel(value)];
  if (isRunRecord(value)) {
    if (value.currentTool) details.push(`tool:${value.currentTool}`);
    if (value.toolCalls > 0) details.push(`${value.toolCalls} calls`);
    const tokens = totalTokens(value);
    if (tokens > 0) details.push(`${tokens} tok`);
  }
  const suffix = details.length > 0 ? ` · ${details.join(" · ")}` : "";
  return compact(`${indent}${value.name}${suffix}`, width);
};

const countStatuses = (rows: LeanDashboardAgentRow[]): string => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.run.status, (counts.get(row.run.status) ?? 0) + 1);
  const order = ["running", "queued", "completed", "failed", "timed_out", "stopped"];
  return order
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      return count > 0 ? [`${count} ${status}`] : [];
    })
    .join(" · ");
};

const logLinesFor = (
  manager: AgentManager,
  row: LeanDashboardAgentRow | undefined,
  limit: number,
): { events: FabricLogLine[]; hasMore: boolean } => {
  if (!row) return { events: [], hasMore: false };
  if (row.depth > 0 && isRunRecord(row.run) && row.run.logFile) {
    const page = readJsonlPage(row.run.logFile, Math.max(1, limit));
    return { events: page.lines, hasMore: page.hasMore };
  }
  try {
    const log = manager.readLog(row.run.id, { lines: Math.max(1, limit) });
    return { events: log.events, hasMore: log.hasMore };
  } catch {
    if (isRunRecord(row.run) && row.run.logFile) {
      const page = readJsonlPage(row.run.logFile, Math.max(1, limit));
      return { events: page.lines, hasMore: page.hasMore };
    }
    return { events: [], hasMore: false };
  }
};

export class LeanFabricDashboard implements Component, Focusable {
  focused = true;
  #selection = 0;
  #listOffset = 0;
  #feedback: string | undefined;
  #pendingStop: { id: string; expiresAt: number } | undefined;
  #unsubscribe: (() => void) | undefined;
  #timer: NodeJS.Timeout | undefined;
  #closed = false;

  constructor(
    readonly tui: TUI,
    readonly theme: Theme,
    readonly manager: AgentManager,
    readonly done: () => void,
  ) {
    this.#unsubscribe = manager.subscribeUi(() => this.tui.requestRender());
    this.#timer = setInterval(() => this.tui.requestRender(), DASHBOARD_REFRESH_MS);
    this.#timer.unref();
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #close(): void {
    this.dispose();
    this.done();
  }

  #rows(): LeanDashboardAgentRow[] {
    return flattenLeanDashboardAgents(this.manager.listForUi());
  }

  #syncSelection(rows: LeanDashboardAgentRow[]): void {
    if (rows.length === 0) {
      this.#selection = 0;
      this.#listOffset = 0;
      return;
    }
    this.#selection = Math.max(0, Math.min(this.#selection, rows.length - 1));
  }

  #move(delta: number): void {
    const rows = this.#rows();
    this.#syncSelection(rows);
    if (rows.length === 0) return;
    this.#selection = Math.max(0, Math.min(rows.length - 1, this.#selection + delta));
    this.#pendingStop = undefined;
    this.#feedback = undefined;
    this.tui.requestRender();
  }

  #requestStop(): void {
    const rows = this.#rows();
    this.#syncSelection(rows);
    const selected = rows[this.#selection];
    if (!selected) return;
    if (selected.depth > 0) {
      this.#feedback = "Nested recursive agents cannot be stopped from this parent dashboard.";
      this.tui.requestRender();
      return;
    }
    if (selected.run.status !== "running" && selected.run.status !== "queued") {
      this.#feedback = `${selected.run.id.slice(0, 8)} is already ${selected.run.status}.`;
      this.tui.requestRender();
      return;
    }
    const now = Date.now();
    if (this.#pendingStop?.id !== selected.run.id || this.#pendingStop.expiresAt < now) {
      this.#pendingStop = { id: selected.run.id, expiresAt: now + 2_500 };
      this.#feedback = `Press x again to stop ${selected.run.id.slice(0, 8)}.`;
      this.tui.requestRender();
      return;
    }
    this.#pendingStop = undefined;
    this.#feedback = `Stopping ${selected.run.id.slice(0, 8)}…`;
    void this.manager
      .stop(selected.run.id)
      .then((result) => {
        this.#feedback = `${selected.run.id.slice(0, 8)} ${result.status}.`;
        this.tui.requestRender();
      })
      .catch((error) => {
        this.#feedback = error instanceof Error ? error.message : String(error);
        this.tui.requestRender();
      });
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.#close();
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      this.#move(-1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.#move(1);
      return;
    }
    if (matchesKey(data, Key.home) || data === "g") {
      this.#selection = 0;
      this.#listOffset = 0;
      this.#pendingStop = undefined;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.end) || data === "G") {
      const rows = this.#rows();
      this.#selection = Math.max(0, rows.length - 1);
      this.#pendingStop = undefined;
      this.tui.requestRender();
      return;
    }
    if (data === "x") {
      this.#requestStop();
      return;
    }
    if (data === "r") {
      this.#feedback = undefined;
      this.tui.requestRender();
    }
  }

  #agentLine(row: LeanDashboardAgentRow, selected: boolean, width: number): string {
    const marker = selected ? this.theme.fg("accent", "›") : " ";
    const branch = row.depth > 0 ? `${"  ".repeat(Math.max(0, row.depth - 1))}↳ ` : "";
    const glyph = colorStatus(this.theme, row.run.status, statusGlyph(row.run.status));
    const id = this.theme.fg("muted", row.run.id.slice(0, 8));
    const prefix = `${marker} ${branch}${glyph} ${id} `;
    const remaining = Math.max(1, width - visibleWidth(prefix));
    const summary = agentSummary(row.run, remaining);
    return fit(`${prefix}${selected ? this.theme.fg("accent", summary) : summary}`, width);
  }

  #selectedHeader(row: LeanDashboardAgentRow | undefined, width: number): string {
    if (!row) return fit(this.theme.fg("muted", "No Fabric subagents in this session."), width);
    const parts = [
      `${row.run.id.slice(0, 8)} · ${row.run.status}`,
      runnerLabel(row.run),
      row.run.transport,
    ];
    if (row.run.model) parts.push(row.run.model);
    if (isRunRecord(row.run) && row.run.currentTool) parts.push(`tool:${row.run.currentTool}`);
    return fit(this.theme.fg("accent", compact(parts.join(" · "), width)), width);
  }

  #outputLines(row: LeanDashboardAgentRow | undefined, height: number, width: number): string[] {
    if (height <= 0) return [];
    if (!row) return [fit(this.theme.fg("muted", "Nothing to inspect yet."), width)];
    const logBudget = Math.max(1, height - 1);
    const log = logLinesFor(this.manager, row, logBudget);
    const formatted = log.events
      .map(formatLeanFabricLogLine)
      .filter(Boolean)
      .map((line) => compact(line, width));
    if (formatted.length === 0 && isRunRecord(row.run)) {
      if (row.run.error) formatted.push(`error: ${compact(row.run.error, Math.max(1, width - 7))}`);
      else if (row.run.text) formatted.push(`output: ${compact(row.run.text, Math.max(1, width - 8))}`);
      else if (row.run.currentTool) formatted.push(`working: ${row.run.currentTool}`);
    }
    if (formatted.length === 0) formatted.push("No output recorded yet.");
    if (log.hasMore && formatted.length > 0) formatted[0] = `… ${formatted[0]}`;
    return formatted.slice(-height).map((line) => fit(line, width));
  }

  #renderTwoPane(width: number, rows: LeanDashboardAgentRow[], bodyRows: number): string[] {
    const inner = width - 2;
    const leftWidth = Math.max(
      MIN_AGENT_PANE_WIDTH,
      Math.min(MAX_AGENT_PANE_WIDTH, Math.floor(inner * 0.38)),
    );
    const rightWidth = inner - leftWidth - 1;
    const selected = rows[this.#selection];
    const visibleRows = Math.max(1, bodyRows - 1);
    if (this.#selection < this.#listOffset) this.#listOffset = this.#selection;
    if (this.#selection >= this.#listOffset + visibleRows) {
      this.#listOffset = this.#selection - visibleRows + 1;
    }
    const maxOffset = Math.max(0, rows.length - visibleRows);
    this.#listOffset = Math.max(0, Math.min(this.#listOffset, maxOffset));
    const agentRows = rows.slice(this.#listOffset, this.#listOffset + visibleRows);
    const output = this.#outputLines(selected, visibleRows, rightWidth);
    const lines = [
      `├${"─".repeat(leftWidth)}┬${"─".repeat(rightWidth)}┤`,
      `│${fit(this.theme.fg("muted", " Agents / Workflow"), leftWidth)}│${this.#selectedHeader(selected, rightWidth)}│`,
    ];
    for (let index = 0; index < visibleRows; index++) {
      const absolute = this.#listOffset + index;
      const row = agentRows[index];
      const left = row
        ? this.#agentLine(row, absolute === this.#selection, leftWidth)
        : fit("", leftWidth);
      const right = output[index] ?? fit("", rightWidth);
      lines.push(`│${left}│${right}│`);
    }
    return lines;
  }

  #renderStacked(width: number, rows: LeanDashboardAgentRow[], bodyRows: number): string[] {
    const inner = width - 2;
    const listRows = Math.max(3, Math.floor(bodyRows * 0.45));
    const outputRows = Math.max(1, bodyRows - listRows - 2);
    if (this.#selection < this.#listOffset) this.#listOffset = this.#selection;
    if (this.#selection >= this.#listOffset + listRows) this.#listOffset = this.#selection - listRows + 1;
    const maxOffset = Math.max(0, rows.length - listRows);
    this.#listOffset = Math.max(0, Math.min(this.#listOffset, maxOffset));
    const selected = rows[this.#selection];
    const lines = [`├${"─".repeat(inner)}┤`, `│${fit(this.theme.fg("muted", " Agents / Workflow"), inner)}│`];
    const agentRows = rows.slice(this.#listOffset, this.#listOffset + listRows);
    for (let index = 0; index < listRows; index++) {
      const absolute = this.#listOffset + index;
      const row = agentRows[index];
      lines.push(`│${row ? this.#agentLine(row, absolute === this.#selection, inner) : fit("", inner)}│`);
    }
    lines.push(`├${"─".repeat(inner)}┤`);
    lines.push(`│${this.#selectedHeader(selected, inner)}│`);
    for (const line of this.#outputLines(selected, outputRows, inner)) lines.push(`│${line}│`);
    while (lines.length < bodyRows + 3) lines.push(`│${fit("", inner)}│`);
    return lines;
  }

  render(width: number): string[] {
    if (width < 12) return [];
    const rows = this.#rows();
    this.#syncSelection(rows);
    const totalRows = dashboardRows(this.tui);
    const inner = width - 2;
    const bodyRows = Math.max(4, totalRows - 5);
    const counts = countStatuses(rows);
    const title = ` Fabric · ${rows.length} agent${rows.length === 1 ? "" : "s"}${counts ? ` · ${counts}` : ""} `;
    const titleText = compact(title, Math.max(1, inner - 2));
    const topRight = Math.max(0, inner - visibleWidth(titleText));
    const lines = [`┌${titleText}${"─".repeat(topRight)}┐`];
    if (width >= MIN_TWO_PANE_WIDTH) lines.push(...this.#renderTwoPane(width, rows, bodyRows));
    else lines.push(...this.#renderStacked(width, rows, bodyRows));
    const footer = this.#feedback
      ? this.theme.fg(this.#feedback.startsWith("Press x again") ? "warning" : "muted", this.#feedback)
      : this.theme.fg("muted", "↑↓/jk select · g/G first/last · x stop · r refresh · Esc close");
    lines.push(`├${"─".repeat(inner)}┤`);
    lines.push(`│${fit(footer, inner)}│`);
    lines.push(`└${"─".repeat(inner)}┘`);
    return lines.slice(0, totalRows);
  }
}
