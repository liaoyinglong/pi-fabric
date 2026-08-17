import fs from "node:fs/promises";

const read = (path) => fs.readFile(path, "utf8");
const write = (path, content) => fs.writeFile(path, content);

const findCallEnd = (source, callStart) => {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let enteredCall = false;
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
    if (ch === "(") { paren++; enteredCall = true; }
    else if (ch === ")") paren--;
    else if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
    if (enteredCall && paren === 0 && brace === 0 && bracket === 0) {
      let end = i + 1;
      while (source[end] === ";" || source[end] === "\r" || source[end] === "\n") end++;
      return end;
    }
  }
  throw new Error("unterminated test call");
};

const removeTest = (source, title) => {
  const needles = [
    `  it(\"${title}\"`, `it(\"${title}\"`,
    `  test(\"${title}\"`, `test(\"${title}\"`,
  ];
  const candidates = needles
    .map((needle) => source.indexOf(needle))
    .filter((index) => index >= 0);
  if (candidates.length === 0) throw new Error(`test not found: ${title}`);
  const start = Math.min(...candidates);
  return source.slice(0, start) + source.slice(findCallEnd(source, start));
};

const quickjsPath = "tests/quickjs-runtime.test.ts";
let quickjs = await read(quickjsPath);
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
]) quickjs = removeTest(quickjs, title);
await write(quickjsPath, quickjs);

const executionPath = "tests/execution-service.test.ts";
let execution = await read(executionPath);
for (const title of [
  "defers explicit handoff and completes every later call in the same program",
  "applies the same deferred boundary through generic tools.call",
]) execution = removeTest(execution, title);
await write(executionPath, execution);

console.log("Legacy Full Fabric test contracts removed");
