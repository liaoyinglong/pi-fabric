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
import {
  explicitFabricConfigOverride,
  loadLeanConfigForScope,
  saveLeanConfigPartial,
  type LeanSettingsPersistenceOptions,
} from "../settings/lean-persistence.js";

const BOOLEANS = ["true", "false"] as const;
const APPROVALS = ["allow", "ask", "auto", "deny"] as const;
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
  if (id === "capture.keepVisible") {
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
    this.list = new SettingsList(
      items,
      Math.min(items.length, 15),
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
      ? "Project overrides (.pi/fabric.json)"
      : "Global defaults (~/.pi/agent/fabric.json)";
    this.#scopeText.setText(
      this.theme.fg("muted", "Editing: ") + this.theme.fg("accent", destination),
    );
    const configOverride = explicitFabricConfigOverride();
    const warnings = [
      configOverride ? `PI_FABRIC_CONFIG overrides saved config: ${configOverride}` : undefined,
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

  #items(): SettingItem[] {
    const executor = this.#section("Executor", "Code Mode execution limits and result formatting.", [
      this.#valueSetting("executor.runtime", "Runtime", { description: "QuickJS sandbox or Node subprocess.", values: RUNTIMES }),
      this.#valueSetting("executor.resultFormat", "Result format", { description: "Program return rendering format.", values: RESULT_FORMATS }),
      this.#valueSetting("executor.timeoutMs", "Timeout (ms)", { description: "Maximum execution wall time.", input: true }),
      this.#valueSetting("executor.memoryLimitBytes", "Memory limit (bytes)", { description: "Executor memory ceiling.", input: true }),
      this.#valueSetting("executor.maxOutputChars", "Max output chars", { description: "Bounded final output size.", input: true }),
      this.#valueSetting("executor.maxNestedResultChars", "Max nested result chars", { description: "Bounded nested tool result size.", input: true }),
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
      this.#valueSetting("approvals.agent", "Agent-class risk", { description: "Approval mode for third-party providers classified as agent risk.", values: APPROVALS }),
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

    return [
      setting("executor", "Executor", `${this.#config.executor.runtime} · ${this.#config.executor.resultFormat}`, { description: "Execution runtime and bounds.", submenu: executor }),
      setting("mcp", "MCP", this.#config.mcp.enabled ? "enabled" : "disabled", { description: "MCP discovery and cache.", submenu: mcp }),
      setting("approvals", "Approvals", this.#config.approvals.execute, { description: "Approval modes by risk class.", submenu: approvals }),
      setting("capture", "Capture", `${this.#config.capture.keepVisible.length} visible`, { description: "Visible captured tools and risk mapping.", submenu: capture }),
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
