import fs from "node:fs/promises";

const path = "scripts/lean-agent-substrate-cleanup.mjs";
let source = await fs.readFile(path, "utf8");

const replace = (before, after, label) => {
  if (!source.includes(before)) throw new Error(`fix anchor not found: ${label}`);
  source = source.replace(before, after);
};

replace(
  `  "worker actor/mesh arguments",\n  \`        ...(request.runnerSessionId\\n\`,\n);`,
  `  "worker actor/mesh arguments",\n  "",\n);`,
  "manager runnerSessionId join",
);

replace(
  `  "worker option legacy parse",\n  \`  const projectRoot = optional(args, "project-root");\\n\`,\n);`,
  `  "worker option legacy parse",\n  "",\n);`,
  "worker projectRoot declaration join",
);

replace(
  `  "worker option legacy result",\n  \`    ...(projectRoot ? { projectRoot } : {}),\\n    ...(runnerSessionId ? { runnerSessionId } : {}),\\n\`,\n);`,
  `  "worker option legacy result",\n  \`    ...(projectRoot ? { projectRoot } : {}),\\n\`,\n);`,
  "worker runnerSessionId result join",
);

replace(
  `  "worker legacy environment prelude",\n  \`      ...(options.projectRoot ? { PI_FABRIC_PROJECT_ROOT: options.projectRoot } : {}),\\n\`,\n);`,
  `  "worker legacy environment prelude",\n  "",\n);`,
  "worker projectRoot env join",
);

await fs.writeFile(path, source);
console.log("Lean substrate cleanup range joins fixed");
