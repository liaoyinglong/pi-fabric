import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  getOsc8LinkAtColumn,
  matchesKey,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

const INSPECT_URL_PREFIX = "pi-fabric://inspect/";
const CAPTURE_WIDGET_KEY = "pi-fabric.result-inspector.capture";
const PATCH_SYMBOL = Symbol.for("pi-fabric.result-inspector.active-tui-patch");
const ROUTES_GLOBAL_KEY = "__piFabricResultInspectorRoutes";

interface InspectPayload {
  content: string;
  meta: string;
}

interface FabricExecutionSnapshot {
  args: Record<string, unknown>;
  details?: unknown;
}

export interface FabricExecutionInspectSnapshot extends FabricExecutionSnapshot {
  inspectId: string;
}

export interface FabricResultInspectAction {
  inspectId: string;
  output: string;
  meta: string;
}

export interface FabricResultInspectorLike {
  captureExecution?(snapshot: FabricExecutionInspectSnapshot): void;
  renderAction(action: FabricResultInspectAction, theme: Theme): string | undefined;
}

type InspectRouteMap = Map<string, () => void>;
type InspectorGlobal = typeof globalThis & Record<string, unknown>;

const globalState = globalThis as InspectorGlobal;
const existingRoutes = globalState[ROUTES_GLOBAL_KEY];
const inspectRoutes: InspectRouteMap = existingRoutes instanceof Map
  ? existingRoutes as InspectRouteMap
  : new Map<string, () => void>();
globalState[ROUTES_GLOBAL_KEY] = inspectRoutes;

interface SelectionPointLike {
  row?: number;
  col: number;
}

interface AltScreenMouseEventLike {
  release?: boolean;
  button?: number;
  x?: number;
  y?: number;
}

interface AltScreenMouseInternals {
  selectionPressActive?: boolean;
  selectionDragged?: boolean;
  pressedUrl?: string | undefined;
  selectionAnchor?: unknown;
  selectionFocus?: unknown;
  selectionInitialRange?: unknown;
  lastClick?: unknown;
  getSelectionSourceLine?: (point: SelectionPointLike) => string;
  stopSelectionAutoScroll?: () => void;
  requestRender?: () => void;
}

interface AuditLike {
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

let nextInspectorInstance = 0;

const safeText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const stringifyValue = (value: unknown): string => {
  if (typeof value === "string") return safeText(value);
  try {
    return safeText(JSON.stringify(value, null, 2) ?? String(value));
  } catch {
    return safeText(String(value));
  }
};

const indent = (text: string, spaces = 2): string => {
  const prefix = " ".repeat(spaces);
  return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
};

const elapsedLabel = (startedAt: unknown, endedAt: unknown): string | undefined => {
  if (typeof startedAt !== "number" || typeof endedAt !== "number") return undefined;
  const elapsed = Math.max(0, endedAt - startedAt);
  if (elapsed < 1_000) return `${Math.round(elapsed)}ms`;
  return `${(elapsed / 1_000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
};

const auditRef = (audit: AuditLike): string =>
  (audit.ref ?? [audit.provider, audit.tool].filter(Boolean).join(".")) || "tool";

const formatCode = (args: Record<string, unknown>): string[] => {
  const raw = Array.isArray(args.code) ? args.code.join("\n") : String(args.code ?? "");
  const lines = safeText(raw).split("\n");
  const width = String(Math.max(1, lines.length)).length;
  return [
    `Code · ${lines.length} ${lines.length === 1 ? "line" : "lines"}`,
    ...lines.map((line, index) => `${String(index + 1).padStart(width, " ")} ${line}`),
  ];
};

const formatInputs = (args: Record<string, unknown>): string[] => {
  const lines: string[] = [];
  const strings = asRecord(args.strings);
  if (strings && Object.keys(strings).length > 0) {
    lines.push(`Strings · ${Object.keys(strings).length}`);
    for (const [key, value] of Object.entries(strings)) {
      lines.push(`${key}:`);
      lines.push(indent(stringifyValue(value)));
    }
  }
  if (typeof args.resultFormat === "string" && args.resultFormat !== "auto") {
    lines.push(`Result format · ${safeText(args.resultFormat)}`);
  }
  return lines;
};

const formatAudits = (details: unknown): string[] => {
  const record = asRecord(details);
  const audits = Array.isArray(record?.audits)
    ? record.audits.filter((value): value is AuditLike => typeof value === "object" && value !== null)
    : [];
  const visible = audits.filter((audit) => auditRef(audit) !== "todo.replace");
  if (visible.length === 0) return ["Calls · 0"];

  const lines = [`Calls · ${visible.length}`];
  visible.forEach((audit, index) => {
    const glyph = audit.success === false ? "✗" : audit.success === true ? "✓" : "◆";
    const duration = elapsedLabel(audit.startedAt, audit.endedAt);
    lines.push(`${index + 1}. ${glyph} ${safeText(auditRef(audit))}${duration ? ` · ${duration}` : ""}`);
    if (audit.args && Object.keys(audit.args).length > 0) {
      lines.push("  Args");
      lines.push(indent(stringifyValue(audit.args), 4));
    }
    if (audit.preview !== undefined) {
      lines.push("  Preview");
      lines.push(indent(stringifyValue(audit.preview), 4));
    }
    if (audit.error) {
      lines.push("  Error");
      lines.push(indent(safeText(audit.error), 4));
    }
  });
  return lines;
};

export const buildFabricExecutionInspectContent = (
  snapshot: FabricExecutionSnapshot | undefined,
  output: string,
): string => {
  const sections: string[][] = [];
  if (snapshot) {
    sections.push(formatCode(snapshot.args));
    const inputs = formatInputs(snapshot.args);
    if (inputs.length > 0) sections.push(inputs);
    sections.push(formatAudits(snapshot.details));
  }
  const resultLines = safeText(output).split("\n");
  sections.push([
    `Result · ${output ? `${resultLines.length} ${resultLines.length === 1 ? "line" : "lines"}` : "empty"}`,
    ...(output ? resultLines : ["(no result)"]),
  ]);
  return sections.map((section) => section.join("\n")).join("\n\n");
};

const recoverInspectUrlFromSelection = (state: AltScreenMouseInternals): void => {
  if (typeof state.getSelectionSourceLine !== "function") return;
  const anchor = state.selectionAnchor as Partial<SelectionPointLike> | undefined;
  if (!anchor || typeof anchor.col !== "number") return;

  let sourceLine: string;
  try {
    sourceLine = state.getSelectionSourceLine(anchor as SelectionPointLike);
  } catch {
    return;
  }

  const url = getOsc8LinkAtColumn(sourceLine, anchor.col);
  if (url && inspectRoutes.has(url)) state.pressedUrl = url;
};

/**
 * Pi 0.84.x owns mouse input in fullscreen mode but does not expose
 * component-level mouse events to extensions yet. Patch the *active renderer
 * instance* handed to extensions instead of importing/patching TuiAltScreen's
 * class prototype: an extension may resolve a different pi-tui module instance
 * than the host renderer.
 *
 * Pi's fullscreen selection code normally resolves OSC 8 links from the painted
 * screen row. For transcript ScrollViews that can lose the link identity and a
 * click falls through to "copied". After the host processes mouse-down, recover
 * Fabric's private link from the scroll-content selection source. On mouse-up,
 * consume only registered Fabric inspect links and delegate every other event to
 * Pi unchanged.
 */
const installActiveTuiInspectInterceptor = (tui: TUI): boolean => {
  if (tui.mode !== "fullscreen") return false;
  const target = tui as unknown as Record<PropertyKey, unknown>;
  if (target[PATCH_SYMBOL] === true) return true;

  const original = target.handleSelectionMouseEvent;
  if (typeof original !== "function") return false;

  target.handleSelectionMouseEvent = function (
    this: AltScreenMouseInternals,
    event: AltScreenMouseEventLike,
  ): unknown {
    const url = this.pressedUrl;
    const handler = typeof url === "string" ? inspectRoutes.get(url) : undefined;
    if (
      event.release === true &&
      this.selectionPressActive === true &&
      this.selectionDragged !== true &&
      handler
    ) {
      this.selectionPressActive = false;
      this.selectionDragged = false;
      this.pressedUrl = undefined;
      this.selectionAnchor = undefined;
      this.selectionFocus = undefined;
      this.selectionInitialRange = undefined;
      this.lastClick = undefined;
      this.stopSelectionAutoScroll?.();
      handler();
      this.requestRender?.();
      return;
    }

    const result = Reflect.apply(original, this, [event]);
    if (
      event.release !== true &&
      this.selectionPressActive === true &&
      this.selectionDragged !== true &&
      !(typeof this.pressedUrl === "string" && inspectRoutes.has(this.pressedUrl))
    ) {
      recoverInspectUrlFromSelection(this);
    }
    return result;
  };
  target[PATCH_SYMBOL] = true;
  return true;
};

const osc8Link = (url: string, text: string): string =>
  `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;

class EmptyCaptureComponent implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

class ResultInspectorOverlay implements Component {
  private offset = 0;
  private pageSize = 1;
  private readonly body: Text;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly payload: InspectPayload,
    private readonly close: () => void,
  ) {
    this.body = new Text(payload.content || "(no details)", 0, 0);
  }

  private framed(content: string, width: number): string {
    const innerWidth = Math.max(1, width - 4);
    const clipped = truncateToWidth(content, innerWidth, "…");
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
    return `${this.theme.fg("dim", "│")} ${clipped}${padding} ${this.theme.fg("dim", "│")}`;
  }

  private requestRender(): void {
    this.tui.requestRender();
  }

  private move(delta: number): void {
    this.offset = Math.max(0, this.offset + delta);
    this.requestRender();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(8, width);
    const innerWidth = Math.max(1, safeWidth - 4);
    const bodyLines = this.body.render(innerWidth);
    const maxOverlayHeight = Math.max(8, Math.floor(this.tui.terminal.rows * 0.75));
    const bodyCapacity = Math.max(1, maxOverlayHeight - 6);
    this.pageSize = Math.min(Math.max(1, bodyLines.length), bodyCapacity);
    const maxOffset = Math.max(0, bodyLines.length - this.pageSize);
    this.offset = Math.min(this.offset, maxOffset);

    const shown = bodyLines.slice(this.offset, this.offset + this.pageSize);
    while (shown.length < this.pageSize) shown.push(" ");

    const end = Math.min(bodyLines.length, this.offset + this.pageSize);
    const footer = maxOffset > 0
      ? `${this.offset + 1}-${end}/${bodyLines.length} · ↑↓/PgUp/PgDn scroll · Esc close`
      : "Esc close";
    const rule = this.theme.fg("dim", `├${"─".repeat(Math.max(0, safeWidth - 2))}┤`);

    return [
      this.theme.fg("dim", `┌${"─".repeat(Math.max(0, safeWidth - 2))}┐`),
      this.framed(this.theme.fg("accent", this.theme.bold("Fabric execution")), safeWidth),
      this.framed(this.theme.fg("dim", this.payload.meta), safeWidth),
      rule,
      ...shown.map((line) => this.framed(line || " ", safeWidth)),
      this.framed(this.theme.fg("dim", footer), safeWidth),
      this.theme.fg("dim", `└${"─".repeat(Math.max(0, safeWidth - 2))}┘`),
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.close();
      return;
    }
    if (matchesKey(data, "up")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.move(1);
      return;
    }
    if (matchesKey(data, "pageUp")) {
      this.move(-this.pageSize);
      return;
    }
    if (matchesKey(data, "pageDown")) {
      this.move(this.pageSize);
      return;
    }
    if (matchesKey(data, "home")) {
      this.offset = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, "end")) {
      this.offset = Number.MAX_SAFE_INTEGER;
      this.requestRender();
      return;
    }

    const wheel = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data);
    if (!wheel) return;
    const button = Number.parseInt(wheel[1] ?? "0", 10);
    if ((button & 64) === 0) return;
    this.move((button & 3) === 0 ? -3 : 3);
  }

  invalidate(): void {
    this.body.invalidate();
  }
}

export class FabricResultInspector implements FabricResultInspectorLike {
  private readonly instanceId = ++nextInspectorInstance;
  private readonly payloads = new Map<string, InspectPayload>();
  private readonly snapshots = new Map<string, FabricExecutionSnapshot>();
  private readonly urls = new Map<string, string>();
  private ui: ExtensionUIContext | undefined;
  private tui: TUI | undefined;
  private overlayOpen = false;

  bind(ui: ExtensionUIContext | undefined): void {
    this.dispose();
    if (!ui) return;
    this.ui = ui;
    ui.setWidget(
      CAPTURE_WIDGET_KEY,
      (tui) => {
        this.tui = tui;
        installActiveTuiInspectInterceptor(tui);
        return new EmptyCaptureComponent();
      },
      { placement: "belowEditor" },
    );
  }

  captureExecution(snapshot: FabricExecutionInspectSnapshot): void {
    this.snapshots.set(snapshot.inspectId, {
      args: snapshot.args,
      ...(snapshot.details === undefined ? {} : { details: snapshot.details }),
    });
  }

  dispose(): void {
    for (const url of this.urls.values()) inspectRoutes.delete(url);
    this.urls.clear();
    this.payloads.clear();
    this.snapshots.clear();
    this.overlayOpen = false;
    if (this.ui) this.ui.setWidget(CAPTURE_WIDGET_KEY, undefined);
    this.ui = undefined;
    this.tui = undefined;
  }

  renderAction(action: FabricResultInspectAction, theme: Theme): string | undefined {
    const tui = this.tui;
    if (!this.ui || !tui || tui.mode !== "fullscreen" || !installActiveTuiInspectInterceptor(tui)) {
      return undefined;
    }

    this.payloads.set(action.inspectId, {
      content: buildFabricExecutionInspectContent(this.snapshots.get(action.inspectId), action.output),
      meta: action.meta,
    });
    let url = this.urls.get(action.inspectId);
    if (!url) {
      url = `${INSPECT_URL_PREFIX}${this.instanceId}/${encodeURIComponent(action.inspectId)}`;
      this.urls.set(action.inspectId, url);
      inspectRoutes.set(url, () => this.open(action.inspectId));
    }
    return osc8Link(url, theme.fg("accent", "[inspect]"));
  }

  private open(inspectId: string): void {
    const payload = this.payloads.get(inspectId);
    const ui = this.ui;
    if (!payload || !ui || this.overlayOpen) return;
    this.overlayOpen = true;
    void ui.custom<void>(
      (tui, theme, _keybindings, done) =>
        new ResultInspectorOverlay(tui, theme, payload, () => done()),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "80%",
          minWidth: 40,
          maxHeight: "75%",
          margin: 1,
        },
      },
    ).finally(() => {
      this.overlayOpen = false;
    });
  }
}
