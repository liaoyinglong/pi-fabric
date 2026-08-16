---
name: fabric-subagents
description: Delegates bounded work to named Pi Fabric subagent roles with role-specific runner, model, thinking, tools, and instructions. Use when a task benefits from isolated research, exploration, implementation, or review workers.
---

# Fabric Named Subagents

Use named roles instead of choosing raw models in every prompt. Roles are configured globally in `~/.pi/agent/fabric/subagents.yaml` or per project in `.pi/fabric/subagents.yaml`. Project roles override global roles field-by-field.

Discover the active role catalog from Code Mode:

```ts
return await agents.roles();
```

Run a role synchronously:

```ts
const finding = await agents.run({
  role: "research",
  task: "Find the relevant upstream documentation and return only evidence needed for this task.",
});
return finding;
```

Or spawn a long-running role and wait later:

```ts
const handle = await agents.spawn({
  role: "review",
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

Role defaults include `runner`, `transport`, `model`, `persona`, `thinking`, `tools`, `timeoutMs`, `extensions`, `recursive`, and `worktree`. Explicit arguments on `agents.run` / `agents.spawn` override role defaults. Role `instructions` are prepended to the child task. If `role` is omitted, a `name` matching a configured role is accepted for backwards compatibility.

Prefer semantic roles (`research`, `explore`, `deep`, `review`) over model names. This keeps model routing in configuration and lets the main agent decide what kind of worker it needs rather than which provider implementation to call.
