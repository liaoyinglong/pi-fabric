# Pi Fabric Lean V2

A focused Programmatic Tool Calling runtime for Pi.

This fork keeps three product surfaces:

1. **Code Mode (`fabric_exec`)**: one type-checked TypeScript program can call many tools, branch, loop, fan out, aggregate intermediate values, and return one bounded result to the model.
2. **Named one-shot subagents**: semantic roles such as `research`, `explore`, `deep`, and `review` can bind to different runners, models, thinking levels, tools, personas, and instructions.
3. **Workflow orchestration**: `agent`, `parallel`, `pipeline`, and workflow phase helpers compose the same one-shot subagent runtime.

V2 physically removes the persistent Fabric systems that are outside this scope: Actor, Mesh, State, Schema runtime, Memory, RLM skills, Prewalk, resident hosts, the Component supervisor, trajectory handoff, the Fabric dashboard, and main-session Fabric compaction.

## Runtime shape

```text
Pi Main
  |
  v
fabric_exec
  |-- pi.*          Pi core tools
  |-- extensions.*  captured Pi extension tools
  |-- mcp.*         MCP tools
  |-- agents.*      named one-shot subagents
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

For implementation boundaries and removed systems, read **[Lean Code Mode V2 Architecture](docs/lean-code-mode.md)**.

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

Project roles live at:

```text
.pi/fabric/subagents.yaml
```

Project fields override global fields. `PI_FABRIC_SUBAGENTS_FILE` can add one explicit role file.

Example:

```yaml
roles:
  research:
    description: Cheap bounded research
    instructions: |
      Gather concrete evidence and return only material needed by the caller.
    runner: veda
    model: agy/gemini-3.1-pro-high
    persona: navigator-chat
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

A role can define:

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

Explicit call arguments override role defaults.

```ts
const evidence = await agents.run({
  name: "research",
  task: "Find the upstream behavior relevant to this bug.",
});

return evidence;
```

When `name` matches a configured role, the role profile is selected automatically. The low-level provider also accepts an explicit `role` field.

Discover roles:

```ts
return tools.call({ ref: "agents.roles", args: {} });
```

The one-shot agent surface keeps `run`, `spawn`, `wait`, `status`, `list`, `roles`, `models`, `stop`, `cleanup`, `steer`, `followUp`, steering/follow-up modes, and child `compact`.

Child `compact` remains because it controls a running child Pi session. V2 does not install Fabric main-session compaction.

## Workflow

Workflow is a thin orchestration layer over named one-shot subagents.

```text
Workflow -> named subagent roles -> AgentManager
```

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

Model routing stays in role configuration. A workflow can use cheap evidence-gathering roles and strong reasoning roles without embedding model IDs throughout the workflow.

## Configuration

V2 reads the existing global and project Fabric config paths for migration convenience:

```text
~/.pi/agent/fabric.json
.pi/fabric.json
```

Only the lean runtime groups are used:

- `executor`
- `approvals`
- `mcp`
- `agents`
- `capture`
- `retention`

Legacy persistent-runtime fields are ignored. V2 always runs Full Code Mode and does not enable the old Schema runtime.

## Included Pi skills

The package registers and ships only:

- `fabric-exec`
- `fabric-subagents`
- `fabric-workflow`

Pi's normal skill catalog is still available. Because Full Code Mode hides the model-facing `read` tool, the extension adapts Pi's progressive skill-loading instruction to use `pi.read` inside `fabric_exec`.

## Development

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm lint:dead
```

The GitHub Actions workflow runs these checks on Ubuntu and Windows for `agent/**` branches.

## Upstream

This fork is based on [monotykamary/pi-fabric](https://github.com/monotykamary/pi-fabric). It keeps the mature Code Mode, tool capture, execution, MCP, and one-shot agent paths while removing the persistent multi-agent runtime.

## License

MIT
