# Lean Code Mode V2 Architecture

Pi Fabric Lean V2 is a Programmatic Tool Calling runtime for Pi. Its runtime boundary is intentionally small:

```text
lean-index
  -> registered-tool capture
  -> LeanCodeModeRuntime
     -> ActionRegistry
        -> pi.*
        -> extensions.*
        -> mcp.*
        -> agents.*
     -> FabricExecutionService
        -> QuickJS / node-process executor
        -> workflow helpers
```

Only the value returned by the TypeScript program is intended to return to the main model. Intermediate tool results, loops, filtering, branching, and fan-out remain inside the execution runtime.

## Retained systems

### Code Mode

`fabric_exec` is the model-facing execution gateway. It provides typed TypeScript orchestration over Pi core tools, captured Pi extension tools, MCP, and one-shot agents.

### Tool capture

The capture layer observes Pi's internal `ExtensionRunner` registered-tool catalog. For each captured extension tool it keeps the real `RegisteredTool`, source metadata, owning runner, and wrapped executable tool. Calls made from Code Mode replay Pi's normal tool lifecycle so permission, audit, and other extension hooks can still participate.

This is why ordinary Pi extension tools can remain installed normally and still be invoked through `extensions.*` without a custom adapter.

### MCP

`McpProvider` remains a first-class ActionRegistry provider. Known tools can be called directly as `mcp.<server>.<tool>(args)` and dynamic refs can be discovered through `tools.search` / `tools.describe`.

### Named one-shot subagents

`LeanAgentsProvider` wraps the existing one-shot `AgentManager` rather than the old persistent AgentsProvider.

Role files:

```text
~/.pi/agent/fabric/subagents.yaml
.pi/fabric/subagents.yaml
```

A role can bind its semantic name to runner, transport, model, persona, thinking, tools, instructions, timeout, extension policy, recursion, and worktree behavior. Project fields override global fields, and explicit call arguments override role defaults.

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

### Workflow

Workflow is orchestration only. It does not own a second agent runtime or model router.

```text
workflow
  -> agent(..., { name: "explore" })
  -> parallel(...)
  -> pipeline(...)
  -> agent(..., { name: "review" })
        -> LeanAgentsProvider
        -> AgentManager
```

This keeps model routing inside semantic subagent roles.

## Physically removed systems

V2 removes the source/runtime surfaces for:

- Actors and mailboxes
- Mesh and participant topology
- State and certification
- Schema runtime
- Fabric Memory
- RLM skill/runtime surface
- Prewalk
- resident hosts
- Component supervisor, loader, and model-guidance plane
- trajectory handoff implementation
- Fabric dashboard and its UI controllers
- Fabric main-session compaction
- advanced Fabric skills outside exec/subagents/workflow

The package ships only these Fabric skills:

```text
fabric-exec
fabric-subagents
fabric-workflow
```

Pi's normal external/user skill catalog is still restored in Full Code Mode, with the progressive loading instruction adapted to use `pi.read` inside `fabric_exec`.

## Compatibility remnants

A few names remain only to avoid unnecessary churn in low-level shared code. They do not represent retained product features:

- `components/types.ts` contains only generic capability-requirement and provider-generation lease interfaces used by `ActionRegistry`; no Component runtime exists.
- `agents/handoff.ts` is an unreachable compatibility shim that throws if an old internal `sessionSeed` path is used. The public lean subagent provider never creates such a request.
- `FabricInvocationContext.deferHandoff?` is an optional low-level ExecutionService test hook. Lean V2 does not install it.
- `schema.mode` and `fullCodeMode` remain broad TypeScript fields for ExecutionService unit coverage, while the V2 config loader always normalizes runtime configuration to Full Code Mode with Schema off.

## Configuration boundary

V2 still reads the established Fabric config locations for migration convenience:

```text
~/.pi/agent/fabric.json
.pi/fabric.json
```

Only these groups are used by the lean product:

- `executor`
- `approvals`
- `mcp`
- `agents`
- `capture`
- `retention`

Historical persistent-runtime keys are ignored.

## Build boundary

The distributable graph has three roots:

```text
src/lean-index.ts
src/protocol.ts
src/worker.ts
```

Both esbuild and declaration generation follow those roots. The build assertion rejects legacy Actor/Mesh/State/Schema/Memory/Residency/Prewalk modules if they become reachable again. This makes the lean boundary an enforced build property rather than a documentation convention.
