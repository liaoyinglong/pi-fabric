# Pi Fabric Lean V2

A focused Programmatic Tool Calling runtime for Pi.

Lean V2 keeps three product surfaces:

1. **Code Mode (`fabric_exec`)**: one type-checked TypeScript program can call many tools, branch, loop, fan out, aggregate intermediate values, and return one bounded result to the model.
2. **Profile-based one-shot subagents**: semantic profiles such as `research`, `explore`, `deep`, and `review` keep runner/model/thinking/tool policy in configuration and keep those choices out of call sites.
3. **Thin workflow composition**: ordinary TypeScript plus `agent`, `parallel`, `pipeline`, and phase helpers orchestrate the same one-shot substrate. If plain TypeScript is clearer, use plain TypeScript.

A small `agents.recurse({ profile, task })` primitive is retained for bounded recursive Pi delegation. It is a primitive separate from the removed RLM provider and workflow systems.

Lean V2 physically removes the persistent Fabric product systems outside this scope: Actor, Mesh, State, Schema runtime, Memory, RLM skills/providers, Prewalk, resident hosts, Component supervision, trajectory handoff, the Fabric dashboard, and main-session Fabric compaction.

## Runtime shape

```text
Pi Main
  |
  v
fabric_exec
  |-- pi.*          Pi core tools
  |-- extensions.*  captured Pi extension tools
  |-- mcp.*         MCP tools when enabled
  |-- agents.*      profile-based one-shot workers when enabled
  `-- workflow      thin TypeScript orchestration helpers
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

- **[Usage Guide](docs/usage.md)**: installation, Code Mode, FFF/captured tools, MCP, profiles, direct AGY/Droid CLI adapters, workflow, recursion, troubleshooting.
- **[Subagents & Workflows Guide](docs/subagents-and-workflows.md)**: chat triggering, automatic model delegation, workflow fan-out, and execution lifecycle.
- **[Configuration Reference](docs/configuration.md)**: every Lean V2 configuration field and default.
- **[Architecture](docs/lean-code-mode.md)**: implementation boundaries and removed systems.

## Code Mode

The model-facing execution gateway is `fabric_exec`.

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

Lean keeps the useful original Code Mode visibility without restoring the old dashboard stack:

- generated TypeScript is always visible in the `fabric_exec` call card;
- collapsed cards show the first 8 lines; `Ctrl+O` expands the complete program;
- running nested calls show concise tool headlines such as `pi.find`, `pi.bash`, and captured/MCP refs;
- `write` and `edit` calls show a bounded diff preview;
- a successful program with no returned value shows only the completion/activity summary and does not create a synthetic `(no output)` result.

## Captured Pi extension tools

The original Fabric capture layer is retained because it solves a core Code Mode problem: invoking executable Pi extension tools while preserving Pi's registered-tool lifecycle.

Additive extension tools remain callable through `extensions.*`:

```ts
const files = await extensions.fffind({ pattern: "auth", path: "src" });
return files;
```

Core overrides remain on the core surface. With FFF override mode, use:

```ts
const files = await pi.find({ pattern: "auth", path: "src" });
const hits = await pi.grep({ pattern: "refreshToken", path: "src" });
return { files, hits };
```

Captured tools remain registered in Pi so permission, audit, and lifecycle extensions can still observe them. Full Code Mode hides captured tools from the main model unless listed in `capture.keepVisible`.

## Semantic subagent profiles

Profile definitions remain under `roles:` in configuration files for compatibility. Runtime selection uses the explicit `profile` field.

Global profiles:

```text
~/.pi/agent/fabric/subagents.yaml
```

Trusted project profiles:

```text
.pi/fabric/subagents.yaml
```

Example:

```yaml
roles:
  research:
    description: Cheap bounded research
    runner: cli
    cli: agy
    thinking: low
    tools: [read, grep, find, ls]

  explore:
    description: Repository exploration
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low
    tools: [read, grep, find, ls]

  deep:
    description: Difficult reasoning or implementation
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high

  review:
    description: Strong independent verification
    runner: cli
    cli: droid
    thinking: high
    tools: [read, grep, find, ls]
```

Discover and use profiles without exposing model routing in ordinary calls:

```ts
const catalog = await agents.profiles({});

const evidence = await agents.run({
  profile: "explore",
  task: "Find the files and call chain involved in this bug.",
});

const decision = await agents.run({
  profile: "deep",
  task: `Analyze this evidence and propose the safest fix:\n${evidence.text}`,
});

return { catalog, decision: decision.text };
```

`name` is now only an optional display name. Older code that used a matching `name` as the selector is accepted as a compatibility fallback. New code should use `profile`.

The public run/spawn surface intentionally excludes raw `runner`, `cli`, `model`, `thinking`, `tools`, or `recursive` routing fields. Change the profile when routing policy changes.

## Minimal recursive delegation

Use recursion only when one isolated child context is insufficient:

```ts
return agents.recurse({
  profile: "deep",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering as needed, and return the verified conclusion.",
});
```

The resolved profile must use the Pi runner. The child gets Lean Code Mode and may delegate again, subject to `agents.maxDepth`, per-execution agent-call limits, child timeout/token limits, and the shared cost ledger when `agents.budgetUsd` is configured. The result contains only the fields the parent needs and omits the complete internal run record.

This is intentionally a primitive and does not revive the RLM subsystem.

## Thin workflow

Workflow code chooses profiles and keeps model selection in configuration:

```ts
const findings = await parallel(
  ["auth", "routing", "cache"].map((topic) => () =>
    agent(`Inspect ${topic} and return bounded evidence.`, {
      profile: "explore",
      label: `inspect ${topic}`,
    })
  ),
  { concurrency: 3 },
);

return agent(
  `Verify these findings and remove unsupported claims:\n${JSON.stringify(findings)}`,
  { profile: "review", label: "verify" },
);
```

For a few independent workers, plain TypeScript is preferred:

```ts
const [docs, code] = await Promise.all([
  agents.run({ profile: "research", task: "Check upstream behavior." }),
  agents.run({ profile: "explore", task: "Locate the implementation." }),
]);
return { docs, code };
```

Workflow helpers exist only when they make orchestration clearer.

## Direct CLI adapters

The generic `cli` runner invokes supported headless CLIs directly. The first adapters are `agy` (Antigravity) and `droid` (Factory Droid), so using either no longer requires installing Veda as an intermediary.

Configure defaults in `fabric.json`:

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

Select the adapter in a semantic profile with `runner: cli` and `cli: agy` or `cli: droid`. The adapter contract owns invocation arguments, portable tool mapping, model normalization, and final-result parsing; transport remains independent and can still be `process`, `tmux`, `screen`, `localterm`, or `herdr`.

Droid uses its native per-run tool restriction. Antigravity does not currently provide an equivalent headless per-run allowlist, so Fabric passes the requested tool boundary as an explicit prompt policy and leaves Antigravity's permission configuration authoritative. Fabric never turns on Antigravity's dangerous permission bypass automatically.

CLI adapters are one-shot in V1: no recursive Fabric, steer/follow-up, or Fabric-triggered compaction. Adding another CLI should only require an adapter addition; AgentManager remains unchanged.

## Verification

`pnpm check` is the local release gate: typecheck, distributable build/artifact assertions, full Vitest suite, and dead-code analysis. GitHub Actions runs the repository checks on Ubuntu and Windows.

## Package surface

The package registers only:

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
```
