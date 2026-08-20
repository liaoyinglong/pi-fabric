import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  buildFabricExecutionInspectContent,
  FabricResultInspector,
} from "../src/ui/result-inspector.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

type FakeInteractiveTui = TUI & {
  sourceLine: string;
  copied: number;
  openedUrl?: string;
  selectionPressActive?: boolean;
  selectionDragged?: boolean;
  selectionAnchor?: { row: number; col: number };
  pressedUrl: string | undefined;
  handleSelectionMouseEvent(event: { release: boolean; x: number }): void;
  getSelectionSourceLine(point: { row: number; col: number }): string;
};

const fakeTui = (mode: "regular" | "fullscreen"): FakeInteractiveTui => ({
  mode,
  terminal: { rows: 40, columns: 120 },
  requestRender: vi.fn(),
  sourceLine: "",
  copied: 0,
  pressedUrl: undefined,
  handleSelectionMouseEvent(this: FakeInteractiveTui, event: { release: boolean; x: number }) {
    if (event.release) {
      if (!this.selectionPressActive) return;
      this.selectionPressActive = false;
      if (this.pressedUrl) {
        this.openedUrl = this.pressedUrl;
        this.pressedUrl = undefined;
        return;
      }
      this.copied += 1;
      return;
    }

    this.selectionPressActive = true;
    this.selectionDragged = false;
    this.selectionAnchor = { row: 0, col: event.x };
    // Reproduce Pi's fullscreen ScrollView failure: the painted screen lookup
    // misses the OSC 8 link even though the scroll-content source still has it.
    this.pressedUrl = undefined;
  },
  getSelectionSourceLine(this: FakeInteractiveTui) {
    return this.sourceLine;
  },
} as unknown as FakeInteractiveTui);

const bindInspector = (mode: "regular" | "fullscreen") => {
  const tui = fakeTui(mode);
  const custom = vi.fn(async (
    factory: Parameters<ExtensionUIContext["custom"]>[0],
    options?: Parameters<ExtensionUIContext["custom"]>[1],
  ) => {
    const done = vi.fn();
    await factory(tui, plainTheme, {} as never, done);
    return undefined;
  });
  const ui = {
    setWidget: vi.fn((
      _key: string,
      content: ((tui: TUI, theme: Theme) => unknown) | string[] | undefined,
    ) => {
      if (typeof content === "function") content(tui, plainTheme);
    }),
    custom,
  } as unknown as ExtensionUIContext;
  const inspector = new FabricResultInspector();
  inspector.bind(ui);
  return { inspector, tui, ui, custom };
};

describe("Fabric result inspector", () => {
  it("formats the full Fabric execution instead of only the final result", () => {
    const content = buildFabricExecutionInspectContent({
      args: {
        code: "const data = await pi.bash('echo hi');\nreturn data.output;",
        strings: { query: "hello" },
        resultFormat: "text",
      },
      details: {
        audits: [{
          ref: "pi.bash",
          success: false,
          args: { command: "echo hi" },
          preview: { output: "hi" },
          error: "boom",
          startedAt: 10,
          endedAt: 591,
        }],
      },
    }, "final-result");

    expect(content).toContain("Code · 2 lines");
    expect(content).toContain("1 const data = await pi.bash('echo hi');");
    expect(content).toContain("Strings · 1");
    expect(content).toContain("Result format · text");
    expect(content).toContain("Calls · 1");
    expect(content).toContain("1. ✗ pi.bash · 581ms");
    expect(content).toContain('\"command\": \"echo hi\"');
    expect(content).toContain('\"output\": \"hi\"');
    expect(content).toContain("boom");
    expect(content).toContain("Result · 1 line");
    expect(content).toContain("final-result");
  });

  it("keeps inspect actions disabled in regular mode", () => {
    const { inspector } = bindInspector("regular");
    expect(inspector.renderAction({
      inspectId: "call-regular",
      output: "line 1\nline 2",
      meta: "2 lines · 13 chars",
    }, plainTheme)).toBeUndefined();
    inspector.dispose();
  });

  it("opens the overlay instead of falling through to copied", async () => {
    const { inspector, tui, custom } = bindInspector("fullscreen");
    inspector.captureExecution({
      inspectId: "call-fullscreen",
      args: { code: "return 42;" },
      details: { audits: [] },
    });
    const action = inspector.renderAction({
      inspectId: "call-fullscreen",
      output: "line 1\nline 2",
      meta: "2 lines · 13 chars",
    }, plainTheme);

    expect(action).toContain("[inspect]");
    const url = /\x1b\]8;;([^\x07]+)\x07/.exec(action ?? "")?.[1];
    expect(url).toMatch(/^pi-fabric:\/\/inspect\//);

    // The current renderer's painted-screen URL lookup misses, but its
    // scroll-content source line still contains Fabric's OSC 8 action.
    tui.sourceLine = action ?? "";
    tui.handleSelectionMouseEvent({ release: false, x: 1 });
    expect(tui.pressedUrl).toBe(url);

    tui.handleSelectionMouseEvent({ release: true, x: 1 });
    await Promise.resolve();

    expect(tui.copied).toBe(0);
    expect(tui.openedUrl).toBeUndefined();
    expect(custom).toHaveBeenCalledTimes(1);
    expect(custom.mock.calls[0]?.[1]).toMatchObject({
      overlay: true,
      overlayOptions: { width: "80%", maxHeight: "75%" },
    });
    inspector.dispose();
  });
});
