---
name: fabric-exec
description: >-
  Advanced reference for Pi Code Mode / `fabric_exec`. Use when a program needs
  exact Pi, MCP, captured-extension, tier/policy subagent, todo, or error-recovery
  contracts; routine tool calling should rely on compact ambient guidance.
---

# `fabric_exec` — Lean Code Mode reference

`fabric_exec` runs one type-checked TypeScript program in an isolated executor. Compose related calls in that program and return only the bounded value Main needs. `print()` and `console.log()` are diagnostics, not the returned result.

The TUI always keeps generated TypeScript observable: collapsed cards show the first 15 lines, `Ctrl+O` expands the program, live nested calls show concise headlines, write/edit activity includes a bounded diff preview, and the current Todo list is rendered inside the same card.

## Built-in Todo

For non-trivial multi-step work, maintain the session-local task list from inside `fabric_exec` with `todo(...)`.

```ts
await todo([
  { content: "Inspect runtime", status: "completed" },
  {
    content: "Implement guest todo API",
    status: "in_progress",
    activeForm: "Implementing guest todo API",
  },
  { content: "Run verification", status: "pending" },
]);
```

Each call replaces the complete current list. Use `await todo([])` to clear it. Items use `pending`, `in_progress`, or `completed`. `activeForm` is optional and should be a short present-progress label.

Todo is a Code Mode built-in. Main does not receive a separate Pi `todo` tool. Keep simple one-step requests free of Todo bookkeeping; use it when several meaningful steps need visible progress.

## Pi tools

In Full Code Mode, call Pi core tools through `pi.*`:

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

Shell execution is `pi.bash(...)`; there is no `pi.exec`. Unknown `pi.*` members are rejected by the guest TypeScript checker before execution.

Prefer search-before-read and bounded ranges. Avoid returning large raw tool results when a smaller derived value is enough.

For multiline/syntax-heavy payloads, pass data through top-level `strings` and read it as `π.<key>` rather than embedding it in generated TypeScript.

## Captured extension tools

Additive Pi extension tools hidden from Main remain callable as `extensions.*` while Pi's registered-tool lifecycle still runs:

```ts
const result = await extensions.some_tool({ /* extension args */ });
return result;
```

Core overrides remain on `pi.*`. For example, FFF override mode is reached through `pi.find` / `pi.grep`, not `extensions.fffind` / `extensions.ffgrep`.

If the exact tool or schema is unknown, discover it before calling it.

## MCP

Known MCP refs use generated namespaces:

```ts
return mcp.some_server.some_tool({ query: "..." });
```

Use `tools.search`, `tools.describe`, and `tools.call` for unknown or computed refs. See `<skill-dir>/references/mcp.md` for MCP naming/management details.

## Tier/policy subagents

Main creates the temporary role and chooses execution semantics without selecting a configured profile:

```ts
const finding = await agents.run({
  tier: "fast",
  policy: "inspect",
  role: "repository scout",
  instructions: "Return concrete file references and keep the result compact.",
  task: "Collect bounded evidence for this question.",
});
return finding;
```

Tiers are `fast`, `balance`, and `strong`. Capability policies are `inspect`, `execute`, `modify`, and `isolated`. Load `fabric-subagents` for the routing policy, default mappings, configuration overrides, spawn/wait/steer controls, or bounded recursion.

Use `agents.routing({})` only when active tier/policy overrides need inspection; ordinary calls should choose from the known semantic names directly.

When one child context is genuinely insufficient:

```ts
return agents.recurse({
  tier: "strong",
  policy: "inspect",
  role: "problem decomposer",
  task: "Recursively decompose this cross-module problem and return the verified conclusion.",
});
```

The selected tier must resolve to Pi. Recursion remains bounded by configured depth, call, token, timeout, cost, and policy guards.

## Thin workflow composition

For dependent work, use ordinary sequential `await`. For a few independent operations, `Promise.all(...)` is usually clearest. Use `parallel(...)`, `pipeline(...)`, or phases only when they reduce orchestration noise.

Workflow workers use the same `tier`, `policy`, and temporary `role` semantics as `agents.run`; workflow code should not choose raw model/runner/thinking/tool settings.

Load `fabric-workflow` when multi-item bounded concurrency, repeated stages, or explicit phase progress makes the program clearer than plain TypeScript.

## Error recovery

When an argument shape fails:

1. Read the validation error.
2. Use `tools.describe({ ref })` if the schema is not known.
3. Correct and retry only the failed call.

Do not guess provider names or fall back to removed Full Fabric surfaces. Lean V2 is Code Mode + built-in Todo + captured/MCP tools + Main-routed tier/policy one-shot subagents + thin workflow + bounded recursive Pi delegation.
