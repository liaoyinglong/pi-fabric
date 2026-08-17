import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

type SubagentRoleRunner = "pi" | "claude" | "cli";
type SubagentCliAdapter = "agy" | "droid";
type SubagentRoleTransport = "auto" | "process" | "tmux" | "screen" | "localterm" | "herdr";
type SubagentRoleThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface SubagentRoleProfile {
  description?: string;
  instructions?: string;
  runner?: SubagentRoleRunner;
  cli?: SubagentCliAdapter;
  transport?: SubagentRoleTransport;
  model?: string;
  thinking?: SubagentRoleThinking;
  tools?: string[];
  timeoutMs?: number;
  extensions?: boolean;
  worktree?: boolean;
}

interface SubagentRoleCatalog {
  roles: Record<string, SubagentRoleProfile>;
  sources: string[];
}

interface ResolvedSubagentRole {
  role?: string;
  profile?: SubagentRoleProfile;
  args: Record<string, unknown>;
}

export interface SubagentRoleLoadOptions {
  projectTrusted?: boolean;
}

const ROLE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const RUNNERS = new Set<SubagentRoleRunner>(["pi", "claude", "cli"]);
const CLI_ADAPTERS = new Set<SubagentCliAdapter>(["agy", "droid"]);
const TRANSPORTS = new Set<SubagentRoleTransport>([
  "auto",
  "process",
  "tmux",
  "screen",
  "localterm",
  "herdr",
]);
const THINKING = new Set<SubagentRoleThinking>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return result.length > 0 ? result : [];
};

const roleProfile = (value: unknown): SubagentRoleProfile | undefined => {
  const input = asObject(value);
  if (!input) return undefined;
  const runner = RUNNERS.has(input.runner as SubagentRoleRunner)
    ? input.runner as SubagentRoleRunner
    : undefined;
  const cli = CLI_ADAPTERS.has(input.cli as SubagentCliAdapter)
    ? input.cli as SubagentCliAdapter
    : undefined;
  const transport = TRANSPORTS.has(input.transport as SubagentRoleTransport)
    ? input.transport as SubagentRoleTransport
    : undefined;
  const thinking = THINKING.has(input.thinking as SubagentRoleThinking)
    ? input.thinking as SubagentRoleThinking
    : undefined;
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
    ? Math.floor(input.timeoutMs)
    : undefined;
  const tools = stringList(input.tools);
  const description = nonEmptyString(input.description);
  const instructions = nonEmptyString(input.instructions);
  const model = nonEmptyString(input.model);
  return {
    ...(description ? { description } : {}),
    ...(instructions ? { instructions } : {}),
    ...(runner ? { runner } : {}),
    ...(cli ? { cli } : {}),
    ...(transport ? { transport } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(typeof input.extensions === "boolean" ? { extensions: input.extensions } : {}),
    ...(typeof input.worktree === "boolean" ? { worktree: input.worktree } : {}),
  };
};

const parseRoleFile = (filePath: string): Record<string, SubagentRoleProfile> => {
  const source = fs.readFileSync(filePath, "utf8");
  const parsed: unknown = filePath.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
  const root = asObject(parsed);
  if (!root) throw new Error(`Subagent role file must contain an object: ${filePath}`);
  const roleObject = asObject(root.roles) ?? root;
  const result: Record<string, SubagentRoleProfile> = {};
  for (const [name, raw] of Object.entries(roleObject)) {
    if (!ROLE_NAME_RE.test(name)) continue;
    const profile = roleProfile(raw);
    if (profile) result[name] = profile;
  }
  return result;
};

const projectRoot = (cwd: string): string => {
  const configured = process.env.PI_FABRIC_PROJECT_ROOT?.trim();
  if (configured) return path.resolve(configured);
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
};

const candidateFiles = (base: string): string[] => [
  path.join(base, "subagents.yaml"),
  path.join(base, "subagents.yml"),
  path.join(base, "subagents.json"),
];

const subagentRoleFiles = (
  cwd: string,
  options: SubagentRoleLoadOptions = {},
): string[] => {
  const globalBase = path.join(os.homedir(), ".pi", "agent", "fabric");
  const projectBase = path.join(projectRoot(cwd), ".pi", "fabric");
  const explicit = process.env.PI_FABRIC_SUBAGENTS_FILE?.trim();
  return [
    ...candidateFiles(globalBase),
    ...(options.projectTrusted === false ? [] : candidateFiles(projectBase)),
    ...(explicit ? [path.resolve(explicit)] : []),
  ];
};

const loadSubagentRoles = (
  cwd: string,
  options: SubagentRoleLoadOptions = {},
): SubagentRoleCatalog => {
  const roles: Record<string, SubagentRoleProfile> = {};
  const sources: string[] = [];
  for (const filePath of subagentRoleFiles(cwd, options)) {
    if (!fs.existsSync(filePath)) continue;
    const loaded = parseRoleFile(filePath);
    for (const [name, profile] of Object.entries(loaded)) {
      roles[name] = { ...(roles[name] ?? {}), ...profile };
    }
    sources.push(filePath);
  }
  return { roles, sources };
};

const profileArgs = (profile: SubagentRoleProfile): Record<string, unknown> => ({
  ...(profile.runner ? { runner: profile.runner } : {}),
  ...(profile.cli ? { cli: profile.cli } : {}),
  ...(profile.transport ? { transport: profile.transport } : {}),
  ...(profile.model ? { model: profile.model } : {}),
  ...(profile.thinking ? { thinking: profile.thinking } : {}),
  ...(profile.tools !== undefined ? { tools: profile.tools } : {}),
  ...(profile.timeoutMs !== undefined ? { timeoutMs: profile.timeoutMs } : {}),
  ...(profile.extensions !== undefined ? { extensions: profile.extensions } : {}),
  ...(profile.worktree !== undefined ? { worktree: profile.worktree } : {}),
});

const roleTask = (role: string, instructions: string, task: unknown): string => [
  `You are running the configured subagent profile "${role}".`,
  "Profile instructions:",
  instructions.trim(),
  "Task:",
  String(task ?? ""),
].join("\n\n");

export const resolveSubagentRole = (
  args: Record<string, unknown>,
  cwd: string,
  options: SubagentRoleLoadOptions = {},
): ResolvedSubagentRole => {
  const catalog = loadSubagentRoles(cwd, options);
  const explicitProfile = nonEmptyString(args.profile);
  const legacyRole = nonEmptyString(args.role);
  const legacyName = nonEmptyString(args.name);
  const role = explicitProfile ?? legacyRole ?? (legacyName && catalog.roles[legacyName] ? legacyName : undefined);
  if (!role) return { args };
  const profile = catalog.roles[role];
  if (!profile) throw new Error(`Unknown subagent profile: ${role}`);
  const merged: Record<string, unknown> = {
    ...profileArgs(profile),
    ...args,
    name: nonEmptyString(args.name) ?? role,
  };
  delete merged.profile;
  delete merged.role;
  if (profile.instructions) merged.task = roleTask(role, profile.instructions, args.task);
  return { role, profile, args: merged };
};

export const describeSubagentRoles = (
  cwd: string,
  options: SubagentRoleLoadOptions = {},
): Record<string, unknown> => {
  const catalog = loadSubagentRoles(cwd, options);
  return {
    profiles: Object.entries(catalog.roles).map(([name, profile]) => ({
      name,
      ...(profile.description ? { description: profile.description } : {}),
      ...(profile.runner ? { runner: profile.runner } : {}),
      ...(profile.cli ? { cli: profile.cli } : {}),
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.thinking ? { thinking: profile.thinking } : {}),
      ...(profile.tools !== undefined ? { tools: profile.tools } : {}),
    })),
    sources: catalog.sources,
  };
};
