import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";

const COLLAPSED_CODE_LINES = 8;
const COLLAPSED_RESULT_LINES = 12;

const countLabel = (count: number, singular: string): string =>
  `${count} ${count === 1 ? singular : `${singular}s`}`;

// Tool arguments are model-generated text. Strip terminal escape/control
// sequences before rendering them back into the interactive TUI.
export const safeExecDisplayText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export interface LeanExecDisplay {
  name?: string;
  description?: string;
}

const normalizedDisplay = (value: unknown): LeanExecDisplay | undefined => {
  if (typeof value === "string") return value.trim() ? { name: value.trim() } : undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
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

export const renderLeanExecResult = (
  result: { content?: unknown; details?: unknown },
  theme: Theme,
  expanded: boolean,
  isPartial: boolean,
): Component => {
  if (isPartial) {
    return new Text(theme.fg("warning", "◆ Running Fabric program…"), 0, 0);
  }

  const details =
    typeof result.details === "object" && result.details !== null && !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : {};
  const audits = Array.isArray(details.audits) ? details.audits : [];
  const elapsed = elapsedLabel(details.elapsedMs);
  const header = `${theme.fg("success", "✓ Fabric complete")}${theme.fg(
    "dim",
    `${audits.length > 0 ? ` · ${countLabel(audits.length, "call")}` : ""}${elapsed ? ` · ${elapsed}` : ""}`,
  )}`;

  const output = safeExecDisplayText(textContent(result.content));
  if (!output) return new Text(header, 0, 0);

  const lines = output.split("\n");
  const limit = expanded ? lines.length : Math.min(lines.length, COLLAPSED_RESULT_LINES);
  const shown = lines.slice(0, limit).map((line) => theme.fg("toolOutput", line || " "));
  const hidden = lines.length - shown.length;
  if (hidden > 0) {
    shown.push(theme.fg("dim", `… ${countLabel(hidden, "line")} hidden · Ctrl+O to expand`));
  }
  return new Text(`${header}\n${shown.join("\n")}`, 0, 0);
};
