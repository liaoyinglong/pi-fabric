import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  fabricConfigPath,
  normalizeFabricConfig,
  type FabricConfig,
  type FabricConfigScope,
  type LoadFabricConfigOptions,
} from "../config.js";
import { writeFileAtomic, writeJsonAtomic } from "../core/atomic-write.js";
import type { FabricThinking } from "../thinking.js";

export interface LeanSettingsPersistenceOptions extends LoadFabricConfigOptions {
  projectTrusted: boolean;
}

export interface EditableSubagentProfile {
  description?: string;
  instructions?: string;
  runner?: "pi" | "claude" | "cli";
  cli?: "agy" | "droid";
  transport?: "auto" | "process" | "tmux" | "screen" | "localterm" | "herdr";
  model?: string;
  thinking?: FabricThinking;
  tools?: string[];
  timeoutMs?: number;
  extensions?: boolean;
  worktree?: boolean;
}

export interface EditableSubagentCatalog {
  profiles: Record<string, EditableSubagentProfile>;
  sources: string[];
  explicitOverride: string | undefined;
}

const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonObject = (filePath: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isObject(parsed)) throw new Error("configuration root must be an object");
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw new Error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isObject(current) && isObject(value)
      ? deepMerge(current, value)
      : structuredClone(value);
  }
  return result;
};

export const loadLeanConfigForScope = (
  scope: FabricConfigScope,
  options: LeanSettingsPersistenceOptions,
): FabricConfig => {
  if (scope === "project" && !options.projectTrusted) {
    throw new Error("Project Fabric settings are unavailable for an untrusted project");
  }
  const global = readJsonObject(fabricConfigPath("global", options));
  const raw = scope === "global"
    ? global
    : deepMerge(global, readJsonObject(fabricConfigPath("project", options)));
  return normalizeFabricConfig(raw);
};

export const saveLeanConfigPartial = (
  scope: FabricConfigScope,
  options: LeanSettingsPersistenceOptions,
  partial: Record<string, unknown>,
): string => {
  if (scope === "project" && !options.projectTrusted) {
    throw new Error("Cannot save project Fabric settings for an untrusted project");
  }
  const target = fabricConfigPath(scope, options);
  const current = readJsonObject(target);
  const next = deepMerge(current, partial);
  normalizeFabricConfig(next);
  writeJsonAtomic(target, next, { space: 2, newline: true });
  return target;
};

export const explicitFabricConfigOverride = (): string | undefined => {
  const value = process.env.PI_FABRIC_CONFIG?.trim();
  return value ? path.resolve(value) : undefined;
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

const profileBase = (
  scope: FabricConfigScope,
  options: LeanSettingsPersistenceOptions,
): string => scope === "global"
  ? path.join(options.agentDir, "fabric")
  : path.join(projectRoot(options.cwd), ".pi", "fabric");

const profileCandidates = (base: string): string[] => [
  path.join(base, "subagents.yaml"),
  path.join(base, "subagents.yml"),
  path.join(base, "subagents.json"),
];

const parseProfileFile = (filePath: string): Record<string, EditableSubagentProfile> => {
  const source = fs.readFileSync(filePath, "utf8");
  const parsed: unknown = filePath.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
  if (!isObject(parsed)) throw new Error(`Subagent profile file must contain an object: ${filePath}`);
  const roles = isObject(parsed.roles) ? parsed.roles : parsed;
  const result: Record<string, EditableSubagentProfile> = {};
  for (const [name, value] of Object.entries(roles)) {
    if (!PROFILE_NAME_RE.test(name) || !isObject(value)) continue;
    result[name] = structuredClone(value) as EditableSubagentProfile;
  }
  return result;
};

const existingProfileFile = (base: string): string | undefined =>
  profileCandidates(base).find((candidate) => fs.existsSync(candidate));

export const profileFilePath = (
  scope: FabricConfigScope,
  options: LeanSettingsPersistenceOptions,
): string => existingProfileFile(profileBase(scope, options)) ?? path.join(profileBase(scope, options), "subagents.yaml");

export const loadEditableSubagentCatalog = (
  scope: FabricConfigScope,
  options: LeanSettingsPersistenceOptions,
): EditableSubagentCatalog => {
  if (scope === "project" && !options.projectTrusted) {
    throw new Error("Project subagent profiles are unavailable for an untrusted project");
  }
  const profiles: Record<string, EditableSubagentProfile> = {};
  const sources: string[] = [];
  const mergeFile = (filePath: string | undefined): void => {
    if (!filePath || !fs.existsSync(filePath)) return;
    const loaded = parseProfileFile(filePath);
    for (const [name, profile] of Object.entries(loaded)) {
      profiles[name] = { ...(profiles[name] ?? {}), ...profile };
    }
    sources.push(filePath);
  };
  mergeFile(existingProfileFile(profileBase("global", options)));
  if (scope === "project") mergeFile(existingProfileFile(profileBase("project", options)));
  const explicit = process.env.PI_FABRIC_SUBAGENTS_FILE?.trim();
  const explicitPath = explicit ? path.resolve(explicit) : undefined;
  return { profiles, sources, explicitOverride: explicitPath };
};

export const saveEditableSubagentProfile = (
  scope: FabricConfigScope,
  options: LeanSettingsPersistenceOptions,
  name: string,
  profile: EditableSubagentProfile,
): string => {
  if (!PROFILE_NAME_RE.test(name)) throw new Error(`Invalid subagent profile name: ${name}`);
  if (scope === "project" && !options.projectTrusted) {
    throw new Error("Cannot save project subagent profiles for an untrusted project");
  }
  const target = profileFilePath(scope, options);
  let root: Record<string, unknown> = {};
  if (fs.existsSync(target)) {
    const source = fs.readFileSync(target, "utf8");
    const parsed: unknown = target.endsWith(".json") ? JSON.parse(source) : parseYaml(source);
    if (!isObject(parsed)) throw new Error(`Subagent profile file must contain an object: ${target}`);
    root = parsed;
  }
  if (isObject(root.roles)) {
    root.roles[name] = structuredClone(profile);
  } else if (Object.keys(root).length === 0) {
    root.roles = { [name]: structuredClone(profile) };
  } else {
    root[name] = structuredClone(profile);
  }
  if (target.endsWith(".json")) {
    writeJsonAtomic(target, root, { space: 2, newline: true });
  } else {
    const serialized = stringifyYaml(root, { lineWidth: 100 });
    writeFileAtomic(target, serialized.endsWith("\n") ? serialized : `${serialized}\n`);
  }
  return target;
};
