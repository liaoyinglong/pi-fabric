# Usage

Lean Fabric exposes one Pi tool: `fabric_exec`.

Use it when related tool calls benefit from one TypeScript program with local variables, branching, loops, parallel calls, or a compact returned value. Keep simple direct work simple.

## Core tools

```ts
const hits = await pi.grep({ pattern: "createSession", path: "src", context: 2 });
const source = await pi.read({ path: "src/session.ts", offset: 1, limit: 160 });
return { hits, source };
```

`pi.read`, `pi.grep`, `pi.find`, and `pi.ls` resolve to strings. `pi.bash`, `pi.edit`, and `pi.write` resolve to envelopes with `ok`, `output`, and `details`.

## Independent work

Use `Promise.all` for independent operations:

```ts
const [routes, auth] = await Promise.all([
  pi.grep({ pattern: "route", path: "src" }),
  pi.grep({ pattern: "auth", path: "src" }),
]);
return { routes, auth };
```

Use `all({...})` when some tasks depend on other tasks in the same program.

## Captured extension tools

Pi extension tools captured by Fabric are available as `extensions.<tool>`:

```ts
return extensions.project_status({ verbose: false });
```

Core overrides still use the `pi.*` names.

## MCP

Known MCP tools use generated namespaces:

```ts
return mcp.github.get_repo({ owner: "acme", repo: "app" });
```

For unknown or computed refs:

```ts
const matches = await tools.search({ query: "repository issue" });
const descriptor = await tools.describe({ ref: matches[0].ref });
return { matches, descriptor };
```

Use `tools.call({ ref, args })` only when a direct namespace call is not practical.

## String inputs

Pass multiline or syntax-heavy data with the top-level `strings` field and access it through `π`:

```ts
const text = π.payload;
return text.length;
```

## Progress and logs

`tools.progress({ message: "Checking routes" })` updates execution progress. `print()` and `console.log()` write bounded diagnostics. The program's `return` value is the result sent back to the model.

## Removed orchestration surface

Lean Fabric does not provide subagents, workflow scheduling, routing tiers, built-in todo state, or child-agent lifecycle commands. The calling agent can use its own delegation or planning facilities outside Fabric and can call `fabric_exec` for execution when useful.
