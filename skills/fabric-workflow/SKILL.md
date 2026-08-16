---
name: fabric-workflow
description: Runs a bounded Code Mode workflow with phases, parallel fan-out, pipelines, and named subagent roles. Use for audits, migrations, parallel research, or explicit workflow requests.
disable-model-invocation: true
---

# Fabric Workflow

Keep the complete orchestration program inside one `fabric_exec` call. Workflow owns ordering, fan-out, progress, and aggregation; it does **not** own a second agent runtime. Delegate worker execution to `agents.run` / `agents.spawn` and prefer configured semantic roles.

Core surfaces:

- `agents.roles()` discovers configured subagent roles.
- `agents.run({ role, task, ... })` runs a bounded worker and waits for the result.
- `agents.spawn({ role, task, ... })` starts a worker when the workflow has useful work to do before waiting.
- `parallel(thunks, { concurrency })` performs bounded fan-out; pass functions, not promises.
- `pipeline(items, ...stages)` performs sequential stages per item with cross-item concurrency.
- `workflow.configure`, `phase`, `workflow.item`, `workflow.event`, and `workflow.log` report progress.
- `workflow.budget` plus top-level `agentBudget` / `tokenBudget` bound expensive workflows.

Use semantic roles instead of model names. A typical policy is cheap evidence collection followed by strong verification:

```ts
type WorkOutcome =
  | { item: string; status: "completed"; finding: unknown }
  | { item: string; status: "failed"; error: string };

const catalog = await agents.roles();
const roleNames = new Set(catalog.roles.map((role: { name: string }) => role.name));
const exploreRole = roleNames.has("explore") ? "explore" : undefined;
const reviewRole = roleNames.has("review") ? "review" : undefined;

await workflow.configure({
  name: "Bounded analysis",
  description: "Discover evidence in parallel, then verify it independently",
});

await phase("Discover", { total: 1 });
const inventory = await agents.run({
  ...(exploreRole ? { role: exploreRole } : {}),
  name: "inventory",
  task: `Discover the bounded work items for this objective.\n\nObjective:\n${π.task}`,
  tools: ["read", "grep", "find", "ls"],
  schema: {
    type: "object",
    properties: {
      items: { type: "array", maxItems: 32, items: { type: "string" } },
    },
    required: ["items"],
    additionalProperties: false,
  },
});

const items = [...new Set(inventory.items.map((item: string) => item.trim()).filter(Boolean))];
await phase("Analyze", { total: items.length });

const outcomes = await parallel(
  items.map((item) => async (): Promise<WorkOutcome> => {
    try {
      const finding = await agents.run({
        ...(exploreRole ? { role: exploreRole } : {}),
        name: `explore ${item}`.slice(0, 50),
        task: `Analyze this bounded item with concrete evidence: ${item}\n\nObjective:\n${π.task}`,
      });
      return { item, status: "completed", finding };
    } catch (error) {
      return {
        item,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }),
  { concurrency: Math.min(4, Math.max(1, items.length)) },
);

const completed = outcomes.filter(
  (outcome): outcome is Extract<WorkOutcome, { status: "completed" }> =>
    outcome.status === "completed",
);
const failures = outcomes.filter((outcome) => outcome.status === "failed");
if (completed.length === 0) {
  return { status: "failed", failures, result: null };
}

await phase("Verify", { total: 1 });
const result = await agents.run({
  ...(reviewRole ? { role: reviewRole } : {}),
  name: "verify synthesis",
  task: `Adversarially verify only these completed findings. Remove unsupported claims and do not infer anything about failed items.\n\nObjective:\n${π.task}\n\nFindings:\n${JSON.stringify(completed)}`,
});

return {
  status: failures.length === 0 ? "success" : "partial",
  coverage: { requested: items.length, completed: completed.length },
  failures,
  result,
};
```

For edits, partition path ownership or use `worktree: true`; do not let concurrent workers edit the same files. Prefer cheap roles for discovery and evidence gathering, and strong roles for difficult reasoning or independent verification. Explicit `model`, `thinking`, or `tools` on a call override the selected role defaults when a one-off escalation is necessary.
