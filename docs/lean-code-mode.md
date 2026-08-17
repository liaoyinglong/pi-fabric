# Lean Code Mode V2 Architecture

Pi Fabric Lean V2 is a Programmatic Tool Calling runtime for Pi. Its public runtime boundary is intentionally small:

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
        -> workflow helpers
```

Only the value returned by the TypeScript program is intended to return to the main model. Intermediate tool results, loops, filtering, branching, and fan-out remain inside the execution runtime.

## Retained product systems

### Code Mode

`fabric_exec` is the model-facing execution gateway. It provides typed TypeScript orchestration over Pi core tools, captured Pi extension tools, optional MCP, and optional one-shot agents.

### Tool capture

The capture layer observes Pi's internal `ExtensionRunner` registered-tool catalog. For each captured extension tool it keeps the real `RegisteredTool`, source metadata, owning runner, and wrapped executable tool. Calls made from Code Mode replay Pi's normal tool lifecycle so permission, audit, and other extension hooks can still participate.

This is why ordinary Pi extension tools can remain installed normally and still be invoked through `extensions.*` without a custom adapter.

### MCP

When `mcp.enabled` is true, `McpProvider` is an ActionRegistry provider. Known tools can be called directly as `mcp.<server>.<tool>(args)` and dynamic refs can be discovered through `tools.search` / `tools.describe`.

When MCP is disabled, Lean V2 does not register or warm the provider and omits the `mcp` guest global from the active capability surface.

For trusted projects, MCP discovery uses the project as its root. For untrusted projects, Lean V2 uses the user Agent directory as the mcporter discovery root and keeps the descriptor cache outside the repository, preventing project-local MCP/import configuration from being loaded through Fabric.

### Named one-shot subagents

`LeanAgentsProvider` wraps the one-shot portion of `AgentManager`; the old persistent AgentsProvider is not part of the Lean public surface. When `agents.enabled` is false, Lean V2 does not create or register the agents provider and system guidance does not advertise semantic delegation.

Role files:

```text
~/.pi/agent/fabric/subagents.yaml
.pi/fabric/subagents.yaml
```

Project role files are loaded only for projects Pi marks trusted. A role can bind its semantic name to runner, transport, model, persona, thinking, tools, instructions, timeout, extension policy, recursion, and worktree behavior. Trusted project fields override global fields, and explicit supported call arguments override role defaults.

Typical roles:

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

A Veda role can omit `model` and `persona` to inherit the installed backend defaults. Fabric forwards explicit selections to Veda and does not maintain its own Veda model/persona catalog.

Normal system guidance tells Main to discover `agents.roles({})` and prefer semantic roles over raw model ids when delegation is useful.

### Workflow

Workflow is orchestration only. It does not own a second agent runtime or model router.

```text
workflow
  -> agent(..., { name: "explore" })
  -> parallel(...)
  -> pipeline(...)
  -> agent(..., { name: "review" })
        -> agents.run(...)
        -> LeanAgentsProvider
        -> AgentManager
```

The workflow helper forwards its supported worker options, including `name`, to `agents.run`, so role selection follows the same resolver as a direct one-shot call.

## Physically removed product systems

Lean V2 does not expose these as user-facing providers, globals, skills, commands, or dashboard surfaces:

- Actors and mailboxes
- Mesh and participant topology
- State
- Schema runtime
- Fabric Memory
- RLM skill/provider surface
- Prewalk
- resident hosts
- Component supervisor and model-guidance plane
- trajectory handoff
- Fabric dashboard and settings command surface
- Fabric main-session compaction
- advanced Fabric skills outside exec/subagents/workflow

The package ships only these Fabric skills:

```text
fabric-exec
fabric-subagents
fabric-workflow
```

Pi's normal external/user skill catalog is still restored in Full Code Mode, with the progressive loading instruction adapted to use `pi.read` inside `fabric_exec`.

## Physical cleanup status

The Full Fabric product paths listed above are no longer merely hidden from the Lean public API:

- QuickJS no longer creates Memory, State, Schema, Components, Mesh, Council, RLM, Actor, participant, or trajectory-handoff globals/helpers.
- `FabricExecutionService` and `FabricInvocationContext` no longer carry deferred handoff state or hooks.
- `AgentManager`, worker arguments, worker environment propagation, lifecycle records, and retention no longer carry Actor/Mesh identity, capability-digest ownership, durable residency, session-seed, or thinking-transfer fields.
- Lifecycle and budget telemetry identify one-shot runs and runner attribution only; there is no Actor identity or Actor-specific rollup path.
- trajectory handoff/session-seed source files and Actor archive retention have been removed.

Lean intentionally retains one-shot child features that are useful independently of those systems: runner sessions for steering/follow-up, child compaction for running Pi workers, session export, worktrees, budgets, transports, and bounded recursive Pi children.

`schema.mode` and `fullCodeMode` remain broad TypeScript fields only for low-level ExecutionService test coverage; the live Lean loader normalizes them to Full Code Mode with Schema off. They do not reconnect the removed Schema product runtime.

## Configuration boundary

V2 keeps the established Fabric config locations for migration convenience:

```text
~/.pi/agent/fabric.json
.pi/fabric.json
```

The lean product consumes these groups:

- `executor`
- `approvals`
- `mcp`
- `agents`
- `capture`
- `retention`

Historical persistent-runtime keys do not activate removed providers. See [configuration.md](configuration.md) for the exact active fields and defaults.

## Build boundary

The distributable graph has three roots:

```text
src/lean-index.ts
src/protocol.ts
src/worker.ts
```

Both esbuild and declaration generation follow those roots. The build assertion rejects direct reachability of several heavyweight Full Fabric modules, including Actor manager, Mesh store, Schema controller, State store, Memory provider, resident host, and Prewalk modules.

That assertion guards against accidentally reconnecting removed product runtimes. The shared QuickJS, ExecutionService, AgentManager, worker, and retention paths are also covered by Lean-specific tests and source-level contracts so the removed Actor/Mesh/trajectory surfaces do not silently return.
