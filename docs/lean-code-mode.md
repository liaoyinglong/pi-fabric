# Lean Code Mode

Lean Fabric is an execution bridge. It does not own planning or task orchestration.

```text
Pi agent
  |
  `-- fabric_exec
      |-- pi.*
      |-- extensions.*
      |-- mcp.*
      `-- tools.*
```

## One model-facing tool

The model-facing Fabric surface is only `fabric_exec`. Pi core tools and captured extension tools can be hidden from the model while remaining callable inside the execution program.

The `fabric_exec` tool's own prompt snippet/guidelines carry the minimal stable ABI needed for a correct first call. Fabric does not maintain a separate generic instruction layer.

## Host compatibility shims

Hiding Pi's native core tools changes two host behaviors that Lean must deliberately preserve:

- Pi normally includes model-visible skills only while native `read` is active. Lean restores the same skill catalog and changes only the load instruction to use `pi.read` inside `fabric_exec`.
- Exact-name core overrides may define `promptSnippet` or `promptGuidelines`. Lean preserves that authored guidance after the original override tool is hidden and re-exposed through `pi.*`.

The packaged `fabric-exec` skill is an on-demand reference. It is documentation, not orchestration or persistent agent state.

## Guest ABI

Retained globals:

- `pi`
- `extensions`
- `mcp`
- `tools`
- `π`
- `print` and `console`
- timers

Fabric does not add scheduling helpers. Use sequential `await` for dependency order and `Promise.all(...)` for independent work.

## Executors

QuickJS is the default sandbox. The optional `node-process` executor runs the same generated guest contract in a disposable Node subprocess. Both use the same host dispatch, cancellation, output bounds, and deadline rules.

A long explicit `pi.bash` timeout can raise the enclosing execution deadline enough for that shell call. Generic provider calls do not receive a special orchestration timeout floor.

## Capability discovery

Known Pi, captured extension, and MCP actions use direct namespaces. Generic discovery remains available through `tools.providers`, `tools.catalog`, `tools.list`, `tools.search`, and `tools.describe`. `tools.call` handles computed refs.
