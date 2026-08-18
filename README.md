# Pi Fabric Lean V2

A focused Programmatic Tool Calling runtime for Pi.

Lean V2 keeps three product surfaces:

1. **Code Mode (`fabric_exec`)**: one type-checked TypeScript program can call many tools, branch, loop, fan out, aggregate intermediate values, maintain Todo state, and return one bounded result to the model.
2. **Main-routed one-shot subagents**: Main decides whether to delegate, creates a temporary role, and selects `fast` / `balance` / `strong` plus an explicit capability policy.
3. **Thin workflow composition**: ordinary TypeScript plus `agent`, `parallel`, `pipeline`, and phase helpers orchestrate the same one-shot substrate. If plain TypeScript is clearer, use plain TypeScript.

Todo is a deliberately small `fabric_exec` built-in for bounded session-local task tracking. It does not add another model-facing Pi tool and does not recreate Fabric State/Mesh.

A small `agents.recurse({ tier, policy, role, task })` primitive is retained for bounded recursive Pi delegation. It is separate from the removed RLM provider and workflow systems.

Lean V2 physically removes the persistent Fabric product systems outside this scope: Actor, Mesh, State, Schema runtime, Memory, RLM skills/providers, Prewalk, resident hosts, Component supervision, trajectory handoff, the legacy Fabric control plane, and main-session Fabric compaction.

## Runtime shape

```text
Pi Main
  `-- fabric_exec
      |-- todo(...)      session-local task tracking
      |-- pi.*           Pi core tools
      |-- extensions.*   captured Pi extension tools
      |-- mcp.*          MCP tools when enabled
      |-- agents.*       Main-routed tier/policy workers when enabled
      `-- workflow       thin TypeScript orchestration helpers
      |
      v
  bounded result
      |
      v
  Pi Main
```

Mechanical tool orchestration stays inside one runtime execution. Intermediate reads, searches, loops, filtering, and aggregation do not require a model round trip for every tool call.

## Install this branch

```bash
pi install git:github.com/liaoyinglong/pi-fabric#agent/code-mode-runtime-v2
```

For local development:

```bash
pnpm install
pnpm check
pnpm build
pi -e /absolute/path/to/pi-fabric
```

Requires Node.js 24+ and Pi 0.80.6+.

## Start here

- **[Usage Guide](docs/usage.md)**: Code Mode, built-in Todo, autonomous subagent routing, direct AGY/Droid adapters, workflows, recursion, troubleshooting.
- **[Subagents & Workflows Guide](docs/subagents-and-workflows.md)**: Main-owned delegation, tier/policy rules, fan-out, and lifecycle.
- **[Configuration Reference](docs/configuration.md)**: every Lean V2 configuration field plus tier/policy overrides.
- **[Architecture](docs/lean-code-mode.md)**: implementation boundaries and removed systems.

## Code Mode

The model-facing execution gateway for programmatic tool calling is `fabric_exec`. Todo is one of its built-in guest methods, alongside the workflow helpers used inside the TypeScript program.

```ts
const [manifest, sources] = await Promise.all([
  pi.read({ path: "package.json" }),
  pi.find({ pattern: "**/*.ts", path: "src" }),
]);

return {
  package: JSON.parse(manifest).name,
  sourceCount: sources.split("\n").filter(Boolean).length,
};
```

Use sequential `await` when a result determines the next operation. Use `Promise.all(...)`, `parallel(...)`, or `all({...})` only for independent work.

### TUI observability

Lean keeps useful Code Mode visibility without restoring the old control-plane stack:

- generated TypeScript is visible in the `fabric_exec` call card;
- `Ctrl+O` expands the complete program;
- the current Todo checklist is rendered in the same card;
- running nested calls show concise tool/agent headlines;
- `write` and `edit` calls show bounded diff previews;
- `/fabric` shows the current one-shot/recursive worker tree and live output.

## Built-in todo

For non-trivial multi-step work, update the current list from inside `fabric_exec`:

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

Each call replaces the complete current list. Use `await todo([])` to clear it. The list is session-local and resets on session start/shutdown. `content` is capped at 200 characters, `activeForm` at 120 characters, and the list at 64 items so Todo stays bounded coordination state.

Main only receives the `fabric_exec` Pi tool. The Todo backing provider stays inside Code Mode, while the public guest method gives generated TypeScript the small API it needs.

The MVP deliberately has no persistence, task IDs, dependencies, priorities, or `/todo` editing commands.

## Captured Pi extension tools

Additive Pi extension tools remain callable through `extensions.*`:

```ts
const files = await extensions.fffind({ pattern: "auth", path: "src" });
return files;
```

Core overrides remain on the core surface. With FFF override mode, use `pi.find` / `pi.grep` inside `fabric_exec`.

## Main-routed subagents

Main owns delegation. The user does not have to predeclare `research`, `review`, or other roles. Main creates the role needed for the current child call.

Execution tier:

```text
fast     cheap bounded search/evidence/repetitive inspection
balance  routine reasoning/debugging/implementation/verification
strong   ambiguous/high-impact/difficult reasoning/independent review
```

Capability policy:

```text
inspect   read/search only
execute   inspect + bash, no edits
modify    scoped edits in current workspace
isolated  scoped edits in a separate worktree
```

Built-in default routing:

```text
fast     -> Pi gpt-5.6-luna, medium thinking
balance  -> Pi gpt-5.6-terra, medium thinking
strong   -> Pi gpt-5.6-sol, medium thinking
```

AGY and Droid remain available as CLI runner overrides; they are no longer part of the built-in tier mapping.

Example:

```ts
const evidence = await agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  instructions: "Return concrete file references and uncertainty only.",
  task: "Find the files and call chain involved in this bug.",
});

const decision = await agents.run({
  tier: "strong",
  policy: "inspect",
  role: "architecture critic",
  task: `Challenge the likely fix using this evidence:\n${evidence.text}`,
});

return decision.text;
```

Main should prefer the lowest tier that can reliably finish the bounded task and escalate only when evidence or reasoning quality is insufficient.

The public run/spawn surface intentionally excludes raw runner/model/thinking/tool/worktree routing. Those details come from tier and policy configuration.

## Routing configuration

Built-in defaults work with no `subagents.yaml`.

Optional global override:

```text
~/.pi/agent/fabric/subagents.yaml
```

Optional trusted project override:

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

Only `tiers:` and `policies:` are routing configuration. There is no `roles:` / profile compatibility layer.

## Autonomous delegation policy

Main delegates when isolation protects Main context, independent work can run in parallel, a cheaper worker is sufficient, independent verification materially helps, or mutation is safer in a worktree.

Simple tightly-coupled work stays in Main. Parallel workers must be independent; concurrent mutating workers must not overlap file ownership. Main remains responsible for synthesis, final decisions, and integration.

Subagents return compact results with raw transcripts omitted. They include concrete evidence or validation, surface uncertainty, and stay inside the assigned scope.

## Minimal recursive delegation

Use recursion only when one child context is insufficient for the task:

```ts
return agents.recurse({
  tier: "strong",
  policy: "inspect",
  role: "problem decomposer",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering as needed, and return the verified conclusion.",
});
```

All three built-in tiers resolve to the Pi runner. Recursion remains bounded by `agents.maxDepth`, per-execution call limits, child timeouts/tokens, policy capabilities, and the shared cost ledger when configured.

## Thin workflow

Workflow code uses the same tier/policy/temporary-role contract:

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

For a few independent workers, plain `Promise.all` is preferred. Workflow helpers exist only when they make orchestration clearer.

## Direct CLI adapters

The generic `cli` runner invokes supported headless CLIs directly. The first adapters are `agy` (Antigravity) and `droid` (Factory Droid); no Veda intermediary is required.

Tier configuration can override a tier to select a CLI backend. The adapter owns invocation arguments, portable tool mapping, model normalization, and final-result parsing; transport remains independent and can still be `process`, `tmux`, `screen`, `localterm`, or `herdr`.

CLI adapters are one-shot in V1: no recursive Fabric, steer/follow-up, or Fabric-triggered compaction.

## Verification

`pnpm check` is the release gate: typecheck, distributable build/artifact assertions, full Vitest suite, and dead-code analysis.

## Package surface

The package registers only one Lean model-facing tool:

```text
fabric_exec
```

The package also ships:

```text
dist/lean-index.js
skills/fabric-exec
skills/fabric-subagents
skills/fabric-workflow
```

User documentation packed with the package:

```text
docs/usage.md
docs/configuration.md
docs/lean-code-mode.md
docs/subagents-and-workflows.md
```
