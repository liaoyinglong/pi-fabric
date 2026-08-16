---
name: fabric-subagents
description: Delegates bounded work to named Pi Fabric subagent roles with role-specific runner, model, thinking, tools, and instructions. Use when a task benefits from isolated research, exploration, implementation, or review workers.
disable-model-invocation: true
---

# Fabric Named Subagents

Use named roles instead of choosing raw models in every prompt. Roles are configured globally in `~/.pi/agent/fabric/subagents.yaml` or per project in `.pi/fabric/subagents.yaml`. Project roles override global roles field-by-field.

Discover the active role catalog through the generic Code Mode action surface:

```ts
return await tools.call({ ref: "agents.roles", args: {} });
```

Run a configured role synchronously by using the role name as the run name:

```ts
const finding = await agents.run({
  name: "research",
  task: "Find the relevant upstream documentation and return only evidence needed for this task.",
});
return finding;
```

Or spawn it and wait later:

```ts
const handle = await agents.spawn({
  name: "review",
  task: "Independently review the current diff for correctness regressions.",
});
// Do other bounded work here.
return await agents.wait({ id: handle.id });
```

A role may define:

```yaml
roles:
  research:
    description: Cheap bounded research and evidence gathering
    instructions: |
      Gather concrete evidence. Avoid architecture decisions unless requested.
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

Role defaults include `runner`, `transport`, `model`, `persona`, `thinking`, `tools`, `timeoutMs`, `extensions`, `recursive`, and `worktree`. Explicit call arguments override role defaults. Role `instructions` are prepended to the child task.

The lean runtime accepts both an explicit low-level `role` field and the compatibility form shown above. When `role` is omitted and `name` exactly matches a configured role, that profile is selected automatically. The compatibility form is preferred in Code Mode today because it already fits Fabric's existing static guest types; `name` remains an ordinary display name when it does not match a role.

Prefer semantic roles (`research`, `explore`, `deep`, `review`) over model names. This keeps model routing in configuration and lets the main agent decide what kind of worker it needs rather than which provider implementation to call.
