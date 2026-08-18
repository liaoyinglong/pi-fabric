import {
  wrapRegisteredTool,
  type ExtensionRunner,
  type RegisteredTool,
  type SourceInfo,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { FabricToolCaptureConfig } from "../config.js";
import type { FabricRisk } from "../protocol.js";

const KNOWN_READ_ONLY_CAPTURE_TOOLS = new Set([
  "fovea_sketch",
  "fovea_focus",
  "fovea_dwell",
  "fovea_impact",
  "fffind",
  "ffgrep",
]);

export interface CapturedToolEntry {
  name: string;
  definition: ToolDefinition<any, any, any>;
  registeredTool: RegisteredTool;
  sourceInfo: SourceInfo;
  runner: ExtensionRunner;
  wrappedTool: ReturnType<typeof wrapRegisteredTool>;
  risk: FabricRisk;
}

export interface CapturedToolCatalogOptions {
  /**
   * Tools classified as hide-only remain registered with Pi and are removed
   * from the parent model's active tool set, but are never exposed through
   * Fabric's `extensions.*` guest namespace.
   */
  hideOnly?: (tool: RegisteredTool) => boolean;
}

export class CapturedToolCatalog {
  readonly #tools = new Map<string, CapturedToolEntry>();
  readonly #hiddenOnly = new Set<string>();
  readonly #listeners = new Set<() => void>();
  // The ExtensionRunner observed during the last tool refresh. Stored even
  // when capture is disabled so PiToolsProvider can replay the tool-execution
  // lifecycle (tool_call/tool_result/tool_execution_*) for nested pi.* calls
  // in full-code mode — without it, extensions that hook those events
  // (pi-vision-handoff, auditors, etc.) would never fire for pi core tools.
  #runner: ExtensionRunner | undefined;

  constructor(readonly options: CapturedToolCatalogOptions = {}) {}

  get runner(): ExtensionRunner | undefined {
    return this.#runner;
  }

  replace(
    registeredTools: RegisteredTool[],
    runner: ExtensionRunner,
    config: FabricToolCaptureConfig,
    ownSourcePath: string,
  ): void {
    // Always remember the runner (see field comment) before the enabled gate.
    this.#runner = runner;
    this.#tools.clear();
    this.#hiddenOnly.clear();
    if (!config.enabled) {
      this.#emit();
      return;
    }

    for (const registeredTool of registeredTools) {
      const { definition, sourceInfo } = registeredTool;
      if (sourceInfo.path === ownSourcePath) continue;
      if (this.options.hideOnly?.(registeredTool)) {
        this.#hiddenOnly.add(definition.name);
        continue;
      }
      this.#tools.set(definition.name, {
        name: definition.name,
        definition,
        registeredTool,
        sourceInfo,
        runner,
        wrappedTool: wrapRegisteredTool(registeredTool, runner),
        risk:
          config.risks[definition.name] ??
          (KNOWN_READ_ONLY_CAPTURE_TOOLS.has(definition.name)
            ? "read"
            : config.defaultRisk),
      });
    }
    this.#emit();
  }

  clear(): void {
    this.#tools.clear();
    this.#hiddenOnly.clear();
    this.#emit();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get(name: string): CapturedToolEntry | undefined {
    return this.#tools.get(name);
  }

  require(name: string): CapturedToolEntry {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Unknown captured extension tool: ${name}`);
    return tool;
  }

  list(): CapturedToolEntry[] {
    return [...this.#tools.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  hiddenOnlyNames(): string[] {
    return [...this.#hiddenOnly].sort((left, right) => left.localeCompare(right));
  }

  get size(): number {
    return this.#tools.size;
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* Catalog observers cannot interrupt capture refresh. */ }
    }
  }
}
