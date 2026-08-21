# Lean execution architecture

Pi Fabric is an execution bridge. Planning, delegation, workflows, agent lifecycle, and model selection stay with the calling agent or external extensions. Fabric may still provide bounded execution capabilities such as caller-scoped context memory, provided they do not create, schedule, or manage agents.

```text
Pi model
  |
  `-- fabric_exec
       |-- TypeScript type checker
       |-- QuickJS sandbox
       `-- ActionRegistry
            |-- pi.*
            |-- extensions.*
            `-- mcp.*
```

The registry applies validation, deterministic approvals, effect checks, audits, tracing, cancellation, deadlines, and bounded results around host calls.

## Model-facing surface

The model-facing Fabric surface is `fabric_exec`. Pi core tools and captured extension tools can be removed from Pi's active model tool set while remaining callable inside the execution program.

The `fabric_exec` prompt snippet and guidelines carry the stable ABI needed for a correct first call. The packaged `fabric-exec` skill supplies deeper reference material on demand.

## Host compatibility

Hiding Pi's native core tools changes two host behaviors that Lean preserves:

- Pi normally includes model-visible skills while native `read` is active. Lean restores the same skill catalog and changes the load instruction to `pi.read` inside `fabric_exec`.
- Exact-name core overrides can define `promptSnippet` or `promptGuidelines`. Lean keeps that authored guidance after the original tool is hidden and exposed through `pi.*`.

Captured tools stay registered with Pi. Host extensions that observe tool registration and lifecycle events continue to see them. Lean narrows the active model-facing set separately.

Nested `pi.*` calls replay Pi's tool lifecycle so extension middleware such as image handoff and auditing can participate.

## Guest ABI

Retained globals:

- `pi`
- `extensions`
- `mcp` when MCP is enabled
- `tools`
- `π`
- `print` and `console`
- timers

Fabric does not add scheduling helpers. Use sequential `await` for dependency order and `Promise.all(...)` for independent work.

## Provider lifecycle

Lean registers a static provider set for each runtime instance:

- Pi core provider
- captured extension provider
- optional MCP provider

MCP can discover dynamic servers inside `McpProvider`; this does not replace the registry provider itself. Capability views pin provider names and descriptor hashes so descriptor drift is rejected without a provider-generation lifecycle.

## Executor

Lean V2 uses QuickJS as its single sandbox executor. Host calls, cancellation, output bounds, memory limits, deadline extension, and guest stack remapping are enforced around that runtime contract.

A long explicit `pi.bash` timeout can raise the enclosing execution deadline enough for that shell call. Generic provider calls use the configured execution deadline.

## Capability discovery

Known Pi, captured extension, and MCP actions use direct namespaces. Generic discovery remains available through `tools.providers`, `tools.catalog`, `tools.list`, `tools.search`, and `tools.describe`. `tools.call` handles computed refs.

Discovery follows progressive disclosure:

- `tools.providers()` / `tools.catalog()` expose broad lightweight navigation metadata.
- `tools.list()` / `tools.search()` return lightweight action summaries by default and omit input/output schemas.
- `tools.describe({ ref })` fetches the full descriptor for one selected action.
- `includeSchemas: true` on list/search is an explicit high-cost compatibility path for bulk-schema use cases, not the default discovery strategy.

The model-facing guidance should therefore prefer `list/search -> choose refs -> describe selected refs -> call`, rather than bulk-loading every schema into a single execution result.

## Public protocol

The npm `pi-fabric/protocol` entrypoint is intentionally narrow. It exposes the nested tool-call prefix plus the V1 tool-result proxy envelope and reader used by extension middleware.

Provider, action, capability-view, invocation, approval, and effect types are internal Lean execution contracts. External extensions should interact through Pi tool registration/lifecycle APIs and the public middleware protocol, without depending on Fabric's internal registry types.
