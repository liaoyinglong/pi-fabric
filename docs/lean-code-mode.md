# Lean Code Mode V2 Architecture

Pi Fabric Lean V2 is a Programmatic Tool Calling runtime for Pi. Its runtime boundary is intentionally small:

```text
lean-index
  -> model-facing tool: fabric_exec
     -> LeanCodeModeRuntime
        -> built-in todo(...)
           -> TodoProvider
           -> session-local TodoStore
           -> persistent below-editor widget when UI is available
        -> ActionRegistry
           -> pi.*
           -> extensions.*
           -> mcp.* when enabled
           -> agents.* when enabled
        -> FabricExecutionService
           -> QuickJS / node-process executor
           -> thin workflow helpers
  -> registered-tool capture
```

Only the bounded program return is intended to reach Main from Code Mode. Intermediate tool results, loops, filtering, branching, Todo updates, and fan-out stay inside the execution runtime.

## Retained product systems

### Code Mode

`fabric_exec` is the single Lean model-facing execution gateway over Pi core tools, captured Pi extension tools, optional MCP, optional one-shot agents, workflow helpers, and the built-in Todo API.

The Lean TUI renderer shows generated TypeScript, live nested tool headlines/progress, bounded write/edit diffs, and a concise completion result. Todo has its own persistent widget below the editor so current coordination state is not duplicated into historical `fabric_exec` cards.

### Built-in Todo

Todo is exposed to generated TypeScript as `todo(...)` inside `fabric_exec`. Main does not receive a second Pi tool schema for task tracking.

The guest helper forwards to an internal `TodoProvider`, which owns a session-local `TodoStore`. The provider uses the normal ActionRegistry path for validation and execution, while the public API stays a small built-in method:

```ts
await todo([
  { content: "Inspect runtime", status: "completed" },
  { content: "Implement guest API", status: "in_progress" },
]);
```

The contract uses complete-list replacement. Each item contains `content`, `status`, and optional `activeForm`; an empty list clears state. `content` is capped at 200 characters, `activeForm` at 120 characters, and the list at 64 items.

Todo state belongs to the current session lifecycle and resets on session start/shutdown. There are no IDs, dependencies, priorities, persistence files, or command surface. This keeps Todo as bounded coordination metadata and leaves the removed Fabric State/Mesh systems out of Lean.

After each successful replacement, `TodoProvider` updates the Pi extension UI through `ctx.ui.setWidget("fabric-todo", ..., { placement: "belowEditor" })`. The widget persists across turns, shows up to eight items, strikes through completed work, uses `activeForm` for current work, and is removed by `todo([])` or session lifecycle cleanup. The internal `todo.replace` audit row stays hidden from the compact `fabric_exec` call list.

### Lean dashboard

`/fabric` opens a lightweight TUI overlay over `AgentManager`. It does not recreate the removed Fabric state/control plane.

The dashboard provides a live tree of top-level and recursive subagents, status/runner/tool/token summaries, live worker output, navigation, and guarded stop for top-level running agents.

Thin workflow helpers use the same `agents.run` substrate, so workflow workers appear in the same view without a second workflow state model.

### Tool capture

The capture layer observes Pi's registered-tool catalog and preserves the real registered tool plus executable lifecycle wrapper. Code Mode calls replay Pi's normal tool lifecycle so permission/audit extensions can still participate.

This lets ordinary Pi extension tools remain installed normally and still be invoked through `extensions.*` without a separate adapter.

Lean ownership re-asserts only `fabric_exec` as a model-facing tool. Todo lives inside that gateway and has no Pi tool registration to capture or hide.

### MCP

When enabled, `McpProvider` is an ActionRegistry provider. Known refs use `mcp.<server>.<tool>(args)` and unknown refs use `tools.search` / `tools.describe` / `tools.call`.

When disabled, Lean does not register/warm MCP and omits the `mcp` guest global.

### Main-routed one-shot subagents

`LeanAgentsProvider` wraps the one-shot portion of `AgentManager`. There is no persistent Actor/participant layer and no configured semantic-role catalog.

Main owns four decisions:

```text
1. whether to delegate
2. temporary role / instructions for this child
3. tier: fast | balance | strong
4. policy: inspect | execute | modify | isolated
```

Tier is the cost/capability routing dimension. Policy is the capability-boundary dimension. Role is ephemeral prompt context only.

Built-in tier routing:

```text
fast     -> Pi gpt-5.6-luna, medium thinking
balance  -> Pi gpt-5.6-terra, medium thinking
strong   -> Pi gpt-5.6-sol, medium thinking
```

The built-in table uses Pi for all three tiers. AGY and Droid remain available when a tier override selects `runner: cli`.

Built-in capability policies:

```text
inspect   read grep find ls
execute   inspect + bash
modify    read grep find ls bash edit write
isolated  same mutation tools + isolated worktree
```

The model-facing API is:

```ts
agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  instructions: "Return compact evidence.",
  task: "...",
});
```

Raw runner/model/thinking/tools/worktree fields are absent from the model-facing call schema. Tier and policy configuration resolve them internally.

Routing override files are optional:

```text
~/.pi/agent/fabric/subagents.yaml
.pi/fabric/subagents.yaml
```

Only `tiers:` and `policies:` are recognized. Project overrides load only for trusted projects. There is no `roles:` / profile compatibility layer.

Main can inspect semantic routing metadata with `agents.routing({})`; model/runner IDs stay hidden from that result.

### Main-owned autonomous routing

Ambient guidance tells Main to keep simple tightly-coupled work local and delegate when isolation protects context, independent work can run in parallel, a cheaper child is sufficient, independent verification helps, or mutation is safer in a worktree.

Main is instructed to choose the lowest tier likely to succeed and escalate only if evidence/quality is insufficient. It must not parallelize dependent work or allow concurrent mutating children to overlap file ownership.

Every child gets a compact-output contract: return conclusions/evidence with the tool transcript omitted, report uncertainty, and do not broaden scope.

### Thin workflow

Workflow is syntax/concurrency convenience over ordinary TypeScript and the same `agents.run` substrate. It does not own a second router or decide tiers for Main.

```text
plain await / Promise.all
        |
        +-- optional parallel / pipeline / phase helpers
        |
        `-- agent(..., { tier, policy, role })
                    -> agents.run(...)
                    -> LeanAgentsProvider
                    -> AgentManager
```

The design rule is that helpers must reduce code/noise compared with plain TypeScript. For a few independent child calls, `Promise.all` is preferable.

### Minimal recursive delegation

Lean retains one explicit recursive primitive:

```ts
agents.recurse({
  tier: "strong",
  policy: "inspect",
  role: "problem decomposer",
  task: "...",
});
```

This is not the removed RLM provider. The selected tier must resolve to Pi. All three built-in tiers satisfy that requirement. The child gets recursive Lean Code Mode and the parent receives a compact result; the full internal run record stays hidden.

Existing guards provide bounded execution:

```text
maxDepth            recursive Pi depth
maxPerExecution     run/spawn/recurse starts in one fabric_exec
maxTokensPerChild   optional per-child token ceiling
agents.timeoutMs    child deadline
agents.budgetUsd    optional shared cost ledger
selected policy     hard tool/worktree capability boundary
```

No recursive Actor tree, Mesh, scheduler, state layer, or separate workflow engine is introduced.

## Direct CLI adapters

`AgentManager` keeps a generic CLI runner with adapters. Initial adapters are `agy` and `droid`.

A tier override can map to `runner: cli` and choose an adapter. The adapter owns invocation arguments, portable-tool mapping, model normalization, and result parsing. Transport remains orthogonal.

CLI adapters are one-shot and cannot recurse or receive steering/follow-up/compaction.

## Physically removed systems

Lean V2 does not expose or carry these product systems:

- Actors/mailboxes and participant topology
- Mesh
- State
- Schema product runtime
- Fabric Memory
- standalone RLM provider/skill
- Councils and Swarms
- Prewalk
- resident hosts
- Component supervisor/model-guidance plane
- trajectory handoff/session seeding/thinking transfer
- legacy Fabric dashboard/settings control plane
- Fabric main-session compaction
- advanced Full Fabric skills outside exec/subagents/workflow

The Lean dashboard is intentionally a thin view/controller over `AgentManager` only and does not restore that legacy control plane.

The package ships only these Lean skills:

```text
fabric-exec
fabric-subagents
fabric-workflow
```

Todo ships as part of `fabric_exec`: `src/todo-store.ts` holds bounded session state, `src/providers/todo-provider.ts` handles internal replacement calls and UI refreshes, `src/todo-guest.ts` injects the typed guest helper used by generated TypeScript, and `src/ui/lean-todo-render.ts` owns the persistent widget presentation.

Pi's normal external/user skill catalog remains available in Full Code Mode, with progressive loading adapted to `pi.read` inside `fabric_exec`.

## Configuration boundary

V2 keeps established Fabric config paths:

```text
~/.pi/agent/fabric.json
.pi/fabric.json
```

Active groups:

- `executor`
- `approvals`
- `mcp`
- `agents`
- `capture`
- `retention`

Subagent routing is an additional `subagents.yaml` tier/policy layer. It does not create a second persistent runtime.

Historical persistent-runtime keys do not activate removed providers. See [configuration.md](configuration.md).

`schema.mode` and `fullCodeMode` remain broad TypeScript fields only for low-level ExecutionService test compatibility; the live Lean loader normalizes to Full Code Mode with Schema off.

## Build boundary

Distributable roots:

```text
src/lean-index.ts
src/protocol.ts
src/worker.ts
```

Todo modules are reachable through the Lean entrypoint and do not add another distributable root or runtime subsystem.

esbuild and declaration generation follow those roots. Build assertions reject reachability of removed heavyweight product modules. Lean-specific runtime/type tests lock the absence of removed guest globals and the tier/policy-only model-facing agent contract.
