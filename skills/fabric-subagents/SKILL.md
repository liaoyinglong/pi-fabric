---
name: fabric-subagents
description: Delegates bounded work through Main-selected fast/balance/strong tiers and explicit capability policies. Use proactively when isolation, cheaper execution, parallel work, or independent verification improves the task.
---

# Fabric Subagents

Main owns delegation. Users should not need to predefine roles or name models during normal conversation.

For each delegated task, Main decides four things at call time:

1. whether delegation is useful at all;
2. a temporary semantic `role` and optional bounded `instructions`;
3. an execution `tier`: `fast`, `balance`, or `strong`;
4. a capability `policy`: `inspect`, `execute`, `modify`, or `isolated`.

Model, runner, thinking level, tool grants, and worktree behavior come from the selected tier/policy configuration. The model-facing API intentionally does not expose those raw routing fields.

## Tiers

| Tier | Default routing | Use for |
| --- | --- | --- |
| `fast` | Pi `gpt-5.6-luna`, medium thinking | bounded search, evidence gathering, repetitive inspection, cheap checks |
| `balance` | Pi `gpt-5.6-terra`, medium thinking | routine reasoning, debugging, implementation, verification |
| `strong` | Pi `gpt-5.6-sol`, medium thinking | ambiguous bugs, architecture/high-impact decisions, difficult reasoning, independent review |

Prefer the lowest tier that can reliably finish the bounded task. Escalate only when the result is uncertain, evidence is insufficient, or the task proves harder than expected. Do not run a strong worker merely because it exists.

AGY and Droid remain available as CLI runner overrides in `subagents.yaml`; they are not part of the built-in tier mapping.

## Capability policies

| Policy | Default boundary | Worktree |
| --- | --- | --- |
| `inspect` | `read`, `grep`, `find`, `ls` | no |
| `execute` | inspect + `bash`; no edit/write | no |
| `modify` | read/search + `bash`, `edit`, `write` | no |
| `isolated` | same mutation tools as `modify` | yes |

Use `inspect` by default for research/review. Use `execute` when tests, builds, or diagnostics are required without source mutation. Use `modify` for a bounded implementation in the current workspace. Use `isolated` for experiments or parallel mutation that should not touch Main's current worktree.

Policies are capability boundaries, not personas. A child cannot gain write tools merely because Main calls it an "implementer"; Main must select a policy that grants those capabilities.

## Main-defined roles

Roles are ephemeral call-time context, not configured selectors:

```ts
const finding = await agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  instructions: "Locate the retry implementation and return file references plus the relevant control flow.",
  task: "Find how reconnect backoff is implemented.",
});
return finding;
```

Main can create any role that helps the current task: repository scout, API verifier, migration reviewer, test analyst, focused implementer, architecture critic, and so on. Do not add a permanent profile merely to name a temporary responsibility.

For routine implementation:

```ts
return await agents.run({
  tier: "balance",
  policy: "modify",
  role: "focused implementer",
  instructions: "Keep the patch minimal and run the directly relevant tests.",
  task: "Fix the retry timer leak described by Main.",
});
```

For independent verification:

```ts
const review = await agents.run({
  tier: "strong",
  policy: "inspect",
  role: "independent reviewer",
  instructions: "Challenge Main's assumptions. Report only concrete regressions or residual risks.",
  task: "Review the current diff for correctness regressions.",
});
return review;
```

Or spawn independent work and wait later:

```ts
const handle = await agents.spawn({
  tier: "fast",
  policy: "inspect",
  role: "upstream researcher",
  task: "Check upstream behavior and return only evidence relevant to this change.",
});
// Main can do other independent work here.
return await agents.wait({ id: handle.id });
```

## Default delegation policy

Main should delegate when at least one of these is true:

- isolation keeps large search/log/file-reading work out of Main context;
- multiple independent tasks can run concurrently;
- a cheaper worker is sufficient for bounded work;
- an independent context materially improves verification;
- a mutation is safer in an isolated worktree.

Keep simple, tightly coupled work in Main. Parallelize only independent tasks. Never let concurrent children write overlapping files. Main remains responsible for synthesis, final decisions, and integration.

Children are prompted to return compact results rather than raw tool transcripts, include concrete evidence or validation when relevant, state uncertainty explicitly, and avoid broadening scope.

## Configuration overrides

Built-in tier and policy defaults work without any `subagents.yaml`. Override them globally at `~/.pi/agent/fabric/subagents.yaml` or per trusted project at `.pi/fabric/subagents.yaml`. Project values override global values field-by-field; an explicit `PI_FABRIC_SUBAGENTS_FILE` is applied last.

```yaml
tiers:
  fast:
    runner: pi
    model: azure-openai-responses/gpt-5.6-luna
    thinking: medium

  balance:
    runner: pi
    model: azure-openai-responses/gpt-5.6-terra
    thinking: medium

  strong:
    runner: pi
    model: azure-openai-responses/gpt-5.6-sol
    thinking: medium

policies:
  inspect:
    tools: [read, grep, find, ls]

  execute:
    tools: [read, grep, find, ls, bash]

  modify:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: false

  isolated:
    tools: [read, grep, find, ls, bash, edit, write]
    worktree: true
```

Tier overrides may set `runner`, `cli`, `transport`, `model`, `thinking`, `timeoutMs`, `extensions`, `description`, and `instructions`. Policy overrides may set `tools`, `worktree`, `description`, and `instructions`.

There is no `roles:` / profile compatibility layer in this design. The configured surface is only tiers and policies; roles are created dynamically by Main.

Inspect the active semantic surface when needed:

```ts
return await agents.routing({});
```

`agents.routing()` returns tier/policy descriptions and capability boundaries, but deliberately does not expose raw model IDs or runner routing to Main.

Project routing files are skipped when Pi marks the project untrusted.

## Recursion

Use recursion only when one isolated child context is insufficient:

```ts
return await agents.recurse({
  tier: "strong",
  policy: "inspect",
  role: "problem decomposer",
  task: "Decompose this cross-module problem, delegate bounded evidence gathering as needed, and return the verified conclusion.",
});
```

All three built-in tiers resolve to `runner: pi`, so recursion is available to `fast`, `balance`, and `strong`. Recursive Pi children remain bounded by `agents.maxDepth`, the per-execution agent-call ceiling, child timeouts/token limits, tool policy, and the shared `agents.budgetUsd` ledger when configured.

Prefer ordinary `run`/`spawn` unless recursive decomposition materially reduces Main's context burden.