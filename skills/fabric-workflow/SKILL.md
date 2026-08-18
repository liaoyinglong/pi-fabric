---
name: fabric-workflow
description: Composes Main-selected tier/policy subagents with ordinary TypeScript, parallel fan-out, pipelines, and phases. Use proactively when multiple independent or staged subtasks materially benefit from orchestration.
---

# Fabric Workflow

Workflow is a thin convenience layer over normal TypeScript and the same one-shot `agents.run` substrate. It is not a second agent runtime or a planner that decides for Main.

Main first decides whether decomposition is useful, then creates each worker's temporary role, tier, policy, and bounded task.

Prefer the smallest construct that makes orchestration clearer:

- ordinary sequential `await` when one step depends on the previous result;
- `Promise.all(...)` for a few independent calls when no workflow helper adds value;
- `parallel(...)` when bounded concurrency or many mapped items makes the intent clearer;
- `pipeline(...)` for repeated staged transforms over a collection;
- `phase(...)` only when explicit progress boundaries help a long execution.

For independent evidence gathering, cheap workers are usually enough:

```ts
const findings = await parallel(
  ["auth", "routing", "caching"].map((topic) => () =>
    agent(`Inspect ${topic} and return only concrete evidence.`, {
      tier: "fast",
      policy: "inspect",
      role: `${topic} repository scout`,
      label: `inspect ${topic}`,
    })
  ),
  { concurrency: 3 },
);

return await agent(
  `Independently verify these findings and remove unsupported claims:\n${JSON.stringify(findings)}`,
  {
    tier: "strong",
    policy: "inspect",
    role: "independent reviewer",
    label: "verify findings",
  },
);
```

For simple fan-out, direct TypeScript is preferable:

```ts
const [docs, code] = await Promise.all([
  agents.run({
    tier: "fast",
    policy: "inspect",
    role: "upstream researcher",
    task: "Check the upstream docs and return the relevant contract.",
  }),
  agents.run({
    tier: "fast",
    policy: "inspect",
    role: "repository scout",
    task: "Find the local implementation and return concrete evidence.",
  }),
]);
return { docs, code };
```

Use schema output only when machine-readable aggregation materially reduces ambiguity:

```ts
const inventory = await agent<{ items: string[] }>(
  `Find the bounded work items for this objective:\n${π.task}`,
  {
    tier: "fast",
    policy: "inspect",
    role: "work inventory analyst",
    label: "inventory",
    schema: {
      type: "object",
      properties: {
        items: { type: "array", maxItems: 32, items: { type: "string" } },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
);
```

## Default orchestration policy

Use `fast` for independent bounded discovery and repetitive checks. Use `balance` for routine implementation or reasoning steps. Use `strong` only for difficult synthesis or independent verification that materially benefits from a stronger context.

Choose the least-capable policy that satisfies the step: `inspect` before `execute`, `execute` before `modify`. Use `isolated` when mutation should happen away from Main's current worktree or when multiple mutating experiments need separation.

Do not parallelize dependent steps. Never run concurrent `modify` workers over overlapping files. Prefer `isolated` workers or partition file ownership when parallel mutation is genuinely useful.

Use `agents.spawn` plus `status`/`steer` only for a valuable long-running Pi/Claude worker that must be observed between turns. Use `agents.recurse({ tier, policy, role, task })` only when recursive decomposition is genuinely needed and the selected tier resolves to Pi; do not turn ordinary workflow fan-out into recursion.

The design rule is simple: if plain TypeScript is clearer, use plain TypeScript. Workflow helpers should reduce orchestration noise, while Main remains responsible for decomposition, routing, synthesis, and final decisions.
