# Lean Code Mode Runtime

This branch narrows Pi Fabric around three capabilities:

1. **Programmatic Tool Calling / Code Mode**: `fabric_exec` remains the primary model-facing tool. One model turn can generate a program that calls many Pi, MCP, or captured extension tools and returns only the bounded result.
2. **Named one-shot Subagents**: bounded workers remain available, but persistent Actor/Mesh APIs are removed from the default agent surface. Roles bind semantic names to runner/model/thinking/tools/instructions.
3. **Workflow orchestration**: workflows stay code-held. Phases, parallel fan-out, pipelines, and result aggregation execute inside the same Code Mode program and delegate worker execution to named subagents.

## Default runtime surface

The lean bootstrap runs before the main Fabric extension and changes the defaults to:

- `fullCodeMode: true`
- captured Pi extension tools enabled and hidden behind Code Mode
- MCP retained as a Code Mode capability source
- one-shot subagents retained
- Mesh disabled by default
- Memory disabled by default
- capability advisory disabled by default
- Fabric compaction replaced by Pi's compaction engine by default
- dynamic components empty by default

The one-shot `agents` surface keeps `run`, `spawn`, `wait`, `status`, `list`, `models`, `stop`, `cleanup`, `steer`, `followUp`, steering/follow-up modes, `compact`, plus the new `roles` discovery action. Actor, mailbox, peer, lifecycle-subscription, handoff, and persistent topology actions are not advertised by default.

The old implementation modules still exist in the source tree during the first extraction phase so the refactor can stay reviewable and preserve the existing tested Code Mode/capture path. They are no longer part of the intended default product surface. Physical deletion can follow once the lean path has run through CI and real Pi sessions.

## Why captured extension tools stay

Fabric's capture layer is a key part of the lean runtime. It observes Pi's internal registered-tool catalog, stores the actual executable wrapped tool, and replays the normal Pi tool lifecycle when Code Mode invokes it. This lets tools supplied by extensions such as FFF continue to work from inside one `fabric_exec` program without reimplementing them.

## Named subagent roles

Global roles:

```text
~/.pi/agent/fabric/subagents.yaml
```

Project roles:

```text
.pi/fabric/subagents.yaml
```

Project values override global values field-by-field. A custom path can be appended with `PI_FABRIC_SUBAGENTS_FILE`.

Example:

```yaml
roles:
  research:
    description: Cheap bounded research
    instructions: |
      Gather concrete evidence and return only material needed by the caller.
      Do not make architecture decisions unless the task explicitly asks for them.
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

Discover roles through the generic action surface:

```ts
const catalog = await tools.call({ ref: "agents.roles", args: {} });
return catalog;
```

Run by role using the compatibility selector:

```ts
const evidence = await agents.run({
  name: "research",
  task: "Find the upstream behavior relevant to this bug.",
});
```

Explicit call arguments override role defaults:

```ts
const evidence = await agents.run({
  name: "research",
  task: "This research needs a stronger model.",
  model: "azure-openai-responses/gpt-5.6-sol",
  thinking: "high",
});
```

When `name` exactly matches a configured role, that profile is selected automatically. The low-level provider also accepts an explicit `role` field. The `name` compatibility form is preferred in Code Mode today because it already fits Fabric's existing static guest declarations.

## Workflow model

Workflow is orchestration, not another agent runtime. It calls the same one-shot `agents.run` substrate through the Code Mode `agent()` helper:

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

This keeps a single ownership boundary:

```text
Workflow -> Subagent roles -> AgentManager
Code Mode -> Pi/MCP/captured extension tools
```

Workflow does not implement its own model routing, child runtime, or persistent coordination layer.
