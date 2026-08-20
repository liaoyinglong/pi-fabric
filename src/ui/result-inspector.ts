import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  Text,
  TuiAltScreen,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

const INSPECT_URL_PREFIX = "pi-fabric://inspect/";
const CAPTURE_WIDGET_KEY = "pi-fabric.result-inspector.capture";
const PATCH_SYMBOL = Symbol.for("pi-fabric.result-inspector.alt-screen-patch");
const ROUTES_GLOBAL_KEY = "__piFabricResultInspectorRoutes";

interface InspectPayload {
  output: string;
  meta: string;
}

export interface FabricResultInspectAction {
  inspectId: string;
  output: string;
  meta: string;
}

export interface FabricResultInspectorLike {
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

interface AltScreenMouseEventLike {
  release?: boolean;
}

interface AltScreenMouseInternals {
  selectionPressActive?: boolean;
  selectionDragged?: boolean;
  pressedUrl?: string;
  selectionAnchor?: unknown;
  selectionFocus?: unknown;
  selectionInitialRange?: unknown;
  lastClick?: unknown;
  requestRender?: () => void;
}

let nextInspectorInstance = 0;

/**
 * Pi 0.84.x owns mouse input in fullscreen mode, but does not yet expose
 * component-level mouse events to extensions. Intercept only Fabric's internal
 * OSC 8 links at the point where TuiAltScreen would otherwise open them in the
 * browser. All other mouse/link behavior delegates to Pi unchanged.
 *
 * This is intentionally fullscreen-only. Regular mode leaves mouse ownership
 * with the terminal so native scrollback and selection continue to work.
 */
const installAltScreenInspectInterceptor = (): boolean => {
  const prototype = TuiAltScreen.prototype as unknown as Record<PropertyKey, unknown>;
  if (prototype[PATCH_SYMBOL] === true) return true;

  const original = prototype.handleSelectionMouseEvent;
  if (typeof original !== "function") return false;

  prototype.handleSelectionMouseEvent = function (
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
      this.pressedUrl = undefined;
      this.selectionAnchor = undefined;
      this.selectionFocus = undefined;
      this.selectionInitialRange = undefined;
      this.lastClick = undefined;
      handler();
      this.requestRender?.();
      return;
    }
    return original.call(this, event);
  };
  prototype[PATCH_SYMBOL] = true;
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
    this.body = new Text(payload.output || "(no output)", 0, 0);
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
      this.framed(this.theme.fg("accent", this.theme.bold("Fabric result")), safeWidth),
      this.framed(this.theme.fg("dim", this.payload.meta), safeWidth),
      rule,
      ...shown.map((line) => this.framed(this.theme.fg("toolOutput", line || " "), safeWidth)),
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
    const button = Number.parseInt(wheel[1], 10);
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
  private readonly urls = new Map<string, string>();
  private ui: ExtensionUIContext | undefined;
  private tui: TUI | undefined;
  private interceptorAvailable = false;
  private overlayOpen = false;

  bind(ui: ExtensionUIContext | undefined): void {
    this.dispose();
    if (!ui) return;
    this.ui = ui;
    this.interceptorAvailable = installAltScreenInspectInterceptor();
    ui.setWidget(
      CAPTURE_WIDGET_KEY,
      (tui) => {
        this.tui = tui;
        return new EmptyCaptureComponent();
      },
      { placement: "belowEditor" },
    );
  }

  dispose(): void {
    for (const url of this.urls.values()) inspectRoutes.delete(url);
    this.urls.clear();
    this.payloads.clear();
    this.overlayOpen = false;
    if (this.ui) this.ui.setWidget(CAPTURE_WIDGET_KEY, undefined);
    this.ui = undefined;
    this.tui = undefined;
    this.interceptorAvailable = false;
  }

  renderAction(action: FabricResultInspectAction, theme: Theme): string | undefined {
    if (!this.interceptorAvailable || this.tui?.mode !== "fullscreen" || !this.ui) return undefined;

    this.payloads.set(action.inspectId, { output: action.output, meta: action.meta });
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
