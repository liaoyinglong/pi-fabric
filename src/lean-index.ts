import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CapturedToolCatalog } from "./capture/catalog.js";
import { installRegisteredToolCapture } from "./capture/interceptor.js";
import { registerLeanFabricCommand } from "./commands/lean-fabric.js";
import { DEFAULT_FABRIC_CONFIG } from "./config.js";
import { coreOverridePromptGuidance } from "./core/core-override-guidance.js";
import { PI_CORE_TOOL_NAME_SET } from "./core/pi-tools.js";
import { restoreSkillsForFullCodePrompt } from "./core/skill-prompt.js";
import {
  defaultFabricExecutionGuidance,
  fabricExecutionKernelGuidance,
} from "./core/system-guidance.js";
import { createLeanFabricExecTool } from "./lean-exec-tool.js";
import { LeanCodeModeRuntime } from "./lean-runtime.js";
import { createLeanTodoTool, TodoStore } from "./todo-tool.js";

const extensionPath = fileURLToPath(import.meta.url);
const entryDir = path.dirname(extensionPath);
const skillsRoot = path.resolve(entryDir, "..", "skills");
const leanSkillPaths = [
  path.join(skillsRoot, "fabric-exec"),
  path.join(skillsRoot, "fabric-subagents"),
  path.join(skillsRoot, "fabric-workflow"),
];

export const LEAN_MODEL_FACING_TOOL_NAMES = ["fabric_exec", "todo"] as const;

export const resolveLeanActiveTools = (
  active: readonly string[],
  hiddenCaptured: ReadonlySet<string>,
): string[] => {
  const next = active.filter((name) =>
    !PI_CORE_TOOL_NAME_SET.has(name) && !hiddenCaptured.has(name),
  );
  for (const name of LEAN_MODEL_FACING_TOOL_NAMES) {
    if (!next.includes(name)) next.push(name);
  }
  return next;
};

export const getLeanFabricSkillPaths = (): string[] =>
  leanSkillPaths.filter((skillPath) => existsSync(skillPath));

/**
 * Ordinary Pi subagents still discover extensions so dynamically registered
 * model providers remain available. If that discovery encounters Fabric
 * itself, it must stay inert: only an explicit recursive child should enter
 * Full Code Mode again.
 */
export const isOneShotFabricChild = (
  env: NodeJS.ProcessEnv = process.env,
): boolean =>
  Boolean(env.PI_FABRIC_PARENT_RUN) && env.PI_FABRIC_FULL_CODE_MODE !== "true";

export default async function leanFabricExtension(pi: ExtensionAPI): Promise<void> {
  if (isOneShotFabricChild()) return;

  const capturedTools = new CapturedToolCatalog();
  const runtime = new LeanCodeModeRuntime(pi, capturedTools, extensionPath);
  const fabricTool = createLeanFabricExecTool(runtime);
  const todoStore = new TodoStore();
  const todoTool = createLeanTodoTool(todoStore);
  let savedActiveTools: string[] | undefined;

  registerLeanFabricCommand(pi, runtime);

  const inactiveCapturePolicy = {
    ...structuredClone(DEFAULT_FABRIC_CONFIG.capture),
    enabled: false,
    hideFromModel: false,
  };

  const applyToolOwnership = (): void => {
    if (!runtime.ready) return;
    const active = pi.getActiveTools();
    savedActiveTools ??= [...active];
    const keepVisible = new Set(runtime.config.capture.keepVisible);
    const captured = new Set(
      capturedTools.list().map((entry) => entry.name).filter((name) => !keepVisible.has(name)),
    );
    const next = resolveLeanActiveTools(active, captured);
    if (next.length !== active.length || next.some((name, index) => name !== active[index])) {
      pi.setActiveTools(next);
    }
  };

  const toolCapture = await installRegisteredToolCapture({
    anchorDefinition: fabricTool,
    catalog: capturedTools,
    initialPolicy: inactiveCapturePolicy,
    onCatalogRefresh: () => queueMicrotask(applyToolOwnership),
  });

  pi.registerTool(fabricTool);
  pi.registerTool(todoTool);

  pi.on("resources_discover", async () => ({ skillPaths: getLeanFabricSkillPaths() }));

  pi.on("session_start", async (_event, context) => {
    savedActiveTools = undefined;
    todoStore.reset();
    await runtime.initialize(context);
    toolCapture.setPolicy(runtime.config.capture);
    pi.registerTool(fabricTool);
    pi.registerTool(todoTool);
    applyToolOwnership();
  });

  pi.on("before_agent_start", async (event) => {
    if (!runtime.ready || !pi.getActiveTools().includes("fabric_exec")) return;
    applyToolOwnership();
    const systemPrompt = restoreSkillsForFullCodePrompt(
      event.systemPrompt,
      event.systemPromptOptions.skills ?? [],
    );
    const overrideGuidance = coreOverridePromptGuidance(capturedTools).trim();
    const guidance = [
      fabricExecutionKernelGuidance(true),
      defaultFabricExecutionGuidance(true, {
        agentsEnabled: runtime.config.agents.enabled,
        mcpEnabled: runtime.config.mcp.enabled,
      }),
      overrideGuidance || undefined,
    ].filter((value): value is string => Boolean(value)).join("\n\n");
    return { systemPrompt: `${systemPrompt}\n\n${guidance}` };
  });

  pi.on("session_shutdown", async () => {
    toolCapture.setPolicy(inactiveCapturePolicy);
    todoStore.reset();
    await runtime.close();
    if (savedActiveTools) {
      const registered = new Set(pi.getAllTools().map((tool) => tool.name));
      const restored = savedActiveTools.filter((name) => registered.has(name));
      for (const name of pi.getActiveTools()) {
        if (!restored.includes(name) && registered.has(name)) restored.push(name);
      }
      pi.setActiveTools(restored);
    }
    savedActiveTools = undefined;
  });
}
