// Static detection lets Fabric start known orchestration programs with the
// longer agent deadline. The runtime also extends the deadline when a
// blocking agent ref is discovered dynamically through tools.call(), so
// computed and aliased refs cannot fall back to the short executor timeout.
const BLOCKING_ORCHESTRATION_REFS = new Set([
  "agents.run",
  "agents.wait",
]);

export const isBlockingOrchestrationRef = (ref: string): boolean =>
  BLOCKING_ORCHESTRATION_REFS.has(ref);

// Match blocking lean workflow entry points as call sites (a trailing "("),
// and tolerate a single-level generic such as agent<{ items: string[] }>(...).
const ORCHESTRATION_RE =
  /\b(?:workflow\.agent|agents\.(?:run|wait))\s*\(|(?<!\.)\bagent\s*(?:<[^<>]*>)?\s*\(/;

export const codeUsesOrchestration = (code: string): boolean =>
  ORCHESTRATION_RE.test(code);
