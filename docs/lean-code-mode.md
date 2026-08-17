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
        -> agents.*
     -> FabricExecutionService
        -> QuickJS / node-process executor
        -> workflow helpers
```

Only the value returned by the TypeScript program is intended to return to the main model. Intermediate tool results, loops, filtering, branching, and fan-out remain inside the execution runtime.

## Retained product systems

### Code Mode

`fabric_exec` is the model-facing execution gateway. It provides typed TypeScript orchestration over Pi core tools, captured Pi extension tools, optional MCP, and one-shot agents.

### Tool capture

The capture layer observes Pi's internal `ExtensionRunner` registered-tool catalog. For each captured extension tool it keeps the real `RegisteredTool`, source metadata, owning runner, and wrapped executable tool. Calls made from Code Mode replay Pi's normal tool lifecycle so permission, audit, and other extension hooks can still participate.

This is why ordinary Pi extension tools can remain installed normally and still be invoked through `extensions.*` without a custom adapter.

### MCP

When `mcp.enabled` is true, `McpProvider` is an ActionRegistry provider. Known tools can be called directly as `mcp.<server>.<tool>(args)` and dynamic refs can be discovered through `tools.search` / `tools.describe`.

When MCP is disabled, Lean V2 does not register or warm the provider and omits the `mcp` guest global from the active capability surface.

### Named one-shot subagents

`LeanAgentsProvider` wraps the one-shot portion of `AgentManager`; the old persistent AgentsProvider is not part of the Lean public surface.

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
    model: agy/gemini-flash
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

## Removed public systems

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

## Remaining internal compatibility code

The public Lean surface is smaller than the remaining internal implementation graph. These internals are still scheduled for physical cleanup and must not be treated as retained product features:

- `FabricExecutionService` still contains low-level handoff bookkeeping and a legacy `schema.commit` guard branch used by old unit-test seams.
- `FabricInvocationContext.deferHandoff?` remains as an internal compatibility/test hook until the ExecutionService handoff branch is deleted.
- `AgentManager`, worker options, and worker environment propagation still carry some old actor/mesh/residency/capability ownership fields inherited from Full Fabric.
- `agents/handoff.ts` and thinking-transfer/session-seed compatibility remain reachable through the shared one-shot manager implementation.
- retention still carries `actorRunArchiveMs` and actor-aware cleanup logic.
- the QuickJS setup still contains dormant legacy Council/RLM helper code even though the Lean guest type surface and ActionRegistry do not expose those products. This code should be removed from the guest setup in the physical-cleanup pass.
- `schema.mode` and `fullCodeMode` remain broad TypeScript fields for low-level ExecutionService coverage, while the V2 loader normalizes live runtime configuration to Full Code Mode with Schema off.

This distinction is deliberate in the documentation: the removed systems are absent from the Lean V2 public capability surface today; some shared internal compatibility paths still need deletion before the fork can claim that every old implementation fragment has been physically removed.

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

That assertion is a guard against accidentally reconnecting the removed product runtimes. It is not yet a proof that all compatibility symbols inside shared AgentManager, worker, ExecutionService, and QuickJS modules have been deleted. The remaining compatibility list above is the physical-cleanup backlog.
