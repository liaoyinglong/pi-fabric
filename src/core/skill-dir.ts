import { homedir } from "node:os";
import path from "node:path";

const SKILL_DIR_MARKER = "<skill-dir>";

const expandSkillDirMarkers = (
  content: string,
  skillDir: string,
): string => content.replaceAll(SKILL_DIR_MARKER, skillDir);

const resolveReadPath = (requestedPath: string, cwd: string): string => {
  const withoutAtPrefix = requestedPath.startsWith("@")
    ? requestedPath.slice(1)
    : requestedPath;
  const expandedHome = withoutAtPrefix === "~"
    ? homedir()
    : /^~[\\/]/.test(withoutAtPrefix)
      ? path.join(homedir(), withoutAtPrefix.slice(2))
      : withoutAtPrefix;
  return path.resolve(cwd, expandedHome);
};

/** Preserve native Pi read semantics for SKILL.md content loaded through the guest bridge. */
export const expandSkillDirMarkersForRead = (
  content: string,
  args: Record<string, unknown>,
  cwd: string,
): string => {
  if (!content.includes(SKILL_DIR_MARKER) || typeof args.path !== "string") {
    return content;
  }
  const requestedPath = resolveReadPath(args.path, cwd);
  if (path.basename(requestedPath) !== "SKILL.md") return content;
  return expandSkillDirMarkers(content, path.dirname(requestedPath));
};
