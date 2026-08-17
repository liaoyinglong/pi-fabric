import {
  DynamicBorder,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  Key,
  matchesKey,
  SettingsList,
  Spacer,
  Text,
  type Component,
  type SettingItem,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";
import type { FabricConfig, FabricConfigScope } from "../config.js";
import { THINKING_LEVELS } from "../thinking.js";
import {
  explicitFabricConfigOverride,
  loadEditableSubagentCatalog,
  loadLeanConfigForScope,
  saveEditableSubagentProfile,
  saveLeanConfigPartial,
  type EditableSubagentProfile,
  type LeanSettingsPersistenceOptions,
} from "../settings/lean-persistence.js";

const BOOLEANS = ["true", "false"] as const;
const APPROVALS = ["allow", "ask", "auto", "deny"] as const;
const RUNNERS = ["pi", "claude", "cli"] as const;
const CLI_ADAPTERS = ["agy", "droid"] as const;
const TRANSPORTS = ["auto", "process", "tmux", "screen", "localterm", "herdr"] as const;
const RESULT_FORMATS = ["auto", "yaml", "json", "text"] as const;
const RUNTIMES = ["quickjs", "node-process"] as const;
const MCP_REVALIDATE = ["changed", "all", "off"] as const;
const RISKS = ["read", "write", "execute", "network", "agent"] as const;
const SAVE_SCOPE_KEY = Key.ctrl("g");

const settingsTheme = (theme: Theme): SettingsListTheme => ({
  label: (text, selected) => selected ? theme.fg("accent", text) : text,
  value: (text, selected) => selected ? theme.fg("accent", text) : theme.fg("muted", text),
  description: (text) => theme.fg("dim", text),
  cursor: theme.fg("accent", "→ "),
  hint: (text) => theme.fg("dim", text),
});

type SettingsSubmenu = (currentValue: string, done: (selectedValue?: string) => void) => Component;

const setting = (
  id: string,
  label: string,
  currentValue: string,
  options: { description?: string; values?: readonly string[]; submenu?: SettingsSubmenu } = {},
): SettingItem => ({
  id,
  label: options.submenu ? `${label} ›` : label,
  currentValue,
  ...(options.description ? { description: options.description } : {}),
  ...(options.values ? { values: [...options.values] } : {}),
  ...(options.submenu ? { submenu: options.submenu } : {}),
});

const buildPartial = (id: string, value: unknown): Record<string, unknown> => {
  const segments = id.split(".");
  const root: Record<string, unknown> = {};
  let current = root;
  for (let index = 0; index < segments.length - 1; index++) {
    const next: Record<string, unknown> = {};
    current[segments[index]!] = next;
    current = next;
  }
  current[segments.at(-1)!] = value;
  return root;
};

const getPath = (value: unknown, id: string): unknown => {
  let current = value;
  for (const part of id.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const parseInputValue = (id: string, value: string, config: FabricConfig): unknown => {
  const current = getPath(config, id);
  if (typeof current === "boolean") return value === "true";
  if (typeof current === "number") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : current;
  }
  if (id === "agents.defaultTools" || id === "capture.keepVisible") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return value.trim();
};

const formatValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === "") return "—";
  return String(value);
};

class StringInputSubmenu extends Container {
  readonly input = new Input();

  constructor(
    theme: Theme,
    title: string,
    description: string,
    currentValue: string,
    done: (value?: string) => void,
  ) {
    super();
    this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("muted", description), 0, 0));
    this.addChild(new Spacer(1));
    this.input.handleInput(currentValue === "—" ? "" : currentValue);
    this.input.focused = true;
    this.input.onSubmit = (value) => done(value.trim());
    this.input.onEscape = () => done();
    this.addChild(this.input);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("dim", "Enter to save · Esc to go back"), 0, 0));
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  render(width: number): string[] {
    this.input.focused = true;
    return super.render(width);
  }
}

class SectionSubmenu extends Container {
  readonly list: SettingsList;

  constructor(
    theme: Theme,
    title: string,
    description: string,
    items: SettingItem[],
    onChange: (id: string, value: string) => void,
    done: () => void,
  ) {
    super();
    this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("muted", description), 0, 0));
    this.addChild(new Spacer(1));
    const displayItems = items.length > 0
      ? items
      : [setting("empty", "No entries", "—", { description: "Nothing is configured in this scope." })];
    this.list = new SettingsList(
      displayItems,
      Math.min(displayItems.length, 15),
      settingsTheme(theme),
      onChange,
      done,
      { enableSearch: true },
    );
    this.addChild(this.list);
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }
}

const inputSubmenu = (
  theme: Theme,
  title: string,
  description: string,
): SettingsSubmenu => (current, done) =>
  new StringInputSubmenu(theme, title, description, current, done);

const profileSummary = (profile: EditableSubagentProfile): string => [
  profile.runner ?? "inherit",
  profile.cli,
  profile.model,
  profile.thinking,
].filter(Boolean).join(" · ");

export class LeanFabricSettings extends Container {
  #scope: FabricConfigScope;
  #config: FabricConfig;
  #list!: SettingsList;
  #scopeText = new Text("", 1, 0);
  #statusText = new Text("", 1, 0);
  #listContainer = new Container();

  constructor(
    readonly theme: Theme,
    readonly options: LeanSettingsPersistenceOptions,
    readonly done: () => void,
  ) {
    super();
    this.#scope = options.projectTrusted ? "project" : "global";
    this.#config = loadLeanConfigForScope(this.#scope, options);
    this.addChild(new DynamicBorder((text) => theme.fg("border", text)));
    this.addChild(new Text(theme.bold(theme.fg("accent", "Lean Fabric Settings")), 1, 0));
    this.addChild(this.#scopeText);
    this.addChild(this.#statusText);
    this.addChild(new Spacer(1));
    this.addChild(this.#listContainer);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("dim", "Ctrl+G switch global/project · changes apply to new runtime sessions · Esc close"), 1, 0));
    this.addChild(new DynamicBorder((text) => theme.fg("border", text)));
    this.#refreshHeader();
    this.#rebuild();
  }

  #refreshHeader(): void {
    const destination = this.#scope === "project"
      ? "Project overrides (.pi/fabric.json + .pi/fabric/subagents.*)"
      : "Global defaults (~/.pi/agent/fabric.json + fabric/subagents.*)";
    this.#scopeText.setText(
      this.theme.fg("muted", "Editing: ") + this.theme.fg("accent", destination),
    );
    const configOverride = explicitFabricConfigOverride();
    const profileOverride = process.env.PI_FABRIC_SUBAGENTS_FILE?.trim();
    const warnings = [
      configOverride ? `PI_FABRIC_CONFIG overrides saved config: ${configOverride}` : undefined,
      profileOverride ? `PI_FABRIC_SUBAGENTS_FILE overrides saved profiles: ${profileOverride}` : undefined,
      !this.options.projectTrusted ? "Project scope unavailable because this project is untrusted." : undefined,
    ].filter((value): value is string => Boolean(value));
    this.#statusText.setText(warnings.length > 0 ? this.theme.fg("warning", warnings.join(" · ")) : "");
  }

  #persist(id: string, raw: string): void {
    const value = parseInputValue(id, raw, this.#config);
    const target = saveLeanConfigPartial(this.#scope, this.options, buildPartial(id, value));
    this.#config = loadLeanConfigForScope(this.#scope, this.options);
    this.#statusText.setText(this.theme.fg("success", `Saved ${id} → ${target}`));
  }

  #section(
    title: string,
    description: string,
    items: SettingItem[],
  ): SettingsSubmenu {
    return (_current, done) => new SectionSubmenu(
      this.theme,
      title,
      description,
      items,
      (id, value) => this.#persist(id, value),
      () => done(),
    );
  }

  #valueSetting(
    id: string,
    label: string,
    options: { description: string; values?: readonly string[]; input?: boolean },
  ): SettingItem {
    const current = formatValue(getPath(this.#config, id));
    return setting(id, label, current, {
      description: options.description,
      ...(options.values ? { values: options.values } : {}),
      ...(options.input ? { submenu: inputSubmenu(this.theme, label, options.description) } : {}),
    });
  }

  #profilesSubmenu(): SettingsSubmenu {
    return (_current, done) => {
      const catalog = loadEditableSubagentCatalog(this.#scope, this.options);
      const entries = Object.entries(catalog.profiles);
      const rows = entries.map(([name, profile]) => setting(
        `profile.${name}`,
        name,
        profileSummary(profile) || "configured",
        {
          description: profile.description ?? "Semantic subagent profile.",
          submenu: this.#profileEditor(name, profile),
        },
      ));
      return new SectionSubmenu(
        this.theme,
        "Subagent profiles",
        catalog.explicitOverride
          ? `Editing saved profiles; PI_FABRIC_SUBAGENTS_FILE has higher precedence: ${catalog.explicitOverride}`
          : "Edit semantic routing profiles without exposing raw routing fields to Main.",
        rows,
        () => undefined,
        () => done(),
      );
    };
  }

  #profileEditor(name: string, initial: EditableSubagentProfile): SettingsSubmenu {
    return (_current, done) => {
      let profile = structuredClone(initial);
      const persist = (key: string, raw: string): void => {
        const clean = raw.trim();
        const next: EditableSubagentProfile = { ...profile };
        switch (key) {
          case "description":
            if (clean) next.description = clean;
            else delete next.description;
            break;
          case "instructions":
            if (clean) next.instructions = clean;
            else delete next.instructions;
            break;
          case "runner": next.runner = clean as EditableSubagentProfile["runner"]; break;
          case "cli": next.cli = clean as EditableSubagentProfile["cli"]; break;
          case "transport": next.transport = clean as EditableSubagentProfile["transport"]; break;
          case "model":
            if (clean) next.model = clean;
            else delete next.model;
            break;
          case "thinking": next.thinking = clean as EditableSubagentProfile["thinking"]; break;
          case "tools": next.tools = clean.split(",").map((entry) => entry.trim()).filter(Boolean); break;
          case "timeoutMs": {
            const parsed = Number(clean);
            if (Number.isFinite(parsed) && parsed > 0) next.timeoutMs = Math.floor(parsed);
            break;
          }
          case "extensions": next.extensions = clean === "true"; break;
          case "worktree": next.worktree = clean === "true"; break;
        }
        const target = saveEditableSubagentProfile(this.#scope, this.options, name, next);
        profile = next;
        this.#statusText.setText(this.theme.fg("success", `Saved profile ${name} → ${target}`));
      };
      const profileSetting = (
        key: string,
        label: string,
        value: unknown,
        description: string,
        values?: readonly string[],
        input = false,
      ): SettingItem => setting(key, label, formatValue(value), {
        description,
        ...(values ? { values } : {}),
        ...(input ? { submenu: inputSubmenu(this.theme, label, description) } : {}),
      });
      const items = [
        profileSetting("description", "Description", profile.description, "What this semantic profile is for.", undefined, true),
        profileSetting("instructions", "Instructions", profile.instructions, "Extra instructions prepended to the delegated task.", undefined, true),
        profileSetting("runner", "Runner", profile.runner ?? "pi", "Runtime used for this profile.", RUNNERS),
        profileSetting("cli", "CLI adapter", profile.cli ?? "agy", "CLI adapter when runner=cli.", CLI_ADAPTERS),
        profileSetting("transport", "Transport", profile.transport ?? "auto", "Worker process transport.", TRANSPORTS),
        profileSetting("model", "Model", profile.model, "Optional provider/model override.", undefined, true),
        profileSetting("thinking", "Thinking", profile.thinking ?? "medium", "Reasoning effort for this profile.", THINKING_LEVELS),
        profileSetting("tools", "Tools", profile.tools ?? [], "Comma-separated tool allowlist.", undefined, true),
        profileSetting("timeoutMs", "Timeout (ms)", profile.timeoutMs ?? 3_600_000, "Per-run timeout in milliseconds.", undefined, true),
        profileSetting("extensions", "Extensions", profile.extensions ?? true, "Allow Pi extension discovery for this profile.", BOOLEANS),
        profileSetting("worktree", "Worktree", profile.worktree ?? false, "Run this profile in an isolated worktree.", BOOLEANS),
      ];
      return new SectionSubmenu(
        this.theme,
        `Profile: ${name}`,
        "Changes are written to the selected global/project profile file and apply to new runs.",
        items,
        persist,
        () => done(),
      );
    };
  }

  #items(): SettingItem[] {
    const executor = this.#section("Executor", "Code Mode execution limits and result formatting.", [
      this.#valueSetting("executor.runtime", "Runtime", { description: "QuickJS sandbox or Node subprocess.", values: RUNTIMES }),
      this.#valueSetting("executor.resultFormat", "Result format", { description: "Program return rendering format.", values: RESULT_FORMATS }),
      this.#valueSetting("executor.timeoutMs", "Timeout (ms)", { description: "Maximum execution wall time.", input: true }),
      this.#valueSetting("executor.memoryLimitBytes", "Memory limit (bytes)", { description: "Executor memory ceiling.", input: true }),
      this.#valueSetting("executor.maxOutputChars", "Max output chars", { description: "Bounded final output size.", input: true }),
      this.#valueSetting("executor.maxNestedResultChars", "Max nested result chars", { description: "Bounded nested tool result size.", input: true }),
    ]);

    const agents = this.#section("Agents", "Defaults and safety bounds for delegated work.", [
      this.#valueSetting("agents.enabled", "Enabled", { description: "Enable subagent execution.", values: BOOLEANS }),
      this.#valueSetting("agents.runner", "Default runner", { description: "Default runner when a profile omits one.", values: RUNNERS }),
      this.#valueSetting("agents.transport", "Transport", { description: "Default worker transport.", values: TRANSPORTS }),
      this.#valueSetting("agents.thinking", "Thinking", { description: "Default reasoning effort.", values: THINKING_LEVELS }),
      this.#valueSetting("agents.maxConcurrent", "Max concurrent", { description: "Maximum simultaneous agent runs.", input: true }),
      this.#valueSetting("agents.maxPerExecution", "Max per execution", { description: "Maximum starts from one fabric_exec.", input: true }),
      this.#valueSetting("agents.maxDepth", "Max recursive depth", { description: "Maximum recursive Pi delegation depth.", input: true }),
      this.#valueSetting("agents.timeoutMs", "Timeout (ms)", { description: "Default child timeout.", input: true }),
      this.#valueSetting("agents.defaultTools", "Default tools", { description: "Comma-separated default tool allowlist.", input: true }),
      this.#valueSetting("agents.extensions", "Extensions", { description: "Allow extension discovery in Pi children.", values: BOOLEANS }),
      this.#valueSetting("agents.notifyOnComplete", "Notify on complete", { description: "Show child completion notifications.", values: BOOLEANS }),
      this.#valueSetting("agents.retainRuns", "Retain runs", { description: "Retain completed run directories.", values: BOOLEANS }),
      this.#valueSetting("agents.budgetUsd", "Budget USD", { description: "Shared recursive cost budget; 0 disables.", input: true }),
      this.#valueSetting("agents.maxTokensPerChild", "Max tokens per child", { description: "0 disables the per-child token ceiling.", input: true }),
      this.#valueSetting("agents.sessionExport", "Session export", { description: "Write usage-only Pi session exports.", values: BOOLEANS }),
    ]);

    const runners = this.#section("Runners", "CLI and Claude executable/model defaults.", [
      this.#valueSetting("agents.cli.adapter", "Default CLI adapter", { description: "AGY or Droid for runner=cli.", values: CLI_ADAPTERS }),
      this.#valueSetting("agents.cli.agy.binary", "AGY binary", { description: "Antigravity CLI executable.", input: true }),
      this.#valueSetting("agents.cli.agy.model", "AGY model", { description: "Optional AGY model override.", input: true }),
      this.#valueSetting("agents.cli.droid.binary", "Droid binary", { description: "Factory Droid CLI executable.", input: true }),
      this.#valueSetting("agents.cli.droid.model", "Droid model", { description: "Optional Droid model override.", input: true }),
      this.#valueSetting("agents.claude.binary", "Claude binary", { description: "Claude CLI executable.", input: true }),
      this.#valueSetting("agents.claude.model", "Claude model", { description: "Optional Claude model override.", input: true }),
    ]);

    const mcp = this.#section("MCP", "MCP discovery, OAuth, timeouts, and descriptor cache.", [
      this.#valueSetting("mcp.enabled", "Enabled", { description: "Enable MCP support.", values: BOOLEANS }),
      this.#valueSetting("mcp.configPath", "Config path", { description: "Optional mcporter config path.", input: true }),
      this.#valueSetting("mcp.disableOAuth", "Disable OAuth", { description: "Disable MCP OAuth flows.", values: BOOLEANS }),
      this.#valueSetting("mcp.allowDynamicServers", "Dynamic servers", { description: "Allow servers discovered at runtime.", values: BOOLEANS }),
      this.#valueSetting("mcp.callTimeoutMs", "Call timeout (ms)", { description: "MCP call timeout.", input: true }),
      this.#valueSetting("mcp.cache.enabled", "Descriptor cache", { description: "Cache MCP descriptors on disk.", values: BOOLEANS }),
      this.#valueSetting("mcp.cache.revalidate", "Cache revalidate", { description: "Background revalidation policy.", values: MCP_REVALIDATE }),
      this.#valueSetting("mcp.cache.revalidateBudgetMs", "Revalidate budget (ms)", { description: "Background revalidation wall-time budget.", input: true }),
    ]);

    const approvals = this.#section("Approvals", "Host approval policy by risk class.", [
      this.#valueSetting("approvals.read", "Read", { description: "Read operation approval mode.", values: APPROVALS }),
      this.#valueSetting("approvals.write", "Write", { description: "Write operation approval mode.", values: APPROVALS }),
      this.#valueSetting("approvals.execute", "Execute", { description: "Command execution approval mode.", values: APPROVALS }),
      this.#valueSetting("approvals.network", "Network", { description: "Network operation approval mode.", values: APPROVALS }),
      this.#valueSetting("approvals.agent", "Agent", { description: "Delegated agent approval mode.", values: APPROVALS }),
    ]);

    const riskItems = Object.keys(this.#config.capture.risks).sort().map((name) =>
      this.#valueSetting(`capture.risks.${name}`, name, { description: `Risk class for ${name}.`, values: RISKS }),
    );
    const capture = this.#section(
      "Capture",
      "Lean keeps capture enabled/hidden by design; only visible-tool and risk policy are editable here.",
      [
        this.#valueSetting("capture.keepVisible", "Keep visible", { description: "Comma-separated captured tools left directly visible.", input: true }),
        this.#valueSetting("capture.defaultRisk", "Default risk", { description: "Risk class for tools without an explicit mapping.", values: RISKS }),
        ...riskItems,
      ],
    );

    const retention = this.#section("Retention", "Cleanup windows for temporary and one-shot run data.", [
      this.#valueSetting("retention.orphanedTempRunMs", "Orphaned temp run (ms)", { description: "Age before orphaned temp runs are cleaned.", input: true }),
      this.#valueSetting("retention.oneShotRunMs", "One-shot run (ms)", { description: "Age before retained one-shot run data is cleaned.", input: true }),
    ]);

    const profiles = this.#profilesSubmenu();
    const catalog = loadEditableSubagentCatalog(this.#scope, this.options);

    return [
      setting("executor", "Executor", `${this.#config.executor.runtime} · ${this.#config.executor.resultFormat}`, { description: "Execution runtime and bounds.", submenu: executor }),
      setting("agents", "Agents", `${this.#config.agents.runner} · ${this.#config.agents.transport}`, { description: "Delegation defaults and limits.", submenu: agents }),
      setting("runners", "Runners", `${this.#config.agents.cli.adapter} · ${this.#config.agents.claude.binary}`, { description: "AGY, Droid, and Claude defaults.", submenu: runners }),
      setting("profiles", "Subagent profiles", `${Object.keys(catalog.profiles).length} configured`, { description: "Semantic routing profiles used by agents.run/spawn/recurse.", submenu: profiles }),
      setting("mcp", "MCP", this.#config.mcp.enabled ? "enabled" : "disabled", { description: "MCP discovery and cache.", submenu: mcp }),
      setting("approvals", "Approvals", this.#config.approvals.execute, { description: "Approval modes by risk class.", submenu: approvals }),
      setting("capture", "Capture", `${this.#config.capture.keepVisible.length} visible`, { description: "Visible captured tools and risk mapping.", submenu: capture }),
      setting("retention", "Retention", `${this.#config.retention.oneShotRunMs} ms`, { description: "Run cleanup windows.", submenu: retention }),
    ];
  }

  #rebuild(): void {
    this.#listContainer.clear();
    this.#list = new SettingsList(
      this.#items(),
      10,
      settingsTheme(this.theme),
      () => undefined,
      () => this.done(),
      { enableSearch: true },
    );
    this.#listContainer.addChild(this.#list);
  }

  handleInput(data: string): void {
    if (matchesKey(data, SAVE_SCOPE_KEY) && this.options.projectTrusted) {
      this.#scope = this.#scope === "project" ? "global" : "project";
      this.#config = loadLeanConfigForScope(this.#scope, this.options);
      this.#refreshHeader();
      this.#rebuild();
      return;
    }
    this.#list.handleInput(data);
  }
}
