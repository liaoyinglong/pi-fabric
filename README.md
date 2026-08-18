# pi-fabric

Pi Fabric is a programmatic tool-calling layer for Pi. The Lean V2 runtime exposes one model-facing tool, `fabric_exec`, and lets a generated TypeScript program compose Pi core tools, captured extension tools, and MCP tools behind one bounded execution boundary.

## Scope

Fabric owns execution mechanics:

- sandboxed TypeScript execution with QuickJS or a disposable Node process
- Pi core tool dispatch through `pi.*`
- captured Pi extension dispatch through `extensions.*`
- MCP discovery and calls through `mcp.*` and `tools.*`
- argument validation, approvals, tracing, progress, output bounds, and cancellation
- dependency-aware `all({...})` plus ordinary TypeScript control flow

The calling agent owns planning and orchestration. Fabric no longer ships its own subagent manager, workflow helpers, todo state, worker process, routing tiers, child-agent dashboard, or delegation policy.

## Model-facing surface

Pi sees one Fabric tool:

```text
fabric_exec
```

Inside a `fabric_exec` program:

```ts
const [pkg, source] = await Promise.all([
  pi.read({ path: "package.json" }),
  pi.read({ path: "src/index.ts" }),
]);

const issue = await mcp.github.get_issue({ owner: "acme", repo: "app", issue_number: 42 });
return { packageBytes: pkg.length, sourceBytes: source.length, issue };
```

Available guest surfaces are:

- `pi.read`, `pi.bash`, `pi.edit`, `pi.write`, `pi.grep`, `pi.find`, `pi.ls`
- `extensions.<tool>(args)` for captured Pi extension tools
- `mcp.<server>.<tool>(args)` for known MCP tools
- `tools.providers/catalog/list/search/describe/call/progress/models`
- `all({...})`, `Promise.all(...)`, timers, `print`, `console`, and the `π` string input accessor

There is no `agents`, `workflow`, `agent`, `parallel`, `pipeline`, `phase`, `budget`, or built-in todo API in the Lean guest contract.

## `all({...})`

Use sequential `await` when one operation depends on another. Use `Promise.all` for independent operations. Use `all({...})` for a compact dependency graph:

```ts
const result = await all({
  packageJson: () => pi.read({ path: "package.json" }),
  source: () => pi.read({ path: "src/index.ts" }),
  summary: async function () {
    const [pkg, source] = await Promise.all([this.$.packageJson, this.$.source]);
    return { packageBytes: pkg.length, sourceBytes: source.length };
  },
});
return result.summary;
```

## Configuration

Global configuration lives at `~/.pi/agent/fabric.json`. Trusted projects can override it with `.pi/fabric.json`.

Lean V2 configuration covers executor limits, approvals, MCP, capture visibility/risk mapping, and UI update debounce. Agent runner, workflow, retention, and todo configuration are intentionally absent.

Use `/fabric` in TUI mode to open settings.

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
