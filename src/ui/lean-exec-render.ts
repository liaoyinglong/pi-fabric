import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { diffLines } from "diff";
import { headlineArg } from "../core/call-preview.js";

const COLLAPSED_CODE_LINES = 15;
const COLLAPSED_AUDIT_LINES = 5;
const COLLAPSED_DIFF_LINES = 8;
const COLLAPSED_INLINE_RESULT_CHARS = 160;
const EXPANDED_RESULT_LINES = 40;
const EXPANDED_RESULT_LINE_CHARS = 240;

const countLabel = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

const compactCount = (count: number): string => {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}m`;
};

// Tool arguments and nested outputs are model/tool-generated text. Strip
// terminal escape/control sequences before rendering them into the TUI.
export const safeExecDisplayText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export interface LeanExecDisplay {
  name?: string;
  description?: string;
}

interface LeanAudit {
  ref?: string;
  provider?: string;
  tool?: string;
  success?: boolean;
  error?: string;
  args?: Record<string, unknown>;
  preview?: unknown;
  startedAt?: number;
  endedAt?: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const normalizedDisplay = (value: unknown): LeanExecDisplay | undefined => {
  if (typeof value === "string") return value.trim() ? { name: value.trim() } : undefined;
  const record = asRecord(value);
  if (!record) return undefined;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined;
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : undefined;
  return name || description
    ? { ...(name ? { name } : {}), ...(description ? { description } : {}) }
    : undefined;
};

const textContent = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
};

export const renderLeanExecCall = (
  params: Record<string, unknown>,
  theme: Theme,
  expanded: boolean,
): Component => {
  const rawCode = Array.isArray(params.code) ? params.code.join("\n") : String(params.code ?? "");
  const code = safeExecDisplayText(rawCode);
  const lines = code.split("\n");
  const display = normalizedDisplay(params.display);
  const displayName = display?.name ? safeExecDisplayText(display.name) : "";
  const description = display?.description ? safeExecDisplayText(display.description) : "";

  const title = `${theme.fg("toolTitle", theme.bold("fabric"))}${
    displayName ? ` ${theme.fg("accent", displayName)}` : ""
  } ${theme.fg("dim", `TypeScript · ${countLabel(lines.length, "line")}`)}`;

  const limit = expanded ? lines.length : Math.min(lines.length, COLLAPSED_CODE_LINES);
  const shown = lines.slice(0, limit);
  const lineNumberWidth = String(Math.max(1, shown.length)).length;
  const preview = shown
    .map(
      (line, index) =>
        `${theme.fg("dim", String(index + 1).padStart(lineNumberWidth, " "))} ${theme.fg("muted", line || " ")}`,
    )
    .join("\n");
  const hidden = lines.length - shown.length;
  const hiddenHint =
    hidden > 0
      ? `\n${theme.fg("dim", `… ${countLabel(hidden, "line")} hidden · Ctrl+O to expand`)}`
      : "";

  return new Text(
    `${title}${description ? `\n${theme.fg("dim", description)}` : ""}${preview ? `\n${preview}` : ""}${hiddenHint}`,
    0,
    0,
  );
};

const elapsedLabel = (value: unknown): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  if (value < 1_000) return `${Math.round(value)}ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
};

const auditRef = (audit: LeanAudit): string =>
  (audit.ref ?? [audit.provider, audit.tool].filter(Boolean).join(".")) || "tool";

const auditDuration = (audit: LeanAudit): string | undefined =>
  typeof audit.startedAt === "number" && typeof audit.endedAt === "number"
    ? elapsedLabel(Math.max(0, audit.endedAt - audit.startedAt))
    : undefined;

const auditSummary = (audit: LeanAudit, theme: Theme): string => {
  const glyph = audit.success === false
    ? theme.fg("error", "✗")
    : audit.success === true
      ? theme.fg("success", "✓")
      : theme.fg("warning", "◆");
  const headline = headlineArg(audit.args, 88);
  const duration = auditDuration(audit);
  return `${glyph} ${theme.fg("accent", safeExecDisplayText(auditRef(audit)))}${
    headline ? ` ${theme.fg("muted", safeExecDisplayText(headline))}` : ""
  }${duration ? theme.fg("dim", ` · ${duration}`) : ""}`;
};

const writeDiffLines = (audit: LeanAudit): string[] => {
  const preview = asRecord(audit.preview);
  if (!preview) return [];
  const after = typeof preview.writeContent === "string" ? preview.writeContent : undefined;
  const beforeValue = asRecord(preview.codePreviewBeforeWrite);
  const before = beforeValue?.kind === "content" && typeof beforeValue.content === "string"
    ? beforeValue.content
    : undefined;
  if (after === undefined) return [];
  if (before === undefined) {
    return after.split("\n").map((line) => `+ ${line}`);
  }
  return diffLines(before, after).flatMap((part) => {
    const prefix = part.added ? "+ " : part.removed ? "- " : "  ";
    return part.value.replace(/\n$/, "").split("\n").map((line) => `${prefix}${line}`);
  });
};

const editDiffLines = (audit: LeanAudit): string[] => {
  const args = audit.args;
  if (!args) return [];
  const edits = Array.isArray(args.edits)
    ? args.edits
    : typeof args.oldText === "string" || typeof args.newText === "string"
      ? [{ oldText: args.oldText, newText: args.newText }]
      : [];
  return edits.flatMap((value) => {
    const edit = asRecord(value);
    if (!edit) return [];
    const oldText = typeof edit.oldText === "string" ? edit.oldText : "";
    const newText = typeof edit.newText === "string" ? edit.newText : "";
    return [
      ...oldText.split("\n").map((line) => `- ${line}`),
      ...newText.split("\n").map((line) => `+ ${line}`),
    ];
  });
};

const mutationDiffLines = (audit: LeanAudit): string[] => {
  const tool = audit.tool ?? audit.ref?.split(".").at(-1);
  if (tool === "write") return writeDiffLines(audit);
  if (tool === "edit") return editDiffLines(audit);
  return [];
};

const styledDiff = (line: string, theme: Theme): string => {
  if (line.startsWith("+ ")) return theme.fg("success", safeExecDisplayText(line));
  if (line.startsWith("- ")) return theme.fg("error", safeExecDisplayText(line));
  return theme.fg("dim", safeExecDisplayText(line));
};

const renderAudits = (
  audits: LeanAudit[],
  theme: Theme,
  expanded: boolean,
): string[] => {
  if (audits.length === 0) return [];
  const limit = expanded ? audits.length : Math.min(audits.length, COLLAPSED_AUDIT_LINES);
  const shown = audits.slice(0, limit);
  const lines: string[] = [];
  for (const audit of shown) {
    lines.push(auditSummary(audit, theme));
    if (audit.success === false && audit.error) {
      lines.push(`  ${theme.fg("error", safeExecDisplayText(audit.error).replace(/\s+/g, " ").slice(0, 240))}`);
    }
  }
  if (!expanded && audits.length > shown.length) {
    lines.push(theme.fg("dim", `… ${countLabel(audits.length - shown.length, "call")} hidden · Ctrl+O to expand`));
  }

  const mutation = [...audits].reverse().find((audit) => mutationDiffLines(audit).length > 0);
  if (mutation) {
    const diff = mutationDiffLines(mutation);
    const diffLimit = expanded ? diff.length : Math.min(diff.length, COLLAPSED_DIFF_LINES);
    lines.push(theme.fg("dim", `diff · ${safeExecDisplayText(auditRef(mutation))}`));
    lines.push(...diff.slice(0, diffLimit).map((line) => styledDiff(line, theme)));
    if (!expanded && diff.length > diffLimit) {
      lines.push(theme.fg("dim", `… ${countLabel(diff.length - diffLimit, "diff line")} hidden · Ctrl+O to expand`));
    }
  }
  return lines;
};

const normalizedAudits = (value: unknown): LeanAudit[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is LeanAudit => typeof entry === "object" && entry !== null)
    : [];

const resultMeta = (output: string): string => {
  const lines = output.split("\n").length;
  return `${countLabel(lines, "line")} · ${compactCount(output.length)} chars`;
};

const truncateResultLine = (line: string): { text: string; truncated: boolean } => {
  if (line.length <= EXPANDED_RESULT_LINE_CHARS) return { text: line, truncated: false };
  return {
    text: `${line.slice(0, EXPANDED_RESULT_LINE_CHARS - 1)}…`,
    truncated: true,
  };
};

const renderResultBody = (output: string, theme: Theme, expanded: boolean): string[] => {
  if (!output) return [];
  const lines = output.split("\n");
  if (!expanded) {
    if (lines.length === 1 && output.length <= COLLAPSED_INLINE_RESULT_CHARS) {
      return [`${theme.fg("dim", "result ›")} ${theme.fg("toolOutput", output)}`];
    }
    return [theme.fg("dim", `result · ${resultMeta(output)} · Ctrl+O to inspect`)];
  }

  const visible = lines.slice(0, EXPANDED_RESULT_LINES).map(truncateResultLine);
  const rendered = [
    theme.fg("dim", `result · ${resultMeta(output)}`),
    ...visible.map(({ text }) => theme.fg("toolOutput", text || " ")),
  ];
  const hiddenLines = lines.length - visible.length;
  const truncatedLines = visible.filter(({ truncated }) => truncated).length;
  if (hiddenLines > 0) {
    rendered.push(theme.fg("dim", `… ${countLabel(hiddenLines, "result line")} hidden from TUI`));
  }
  if (truncatedLines > 0) {
    rendered.push(theme.fg("dim", `… ${countLabel(truncatedLines, "long result line")} truncated in TUI`));
  }
  return rendered;
};

export const renderLeanExecResult = (
  result: { content?: unknown; details?: unknown },
  theme: Theme,
  expanded: boolean,
  isPartial: boolean,
): Component => {
  const details = asRecord(result.details) ?? {};
  const audits = normalizedAudits(details.audits);
  const visibleAudits = audits.filter((audit) => auditRef(audit) !== "todo.replace");
  const elapsed = elapsedLabel(details.elapsedMs);
  const progress = typeof details.progress === "string"
    ? safeExecDisplayText(details.progress).replace(/\s+/g, " ").slice(0, 180)
    : undefined;

  if (isPartial) {
    const header = `${theme.fg("warning", "◆ Fabric running")}${theme.fg(
      "dim",
      `${visibleAudits.length > 0 ? ` · ${countLabel(visibleAudits.length, "call")}` : ""}${progress ? ` · ${progress}` : ""}`,
    )}`;
    const activity = renderAudits(visibleAudits, theme, expanded);
    return new Text(activity.length > 0 ? `${header}\n${activity.join("\n")}` : header, 0, 0);
  }

  const header = `${theme.fg("success", "✓ Fabric complete")}${theme.fg(
    "dim",
    `${visibleAudits.length > 0 ? ` · ${countLabel(visibleAudits.length, "call")}` : ""}${elapsed ? ` · ${elapsed}` : ""}`,
  )}`;
  const activity = renderAudits(visibleAudits, theme, expanded);
  const output = safeExecDisplayText(textContent(result.content)).trimEnd();
  const sections = [header, ...(activity.length > 0 ? [activity.join("\n")] : [])];
  const resultBody = renderResultBody(output, theme, expanded);
  if (resultBody.length > 0) sections.push(resultBody.join("\n"));
  return new Text(sections.join("\n"), 0, 0);
};
