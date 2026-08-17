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

const removeBetween = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) throw new Error(`cleanup start anchor not found: ${label}`);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex < 0) throw new Error(`cleanup end anchor not found: ${label}`);
  return source.slice(0, startIndex) + source.slice(endIndex);
};

const findCallEnd = (source, callStart) => {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = callStart; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i++; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i++; continue; }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
    if (paren === 0 && brace === 0 && bracket === 0 && i > callStart) {
      let end = i + 1;
      while (source[end] === ";" || source[end] === "\r" || source[end] === "\n") end++;
      return end;
    }
  }
  throw new Error("unterminated test call");
};

const removeTest = (source, title) => {
  const variants = [`  it(\"${title}\"`, `  test(\"${title}\"`];
  const start = variants.map((needle) => source.indexOf(needle)).find((index) => index >= 0);
  if (start === undefined) throw new Error(`test not found: ${title}`);
  return source.slice(0, start) + source.slice(findCallEnd(source, start));
};

// 1) Shrink the QuickJS guest runtime to the Lean V2 surface.
const quickjsPath = "src/runtime/quickjs-runtime.ts";
let quickjs = await read(quickjsPath);

quickjs = replaceExact(
  quickjs,
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

quickjs = replaceExact(
  quickjs,
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

quickjs = replaceExact(
  quickjs,
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
quickjs = removeBetween(
  quickjs,
  "globalThis.rlm = Object.freeze({",
  "globalThis.console = Object.freeze({",
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
  if (quickjs.includes(forbidden)) throw new Error(`legacy QuickJS surface remains: ${forbidden}`);
}
await write(quickjsPath, quickjs);

// 2) Remove the deferred handoff boundary from ExecutionService + protocol.
const executionPath = "src/execution-service.ts";
let execution = await read(executionPath);
execution = replaceExact(execution, "  handoffRequest?: Record<string, unknown>;\n", "", "execution result handoff");
execution = replaceExact(execution, "    let handoffRequest: Record<string, unknown> | undefined;\n", "", "execution handoff state");
execution = replaceExact(
  execution,
  `      if (
        ref !== "agents.run" &&
        ref !== "agents.handoff" &&
        ref !== "agents.spawn" &&
        ref !== "agents.create"
      ) return;`,
  `      if (ref !== "agents.run" && ref !== "agents.spawn") return;`,
  "agent budget legacy refs",
);
execution = replaceExact(
  execution,
  `        ...(ref === "agents.handoff"
          ? {
              deferHandoff(request: Record<string, unknown>) {
                if (handoffRequest) {
                  throw new Error(
                    "Only one agents.handoff request is allowed per fabric_exec invocation",
                  );
                }
                handoffRequest = structuredClone(request);
                return {
                  scheduled: true,
                  status: "deferred",
                  boundary: "fabric_exec_end",
                };
              },
            }
          : {}),
`,
  "",
  "execution defer handoff hook",
);
execution = replaceExact(execution, "      ...(handoffRequest ? { handoffRequest } : {}),\n", "", "execution handoff return");
if (execution.includes("handoffRequest") || execution.includes("deferHandoff")) {
  throw new Error("ExecutionService handoff compatibility remains");
}
await write(executionPath, execution);

const protocolPath = "src/protocol.ts";
let protocol = await read(protocolPath);
protocol = replaceExact(
  protocol,
  `  /** @internal Legacy ExecutionService test hook pending physical handoff cleanup. */
  deferHandoff?(args: Record<string, unknown>): Record<string, unknown>;
`,
  "",
  "protocol deferHandoff",
);
await write(protocolPath, protocol);

// 3) Drop Full Fabric runtime tests and replace them with a Lean negative-surface contract.
const quickjsTestPath = "tests/quickjs-runtime.test.ts";
let quickjsTest = await read(quickjsTestPath);
for (const title of [
  "routes stable Fabric providers through first-class proxies",
  "exposes durable mesh operations through the host bridge",
  "counts council.run role usage toward budget.spent()",
  "counts rlm.query usage and forces the Pi runner",
  "preempts the council synthesizer when roles exhaust the token budget",
  "gates handoff with a pure predicate over successful call facts",
  "counts successful calls across Pi, extensions, MCP, and computed providers",
  "does not call the host when the handoff predicate returns false",
  "does not count failed mutation calls in handoff facts",
  "rejects asynchronous handoff predicates",
  "keeps immediate boundary scheduling available without a predicate",
  "routes agents.main and Main steering through the agents provider",
  "routes unified participant discovery through the agents provider",
  "routes lifecycle subscriptions through the direct agents API",
  "routes agents.setEvents and agents.setInstructions to the actors provider",
]) quickjsTest = removeTest(quickjsTest, title);

const negativeAnchor = `  it("does not expose Node globals", async () => {`;
const negativeTest = `  it("does not expose removed Full Fabric globals or actor/participant actions", async () => {
    const result = await new QuickJsRuntime().execute(
      \`return {
  memory: typeof memory,
  state: typeof state,
  schema: typeof schema,
  components: typeof components,
  compact: typeof compact,
  mesh: typeof mesh,
  rlm: typeof rlm,
  council: typeof council,
  handoff: typeof agents.handoff,
  create: typeof agents.create,
  main: typeof agents.main,
  members: typeof agents.members,
  subscribe: typeof agents.subscribe,
};\`,
      async () => undefined,
      options,
    );
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      memory: "undefined",
      state: "undefined",
      schema: "undefined",
      components: "undefined",
      compact: "undefined",
      mesh: "undefined",
      rlm: "undefined",
      council: "undefined",
      handoff: "undefined",
      create: "undefined",
      main: "undefined",
      members: "undefined",
      subscribe: "undefined",
    });
  });

`;
if (!quickjsTest.includes(negativeAnchor)) throw new Error("negative QuickJS test anchor not found");
quickjsTest = quickjsTest.replace(negativeAnchor, negativeTest + negativeAnchor);
await write(quickjsTestPath, quickjsTest);

const executionTestPath = "tests/execution-service.test.ts";
let executionTest = await read(executionTestPath);
for (const title of [
  "defers explicit handoff and completes every later call in the same program",
  "applies the same deferred boundary through generic tools.call",
]) executionTest = removeTest(executionTest, title);
executionTest = replaceExact(
  executionTest,
  '    "finishes every nested call in the %s fabric_exec before handoff can be claimed",',
  '    "finishes every nested call in the %s fabric_exec before returning the outer result",',
  "execution test name",
);
executionTest = executionTest.replaceAll("pi-fabric-prewalk-", "pi-fabric-nested-calls-");
executionTest = executionTest.replaceAll('parentToolCallId: "prewalk-complete-program"', 'parentToolCallId: "nested-calls-complete-program"');
await write(executionTestPath, executionTest);

console.log("Lean QuickJS and ExecutionService handoff surfaces removed");
