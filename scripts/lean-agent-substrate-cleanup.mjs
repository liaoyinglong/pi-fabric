import fs from "node:fs/promises";

const read = (path) => fs.readFile(path, "utf8");
const write = (path, content) => fs.writeFile(path, content);
const replaceExact = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`cleanup anchor not found: ${label}`);
  return source.replace(before, after);
};
const removeBetween = (source, start, end, label, replacement = "") => {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`cleanup start anchor not found: ${label}`);
  const b = source.indexOf(end, a);
  if (b < 0) throw new Error(`cleanup end anchor not found: ${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
};
const removeTest = (source, title) => {
  const needles = [`  it(\"${title}\"`, `it(\"${title}\"`, `  test(\"${title}\"`, `test(\"${title}\"`];
  const starts = needles.map((x) => source.indexOf(x)).filter((x) => x >= 0);
  if (starts.length === 0) throw new Error(`test not found: ${title}`);
  const start = Math.min(...starts);
  let paren = 0, brace = 0, bracket = 0;
  let quote = null, escaped = false, lineComment = false, blockComment = false, entered = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i++; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i++; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(") { paren++; entered = true; }
    else if (ch === ")") paren--;
    else if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
    if (entered && paren === 0 && brace === 0 && bracket === 0) {
      let end = i + 1;
      while (source[end] === ";" || source[end] === "\r" || source[end] === "\n") end++;
      return source.slice(0, start) + source.slice(end);
    }
  }
  throw new Error(`unterminated test: ${title}`);
};

// Agent public/internal data types: keep one-shot/session/runtime fields only.
const typesPath = "src/agents/types.ts";
let types = await read(typesPath);
types = types.replace(`import type {\n  SessionEntry,\n  SessionMessageEntry,\n} from "@earendil-works/pi-coding-agent";\n`, "");
types = types.replace(`import type { ThinkingTransferInput } from "./thinking-transfer.js";\n`, "");
types = types.replace(`export type FabricParticipantResidency = "session" | "durable";\n\n`, "");
types = types.replace(/export type AgentToolResultMessage = Extract<[\s\S]*?\n>;\n\n/, "");
types = types.replace(/\/\*\* Legacy trajectory seed retained for child-worker compatibility\. \*\/[\s\S]*?export interface AgentSessionSeed \{[\s\S]*?\n\}\n\n/, "");
const legacyTypeField = /^\s{2}(?:residency|actorId|actorName|capabilityRequirements|capabilityDigest|meshRoot|ownerHostId|ownerIdentityId|sessionSeed|thinkingTransfer|handoffCompact)\??:/;
types = types.split("\n").filter((line) => !legacyTypeField.test(line)).join("\n");
await write(typesPath, types);

// AgentManager: remove trajectory seed, actor identity, durable residency and mesh ownership plumbing.
const managerPath = "src/agents/manager.ts";
let manager = await read(managerPath);
manager = manager.replace(`import { writeHandoffSession } from "./handoff.js";\n`, "");
for (const line of [
  `  residency: "session" | "durable";\n`,
  `  actorId?: string;\n`,
  `  actorName?: string;\n`,
  `  capabilityRequirements?: string[];\n`,
  `  capabilityDigest?: string;\n`,
  `  readonly #meshRoot: string | undefined;\n`,
  `  readonly #hostId: string | undefined;\n`,
  `  readonly #identityId: string | undefined;\n`,
  `      meshRoot?: string;\n`,
  `      hostId?: string;\n`,
  `      identityId?: string;\n`,
  `    this.#meshRoot = options.meshRoot ?? process.env.PI_FABRIC_MESH_ROOT;\n`,
  `    this.#hostId = options.hostId ?? process.env.PI_FABRIC_HOST_ID;\n`,
  `    this.#identityId = options.identityId ?? process.env.PI_FABRIC_IDENTITY_ID;\n`,
  `        residency,\n`,
]) manager = manager.replaceAll(line, "");
manager = manager.replaceAll(`    ...(managed.residency === "durable" ? { residency: "durable" as const } : {}),\n`, "");
manager = manager.replaceAll(`    ...(managed.actorId ? { actorId: managed.actorId } : {}),\n`, "");
manager = manager.replaceAll(`    ...(managed.actorName ? { actorName: managed.actorName } : {}),\n`, "");
manager = manager.replaceAll(`      ...(managed.residency === "durable" ? { residency: "durable" as const } : {}),\n`, "");
manager = manager.replaceAll(`      ...(managed.actorId ? { actorId: managed.actorId } : {}),\n`, "");
manager = manager.replaceAll(`      ...(managed.actorName ? { actorName: managed.actorName } : {}),\n`, "");
manager = manager.replace(/\s*\.\.\.\(managed\.capabilityRequirements[\s\S]*?: \{\}\),\n/g, "\n");
manager = manager.replaceAll(`    ...(managed.capabilityDigest ? { capabilityDigest: managed.capabilityDigest } : {}),\n`, "");
manager = manager.replaceAll(`      ...(managed.capabilityDigest ? { capabilityDigest: managed.capabilityDigest } : {}),\n`, "");
manager = replaceExact(
  manager,
  `    const residency = request.residency ?? "session";\n    if (residency !== "session" && residency !== "durable") {\n      throw new Error(\`Invalid Fabric agent residency: \${String(request.residency)}\`);\n    }\n`,
  "",
  "residency validation",
);
manager = replaceExact(
  manager,
  `    if (request.sessionSeed && runner !== "pi") {\n      throw new Error("Trajectory handoff sessions are only supported by the Pi runner");\n    }\n    if (request.sessionSeed && request.sessionFile) {\n      throw new Error("A agent request cannot combine sessionSeed with sessionFile");\n    }\n`,
  "",
  "trajectory seed validation",
);
manager = removeBetween(
  manager,
  `      const sessionFile = request.sessionSeed\n`,
  `      const adapter = await this.#resolveTransport`,
  "handoff session creation",
  `      const sessionFile = request.sessionFile;\n`,
);
manager = removeBetween(
  manager,
  `        ...(request.actorId ? ["--actor-id", request.actorId] : []),\n`,
  `        ...(request.runnerSessionId\n`,
  "worker actor/mesh arguments",
  "",
);
manager = manager.replaceAll(`        ...(request.actorId ? { actorId: request.actorId } : {}),\n`, "");
manager = manager.replaceAll(`        ...(request.actorName ? { actorName: request.actorName } : {}),\n`, "");
manager = manager.replace(/\s*\.\.\.\(request\.capabilityRequirements[\s\S]*?: \{\}\),\n/g, "\n");
manager = manager.replaceAll(`        ...(request.capabilityDigest ? { capabilityDigest: request.capabilityDigest } : {}),\n`, "");
manager = manager.replaceAll(`      if (!managed.settled || managed.actorId) return false;`, `      if (!managed.settled) return false;`);
manager = manager.replaceAll(`      ...(managed.actorId ? { actorId: managed.actorId } : {}),\n`, "");
manager = manager.replaceAll(`      ...(managed.actorName ? { actorName: managed.actorName } : {}),\n`, "");
manager = replaceExact(
  manager,
  `        source: {\n          id: managed.actorId ?? managed.id,\n          name: managed.actorName ?? managed.name,\n          kind: managed.actorId ? "actor" : "agent",\n          rootId: this.#mainAgentId ?? managed.id,\n          runner: managed.runner,\n          ...(this.#hostId ? { ownerHostId: this.#hostId } : {}),\n          ...(this.#identityId ? { ownerIdentityId: this.#identityId } : {}),\n        },`,
  `        source: {\n          id: managed.id,\n          name: managed.name,\n          kind: "agent",\n          rootId: this.#mainAgentId ?? managed.id,\n          runner: managed.runner,\n        },`,
  "lifecycle actor identity",
);
await write(managerPath, manager);

// Worker argv and environment no longer carry actor/mesh identity or capability digests.
const optionsPath = "src/worker/options.ts";
let workerOptions = await read(optionsPath);
workerOptions = removeBetween(
  workerOptions,
  `  const actorId = optional(args, "actor-id");\n`,
  `  const projectRoot = optional(args, "project-root");\n`,
  "worker option legacy parse",
  "",
);
workerOptions = workerOptions.replace(`  const ownerHostId = optional(args, "owner-host-id");\n`, "");
workerOptions = workerOptions.replace(`  const ownerIdentityId = optional(args, "owner-identity-id");\n`, "");
workerOptions = removeBetween(
  workerOptions,
  `    ...(actorId ? { actorId } : {}),\n`,
  `    ...(runnerSessionId ? { runnerSessionId } : {}),\n`,
  "worker option legacy result",
  `    ...(projectRoot ? { projectRoot } : {}),\n`,
);
await write(optionsPath, workerOptions);

const workerPath = "src/worker.ts";
let worker = await read(workerPath);
worker = removeBetween(
  worker,
  `      ...(options.actorId ? { PI_FABRIC_ACTOR_ID: options.actorId } : {}),\n`,
  `      ...(options.projectRoot ? { PI_FABRIC_PROJECT_ROOT: options.projectRoot } : {}),\n`,
  "worker legacy environment prelude",
  "",
);
worker = worker.replace(`      ...(options.ownerHostId ? { PI_FABRIC_OWNER_HOST_ID: options.ownerHostId } : {}),\n`, "");
worker = worker.replace(`      ...(options.ownerIdentityId\n        ? { PI_FABRIC_OWNER_IDENTITY_ID: options.ownerIdentityId }\n        : {}),\n`, "");
worker = worker.replace(`      ...(options.actorId ? { actorId: options.actorId } : {}),\n`, "");
worker = worker.replace(`      ...(options.actorName ? { actorName: options.actorName } : {}),\n`, "");
await write(workerPath, worker);

const runRecordPath = "src/worker/run-record.ts";
let runRecord = await read(runRecordPath);
runRecord = runRecord.replace(`  ...(options.actorId ? { actorId: options.actorId } : {}),\n`, "");
runRecord = runRecord.replace(`  ...(options.actorName ? { actorName: options.actorName } : {}),\n`, "");
runRecord = runRecord.replace(/\s*\.\.\.\(options\.capabilityRequirements[\s\S]*?: \{\}\),\n/g, "\n");
runRecord = runRecord.replace(`  ...(options.capabilityDigest ? { capabilityDigest: options.capabilityDigest } : {}),\n`, "");
await write(runRecordPath, runRecord);

// Retention is one-shot only; actor archive retention is no longer a V2 concept.
const retentionPath = "src/storage/retention.ts";
let retention = await read(retentionPath);
retention = retention.replace(`  actorId?: string;\n`, "");
retention = retention.replace(
  `    const retentionMs = record.actorId\n      ? orphanedTempRunRetentionMs\n      : oneShotRunRetentionMs;\n`,
  `    const retentionMs = oneShotRunRetentionMs;\n`,
);
retention = retention.replace(
  `  orphanedTempRunRetentionMs: number,\n  oneShotRunRetentionMs: number,\n`,
  `  oneShotRunRetentionMs: number,\n`,
);
retention = retention.replace(
  `          options.orphanedTempRunRetentionMs,\n          options.oneShotRunRetentionMs,\n`,
  `          options.oneShotRunRetentionMs,\n`,
);
const actorArchiveStart = retention.indexOf(`export const pruneActorRunArchives = (`);
if (actorArchiveStart >= 0) retention = retention.slice(0, actorArchiveStart).trimEnd() + "\n";
await write(retentionPath, retention);

const configPath = "src/config.ts";
let config = await read(configPath);
config = config.replace(`  actorRunArchiveMs: number;\n`, "");
config = config.replace(`    actorRunArchiveMs: 7 * 24 * 60 * 60 * 1_000,\n`, "");
config = config.replace(`      actorRunArchiveMs: numberValue(retention.actorRunArchiveMs, DEFAULT_FABRIC_CONFIG.retention.actorRunArchiveMs, 0),\n`, "");
await write(configPath, config);

// Tests/files that only validate trajectory handoff or actor archive behavior are obsolete.
await fs.rm("src/agents/handoff.ts", { force: true });
await fs.rm("src/agents/thinking-transfer.ts", { force: true });
await fs.rm("tests/thinking-transfer.test.ts", { force: true });

const retentionTestPath = "tests/retention.test.ts";
let retentionTest = await read(retentionTestPath);
retentionTest = retentionTest.replace(`  pruneActorRunArchives,\n`, "");
retentionTest = retentionTest.replace(`    const actorTemp = path.join(runRoot, "actor-temp");\n`, "");
retentionTest = retentionTest.replace(`    writeStatus(actorTemp, { status: "failed", actorId: "actor-1", finishedAt: DAY });\n`, "");
retentionTest = retentionTest.replace(`    expect(result.removedRuns.sort()).toEqual([actorTemp, expired].sort());\n`, `    expect(result.removedRuns).toEqual([expired]);\n`);
retentionTest = retentionTest.replace(`    expect(fs.existsSync(actorTemp)).toBe(false);\n`, "");
retentionTest = removeTest(retentionTest, "expires actor archives after seven days while preserving the latest run");
await write(retentionTestPath, retentionTest);

const forbidden = [
  "actorId", "actorName", "capabilityRequirements", "capabilityDigest", "meshRoot",
  "ownerHostId", "ownerIdentityId", "sessionSeed", "handoffCompact", "thinkingTransfer",
  "FabricParticipantResidency", "pruneActorRunArchives", "actorRunArchiveMs",
];
for (const path of [typesPath, managerPath, optionsPath, workerPath, runRecordPath, retentionPath, configPath]) {
  const source = await read(path);
  for (const term of forbidden) {
    if (source.includes(term)) throw new Error(`legacy agent substrate remains in ${path}: ${term}`);
  }
}
console.log("Lean agent substrate actor/mesh/handoff compatibility removed");
