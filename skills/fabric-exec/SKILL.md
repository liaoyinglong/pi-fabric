---
name: fabric-exec
description: >-
  Advanced reference for Pi Code Mode / fabric_exec. Use when a program needs
  exact Pi, MCP, captured-extension, discovery, or error-recovery contracts.
---

# `fabric_exec` — Pi Code Mode reference

`fabric_exec` runs one type-checked TypeScript program in an isolated executor. Fabric owns execution mechanics: tool discovery, argument validation, sandboxing, approvals, bounded output, tracing, and provider dispatch. The calling agent owns planning, delegation, workflow policy, and task tracking.

## Composition

Use ordinary TypeScript control flow. Sequential `await` is for dependent work. Use `Promise.all(...)` for independent calls. Fabric does not add a workflow or scheduling DSL.

## Pi tools

In Code Mode, call Pi core tools through `pi.*`:

```ts
const hits = await pi.grep({ pattern: "targetSymbol", path: "src", context: 2 });
const source = await pi.read({ path: "src/engine.ts", offset: 120, limit: 80 });
return { hits, source };
```

Common forms:

| Tool | Typical form | Result |
| --- | --- | --- |
| `pi.read` | `path` or `{ path, offset?, limit? }` | `string` |
| `pi.grep` | `{ pattern, path?, glob?, context?, limit? }` | `string` |
| `pi.find` | `{ pattern, path?, limit? }` | `string` |
| `pi.ls` | `path` or `{ path?, limit? }` | `string` |
| `pi.bash` | command or `{ command, timeout?, settle? }` | envelope |
| `pi.edit` | `{ path, oldText, newText }` or edit list | envelope |
| `pi.write` | `{ path, content }` | envelope |

Shell execution is `pi.bash(...)`; there is no `pi.exec`. Unknown `pi.*` members are rejected before execution. Prefer bounded reads and compact returned values.

For multiline or syntax-heavy payloads, pass data through top-level `strings` and read it as `π.<key>`.

## Captured extension tools

Captured Pi extension tools hidden from the model remain callable as `extensions.*` while the extension's registered-tool lifecycle still runs:

```ts
return extensions.some_tool({ /* extension args */ });
```

Core overrides stay on `pi.*`. Fabric preserves their authored prompt guidance because the original override tool is hidden from the model.

## MCP

Known MCP refs use generated namespaces:

```ts
return mcp.some_server.some_tool({ query: "..." });
```

Use `tools.search`, `tools.describe`, and `tools.call` for unknown or computed refs. `tools.providers()` and `tools.catalog()` expose bounded discovery metadata.

### Progressive discovery

Discovery is schema-lazy by default. `tools.list()` and `tools.search()` return lightweight action summaries without `inputSchema` or `outputSchema`. Do not bulk-load schemas just to discover what tools exist.

Preferred flow:

```ts
const candidates = await tools.search({ query: "repository issue", limit: 10 });
const selected = candidates.slice(0, 2);
const descriptors = await Promise.all(
  selected.map(({ ref }) => tools.describe({ ref })),
);
return descriptors.map(({ ref, inputSchema }) => ({ ref, inputSchema }));
```

Use this sequence:

1. `tools.providers()` / `tools.catalog()` when broad navigation is enough.
2. `tools.list()` or `tools.search()` to get lightweight candidates.
3. Choose the smallest relevant set of refs.
4. `tools.describe({ ref })` only for those selected refs.
5. Call the selected tool directly or with `tools.call({ ref, args })`.

`includeSchemas: true` on `tools.list()` / `tools.search()` is an explicit compatibility escape hatch for genuine bulk-schema tasks. Treat it as high-cost: avoid it unless the task actually requires many schemas at once.

Read `<skill-dir>/references/mcp.md` when exact MCP server-management, aliasing, or dynamic registration behavior matters.

## Progress and diagnostics

`tools.progress({ message })` can update the current execution status. `print()` and `console.log()` are bounded diagnostics and are separate from the returned result.

## Error recovery

When an argument shape fails, read the validation error, call `tools.describe({ ref })` if the schema is unknown, correct the call, and retry only the failed operation. Do not fall back to removed orchestration globals.
