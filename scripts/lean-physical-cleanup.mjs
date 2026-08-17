import fs from "node:fs/promises";

const read = (path) => fs.readFile(path, "utf8");
const write = (path, content) => fs.writeFile(path, content);

const replaceExact = (source, before, after, label) => {
  if (!source.includes(before)) {
    throw new Error(`cleanup anchor not found: ${label}`);
  }
  const next = source.replace(before, after);
  if (next.includes(before)) {
    throw new Error(`cleanup anchor remained after replacement: ${label}`);
  }
  return next;
};

const path = "src/runtime/quickjs-runtime.ts";
let source = await read(path);

source = replaceExact(
  source,
  `const __successfulCalls = [];
const __resolvedCallRef = (ref, args) =>
  ref === "fabric.$call" && args && typeof args.ref === "string" ? args.ref : ref;
const __recordSuccessfulCall = (ref, args) => {
  __successfulCalls.push(Object.freeze({ ref: __resolvedCallRef(ref, args) }));
};
const __handoffFacts = () => {
  const calls = Object.freeze(__successfulCalls.slice());
  const count = (ref) => {
    if (ref === undefined) return calls.length;
    const refs = new Set(Array.isArray(ref) ? ref : [ref]);
    return calls.reduce((total, call) => total + (refs.has(call.ref) ? 1 : 0), 0);
  };
  return Object.freeze({ calls, count });
};
const __call = async (ref, args) => {
  const normalizedArgs = args ?? {};
  const value = await __fabricBridge(ref, normalizedArgs);
  __recordSuccessfulCall(ref, normalizedArgs);
  return value;
};`,
  `const __call = async (ref, args) => {
  const normalizedArgs = args ?? {};
  return __fabricBridge(ref, normalizedArgs);
};`,
  "handoff call tracking",
);

source = replaceExact(
  source,
  `globalThis.extensions = __providerProxy("extensions");
globalThis.memory = __providerProxy("memory");
globalThis.state = __providerProxy("state");
globalThis.schema = __providerProxy("schema");
globalThis.components = __providerProxy("components");
globalThis.compact = __providerProxy("compact");
const __createActor = async (args = {}) => {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("agents.create expects an options object");
  }
  const request = { ...args };
  const validWhile = request.validWhile;
  if (validWhile !== undefined) {
    if (typeof validWhile !== "function") {
      throw new TypeError("agents.create validWhile must be a pure predicate function");
    }
    const source = Function.prototype.toString.call(validWhile);
    if (source.trimStart().startsWith("async")) {
      throw new TypeError("agents.create validWhile must be synchronous");
    }
    request.validWhile = { version: 1, source };
  }
  return __call("agents.create", request);
};
const __handoff = async (args = {}) => {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("agents.handoff expects an options object");
  }
  const request = { ...args };
  const when = request.when;
  delete request.when;
  if (when !== undefined) {
    if (typeof when !== "function") {
      throw new TypeError("agents.handoff when must be a pure predicate function");
    }
    const decision = when(__handoffFacts());
    if (decision && typeof decision.then === "function") {
      throw new TypeError("agents.handoff when must return a boolean synchronously");
    }
    if (decision !== true) {
      throw new Error("agents.handoff predicate returned false; no agent was started");
    }
  }
  return __call("agents.handoff", request);
};
globalThis.agents = Object.freeze({
  run: (args) => __call("agents.run", args),
  handoff: __handoff,
  spawn: (args) => __call("agents.spawn", args),
  wait: (args) => __call("agents.wait", args),
  status: (args) => __call("agents.status", args),
  list: (args = {}) => __call("agents.list", args),
  members: (args = {}) => __call("agents.members", args),
  self: () => __call("agents.self", {}),
  main: () => __call("agents.main", {}),
  peers: () => __call("agents.peers", {}),
  subscribe: (args) => __call("agents.subscribe", args),
  subscriptions: (args = {}) => __call("agents.subscriptions", args),
  unsubscribe: (args) => __call("agents.unsubscribe", args),
  models: (args = {}) => __call("agents.models", args),
  stop: (args) => __call("agents.stop", args),
  cleanup: (args) => __call("agents.cleanup", args),
  create: __createActor,
  ask: (args) => __call("agents.ask", args),
  tell: (args) => __call("agents.tell", args),
  steer: (args) => __call("agents.steer", args),
  followUp: (args) => __call("agents.followUp", args),
  setSteeringMode: (args) => __call("agents.setSteeringMode", args),
  setFollowUpMode: (args) => __call("agents.setFollowUpMode", args),
  actorStatus: (args) => __call("agents.actorStatus", args),
  setModel: (args) => __call("agents.setModel", args),
  setThinking: (args) => __call("agents.setThinking", args),
  setEvents: (args) => __call("agents.setEvents", args),
  setInstructions: (args) => __call("agents.setInstructions", args),
  actors: () => __call("agents.actors", {}),
  messages: (args) => __call("agents.messages", args),
  remove: (args) => __call("agents.remove", args),
  log: (args) => __call("agents.log", args),
});
globalThis.mesh = Object.freeze({
  self: () => __call("mesh.self", {}),
  publish: (args) => __call("mesh.publish", args),
  read: (args = {}) => __call("mesh.read", args),
  members: (args = {}) => __call("mesh.members", args),
  get: (args) => __call("mesh.get", args),
  list: (args = {}) => __call("mesh.list", args),
  put: (args) => __call("mesh.put", args),
  delete: (args) => __call("mesh.delete", args),
});`,
  `globalThis.extensions = __providerProxy("extensions");
globalThis.agents = Object.freeze({
  run: (args) => __call("agents.run", args),
  spawn: (args) => __call("agents.spawn", args),
  wait: (args) => __call("agents.wait", args),
  status: (args) => __call("agents.status", args),
  list: (args = {}) => __call("agents.list", args),
  roles: (args = {}) => __call("agents.roles", args),
  models: (args = {}) => __call("agents.models", args),
  stop: (args) => __call("agents.stop", args),
  cleanup: (args) => __call("agents.cleanup", args),
  steer: (args) => __call("agents.steer", args),
  followUp: (args) => __call("agents.followUp", args),
  setSteeringMode: (args) => __call("agents.setSteeringMode", args),
  setFollowUpMode: (args) => __call("agents.setFollowUpMode", args),
  compact: (args) => __call("agents.compact", args),
});`,
  "legacy providers and agent actions",
);

source = replaceExact(
  source,
  `// Budget-aware agents.run used by council.run and rlm.query so their usage is
// counted in budget.spent() and the tokenBudget guard can preempt them, just
// like workflow.agent(). Without this, councils bypass the budget entirely.
const __budgetedRun = async (args) => {
  if (__workflowSpentTokens >= __workflowBudgetTotal) {
    throw new Error("Fabric workflow token budget exhausted");
  }
  return __recordAgentUsage(await agents.run(args));
};
`,
  "",
  "council/rlm budget helper",
);

source = replaceExact(
  source,
  `globalThis.rlm = Object.freeze({
  query: (args) => {
    if (args && args.runner && args.runner !== "pi") {
      throw new Error("rlm.query requires the Pi runner because recursive Fabric is unavailable in Claude Code");
    }
    return __budgetedRun({ ...args, runner: "pi", recursive: true });
  },
});
globalThis.council = Object.freeze({
  async run(args) {
    const { task, roles, synthesize = true, ...agentOptions } = args;
    const results = await Promise.all(roles.map((role) => __budgetedRun({
      ...agentOptions,
      name: role,
      task: "Act as the " + role + " council member. Independently analyze this task:\\n\\n" + task,
    })));
    if (!synthesize) return results;
    return __budgetedRun({
      ...agentOptions,
      name: "council-synthesizer",
      task: "Synthesize the council's independent reports into one decision. Preserve disagreements and cite which role raised each concern.\\n\\nTask:\\n" + task + "\\n\\nReports:\\n" + JSON.stringify(results),
    });
  },
});
`,
  "",
  "rlm/council globals",
);

for (const forbidden of [
  "globalThis.memory =",
  "globalThis.state =",
  "globalThis.schema =",
  "globalThis.components =",
  "globalThis.compact =",
  "globalThis.mesh =",
  "globalThis.rlm =",
  "globalThis.council =",
  "agents.handoff",
  "agents.create",
  "agents.actorStatus",
]) {
  if (source.includes(forbidden)) {
    throw new Error(`legacy QuickJS surface remains: ${forbidden}`);
  }
}

await write(path, source);
console.log("Lean QuickJS legacy globals removed");
