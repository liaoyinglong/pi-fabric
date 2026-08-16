import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export type SubagentRoleRunner = "pi" | "claude" | "veda";
export type SubagentRoleTransport = "auto" | "process" | "tmux" | "screen" | "localterm" | "herdr";
export type SubagentRoleThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SubagentRoleProfile {
  description?: string;
  instructions?: string;
  runner?: SubagentRoleRunner;
  transport?: SubagentRoleTransport;
  model?: string;
  persona?: string;
  thinking?: SubagentRoleThinking;
  tools?: string[];
  timeoutMs?: number;
  extensions?: boolean;
  recursive?: boolean;
  worktree?: boolean;
}

export interface SubagentRoleCatalog {
  roles: Record<string, SubagentRoleProfile>;
  sources: string[];
}

export interface ResolvedSubagentRole {
  role?: string;
  profile?: SubagentRoleProfile;
  args: Record<string, unknown>;
}

const ROLE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const RUNNERS = new Set<SubagentRoleRunner>(["pi", "claude", "veda"]);
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
  const profile: SubagentRoleProfile = {
    ...(nonEmptyString(input.description) ? { description: nonEmptyString(input.description)! } : {}),
    ...(nonEmptyString(input.instructions) ? { instructions: nonEmptyString(input.instructions)! } : {}),
    ...(runner ? { runner } : {}),
    ...(transport ? { transport } : {}),
    ...(nonEmptyString(input.model) ? { model: nonEmptyString(input.model)! } : {}),
    ...(nonEmptyString(input.persona) ? { persona: nonEmptyString(input.persona)! } : {}),
    ...(thinking ? { thinking } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(typeof input.extensions === "boolean" ? { extensions: input.extensions } : {}),
    ...(typeof input.recursive === "boolean" ? { recursive: input.recursive } : {}),
    ...(typeof input.worktree === "boolean" ? { worktree: input.worktree } : {}),
  };
  return profile;
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

export const subagentRoleFiles = (cwd: string): string[] => {
  const globalBase = path.join(os.homedir(), ".pi", "agent", "fabric");
  const projectBase = path.join(projectRoot(cwd), ".pi", "fabric");
  const explicit = process.env.PI_FABRIC_SUBAGENTS_FILE?.trim();
  return [
    ...candidateFiles(globalBase),
    ...candidateFiles(projectBase),
    ...(explicit ? [path.resolve(explicit)] : []),
  ];
};

export const loadSubagentRoles = (cwd: string): SubagentRoleCatalog => {
  const roles: Record<string, SubagentRoleProfile> = {};
  const sources: string[] = [];
  for (const filePath of subagentRoleFiles(cwd)) {
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
  ...(profile.transport ? { transport: profile.transport } : {}),
  ...(profile.model ? { model: profile.model } : {}),
  ...(profile.persona ? { persona: profile.persona } : {}),
  ...(profile.thinking ? { thinking: profile.thinking } : {}),
  ...(profile.tools !== undefined ? { tools: profile.tools } : {}),
  ...(profile.timeoutMs !== undefined ? { timeoutMs: profile.timeoutMs } : {}),
  ...(profile.extensions !== undefined ? { extensions: profile.extensions } : {}),
  ...(profile.recursive !== undefined ? { recursive: profile.recursive } : {}),
  ...(profile.worktree !== undefined ? { worktree: profile.worktree } : {}),
});

const roleTask = (role: string, instructions: string, task: unknown): string => [
  `You are running the configured subagent role "${role}".`,
  "Role instructions:",
  instructions.trim(),
  "Task:",
  String(task ?? ""),
].join("\n\n");

export const resolveSubagentRole = (
  args: Record<string, unknown>,
  cwd: string,
): ResolvedSubagentRole => {
  const catalog = loadSubagentRoles(cwd);
  const explicitRole = nonEmptyString(args.role);
  const legacyName = nonEmptyString(args.name);
  const role = explicitRole ?? (legacyName && catalog.roles[legacyName] ? legacyName : undefined);
  if (!role) return { args };
  const profile = catalog.roles[role];
  if (!profile) throw new Error(`Unknown subagent role: ${role}`);
  const merged: Record<string, unknown> = {
    ...profileArgs(profile),
    ...args,
    name: nonEmptyString(args.name) ?? role,
  };
  delete merged.role;
  if (profile.instructions) merged.task = roleTask(role, profile.instructions, args.task);
  return { role, profile, args: merged };
};

export const describeSubagentRoles = (cwd: string): Record<string, unknown> => {
  const catalog = loadSubagentRoles(cwd);
  return {
    roles: Object.entries(catalog.roles).map(([name, profile]) => ({
      name,
      ...(profile.description ? { description: profile.description } : {}),
      ...(profile.runner ? { runner: profile.runner } : {}),
      ...(profile.model ? { model: profile.model } : {}),
      ...(profile.persona ? { persona: profile.persona } : {}),
      ...(profile.thinking ? { thinking: profile.thinking } : {}),
      ...(profile.tools !== undefined ? { tools: profile.tools } : {}),
    })),
    sources: catalog.sources,
  };
};
