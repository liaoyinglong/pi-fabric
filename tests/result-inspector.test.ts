import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { FabricResultInspector } from "../src/ui/result-inspector.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const fakeTui = (mode: "regular" | "fullscreen"): TUI => ({
  mode,
  terminal: { rows: 40 },
  requestRender: vi.fn(),
} as unknown as TUI);

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
  it("keeps inspect actions disabled in regular mode", () => {
    const { inspector } = bindInspector("regular");
    expect(inspector.renderAction({
      inspectId: "call-regular",
      output: "line 1\nline 2",
      meta: "2 lines · 13 chars",
    }, plainTheme)).toBeUndefined();
    inspector.dispose();
  });

  it("opens a fullscreen overlay when the inspect link is clicked", async () => {
    const { inspector, custom } = bindInspector("fullscreen");
    const action = inspector.renderAction({
      inspectId: "call-fullscreen",
      output: "line 1\nline 2",
      meta: "2 lines · 13 chars",
    }, plainTheme);

    expect(action).toContain("[inspect]");
    const url = /\x1b\]8;;([^\x07]+)\x07/.exec(action ?? "")?.[1];
    expect(url).toMatch(/^pi-fabric:\/\/inspect\//);

    const mouseHandler = (TuiAltScreen.prototype as unknown as Record<string, unknown>)
      .handleSelectionMouseEvent;
    expect(typeof mouseHandler).toBe("function");
    (mouseHandler as (this: Record<string, unknown>, event: { release: boolean }) => void).call({
      selectionPressActive: true,
      selectionDragged: false,
      pressedUrl: url,
      requestRender: vi.fn(),
    }, { release: true });

    await Promise.resolve();
    expect(custom).toHaveBeenCalledTimes(1);
    expect(custom.mock.calls[0]?.[1]).toMatchObject({
      overlay: true,
      overlayOptions: { width: "80%", maxHeight: "75%" },
    });
    inspector.dispose();
  });
});
