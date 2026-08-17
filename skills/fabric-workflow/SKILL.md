---
name: fabric-workflow
description: Composes bounded profile-based subagents with ordinary TypeScript, parallel fan-out, pipelines, and phases. Use when explicit orchestration is clearer than a single agent call.
disable-model-invocation: true
---

# Fabric Workflow

Workflow is a thin convenience layer over normal TypeScript and the same one-shot `agents.run` substrate. It is not a second agent runtime.

Prefer the smallest construct that makes the orchestration clearer:

- ordinary sequential `await` when one step depends on the previous result;
- `Promise.all(...)` for a few independent calls when no workflow helper adds value;
- `parallel(...)` when bounded concurrency or many mapped items makes the intent clearer;
- `pipeline(...)` for repeated staged transforms over a collection;
- `phase(...)` only when explicit progress boundaries help a long execution.

A workflow worker chooses a semantic profile with `profile`. Model, runner, thinking, persona, and tool policy stay in `subagents.yaml` rather than in workflow code.

```ts
const findings = await parallel(
  ["auth", "routing", "caching"].map((topic) => () =>
    agent(`Inspect ${topic} and return only concrete evidence.`, {
      profile: "explore",
      label: `explore ${topic}`,
    })
  ),
  { concurrency: 3 },
);

return await agent(
  `Independently verify these findings and remove unsupported claims:\n${JSON.stringify(findings)}`,
  {
    profile: "review",
    label: "verify findings",
  },
);
```

For simple fan-out, direct TypeScript is preferable:

```ts
const [docs, code] = await Promise.all([
  agents.run({ profile: "research", task: "Check the upstream docs." }),
  agents.run({ profile: "explore", task: "Find the relevant implementation." }),
]);
return { docs, code };
```

Use schema output only when machine-readable aggregation materially reduces ambiguity:

```ts
const inventory = await agent<{ items: string[] }>(
  `Find the bounded work items for this objective:\n${π.task}`,
  {
    profile: "explore",
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

For editing workflows, avoid concurrent writes to the same files. Partition ownership, serialize dependent edits, or use a profile configured with `worktree: true` when isolation is useful.

Use `agents.spawn` plus `status`/`steer` only for a valuable long-running Pi/Claude worker that must be observed between turns. Veda remains one-shot. Use `agents.recurse({ profile, task })` only when recursive decomposition is genuinely needed; do not turn ordinary workflow fan-out into recursion.

The design rule is simple: if plain TypeScript is clearer, use plain TypeScript. Workflow helpers must reduce orchestration noise, not create a new abstraction layer.
