---
name: fabric-exec
description: >-
  Advanced reference for Pi Code Mode / `fabric_exec`. Use when a program needs
  exact Pi, MCP, captured-extension, profile-subagent, or error-recovery
  contracts; routine tool calling should rely on compact ambient guidance.
---

# `fabric_exec` — Lean Code Mode reference

`fabric_exec` runs one type-checked TypeScript program in an isolated executor. Compose related calls in that program and return only the bounded value Main needs. `print()` and `console.log()` are diagnostics, not the returned result.

The TUI always keeps generated TypeScript observable: collapsed cards show the first 8 lines, `Ctrl+O` expands the program, live nested calls show concise headlines, and write/edit activity includes a bounded diff preview.

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

Prefer search-before-read and bounded ranges. Avoid returning large raw tool results when a smaller derived value is enough.

For multiline/syntax-heavy payloads, pass data through top-level `strings` and read it as `π.<key>` rather than embedding it in generated TypeScript.

## Captured extension tools

Additive Pi extension tools hidden from Main remain callable as `extensions.*` while Pi's registered-tool lifecycle still runs:

```ts
const result = await extensions.some_tool({ /* extension args */ });
return result;
```

Core overrides remain on `pi.*`. For example, FFF override mode is reached through `pi.find` / `pi.grep`, not `extensions.fffind` / `extensions.ffgrep`.

If the exact tool or schema is unknown, discover it rather than guessing.

## MCP

Known MCP refs use generated namespaces:

```ts
return mcp.some_server.some_tool({ query: "..." });
```

Use `tools.search`, `tools.describe`, and `tools.call` for unknown or computed refs. See `<skill-dir>/references/mcp.md` for MCP naming/management details.

## Profile-based subagents

Choose semantics, not model ids:

```ts
const finding = await agents.run({
  profile: "research",
  task: "Collect bounded evidence for this question.",
});
return finding;
```

Discover profiles with `agents.profiles({})`. `name` is display-only in new code. Load `fabric-subagents` for profile files, runner policy, spawn/wait/steer controls, or bounded recursion.

When one child context is genuinely insufficient:

```ts
return agents.recurse({
  profile: "deep",
  task: "Recursively decompose this cross-module problem and return the verified conclusion.",
});
```

Recursive profiles must resolve to Pi and remain bounded by configured depth, call, token, timeout, and cost guards.

## Thin workflow composition

For dependent work, use ordinary sequential `await`. For a few independent operations, `Promise.all(...)` is usually clearest. Use `parallel(...)`, `pipeline(...)`, or phases only when they reduce orchestration noise.

Workflow workers select the same semantic `profile` used by `agents.run`; workflow code should not choose raw model/runner/thinking policy.

Load `fabric-workflow` when multi-item bounded concurrency, repeated stages, or explicit phase progress makes the program clearer than plain TypeScript.

## Error recovery

When an argument shape fails:

1. Read the validation error.
2. Use `tools.describe({ ref })` if the schema is not known.
3. Correct and retry only the failed call.

Do not guess provider names or fall back to removed Full Fabric surfaces. Lean V2 is Code Mode + captured/MCP tools + profile-based one-shot subagents + thin workflow + bounded recursive Pi delegation.
