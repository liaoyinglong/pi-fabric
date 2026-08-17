---
name: fabric-subagents
description: Delegates bounded work to semantic Pi Fabric subagent profiles with profile-specific runner, model, thinking, tools, and instructions. Use when a task benefits from isolated research, exploration, implementation, review, or bounded recursive decomposition.
disable-model-invocation: true
---

# Fabric Subagent Profiles

Route by semantic profile instead of choosing raw models in ordinary calls. Profiles are configured as `roles:` globally in `~/.pi/agent/fabric/subagents.yaml` or per trusted project in `.pi/fabric/subagents.yaml`. Project entries override global entries field-by-field.

Discover the active catalog:

```ts
const catalog = await agents.profiles({});
return catalog.profiles;
```

Run a configured profile synchronously:

```ts
const finding = await agents.run({
  profile: "research",
  task: "Find the relevant upstream documentation and return only evidence needed for this task.",
});
return finding;
```

Or spawn it and wait later:

```ts
const handle = await agents.spawn({
  profile: "review",
  task: "Independently review the current diff for correctness regressions.",
});
// Do other bounded work here.
return await agents.wait({ id: handle.id });
```

`name` is only an optional display name. Do not use it for model routing. Older `name: "research"` calls still resolve matching profiles as a compatibility fallback, but new code should always use `profile`.

A profile may define:

```yaml
roles:
  research:
    description: Cheap bounded research and evidence gathering
    instructions: |
      Gather concrete evidence. Avoid architecture decisions unless requested.
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

Profile configuration owns `runner`, `transport`, `model`, `persona`, `thinking`, `tools`, `timeoutMs`, `extensions`, `recursive`, and `worktree`. The public `agents.run`/`spawn` call surface intentionally does not expose raw model-routing fields; change the profile when routing policy changes. Profile `instructions` are prepended to the child task.

Project profile files are skipped when Pi marks the project untrusted. Global profiles and an explicit host-supplied `PI_FABRIC_SUBAGENTS_FILE` remain available.

For Veda, omit `model` and `persona` to use the current backend defaults. Add either value only after confirming the identifier accepted by the installed Veda backend. Fabric forwards those selections to Veda rather than maintaining its own Veda model or persona catalog.

## Minimal recursive delegation

Use recursion only when one isolated child context is not enough. `agents.recurse` is deliberately small: it starts a recursive **Pi** profile, allows that child to use Lean Code Mode and delegate again, and returns only a compact result instead of the full run record.

```ts
return await agents.recurse({
  profile: "deep",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering as needed, and return the verified conclusion.",
});
```

A recursive profile must resolve to `runner: pi`; Veda and Claude remain one-shot workers. Recursion is bounded by `agents.maxDepth`, the execution agent-call ceiling, child timeouts/token limits, and the shared `agents.budgetUsd` cost ledger when configured. Prefer ordinary `run`/`spawn` unless recursive decomposition materially reduces the parent context burden.

The intended routing pattern is semantic: cheap profiles such as `research`/`explore` gather evidence, while `deep`/`review` handle difficult reasoning or independent verification. The main agent should choose the profile, not the provider/model identifier.
