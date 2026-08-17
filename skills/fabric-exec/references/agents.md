# Lean one-shot agents reference

Lean V2 keeps local one-shot workers plus one bounded recursive Pi primitive. Persistent actors, Mesh routing, participant directories, trajectory handoff, Prewalk, resident hosts, Councils, Swarms, and the old RLM provider are not part of this runtime.

Every method takes one options object.

## Profiles, not raw models

Model routing belongs in subagent profile configuration. Runtime callers select a semantic `profile` and provide the task.

Discover active profiles:

```ts
return agents.profiles({});
```

Run one profile and wait:

```ts
const result = await agents.run({
  profile: "research",
  task: "Collect bounded evidence for this question.",
});
return result;
```

The public run request is intentionally small:

```text
task        required child task
profile     configured semantic profile
name        optional display name only
timeoutMs   optional bounded timeout override
worktree    optional isolated Git worktree
schema      optional JSON Schema for structured output
```

Do not put `runner`, `model`, `persona`, `thinking`, `tools`, `extensions`, or `recursive` in ordinary run/spawn calls. Those are profile policy.

For compatibility, an old `name` that exactly matches a configured profile still resolves that profile internally, but new code should use `profile` explicitly.

## Profile files

Global files:

```text
~/.pi/agent/fabric/subagents.yaml
~/.pi/agent/fabric/subagents.yml
~/.pi/agent/fabric/subagents.json
```

Trusted project files:

```text
.pi/fabric/subagents.yaml
.pi/fabric/subagents.yml
.pi/fabric/subagents.json
```

Optional host-supplied file:

```text
PI_FABRIC_SUBAGENTS_FILE=/absolute/path/to/subagents.yaml
```

Definitions remain under `roles:` for config compatibility:

```yaml
roles:
  research:
    description: Cheap bounded evidence gathering
    instructions: |
      Gather concrete evidence and return only material needed by the caller.
    runner: veda
    thinking: low
    tools: [read, grep, find, ls]

  explore:
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low
    tools: [read, grep, find, ls]

  deep:
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high

  review:
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high
    tools: [read, grep, find, ls]
```

A profile can define `description`, `instructions`, `runner`, `transport`, `model`, `persona`, `thinking`, `tools`, `timeoutMs`, `extensions`, `recursive`, and `worktree`. Project definitions merge over global definitions field-by-field only when Pi trusts the project. `PI_FABRIC_SUBAGENTS_FILE` is host supplied and loads last.

Profile `instructions` are prepended to the child task.

## Spawn and wait

Start a detached worker:

```ts
const handle = await agents.spawn({
  profile: "review",
  name: "independent review",
  task: "Review the current diff independently.",
});

const localWork = await pi.grep({ pattern: "unsafe", path: "src" });
const review = await agents.wait({ id: handle.id });
return { localWork, review };
```

Retained lifecycle operations:

```text
agents.wait({ id })
agents.status({ id })
agents.list({})
agents.stop({ id })
agents.cleanup({ id, deleteBranch? })
```

Detached runs can notify Main on completion when `agents.notifyOnComplete` is enabled. Calling `wait()` makes the run foreground work for the current program.

## Steering and follow-up

Running Pi/Claude children can be redirected between turns:

```ts
const handle = await agents.spawn({
  profile: "deep",
  task: "Investigate the authentication failure.",
});

await agents.steer({
  id: handle.id,
  message: "Ignore token rotation; focus on cookie/session lifetime.",
});

return agents.wait({ id: handle.id });
```

Controls:

```text
agents.steer({ id, message, data? })
agents.followUp({ id, message, data? })
agents.setSteeringMode({ id, mode: "all" | "one-at-a-time" })
agents.setFollowUpMode({ id, mode: "all" | "one-at-a-time" })
```

These target local one-shot children only. Veda is one-shot and does not support steering/follow-up.

## Child compaction

`agents.compact({ id, instructions? })` requests advisory compaction for a running Pi child. This is child-session control only; Lean V2 has no Fabric main-session compaction runtime.

## Minimal recursive delegation

Use recursion only when one child context is insufficient:

```ts
return agents.recurse({
  profile: "deep",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering if needed, and return the verified conclusion.",
});
```

The resolved profile must use `runner: pi`. Lean starts that child with recursive Code Mode enabled and returns a compact result containing status, text/value, error, turns, tool-call count, and usage rather than the full internal run record.

Existing guards apply:

- `agents.maxDepth` limits recursive Pi depth;
- `agents.maxPerExecution` / top-level `agentBudget` cap agent starts in the current `fabric_exec`;
- child timeouts and `maxTokensPerChild` still apply;
- `agents.budgetUsd` shares a cost ledger across recursive Pi descendants when configured.

Use ordinary `run`/`spawn` for normal delegation. `agents.recurse` is a primitive, not a replacement workflow engine.

## Runner policy lives in profiles

### Pi

Pi is the default runner. If a Pi profile does not specify `model`, Lean uses `agents.model` when configured, otherwise the child may inherit the host model.

A profile may opt into `recursive: true`, but prefer the explicit `agents.recurse(...)` call when recursion is part of the task semantics.

### Claude

Claude uses `agents.claude.binary` and the profile/config model defaults. Portable tool names map to Claude Code tools. Unsupported names fail before launch.

### Veda

Veda uses `agents.veda.binary`, backend defaults, and an isolated Veda session per child. A profile can set Veda `model`, `persona`, `thinking`, and portable tools.

Conceptually:

```text
veda -b <backend> -p <persona> -m <model> -r <thinking> --tools ... --json
```

Omit model/persona when the installed backend defaults are preferred.

Portable mapping:

```text
read  -> read
grep  -> grep
find  -> glob
ls    -> glob
bash  -> bash
edit  -> edit
write -> write
```

## Transport policy lives in profiles

Runner and transport are independent profile settings:

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

Veda executes the worker while Herdr hosts the process.

## Structured results

Pass `schema` when the parent needs machine-readable output:

```ts
const result = await agents.run({
  profile: "explore",
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

`worktree: true` creates a dedicated Git worktree for the child. Use it when parallel implementation workers need isolated file ownership, then clean it with `agents.cleanup({ id, deleteBranch: true })`.

Do not let multiple workers edit the same files concurrently in one shared workspace.

## Intentionally absent

Do not call or document these as Lean V2 APIs:

```text
agents.models / call-site model routing
agents.create / actors
agents.members / peers / main / participant directory
agents.subscribe / subscriptions / unsubscribe
agents.handoff
Mesh-backed cross-process steering
Prewalk
Council / Swarm / standalone RLM provider
```
