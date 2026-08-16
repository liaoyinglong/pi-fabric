---
name: fabric-exec
description: >-
  Advanced reference for Pi Code Mode / `fabric_exec`. Use when a program needs
  exact Pi, MCP, captured-extension, discovery, or error-recovery contracts;
  routine tool calling should rely on the compact ambient guidance.
---

# `fabric_exec` — lean Code Mode reference

`fabric_exec` runs one type-checked TypeScript program in an isolated executor. Compose related calls in that program and return only the bounded value the main model needs. `print()` and `console.log()` are diagnostic output; they are not the returned result.

## Pi tools

In full Code Mode, call Pi core tools through `pi.*`:

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
| `pi.bash` | command or `{ command, timeout?, settle? }` | `{ ok, output, details, ... }` |
| `pi.edit` | `{ path, oldText, newText }` or edit list | `{ ok, output, details }` |
| `pi.write` | `{ path, content }` | `{ ok, output, details }` |

`bash`, `edit`, and `write` return envelopes; read `.output` when you need their textual result. Ordinary `bash` non-zero exits reject unless `settle: true` is requested. Timeout, cancellation, approval, and security failures still reject.

Prefer search-before-read and bounded ranges. Avoid returning large raw tool results when a smaller derived value is enough.

For multiline or syntax-heavy payloads, pass data through `strings` and read it as `π.<key>` rather than embedding it into generated TypeScript.

## Captured extension tools

Pi extension tools hidden from the model remain callable inside Code Mode as:

```ts
const result = await extensions.some_tool({ /* extension args */ });
return result;
```

Captured tools keep Pi's normal execution lifecycle and authoritative argument validation. If you do not know the exact tool name or schema, discover it instead of guessing.

## MCP

Known MCP tools use the generated namespace:

```ts
const result = await mcp.some_server.some_tool({ query: "..." });
return result;
```

Server and tool identifiers are sanitized into valid TypeScript property names. Use discovery when the exact ref is unknown. See `<skill-dir>/references/mcp.md` only when MCP naming or management details are necessary.

## Discovery and dynamic refs

Use the `tools` surface for discovery, not as a replacement for known direct calls:

```ts
const matches = await tools.search({ query: "browser screenshot" });
const action = matches[0];
if (!action) return null;
const descriptor = await tools.describe({ ref: action.ref });
return { ref: action.ref, inputSchema: descriptor.inputSchema };
```

For a computed or dynamically discovered ref:

```ts
return await tools.call({ ref, args });
```

Useful discovery calls include `tools.providers`, `tools.catalog`, `tools.list`, `tools.search`, `tools.describe`, `tools.call`, and `tools.models`.

## Named subagents

One-shot subagents are intentionally retained in the lean runtime. Prefer semantic role names configured in the subagent role catalog:

```ts
const finding = await agents.run({
  name: "research",
  task: "Collect bounded evidence for this question.",
});
return finding;
```

Load `fabric-subagents` when you need role configuration, runner/model routing, spawning, waiting, or override details.

## Workflow composition

For dependent tool work, ordinary sequential `await` is clearest. For independent work, use `parallel(...)` or `all({...})` with bounded concurrency.

Workflows that delegate to subagents should use the same one-shot worker substrate rather than introducing another runtime. Load `fabric-workflow` for multi-phase fan-out, pipelines, verification, and workflow progress APIs.

## Error recovery

When a call fails because an argument shape is wrong:

1. Read the validation error.
2. Use `tools.describe({ ref })` if the schema is not already known.
3. Correct the arguments and retry only that failed call.

Do not guess provider names or silently fall back to legacy Fabric surfaces. The lean product surface is Code Mode, captured/MCP tools, named one-shot subagents, and workflows.
