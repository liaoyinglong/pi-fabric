# Lean one-shot agents reference

Lean V2 keeps only local one-shot child workers. Persistent actors, participant directories, Mesh routing, lifecycle subscriptions, trajectory handoff, Prewalk, and resident-host residency are not part of this runtime.

Every method takes one options object.

## Run one worker

`agents.run(args)` starts one child and waits for completion.

```ts
const result = await agents.run({
  name: "research",
  task: "Collect bounded evidence for this question.",
});
return result;
```

A run request accepts:

```text
task        required child task
name        display name; also selects a configured role when names match
runner      pi | claude | veda
transport   auto | process | tmux | screen | localterm | herdr
model       runner-specific model string
persona     Veda persona
thinking    off | minimal | low | medium | high | xhigh | max
tools       portable child tool allowlist
timeoutMs   requested timeout
extensions  whether child runner extensions are enabled
recursive   whether a Pi child may load Fabric recursively
worktree    create an isolated Git worktree
schema      JSON Schema for structured result validation
```

Explicit supported call arguments override named-role defaults.

## Named roles

Global roles are loaded from:

```text
~/.pi/agent/fabric/subagents.yaml
~/.pi/agent/fabric/subagents.yml
~/.pi/agent/fabric/subagents.json
```

Trusted project roles are loaded from:

```text
.pi/fabric/subagents.yaml
.pi/fabric/subagents.yml
.pi/fabric/subagents.json
```

`PI_FABRIC_SUBAGENTS_FILE` can add one explicit role file after global and trusted project files. Role profiles merge field-by-field in that order. Project role files are skipped when Pi marks the project untrusted.

Example:

```yaml
roles:
  research:
    description: Cheap bounded evidence gathering
    instructions: |
      Gather concrete evidence and return only material needed by the caller.
    runner: veda
    model: agy/gemini-3.1-pro-high
    persona: navigator-chat
    thinking: low
    tools: [read, grep, find, ls]

  explore:
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low
    tools: [read, grep, find, ls]

  review:
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high
    tools: [read, grep, find, ls]
```

When `name` exactly matches a configured role, that role is selected automatically. A non-role `name` is only the worker display name. The `name` form is the public Code Mode role selector.

Discover roles:

```ts
return agents.roles({});
```

## Spawn and wait

`agents.spawn(args)` starts one local child and returns a handle.

```ts
const handle = await agents.spawn({
  name: "review",
  task: "Review the current diff independently.",
});

const localWork = await pi.grep({ pattern: "unsafe", path: "src" });
const review = await agents.wait({ id: handle.id });
return { localWork, review };
```

Use:

- `agents.wait({ id })` when the current program needs the final result.
- `agents.status({ id })` for one point-in-time status read.
- `agents.list({})` to list children created by this Pi host.
- `agents.stop({ id })` to stop a local child.
- `agents.cleanup({ id, deleteBranch? })` to remove completed run state and an optional worktree branch.

Detached spawned runs can notify Main on completion when `agents.notifyOnComplete` is enabled. Calling `wait()` makes the run foreground work for the current program.

## Steering and follow-up

Running Pi/Claude children can be redirected between turns:

```ts
const handle = await agents.spawn({
  name: "deep",
  task: "Investigate the authentication failure.",
});

await agents.steer({
  id: handle.id,
  message: "Ignore token rotation; focus on cookie/session lifetime.",
});

return agents.wait({ id: handle.id });
```

Retained controls:

```text
agents.steer({ id, message, data? })
agents.followUp({ id, message, data? })
agents.setSteeringMode({ id, mode: "all" | "one-at-a-time" })
agents.setFollowUpMode({ id, mode: "all" | "one-at-a-time" })
```

These controls target local one-shot children only. Lean V2 does not route them through Mesh to peers, actors, or other roots.

## Child compaction

`agents.compact({ id, instructions? })` requests advisory compaction for a running Pi child.

```ts
return agents.compact({
  id,
  instructions: "Preserve implementation decisions and unresolved failures.",
});
```

This is child-session control only. Lean V2 has no Fabric main-session compaction runtime.

## Runner selection

### Pi

Pi is the default runner. If a Pi role does not specify `model`, Lean V2 uses `agents.model` when configured, otherwise it can inherit the current host model.

```yaml
roles:
  explore:
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low
    tools: [read, grep, find, ls]
```

`recursive: true` is meaningful only for a Pi child that is intentionally allowed to load Fabric again. Prefer non-recursive bounded workers unless recursion is specifically needed.

### Claude

Claude uses the configured `agents.claude.binary`. Portable tool names map to Claude Code tools. Unsupported tool names fail before launch.

### Veda

Veda uses the configured `agents.veda.binary`, `agents.veda.backend`, and default persona. A role can override `persona`, `model`, `thinking`, and tools.

Fabric conceptually invokes:

```text
veda -b <backend> -p <persona> -m <model> -r <thinking> --tools ... --json
```

The model value is forwarded to Veda's `-m` argument. A `veda/` prefix is stripped; other model strings pass through unchanged. Omit `model` to let the Veda backend choose its default.

Portable Veda tool mapping:

```text
read  -> read
grep  -> grep
find  -> glob
ls    -> glob
bash  -> bash
edit  -> edit
write -> write
```

Each Fabric Veda child uses an isolated Veda session, so parallel children do not share conversation or selection state.

## Transport selection

Runner and transport are separate.

```text
runner:    pi | claude | veda
transport: process | tmux | screen | localterm | herdr | auto
```

Example:

```yaml
roles:
  research:
    runner: veda
    transport: herdr
    thinking: low
    tools: [read, grep, find, ls]
```

Here Veda executes the child while Herdr hosts the process.

## Model discovery

```ts
return agents.models({ runner: "pi" });
```

The lean provider exposes runtime discovery only when the selected runner can provide it. Veda currently returns an empty advisory list; configure its backend/model in the role catalog without relying on discovery.

## Structured results

Pass `schema` when the parent needs machine-readable output:

```ts
const result = await agents.run({
  name: "explore",
  task: "Find the files responsible for authentication.",
  schema: {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" } },
      summary: { type: "string" }
    },
    required: ["files", "summary"],
    additionalProperties: false
  }
});

return result.value;
```

## Worktrees

`worktree: true` creates a dedicated Git worktree for the child. Use it when parallel implementation workers need isolated file ownership. Clean it with:

```ts
await agents.cleanup({ id: handle.id, deleteBranch: true });
```

Do not let multiple concurrent workers edit the same files in one shared workspace.

## What is intentionally absent

Do not call or document these as Lean V2 APIs:

```text
agents.create / actors
agents.members / peers / main / participant directory
agents.subscribe / subscriptions / unsubscribe
agents.handoff
persistent/durable residency
Mesh-backed cross-process steering
Prewalk
Council / Swarm / RLM persistent orchestration
```

Use bounded `run` / `spawn` workers and workflow composition.
