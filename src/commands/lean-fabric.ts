import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { LeanCodeModeRuntime } from "../lean-runtime.js";

const openLeanFabricSettings = async (context: ExtensionContext): Promise<void> => {
  if (context.mode !== "tui") {
    context.ui.notify("/fabric settings is available in TUI mode.", "warning");
    return;
  }
  const { LeanFabricSettings } = await import("../ui/lean-settings.js");
  await context.ui.custom<void>(
    (_tui, theme, _keybindings, done) => new LeanFabricSettings(
      theme,
      {
        cwd: context.cwd,
        agentDir: getAgentDir(),
        projectTrusted: context.isProjectTrusted(),
      },
      () => done(undefined),
    ),
    {
      overlay: true,
      overlayOptions: {
        width: "88%",
        minWidth: 44,
        maxHeight: "90%",
        anchor: "center",
        margin: 1,
      },
    },
  );
};

export function registerLeanFabricCommand(
  pi: ExtensionAPI,
  runtime: LeanCodeModeRuntime,
): void {
  pi.registerCommand("fabric", {
    description: "Open Lean Fabric settings",
    getArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
      const matches = ["settings"].filter((name) => name.startsWith(argumentPrefix));
      return matches.length > 0 ? matches.map((name) => ({ value: name, label: name })) : null;
    },
    async handler(argumentsText, context) {
      await runtime.initialize(context);
      const command = argumentsText.trim() || "settings";
      if (command === "settings") {
        await openLeanFabricSettings(context);
        return;
      }
      context.ui.notify("Usage: /fabric [settings]", "warning");
    },
  });
}
