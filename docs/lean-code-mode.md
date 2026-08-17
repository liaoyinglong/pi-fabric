# Lean Code Mode V2 Architecture

Pi Fabric Lean V2 is a Programmatic Tool Calling runtime for Pi. Its runtime boundary is intentionally small:

```text
lean-index
  -> registered-tool capture
  -> LeanCodeModeRuntime
     -> ActionRegistry
        -> pi.*
        -> extensions.*
        -> mcp.* when enabled
        -> agents.* when enabled
     -> FabricExecutionService
        -> QuickJS / node-process executor
        -> thin workflow helpers
```

Only the bounded program return is intended to reach Main. Intermediate tool results, loops, filtering, branching, and fan-out stay inside the execution runtime.

## Retained product systems

### Code Mode

`fabric_exec` is the model-facing execution gateway over Pi core tools, captured Pi extension tools, optional MCP, and optional profile-based one-shot agents.

The Lean TUI renderer is deliberately small but observable: it shows generated TypeScript, live nested tool headlines/progress, bounded write/edit diffs, and a concise completion result.

### Lean dashboard

`/fabric` opens a lightweight TUI overlay for runtime observability. It reads the existing `AgentManager` directly rather than recreating the removed Fabric state/control plane.

The dashboard provides:

- a live tree of top-level and recursive subagents;
- status, runner, transport, model, current tool, call count, and token summaries;
- live `events.jsonl` output for the selected agent, including recursive children;
- keyboard navigation and guarded stop for top-level running agents;
- a stacked layout on narrow terminals and a two-pane layout when space permits.

Thin workflow helpers ultimately delegate through the same `agents.run` substrate, so workflow-launched agents appear in the same view without a second workflow state model.

The command surface remains available for scripting or focused inspection:

```text
/fabric agents
/fabric status <id>
/fabric log <id> [--lines N]
/fabric stop <id>
```

### Tool capture

The capture layer observes Pi's internal `ExtensionRunner` registered-tool catalog. For each captured tool it keeps the real `RegisteredTool`, source metadata, owning runner, and executable wrapper. Code Mode calls replay Pi's normal tool lifecycle so permission/audit extensions can still participate.

This is why ordinary Pi extension tools can remain installed normally and still be invoked through `extensions.*` without a separate adapter.

### MCP

When enabled, `McpProvider` is an ActionRegistry provider. Known refs use `mcp.<server>.<tool>(args)` and unknown refs use `tools.search` / `tools.describe` / `tools.call`.

When disabled, Lean does not register/warm MCP and omits the `mcp` guest global.

For trusted projects, discovery can use the project root. For untrusted projects, Lean uses the user Agent directory as mcporter discovery root and keeps descriptor cache state outside the repository.

### Profile-based one-shot subagents

`LeanAgentsProvider` wraps the one-shot portion of `AgentManager`. There is no persistent Actor/participant layer.

Configuration definitions remain under the historical `roles:` key:

```text
~/.pi/agent/fabric/subagents.yaml
.pi/fabric/subagents.yaml
```

Project definitions are loaded only for trusted projects. A profile binds semantic purpose to runner, transport, model, persona, thinking, tools, instructions, timeout, extension policy and worktree policy.

Typical catalog:

```yaml
roles:
  research:
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

The public selector is explicit `profile`:

```ts
agents.run({ profile: "explore", task: "..." })
```

`name` is display-only in the public schema. Matching old `name` values remain an internal compatibility fallback. Raw runner/model/thinking/tool policy is intentionally absent from the model-facing run/spawn schema.

Main guidance discovers `agents.profiles({})` and selects semantic profiles and leaves provider/model ids in configuration.

### Thin workflow

Workflow is syntax/concurrency convenience over ordinary TypeScript and the same `agents.run` substrate. It does not own a second agent runtime or router.

```text
plain await / Promise.all
        |
        +-- optional parallel / pipeline / phase helpers
        |
        `-- agent(..., { profile: "explore" })
                    -> agents.run(...)
                    -> LeanAgentsProvider
                    -> AgentManager
```

The design rule is that helpers must reduce code/noise compared with plain TypeScript. For a few independent child calls, `Promise.all` is preferable to a workflow abstraction.

### Minimal recursive delegation

Lean retains one explicit recursive primitive:

```ts
agents.recurse({ profile: "deep", task: "..." })
```

This is not the removed RLM provider. It resolves the same semantic profile, requires the Pi runner, enables recursive Lean Code Mode for that child, and returns a compact result that omits the full internal run record.

Existing guards provide bounded execution:

```text
maxDepth            recursive Pi depth
maxPerExecution     run/spawn/recurse starts in one fabric_exec
maxTokensPerChild   optional per-child token ceiling
agents.timeoutMs    child deadline
agents.budgetUsd    optional shared cost ledger across recursive Pi descendants
```

No recursive Actor tree, Mesh, scheduler, state layer, or separate workflow engine is introduced.

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

The Lean dashboard is intentionally not that legacy control plane: it is a thin view/controller over `AgentManager` only.

The package ships only:

```text
fabric-exec
fabric-subagents
fabric-workflow
```

Pi's normal external/user skill catalog remains available in Full Code Mode, with progressive loading adapted to `pi.read` inside `fabric_exec`.

## Physical cleanup status

The systems above are not merely hidden:

- QuickJS does not create Memory, State, Schema, Components, Mesh, Council, RLM, Actor, participant, or trajectory-handoff globals/helpers.
- `FabricExecutionService` and invocation contexts carry no deferred handoff state.
- `AgentManager`, worker args/environment, lifecycle records, and retention carry no Actor/Mesh identity, durable residency, capability ownership, session-seed, or thinking-transfer chain.
- lifecycle/budget telemetry describes one-shot runs and runner attribution only.

Lean intentionally keeps standalone one-shot features that remain useful: runner sessions for steering/follow-up, child compaction, session export, worktrees, budgets, transports, and bounded recursive Pi children.

## Configuration boundary

V2 keeps established Fabric config paths for migration convenience:

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

Historical persistent-runtime keys do not activate removed providers. See [configuration.md](configuration.md).

`schema.mode` and `fullCodeMode` remain broad TypeScript fields only for low-level ExecutionService test compatibility; the live Lean loader normalizes to Full Code Mode with Schema off.

## Build boundary

Distributable roots:

```text
src/lean-index.ts
src/protocol.ts
src/worker.ts
```

esbuild and declaration generation follow those roots. Build assertions reject reachability of removed heavyweight product modules. Lean-specific runtime/type tests additionally lock the absence of removed guest globals and the profile-only model-facing agent contract.
