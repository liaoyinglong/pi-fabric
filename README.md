# Pi Fabric Lean V2

A focused Programmatic Tool Calling runtime for Pi.

This fork keeps three product surfaces:

1. **Code Mode (`fabric_exec`)**: one type-checked TypeScript program can call many tools, branch, loop, fan out, aggregate intermediate values, and return one bounded result to the model.
2. **Named one-shot subagents**: semantic roles such as `research`, `explore`, `deep`, and `review` can bind to different runners, models, thinking levels, tools, personas, and instructions.
3. **Workflow orchestration**: `agent`, `parallel`, `pipeline`, and workflow phase helpers compose the same one-shot subagent runtime.

Lean V2 removes the persistent Fabric product systems that are outside this scope: Actor, Mesh, State, Schema runtime, Memory, RLM skills, Prewalk, resident hosts, the Component supervisor, trajectory handoff, the Fabric dashboard, and main-session Fabric compaction. The shared Code Mode and agent runtime no longer carries the old Actor/Mesh/trajectory plumbing or dormant QuickJS globals for those systems.

## Runtime shape

```text
Pi Main
  |
  v
fabric_exec
  |-- pi.*          Pi core tools
  |-- extensions.*  captured Pi extension tools
  |-- mcp.*         MCP tools when enabled
  |-- agents.*      named one-shot subagents when enabled
  `-- workflow      agent / parallel / pipeline / phases
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

For day-to-day setup and examples, read **[Lean V2 Usage Guide](docs/usage.md)**. It covers:

- global and project `fabric.json`
- `fabric_exec` and `pi.*`
- captured extension tools such as FFF
- MCP
- named subagent role files
- Pi / Claude / Veda runners
- Veda + AGY routing
- Herdr and other transports
- workflow examples
- migration from full Fabric
- troubleshooting

For every Lean V2 configuration field and its default, read **[Configuration Reference](docs/configuration.md)**.

For implementation boundaries and removed public systems, read **[Lean Code Mode V2 Architecture](docs/lean-code-mode.md)**.

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

Use sequential `await` when a result determines the next operation. Use `parallel(...)`, `Promise.all(...)`, or `all({...})` for independent work.

### Captured Pi extension tools

The capture layer is retained because it is one of the important parts of the original Fabric implementation.

It observes Pi's internal registered-tool catalog, stores the executable registered tool and its owning `ExtensionRunner`, then replays Pi's normal tool lifecycle when Code Mode invokes it. Existing extension tools such as FFF can therefore remain ordinary Pi extensions while Code Mode calls them through `extensions.*`.

Captured tools remain registered in Pi so permission, audit, and lifecycle extensions can still observe them. Full Code Mode hides captured tools from the model's active tool set unless they are listed in `capture.keepVisible`.

Known read-only captured tools can be assigned `read` risk. Unknown captured tools default to `execute` risk unless configured explicitly.

## Named subagent roles

Global roles live at:

```text
~/.pi/agent/fabric/subagents.yaml
```

Trusted project roles live at:

```text
.pi/fabric/subagents.yaml
```

Trusted project fields override global fields. `PI_FABRIC_SUBAGENTS_FILE` can add one explicit host-supplied role file.

Example:

```yaml
roles:
  research:
    description: Cheap bounded research
    instructions: |
      Gather concrete evidence and return only material needed by the caller.
    runner: veda
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
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high
    tools: [read, grep, find, ls]
```

Veda roles may omit `model` and `persona` to inherit the installed backend defaults. Add those values only when the current Veda backend identifiers are known.

The public role selector is `name`. When `name` matches a configured role, its profile is applied; a non-role `name` remains a display name.

```ts
const evidence = await agents.run({
  name: "explore",
  task: "Find the files and call chain involved in this bug.",
});

const decision = await agents.run({
  name: "deep",
  task: `Analyze this evidence and propose the safest fix:\n${evidence.text}`,
});

return decision.text;
```

Main can discover the current catalog with `agents.roles({})`. Normal conversation guidance tells Main to prefer semantic roles over raw model ids, so the user does not need to specify Luna, Sol, or another provider model on each delegated task.

## Workflow

Workflow is orchestration over the same one-shot subagent substrate. It does not have a separate agent runtime or model router.

```ts
const findings = await parallel(
  ["auth", "routing", "cache"].map((topic) => () =>
    agent(`Inspect ${topic} and return bounded evidence.`, {
      label: `inspect ${topic}`,
      name: "explore",
    })
  ),
  { concurrency: 3 },
);

return agent(
  `Verify these findings and remove unsupported claims:\n${JSON.stringify(findings)}`,
  { label: "verify", name: "review" },
);
```

Role names keep model ids out of workflow code. Explicit supported worker options can still override a role for one exceptional call.

## Veda

Veda is a one-shot runner option, separate from the process transport. Configure the default Veda binary/backend/persona in `fabric.json`, then bind a semantic role to `runner: veda`.

Fabric invokes Veda headlessly with the configured backend, persona, model, reasoning level, portable tool allowlist, and an isolated session id. The model value is passed to Veda's `-m` argument; a leading `veda/` routing prefix is stripped. If a role does not specify `model` or `persona`, Veda uses the configured backend defaults.

Supported portable tool mapping:

```text
read  -> read
grep  -> grep
find  -> glob
ls    -> glob
bash  -> bash
edit  -> edit
write -> write
```

## Verification

`pnpm check` is the local release gate. It runs type checking, the distributable build and artifact assertions, the full Vitest suite, and dead-code analysis. GitHub Actions runs the same repository checks on both Ubuntu and Windows so platform-specific worker and type-checker regressions remain covered.

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

The public protocol export remains available for the Lean Code Mode provider/action contract. Persistent Full Fabric providers are not registered by the Lean entrypoint.
