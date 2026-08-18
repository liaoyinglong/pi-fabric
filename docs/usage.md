# Pi Fabric Lean V2 Usage Guide

Lean V2 is a focused Programmatic Tool Calling runtime for Pi with three surfaces:

1. `fabric_exec` for one type-checked TypeScript program that composes many tool calls and built-in coordination helpers.
2. Main-routed one-shot subagents using `fast` / `balance` / `strong` plus explicit capability policies.
3. Thin workflow helpers over the same one-shot runtime.

Todo is a small `fabric_exec` built-in for session-local coordination. Main receives only the `fabric_exec` Pi tool; task tracking stays inside the Code Mode program and does not recreate Fabric State/Mesh.

A small `agents.recurse` primitive supports bounded recursive Pi delegation. Persistent Actor, Mesh, State, Memory, standalone RLM/Council/Swarm, Prewalk, resident-host, trajectory-handoff, and the legacy dashboard/control-plane runtime are not part of Lean V2. `/fabric` is a lightweight view over the retained `AgentManager` only.

## 1. Install

```bash
pi install git:github.com/liaoyinglong/pi-fabric#agent/code-mode-runtime-v2
```

Requirements:

- Node.js 24+
- Pi 0.80.6+

For local development:

```bash
pnpm install
pnpm check
pnpm build
pi -e /absolute/path/to/pi-fabric
```

## 2. Runtime configuration

Global config:

```text
~/.pi/agent/fabric.json
```

Trusted project config:

```text
.pi/fabric.json
```

Explicit host config:

```bash
PI_FABRIC_CONFIG=/absolute/path/to/fabric.json pi
```

A practical starting point:

```json
{
  "executor": { "runtime": "quickjs" },
  "agents": {
    "enabled": true,
    "maxConcurrent": 4,
    "maxDepth": 2,
    "cli": {
      "adapter": "agy",
      "agy": { "binary": "agy" },
      "droid": { "binary": "droid" }
    }
  },
  "capture": {
    "keepVisible": ["fabric_exec"],
    "risks": {
      "fffind": "read",
      "ffgrep": "read"
    }
  }
}
```

See [configuration.md](configuration.md) for every active field and default.

## 3. Code Mode

`fabric_exec` receives one TypeScript function body. Keep related mechanical work inside the program and return only what Main needs.

```ts
const [manifest, files] = await Promise.all([
  pi.read({ path: "package.json" }),
  pi.find({ pattern: "**/*.ts", path: "src" }),
]);

return {
  packageName: JSON.parse(manifest).name,
  sourceFiles: files.split("\n").filter(Boolean).length,
};
```

Use sequential `await` when one result determines the next operation. Use `Promise.all`, `parallel(...)`, or `all({...})` only for independent work.

### TUI

The `fabric_exec` card keeps generated code visible. Its result area also renders the current Todo checklist when the program uses `todo(...)`. `/fabric` opens a lightweight overlay over the current `AgentManager`, showing top-level and recursive workers plus live output.

Focused commands remain available:

```text
/fabric agents
/fabric status <id>
/fabric log <id> [--lines N]
/fabric stop <id>
```

### Built-in todo

For non-trivial multi-step work, call `todo(...)` from inside the `fabric_exec` program:

```ts
await todo([
  { content: "Inspect runtime", status: "completed" },
  {
    content: "Implement guest todo API",
    status: "in_progress",
    activeForm: "Implementing guest todo API",
  },
  { content: "Run verification", status: "pending" },
]);
```

Every call replaces the complete current list. `await todo([])` clears it. The object form is also accepted:

```ts
await todo({
  todos: [{ content: "Run verification", status: "in_progress" }],
});
```

Statuses are `pending`, `in_progress`, and `completed`. `activeForm` is optional and is intended as a short present-progress label for an active item.

Todo stays deliberately bounded:

- maximum 64 items;
- `content`: maximum 200 characters;
- `activeForm`: maximum 120 characters;
- state is in memory only and resets at session start/shutdown;
- no task IDs, priorities, dependencies, persistence, or `/todo` editing commands.

The built-in is for coordination and is not a scratchpad or replacement state system.

## 4. Pi core and captured tools

Use `pi.*` inside Full Code Mode:

```ts
const source = await pi.read({ path: "src/index.ts", offset: 1, limit: 120 });
const matches = await pi.grep({ pattern: "TODO", path: "src", context: 2 });
const test = await pi.bash({ command: "pnpm test", timeout: 120 });
return { source, matches, test: test.output };
```

Additive Pi extension tools hidden from Main remain callable through `extensions.*`. Core overrides remain on core names. With FFF override mode, use `pi.find` / `pi.grep`; do not call `extensions.fffind` / `extensions.ffgrep` for core overrides.

If an exact schema is unknown, use `tools.search` and `tools.describe`.

`capture.keepVisible` applies to captured extension tools. Lean owns `fabric_exec` directly; Todo is a guest built-in within that single model-facing tool.

## 5. MCP

When enabled, known tools use generated namespaces:

```ts
return mcp.context7.resolve_library_id({ libraryName: "react" });
```

For unknown refs, use `tools.search` / `tools.describe` / `tools.call`.

## 6. Main-routed subagents

There is no configured role catalog. Main decides whether to delegate and creates a temporary role for each child.

Every child has two routing dimensions:

```text
tier:    fast | balance | strong
policy:  inspect | execute | modify | isolated
```

### Tier selection

- `fast`: cheap bounded search, evidence gathering, repetitive inspection.
- `balance`: routine reasoning, debugging, implementation, verification.
- `strong`: ambiguous bugs, architecture/high-impact decisions, difficult reasoning, independent review.

Main should use the lowest tier that can reliably complete the bounded task and escalate only when needed.

Built-in defaults:

```text
fast     -> Pi gpt-5.6-luna, medium thinking
balance  -> Pi gpt-5.6-terra, medium thinking
strong   -> Pi gpt-5.6-sol, medium thinking
```

AGY and Droid remain available through CLI runner overrides.

### Capability policy selection

- `inspect`: `read`, `grep`, `find`, `ls` only.
- `execute`: inspect + `bash`, still no edit/write.
- `modify`: read/search + `bash`, `edit`, `write` in the current workspace.
- `isolated`: same mutation tools as `modify`, but in an isolated Git worktree.

Policies are capability boundaries. A role name does not grant permissions.

### A cheap repository scout

```ts
return agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  instructions: "Return only the relevant files, call chain, and uncertainty.",
  task: "Find how reconnect backoff is implemented.",
});
```

### Routine implementation

```ts
return agents.run({
  tier: "balance",
  policy: "modify",
  role: "focused implementer",
  instructions: "Keep the patch minimal and run directly relevant tests.",
  task: "Fix the retry timer leak described by Main.",
});
```

### Independent strong review

```ts
return agents.run({
  tier: "strong",
  policy: "inspect",
  role: "independent reviewer",
  instructions: "Challenge Main's assumptions and report only supported regressions or residual risks.",
  task: "Review the current diff.",
});
```

### Spawn independent work

```ts
const handle = await agents.spawn({
  tier: "fast",
  policy: "inspect",
  role: "upstream researcher",
  task: "Check upstream behavior and return bounded evidence.",
});

const localEvidence = await pi.grep({ pattern: "unsafe", path: "src" });
const research = await agents.wait({ id: handle.id });
return { localEvidence, research };
```

Retained child controls:

```text
agents.wait
agents.status
agents.list
agents.stop
agents.cleanup
agents.steer
agents.followUp
agents.setSteeringMode
agents.setFollowUpMode
agents.compact
```

Pi/Claude workers can be steered between turns. CLI adapters are one-shot and reject steering, follow-ups, recursive Fabric, and Fabric-triggered compaction.

## 7. Routing overrides

No `subagents.yaml` is required. Defaults are built in.

Global override:

```text
~/.pi/agent/fabric/subagents.yaml
```

Trusted project override:

```text
.pi/fabric/subagents.yaml
```

Example:

```yaml
tiers:
  fast:
    runner: pi
    model: cliproxyapi/gpt-5.6-luna
    thinking: medium

  balance:
    runner: pi
    model: cliproxyapi/gpt-5.6-terra
    thinking: medium

  strong:
    runner: pi
    model: cliproxyapi/gpt-5.6-sol
    thinking: medium

policies:
  inspect:
    tools: [read, grep, find, ls]

  execute:
    tools: [read, grep, find, ls, bash]

  modify:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: false

  isolated:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: true
```

Only `tiers:` and `policies:` are routing configuration. `roles:` is not supported; roles are generated dynamically by Main.

Inspect active semantics only when needed:

```ts
return agents.routing({});
```

## 8. Autonomous delegation policy

Main should delegate when at least one is true:

- large reading/search/log work is better isolated from Main context;
- multiple independent tasks can run in parallel;
- a cheaper worker is sufficient for bounded work;
- independent context materially improves verification;
- mutation is safer in an isolated worktree.

Keep simple, tightly coupled work in Main. Parallelize only independent tasks. Never let concurrent mutating children overlap file ownership. Main remains responsible for synthesis, final decisions, and integration.

Children return compact results with tool transcripts omitted. They include evidence or verification when relevant, surface uncertainty, and avoid scope broadening.

## 9. Minimal recursive delegation

Use `agents.recurse` only when one child context is insufficient:

```ts
return agents.recurse({
  tier: "strong",
  policy: "inspect",
  role: "problem decomposer",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering as needed, and return the verified conclusion.",
});
```

All three built-in tiers resolve to `runner: pi`, so `fast`, `balance`, and `strong` can recurse. A tier overridden to a CLI runner remains one-shot.

Recursion remains bounded by `agents.maxDepth`, per-execution agent-call limits, child timeout/token limits, cost budget, and the selected capability policy.

## 10. Thin workflow composition

Workflow does not decide routing for Main. It only makes explicit orchestration less noisy.

```ts
const findings = await parallel(
  ["auth", "routing", "cache"].map((topic) => () =>
    agent(`Inspect ${topic} and return bounded evidence.`, {
      tier: "fast",
      policy: "inspect",
      role: `${topic} repository scout`,
      label: `inspect ${topic}`,
    })
  ),
  { concurrency: 3 },
);

return agent(
  `Verify these findings and remove unsupported claims:\n${JSON.stringify(findings)}`,
  {
    tier: "strong",
    policy: "inspect",
    role: "independent reviewer",
    label: "verify",
  },
);
```

For a few independent workers, plain `Promise.all` is preferred. Use `parallel`, `pipeline`, or phases only when they improve clarity.

## 11. Direct CLI adapters: AGY and Droid

Fabric calls supported headless CLIs directly; there is no Veda intermediary.

Configure executable paths and optional adapter defaults in `fabric.json`:

```json
{
  "agents": {
    "cli": {
      "adapter": "agy",
      "agy": { "binary": "agy" },
      "droid": { "binary": "droid" }
    }
  }
}
```

Override any tier to a CLI in `subagents.yaml` when desired:

```yaml
tiers:
  fast:
    runner: cli
    cli: agy
    thinking: low
```

Droid supports native per-run tool restriction. Antigravity receives the selected policy's portable tool boundary as explicit prompt guidance while its own permission configuration remains authoritative.

## 12. Verification

`pnpm check` is the local release gate: typecheck, distributable build/artifact assertions, full Vitest suite, and dead-code analysis. GitHub Actions runs repository checks where configured.
