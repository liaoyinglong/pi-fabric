# Pi Fabric — Lean Code Mode Runtime

A focused **Programmatic Tool Calling runtime for Pi**.

This fork keeps the parts of Fabric that are useful for everyday coding-agent work and makes them the default product surface:

1. **Code Mode / `fabric_exec`** — one type-checked TypeScript program can call many tools, branch, loop, fan out in parallel, aggregate results, and return only the bounded result to the model.
2. **Captured Pi extension tools** — existing extension tools (for example FFF) remain callable from Code Mode through Fabric's registered-tool capture and Pi lifecycle replay.
3. **Named one-shot subagents** — reusable semantic roles such as `research`, `explore`, `deep`, and `review` can bind to their own runner, model, thinking level, tools, persona, and instructions.
4. **Workflow orchestration** — phases, parallel fan-out, pipelines, and aggregation reuse the same one-shot subagent runtime instead of introducing another agent system.

The lean entrypoint intentionally disables the heavy persistent-agent surface by default: Mesh and Fabric Memory are disabled, dynamic Components are empty, and Actor/mailbox/persistent-topology actions are not advertised.

> The original implementation files are still present during this extraction phase so the well-tested Code Mode/capture path can be reused without a risky rewrite. The package entrypoint and Pi skill surface use the lean runtime.

## Why

The core goal is simple:

```text
LLM
  │  writes one TypeScript program
  ▼
fabric_exec
  ├─ read / grep / find / bash
  ├─ captured extension tools
  ├─ MCP tools
  ├─ named subagents
  └─ parallel / pipeline workflow helpers
  │
  ▼
bounded result
  │
  ▼
LLM
```

Instead of repeatedly doing `LLM -> tool -> LLM -> tool -> LLM`, mechanical tool orchestration stays inside the runtime.

## Install this branch

```bash
pi install git:github.com/liaoyinglong/pi-fabric#agent/code-mode-runtime-lite
```

For local development:

```bash
pnpm install
pnpm check
pnpm build
pi -e /absolute/path/to/pi-fabric
```

Requires Node.js 24+ and Pi 0.80.6+.

## Code Mode

The model primarily sees `fabric_exec`. A single program can make many calls and process intermediate values locally:

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

Captured extension tools remain registered in Pi for compatibility with permissions/auditors, but can be hidden from the model's active tool set and invoked through Code Mode.

## Named subagent roles

Define global roles in:

```text
~/.pi/agent/fabric/subagents.yaml
```

Or project roles in:

```text
.pi/fabric/subagents.yaml
```

Project values override global values field-by-field. `PI_FABRIC_SUBAGENTS_FILE` can append an explicit config file.

Example:

```yaml
roles:
  research:
    description: Cheap bounded research
    instructions: |
      Gather concrete evidence and return only material needed by the caller.
    runner: veda
    model: agy/gemini-flash
    persona: researcher
    thinking: low
    tools: [read, grep, find, ls]

  explore:
    description: Repository exploration
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low
    tools: [read, grep, find, ls]

  deep:
    description: Difficult reasoning and implementation decisions
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high

  review:
    description: Strong independent verification
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high
    tools: [read, grep, find, ls]
```

Roles support these defaults:

- `description`
- `instructions`
- `runner`: `pi`, `claude`, or `veda`
- `transport`: `auto`, `process`, `tmux`, `screen`, `localterm`, or `herdr`
- `model`
- `persona`
- `thinking`
- `tools`
- `timeoutMs`
- `extensions`
- `recursive`
- `worktree`

Explicit arguments on a call override role defaults.

Run a configured role:

```ts
const result = await agents.run({
  name: "research",
  task: "Find the upstream behavior relevant to this bug.",
});

return result;
```

If `name` matches a configured role it selects that role automatically. The low-level provider also accepts `role` explicitly.

Discover configured roles:

```ts
return tools.call({ ref: "agents.roles", args: {} });
```

## Workflow

Workflow is deliberately only an orchestration layer. It does **not** own another model router or child-agent runtime.

```text
Workflow -> named subagent roles -> one-shot AgentManager
Code Mode -> Pi / MCP / captured extension tools
```

Example:

```ts
const findings = await parallel(
  items.map((item) => () =>
    agent(`Collect bounded evidence for ${item}`, {
      label: `explore ${item}`,
      name: "explore",
    })
  ),
  { concurrency: 4 },
);

const review = await agent(
  `Verify these findings:\n${JSON.stringify(findings)}`,
  { label: "verify", name: "review" },
);

return review;
```

This lets model choice remain a property of the semantic role. A workflow can use cheap research workers and strong review workers without hard-coding model IDs into every workflow.

## Lean defaults

The lean bootstrap currently sets:

- `fullCodeMode = true`
- extension-tool capture enabled
- captured extension tools hidden from the model by default
- Mesh disabled
- Fabric Memory disabled
- capability advisory disabled
- Pi compaction used by default
- dynamic Components empty
- only one-shot agent actions exposed, plus `agents.roles`

Retained one-shot actions include `run`, `spawn`, `wait`, `status`, `list`, `models`, `stop`, `cleanup`, `steer`, `followUp`, steering/follow-up modes, and `compact`.

## Included Pi skills

The package only registers:

- `fabric-exec`
- `fabric-subagents`
- `fabric-workflow`

See [`docs/lean-code-mode.md`](docs/lean-code-mode.md) for the extraction design and detailed behavior.

## Development

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm lint:dead
```

The GitHub Actions workflow runs these checks on Ubuntu and Windows for `agent/**` branches.

## Upstream

This fork is based on [monotykamary/pi-fabric](https://github.com/monotykamary/pi-fabric) and intentionally reuses its mature Code Mode, tool capture, runtime, and one-shot agent implementation while narrowing the default product surface.

## License

MIT
