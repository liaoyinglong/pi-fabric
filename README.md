# pi-fabric

Pi Fabric is a programmatic tool-calling execution layer for Pi. It exposes one model-facing tool, `fabric_exec`, which runs a type-checked TypeScript program and bridges that program to Pi core tools, captured extension tools, and MCP tools.

## Scope

Fabric owns execution mechanics:

- sandboxed TypeScript execution with QuickJS or a disposable Node process
- Pi core dispatch through `pi.*`
- captured extension dispatch through `extensions.*`
- MCP dispatch through `mcp.*`
- dynamic discovery through `tools.*`
- validation, deterministic approvals, cancellation, tracing, progress, and bounded output

Fabric does not own planning, delegation, workflows, todos, model selection, or agent policy.

## Model-facing surface

Pi sees one Fabric tool:

```text
fabric_exec
```

Inside a program:

```ts
const [pkg, source] = await Promise.all([
  pi.read({ path: "package.json" }),
  pi.read({ path: "src/index.ts" }),
]);

return { packageBytes: pkg.length, sourceBytes: source.length };
```

Retained guest surfaces:

- `pi.read`, `pi.bash`, `pi.edit`, `pi.write`, `pi.grep`, `pi.find`, `pi.ls`
- `extensions.<tool>(args)` for captured Pi extension tools
- `mcp.<server>.<tool>(args)` for known MCP tools
- `tools.providers/catalog/list/search/describe/call/progress`
- ordinary JavaScript/TypeScript control flow, `Promise.all`, timers, `print`, `console`, and `π`

Fabric-specific scheduling helpers such as `all({...})` are intentionally absent. Use the language runtime directly.

## On-demand reference skill

Fabric ships `fabric-exec` as a progressive, on-demand reference for exact guest ABI, MCP, captured-extension, discovery, and error-recovery details. The skill is documentation, not an orchestration layer.

Lean hides Pi's native core tools from the model, including `read`, so a narrow compatibility shim preserves Pi's model-visible skill catalog and adapts skill loading to `pi.read` inside `fabric_exec`. Fabric also preserves prompt guidance authored by captured exact-name core overrides.

## Configuration

Global configuration lives at `~/.pi/agent/fabric.json`. Trusted projects can override it with `.pi/fabric.json`.

Configuration is file-based. Fabric does not provide a settings TUI.

## Documentation

- [`docs/usage.md`](docs/usage.md)
- [`docs/configuration.md`](docs/configuration.md)
- [`docs/lean-code-mode.md`](docs/lean-code-mode.md)
- [`skills/fabric-exec/SKILL.md`](skills/fabric-exec/SKILL.md)

## Development

```bash
pnpm install
pnpm check
```

`pnpm check` runs type checking, build/artifact assertions, Vitest, and Knip dead-code analysis.
