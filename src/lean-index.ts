import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fabricExtension from "./index.js";
import { installLeanCodeMode } from "./lean-bootstrap.js";

installLeanCodeMode();

const entryDir = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(entryDir, "..", "skills");
const leanSkillPaths = [
  path.join(skillsRoot, "fabric-exec"),
  path.join(skillsRoot, "fabric-subagents"),
  path.join(skillsRoot, "fabric-workflow"),
];

type GenericHandler = (...args: unknown[]) => unknown;
type GenericOn = (event: string, handler: GenericHandler) => () => void;

export const getLeanFabricSkillPaths = (): string[] =>
  leanSkillPaths.filter((skillPath) => existsSync(skillPath));

export default async function leanFabricExtension(pi: ExtensionAPI): Promise<void> {
  // The legacy extension still registers a resources_discover hook that points at
  // the whole historical skills directory. Intercept only that registration so
  // local `-e` development and child Pi processes discover the same three skills
  // that the lean package manifest exposes. All other Pi event registrations are
  // delegated unchanged.
  const mutablePi = pi as unknown as { on: GenericOn };
  const originalOn = mutablePi.on;
  mutablePi.on = (event, handler) => {
    if (event !== "resources_discover") {
      return originalOn.call(pi, event, handler);
    }
    return originalOn.call(pi, event, async () => ({
      skillPaths: getLeanFabricSkillPaths(),
    }));
  };

  try {
    await fabricExtension(pi);
  } finally {
    mutablePi.on = originalOn;
  }
}

export * from "./index.js";
