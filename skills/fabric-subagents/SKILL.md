---
name: fabric-subagents
description: Delegates bounded work to semantic Pi Fabric subagent profiles with profile-specific runner, model, thinking, tools, and instructions. Use when a task benefits from isolated research, exploration, implementation, review, or bounded recursive decomposition.
disable-model-invocation: true
---

# Fabric Subagent Profiles

Route ordinary calls by semantic profile and keep raw model choices in configuration. Profiles are configured as `roles:` globally in `~/.pi/agent/fabric/subagents.yaml` or per trusted project in `.pi/fabric/subagents.yaml`. Project entries override global entries field-by-field.

Discover the active catalog:

```ts
const catalog = await agents.profiles({});
return catalog.profiles;
```

`agents.profiles()` returns `{ profiles, sources }`. Each profile has a `name`; there is no profile `id`. If the profile name is already known, call it directly instead of discovering first.

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
    runner: cli
    cli: agy
    thinking: low
    tools: [read, grep, find, ls]

  explore:
    description: Repository exploration
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: low

  deep:
    description: Difficult reasoning and implementation decisions
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: high
    tools: [read, grep, find, ls, edit, write, bash]

  review:
    description: Strong independent verification
    runner: cli
    cli: droid
    thinking: high
    tools: [read, grep, find, ls]
```

If `tools` is omitted, an ordinary one-shot child inherits the safe read-only allowlist `read`, `grep`, `find`, and `ls`. Add `bash`, `edit`, or `write` explicitly only for profiles that need execution or mutation.

Pi extension discovery stays enabled by default. This is necessary for extensions that dynamically register model providers. Ordinary nested Pi children still do **not** enter Fabric again: when they discover the Fabric extension it detects one-shot child mode and stays inert, while the child's `--tools` allowlist remains the model-facing tool boundary. Set `extensions: false` explicitly only when the child genuinely needs no extension-provided model/provider or other extension behavior.

Profile configuration owns `runner`, `cli`, `transport`, `model`, `thinking`, `tools`, `timeoutMs`, `extensions`, and `worktree`. The public `agents.run`/`spawn` call surface intentionally does not expose raw model-routing fields; change the profile when routing policy changes. Profile `instructions` are prepended to the child task.

Project profile files are skipped when Pi marks the project untrusted. Global profiles and an explicit host-supplied `PI_FABRIC_SUBAGENTS_FILE` remain available.

For `runner: cli`, select `cli: agy` or `cli: droid`. If `cli` is omitted, the profile inherits `agents.cli.adapter`. Model identifiers are adapter-specific; omit `model` to use the selected CLI's own configured/default model.

CLI adapters are deliberately one-shot. They do not support recursive Fabric, steering, follow-ups, or Fabric-triggered compaction. Start a new run for another CLI prompt.

## Minimal recursive delegation

Use recursion only when one isolated child context is not enough. `agents.recurse` starts a recursive **Pi** profile, allows that child to use Lean Code Mode and delegate again, and returns only a compact result that omits the full run record.

```ts
return await agents.recurse({
  profile: "deep",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering as needed, and return the verified conclusion.",
});
```

The profile selected by `agents.recurse` must resolve to `runner: pi`; CLI adapters and Claude remain one-shot workers. A recursive Pi child's model-facing execution gateway is `fabric_exec`; Lean hides the direct Pi core tools from that child model. The selected profile's original `tools` list is retained as the internal Code Mode capability grant, so recursion cannot expand authority. For example, a profile that only grants `read`, `grep`, `find`, and `ls` can use those actions through `pi.*` inside `fabric_exec`, but `pi.bash`, `pi.edit`, and `pi.write` are unavailable. Granted captured extension tool names are filtered the same way.

Recursion is bounded by `agents.maxDepth`, the execution agent-call ceiling, child timeouts/token limits, and the shared `agents.budgetUsd` cost ledger when configured. Prefer ordinary `run`/`spawn` unless recursive decomposition materially reduces the parent context burden.

The intended routing pattern is semantic: cheap profiles such as `research`/`explore` gather evidence, while `deep`/`review` handle difficult reasoning or independent verification. The main agent should choose the profile, not the provider/model identifier.
