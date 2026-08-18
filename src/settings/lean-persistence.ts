import fs from "node:fs";
import path from "node:path";
import {
  fabricConfigPath,
  normalizeFabricConfig,
  type FabricConfig,
  type FabricConfigScope,
  type LoadFabricConfigOptions,
} from "../config.js";
import { writeJsonAtomic } from "../core/atomic-write.js";

export interface LeanSettingsPersistenceOptions extends LoadFabricConfigOptions {
  projectTrusted: boolean;
}

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
