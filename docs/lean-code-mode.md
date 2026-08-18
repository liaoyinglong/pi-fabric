# Lean Code Mode

Lean V2 treats Fabric as an execution and capability layer, not an orchestration runtime.

## Boundary

```text
Pi main agent
  |
  `-- fabric_exec
      |-- pi.*
      |-- extensions.*
      |-- mcp.*
      |-- tools.* discovery / generic dispatch
      `-- TypeScript control flow + all({...})
```

The main agent decides what work should happen, when it should happen, and whether its own subagent or planning facilities should be used. Fabric executes the bounded TypeScript program it is given.

## One model-facing tool

`LEAN_MODEL_FACING_TOOL_NAMES` contains only `fabric_exec`. Pi core tools and captured extension tools are hidden from the model when Lean capture owns them, then re-exposed inside the guest runtime.

This keeps the model-facing schema small without introducing a second planning layer.

## Guest ABI

Retained globals:

- `pi`
- `extensions`
- `mcp`
- `tools`
- `all`
- `π`
- `print` and `console`
- timers

Removed globals include Fabric-managed agents, workflow helpers, workflow phases, workflow budget, and built-in todo state. The type declarations omit them and the guest boundary deletes historical bootstrap globals before author code runs.

## Executors

QuickJS is the default sandbox. The optional `node-process` executor runs the same generated guest contract in a disposable Node subprocess. Both use the same host dispatch, cancellation, output bounds, and deadline rules.

A long explicit `pi.bash` timeout can raise the enclosing execution deadline enough for that shell call. Generic provider calls do not receive a special orchestration timeout floor.

## Capability discovery

Known Pi, captured extension, and MCP actions are exposed through direct namespaces. Generic discovery is available through `tools.providers`, `tools.catalog`, `tools.list`, `tools.search`, and `tools.describe`. `tools.call` handles computed refs.

## Composition

Use normal TypeScript. Sequential `await` expresses dependency and side-effect order. `Promise.all` expresses independent work. `all({...})` provides dependency-aware scheduling for a small graph while keeping intermediate values inside the program.

Fabric does not own task decomposition, delegation policy, child-agent lifecycle, or persistent workflow state.
